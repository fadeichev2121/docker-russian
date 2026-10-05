#!/bin/bash
# MIT License
# Copyright (c) 2026 fadeichev2121
# Docker Desktop Russian Localizer - Linux Installer
set -euo pipefail
umask 022

OWNER="fadeichev2121"
REPO="docker-russian"
BRANCH="main"
PRODUCT="Docker Desktop"
SCRIPT_NAME="install.sh"

usage() {
  cat <<EOF
Русский интерфейс $PRODUCT для Linux

Запуск интерактивного меню:
  bash $SCRIPT_NAME

Прямые команды:
  bash $SCRIPT_NAME install   — установить русский перевод
  bash $SCRIPT_NAME status    — проверить статус русификации
  bash $SCRIPT_NAME restore   — вернуть оригинальный английский интерфейс
  bash $SCRIPT_NAME --help    — эта справка

Перед запуском полностью закройте Docker Desktop.
Нужны Linux, Python 3.9+ и установленный Docker Desktop (/opt/docker-desktop).
EOF
}

ACTION="${1:-menu}"
case "$ACTION" in
  --help|-h) usage; exit 0 ;;
  menu|install|status|restore) ;;
  *) printf '[Ошибка] Неизвестное действие: %s\n' "$ACTION" >&2; usage; exit 1 ;;
esac

if ! command -v python3 >/dev/null 2>&1; then
  printf '[Ошибка] Python 3 не найден. Установите Python 3.9+ (например: sudo apt install python3) и повторите попытку.\n' >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_PY="$SCRIPT_DIR/../core/patch.py"

if [ ! -f "$PATCH_PY" ]; then
  PATCH_PY="$SCRIPT_DIR/core/patch.py"
fi

# Standalone execution fallback (curl -fsSL ... | bash)
if [ ! -f "$PATCH_PY" ]; then
  TMP_DIR="$(mktemp -d -t docker_ru_linux_XXXXXX)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  mkdir -p "$TMP_DIR/core"

  printf 'Загрузка компонентов русификатора из GitHub...\n'
  BASE_URL="https://raw.githubusercontent.com/$OWNER/$REPO/$BRANCH/core"
  curl -fsSL "$BASE_URL/asar.py" -o "$TMP_DIR/core/asar.py"
  curl -fsSL "$BASE_URL/ui-runtime.js" -o "$TMP_DIR/core/ui-runtime.js"
  curl -fsSL "$BASE_URL/ru.json" -o "$TMP_DIR/core/ru.json"
  curl -fsSL "$BASE_URL/patch.py" -o "$TMP_DIR/core/patch.py"

  PATCH_PY="$TMP_DIR/core/patch.py"
fi

if [ "$ACTION" = "menu" ]; then
  clear || true
  printf '===================================================\n'
  printf '       Русский интерфейс для Docker Desktop (Linux) \n'
  printf '===================================================\n\n'
  printf 'Выберите действие:\n'
  printf '  1) Установить русский язык\n'
  printf '  2) Проверить статус\n'
  printf '  3) Откатить на оригинальный английский интерфейс\n'
  printf '  0) Выход\n\n'
  if [ -t 0 ]; then
    read -r -p "Введите номер [1-3, 0]: " CHOICE
  elif [ -e /dev/tty ]; then
    read -r -p "Введите номер [1-3, 0]: " CHOICE < /dev/tty
  else
    printf '[Ошибка] Неинтерактивная среда. Укажите команду напрямую: bash %s [install|status|restore]\n' "$SCRIPT_NAME" >&2
    exit 1
  fi
  case "$CHOICE" in
    1) ACTION="install" ;;
    2) ACTION="status" ;;
    3) ACTION="restore" ;;
    0) exit 0 ;;
    *) printf '[Ошибка] Неверный выбор: %s\n' "$CHOICE" >&2; exit 1 ;;
  esac
fi

# Check permissions for /opt/docker-desktop
TARGET_ASAR="/opt/docker-desktop/resources/app.asar"
if [ "$ACTION" != "status" ] && [ -f "$TARGET_ASAR" ] && [ ! -w "$TARGET_ASAR" ] && [ "$(id -u)" -ne 0 ]; then
  printf '\n[Внимание] Для изменения %s требуются права root.\n' "$TARGET_ASAR"
  printf 'Перезапуск через sudo...\n\n'
  if [ -t 0 ]; then
    exec sudo python3 "$PATCH_PY" "$ACTION"
  elif [ -e /dev/tty ]; then
    exec sudo python3 "$PATCH_PY" "$ACTION" < /dev/tty
  else
    exec sudo python3 "$PATCH_PY" "$ACTION"
  fi
fi

if [ -t 0 ]; then
  python3 "$PATCH_PY" "$ACTION"
elif [ -e /dev/tty ]; then
  python3 "$PATCH_PY" "$ACTION" < /dev/tty
else
  python3 "$PATCH_PY" "$ACTION"
fi
