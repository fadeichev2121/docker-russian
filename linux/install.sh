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
Нужен Node.js 18+ (LTS с https://nodejs.org/). Запускайте без sudo.
HELP
}
case "${1:-menu}" in --help|-h) usage; exit 0;; menu|install|launch|status|restore|logs|--app|--state) ;; *) usage;exit 1;; esac
case "$(uname -s)" in Darwin|Linux) ;; *) printf '[Ошибка] Для Windows используйте windows/install.ps1\n' >&2;exit 1;; esac
if [ "$(id -u)" -eq 0 ]; then printf '[Ошибка] Запустите без sudo — установка для вашего пользователя.\n' >&2;exit 1;fi
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'; then
 printf '[Ошибка] Нужен Node.js 18 или новее. Установите LTS с https://nodejs.org/ и откройте терминал заново.\n' >&2;exit 1
fi
TASK_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_CONTROL="$TASK_SCRIPT_DIR/core/control.cjs"
if [ ! -f "$TASK_CONTROL" ]; then TASK_CONTROL="$TASK_SCRIPT_DIR/../core/control.cjs";fi
TASK_TMP=''
cleanup() { if [ -n "$TASK_TMP" ] && [ -d "$TASK_TMP" ] && [ ! -L "$TASK_TMP" ];then rm -rf -- "$TASK_TMP";fi; }
trap cleanup EXIT
if [ ! -f "$TASK_CONTROL" ]; then
 command -v curl >/dev/null 2>&1 || { printf '[Ошибка] Нужен curl для загрузки файлов.\n' >&2;exit 1; }
 TASK_TMP="$(mktemp -d)"
 mkdir "$TASK_TMP/core"
 printf 'Загружаю русификатор Docker из GitHub…\n'
 curl -fLsS --retry 2 'https://api.github.com/repos/fadeichev2121/docker-russian/commits/main' -o "$TASK_TMP/commit.json"
 TASK_SHA="$(node -e 'const d=require(process.argv[1]);if(!/^[a-f0-9]{40}$/.test(d.sha||""))process.exit(1);process.stdout.write(d.sha)' "$TASK_TMP/commit.json")"
 for file in control.cjs launcher.cjs cdp-pipe.cjs ui-runtime.js ru.json;do
  curl -fLsS --retry 2 "https://raw.githubusercontent.com/fadeichev2121/docker-russian/$TASK_SHA/core/$file" -o "$TASK_TMP/core/$file"
 done
 TASK_CONTROL="$TASK_TMP/core/control.cjs"
fi
if [ -t 0 ];then
 node "$TASK_CONTROL" "$@"
elif [ -e /dev/tty ];then
 node "$TASK_CONTROL" "$@" < /dev/tty
else
 node "$TASK_CONTROL" "$@"
fi
