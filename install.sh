#!/bin/bash
# SPDX-License-Identifier: MIT
set -euo pipefail
umask 077
usage() {
cat <<'HELP'
Docker Desktop на русском
  bash docker_ru.sh              — понятное меню
  bash docker_ru.sh install      — установить помощник
  bash docker_ru.sh launch       — открыть оригинальный Docker на русском
  bash docker_ru.sh status       — состояние
  bash docker_ru.sh restore      — убрать перевод и ярлык
  bash docker_ru.sh logs         — показать причину ошибки
Путь к Docker: --app "/путь/к/Docker.app"
Node.js вручную ставить не нужно: служебные файлы загрузятся автоматически.
Запускайте без sudo.
HELP
}
case "${1:-menu}" in --help|-h) usage; exit 0;; menu|install|launch|status|restore|logs|--app|--state) ;; *) usage;exit 1;; esac
case "$(uname -s)" in Darwin|Linux) ;; *) printf '[Ошибка] Для Windows используйте windows/install.ps1\n' >&2;exit 1;; esac
if [ "$(id -u)" -eq 0 ]; then printf '[Ошибка] Запустите без sudo — установка для вашего пользователя.\n' >&2;exit 1;fi
TASK_TMP=''
cleanup() { if [ -n "$TASK_TMP" ] && [ -d "$TASK_TMP" ] && [ ! -L "$TASK_TMP" ];then rm -rf -- "$TASK_TMP";fi; }
trap cleanup EXIT
make_tmp() { if [ -z "$TASK_TMP" ];then TASK_TMP="$(mktemp -d)";fi; }
fail() { printf '[Ошибка] %s\n' "$*" >&2;exit 1; }
safe_runtime_path() {
 local p="$1"
 while [ "$p" != '/' ] && [ "$p" != '.' ];do
  [ ! -L "$p" ] || fail "Папка служебных файлов содержит ссылку: $p"
  p="$(dirname "$p")"
 done
}
file_sha() {
 if command -v sha256sum >/dev/null 2>&1;then sha256sum "$1" | awk '{print $1}';else shasum -a 256 "$1" | awk '{print $1}';fi
}
TASK_NODE=''
if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' >/dev/null 2>&1;then
 TASK_NODE="$(command -v node)"
else
 command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || fail 'Не найдена утилита SHA-256 для проверки служебных файлов.'
 case "$(uname -s)" in
  Darwin) TASK_PLATFORM=darwin;TASK_RUNTIME="$HOME/Library/Application Support/docker-russian-runtime";;
  Linux) TASK_PLATFORM=linux;TASK_RUNTIME="${XDG_DATA_HOME:-$HOME/.local/share}/docker-russian-runtime";;
 esac
 case "$(uname -m)" in arm64|aarch64) TASK_ARCH=arm64;;x86_64|amd64) TASK_ARCH=x64;;*) fail 'Автоматическая загрузка доступна только для ARM64 и x64.';;esac
 [[ "$TASK_RUNTIME" = /* ]] || fail 'Папка служебных файлов должна иметь абсолютный путь.'
 safe_runtime_path "$TASK_RUNTIME"
 if [ -e "$TASK_RUNTIME" ];then
  [ -d "$TASK_RUNTIME" ] && [ -O "$TASK_RUNTIME" ] || fail "Чужой каталог служебных файлов: $TASK_RUNTIME"
  safe_runtime_path "$TASK_RUNTIME/owner"
  [ -f "$TASK_RUNTIME/owner" ] && [ "$(cat "$TASK_RUNTIME/owner")" = 'docker-russian-node-runtime-v1' ] || fail "Каталог не принадлежит русификатору: $TASK_RUNTIME"
 else
  mkdir -p "$TASK_RUNTIME";printf '%s\n' 'docker-russian-node-runtime-v1' > "$TASK_RUNTIME/owner"
 fi
 chmod 700 "$TASK_RUNTIME"
 safe_runtime_path "$TASK_RUNTIME/current.txt"
 if [ -f "$TASK_RUNTIME/current.txt" ];then
  read -r TASK_HASH TASK_REL < "$TASK_RUNTIME/current.txt" || fail 'Некорректные сведения о служебных файлах.'
  [[ "$TASK_HASH" =~ ^[a-f0-9]{64}$ ]] && [[ "$TASK_REL" =~ ^node-v24\.[0-9]+\.[0-9]+-(darwin|linux)-(arm64|x64)-[A-Za-z0-9.]+/bin/node$ ]] || fail 'Некорректные сведения о служебных файлах.'
  TASK_NODE="$TASK_RUNTIME/$TASK_REL";safe_runtime_path "$TASK_NODE"
  [ -f "$TASK_NODE" ] && [ -O "$TASK_NODE" ] && [ "$(file_sha "$TASK_NODE")" = "$TASK_HASH" ] || fail 'Служебная копия Node.js повреждена: контрольная сумма SHA-256 не совпадает.'
 else
  command -v curl >/dev/null 2>&1 || fail 'Для загрузки служебных файлов нужен curl.'
  make_tmp
  printf 'Готовлю служебные файлы — Node.js вручную устанавливать не нужно…\n'
  curl --proto '=https' --tlsv1.2 -fLsS --retry 2 --connect-timeout 15 --max-time 180 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' -o "$TASK_TMP/SHASUMS256.txt"
  TASK_RECORD="$(awk -v suffix="-$TASK_PLATFORM-$TASK_ARCH.tar.gz" '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-/ && substr($2,length($2)-length(suffix)+1)==suffix {print $1 " " $2}' "$TASK_TMP/SHASUMS256.txt")"
  read -r TASK_HASH TASK_ARCHIVE <<< "$TASK_RECORD" || fail 'Официальный сайт вернул некорректные сведения о Node.js.'
  [[ "$TASK_HASH" =~ ^[a-f0-9]{64}$ ]] && [[ "$TASK_ARCHIVE" =~ ^node-v24\.[0-9]+\.[0-9]+-$TASK_PLATFORM-$TASK_ARCH\.tar\.gz$ ]] && [ "$(printf '%s\n' "$TASK_RECORD" | wc -l | tr -d ' ')" = 1 ] || fail 'Официальный сайт вернул некорректные сведения о Node.js.'
  TASK_NAME="${TASK_ARCHIVE%.tar.gz}";TASK_VERSION="${TASK_NAME#node-}";TASK_VERSION="${TASK_VERSION%%-*}"
  curl --proto '=https' --tlsv1.2 -fLsS --retry 2 --connect-timeout 15 --max-time 300 "https://nodejs.org/dist/$TASK_VERSION/$TASK_ARCHIVE" -o "$TASK_TMP/node.tar.gz"
  [ "$(file_sha "$TASK_TMP/node.tar.gz")" = "$TASK_HASH" ] || fail 'Контрольная сумма SHA-256 не совпадает. Служебные файлы не запускались.'
  tar -xzf "$TASK_TMP/node.tar.gz" -C "$TASK_TMP" "$TASK_NAME/bin/node" "$TASK_NAME/LICENSE"
  [ -f "$TASK_TMP/$TASK_NAME/bin/node" ] && [ ! -L "$TASK_TMP/$TASK_NAME/bin/node" ] || fail 'В архиве нет служебного исполняемого файла.'
  TASK_PACKAGE="$TASK_NAME-${TASK_TMP##*/}"
  [ ! -e "$TASK_RUNTIME/$TASK_PACKAGE" ] || fail 'Папка служебных файлов уже существует.'
  mv "$TASK_TMP/$TASK_NAME" "$TASK_RUNTIME/$TASK_PACKAGE"
  TASK_NODE="$TASK_RUNTIME/$TASK_PACKAGE/bin/node";chmod 700 "$TASK_NODE"
  TASK_CURRENT="$(mktemp "$TASK_RUNTIME/.current.XXXXXX")"
  printf '%s %s\n' "$(file_sha "$TASK_NODE")" "$TASK_PACKAGE/bin/node" > "$TASK_CURRENT"
  mv "$TASK_CURRENT" "$TASK_RUNTIME/current.txt"
 fi
 "$TASK_NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' >/dev/null 2>&1 || fail 'Служебные файлы не запускаются на этой системе. См. раздел ошибок в README.'
fi
TASK_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_CONTROL="$TASK_SCRIPT_DIR/core/control.cjs"
if [ ! -f "$TASK_CONTROL" ]; then TASK_CONTROL="$TASK_SCRIPT_DIR/../core/control.cjs";fi
if [ ! -f "$TASK_CONTROL" ]; then
 command -v curl >/dev/null 2>&1 || { printf '[Ошибка] Нужен curl для загрузки файлов.\n' >&2;exit 1; }
 make_tmp
 mkdir "$TASK_TMP/core"
 printf 'Загружаю русификатор Docker из GitHub…\n'
 curl -fLsS --retry 2 'https://api.github.com/repos/fadeichev2121/docker-russian/commits/main' -o "$TASK_TMP/commit.json"
 TASK_SHA="$("$TASK_NODE" -e 'const d=require(process.argv[1]);if(!/^[a-f0-9]{40}$/.test(d.sha||""))process.exit(1);process.stdout.write(d.sha)' "$TASK_TMP/commit.json")"
 for file in control.cjs launcher.cjs cdp-pipe.cjs ui-runtime.js ru.json;do
  curl -fLsS --retry 2 "https://raw.githubusercontent.com/fadeichev2121/docker-russian/$TASK_SHA/core/$file" -o "$TASK_TMP/core/$file"
 done
 TASK_CONTROL="$TASK_TMP/core/control.cjs"
fi
if [ -t 0 ];then
 "$TASK_NODE" "$TASK_CONTROL" "$@"
elif ( : < /dev/tty ) 2>/dev/null;then
 "$TASK_NODE" "$TASK_CONTROL" "$@" < /dev/tty
else
 "$TASK_NODE" "$TASK_CONTROL" "$@"
fi
