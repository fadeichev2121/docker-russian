#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 fadeichev2121
"""
Universal Cross-Platform Docker Desktop Russian Localizer.
Supports macOS, Windows, and Linux.
Zero external dependencies (pure Python 3.9+).
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys

# Import our pure Python Asar codec
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

try:
    from asar import Asar, digest
except ImportError:
    # If running from another location, try relative import
    from core.asar import Asar, digest

SENTINEL = "/* DOCKER_RU_LOCALIZER_V1 */"

def get_platform() -> str:
    if sys.platform == "darwin":
        return "macos"
    elif sys.platform in ("win32", "cygwin"):
        return "windows"
    elif sys.platform.startswith("linux"):
        return "linux"
    return sys.platform

def get_default_app_path() -> str:
    plat = get_platform()
    if plat == "macos":
        return "/Applications/Docker.app"
    elif plat == "windows":
        prog_files = os.environ.get("ProgramFiles", r"C:\Program Files")
        return os.path.join(prog_files, "Docker", "Docker")
    elif plat == "linux":
        return "/opt/docker-desktop"
    return ""

def resolve_asar_path(app_path: str) -> str:
    plat = get_platform()
    if not app_path:
        app_path = get_default_app_path()

    app_path = os.path.expanduser(os.path.expandvars(app_path))

    # If the user passed directly the app.asar file
    if os.path.isfile(app_path) and app_path.endswith(".asar"):
        return app_path

    if plat == "macos":
        nested = os.path.join(app_path, "Contents", "MacOS", "Docker Desktop.app", "Contents", "Resources", "app.asar")
        if os.path.exists(nested):
            return nested
        direct = os.path.join(app_path, "Contents", "Resources", "app.asar")
        if os.path.exists(direct):
            return direct
        return nested
    elif plat == "windows":
        candidate = os.path.join(app_path, "resources", "app.asar")
        if os.path.exists(candidate):
            return candidate
        # If passed C:\Program Files\Docker\Docker
        return candidate
    elif plat == "linux":
        candidate = os.path.join(app_path, "resources", "app.asar")
        if os.path.exists(candidate):
            return candidate
        return candidate

    return os.path.join(app_path, "resources", "app.asar")

def get_nested_macos_app(app_path: str) -> str:
    nested = os.path.join(app_path, "Contents", "MacOS", "Docker Desktop.app")
    if os.path.isdir(nested):
        return nested
    return app_path

def is_docker_running() -> bool:
    plat = get_platform()
    try:
        if plat == "macos":
            res = subprocess.run(["pgrep", "-if", "Docker Desktop.app|Docker.app"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            return res.returncode == 0
        elif plat == "windows":
            res = subprocess.run(["tasklist", "/FI", "IMAGENAME eq Docker Desktop.exe"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            return "Docker Desktop.exe" in res.stdout
        elif plat == "linux":
            res = subprocess.run(["pgrep", "-f", "docker-desktop"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            return res.returncode == 0
    except Exception:
        pass
    return False

def calculate_file_hash(filepath: str) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()

def check_status(app_path: str = "") -> bool:
    asar_path = resolve_asar_path(app_path)
    plat = get_platform()
    
    print("\n" + "=" * 55)
    print("      Docker Desktop — Проверка статуса русификации")
    print("=" * 55)
    print(f"Платформа:       {plat.upper()}")
    print(f"Путь к app.asar: {asar_path}")

    if not os.path.exists(asar_path):
        print(f"\n[!] Файл интерфейса Docker Desktop не найден.")
        print(f"    Убедитесь, что Docker Desktop установлен.")
        print("=" * 55 + "\n")
        return False

    backup_asar = asar_path + ".bak"
    has_backup = os.path.exists(backup_asar)
    
    # Read asar to check if patched
    is_patched = False
    try:
        with open(asar_path, "rb") as f:
            data = f.read()
        asar = Asar(data)
        preload_bytes = asar.read("build/desktop-ui-preload.js")
        if SENTINEL.encode("utf-8") in preload_bytes:
            is_patched = True
    except Exception as e:
        print(f"[Предупреждение] Не удалось прочитать архив asar: {e}")

    running = is_docker_running()

    print(f"Статус перевода: {'✓ УСТАНОВЛЕН (русский язык активен)' if is_patched else '○ НЕ УСТАНОВЛЕН (оригинал)'}")
    print(f"Резервная копия: {'✓ ЕСТЬ (' + backup_asar + ')' if has_backup else '○ НЕТ'}")
    print(f"Docker запущен:  {'ДА (нужно закрыть перед установкой/откатом)' if running else 'НЕТ (готов к установке)'}")
    print("=" * 55 + "\n")
    return is_patched

def install(app_path: str = ""):
    asar_path = resolve_asar_path(app_path)
    plat = get_platform()

    if not os.path.exists(asar_path):
        print(f"[Ошибка] Docker Desktop не найден по пути: {asar_path}", file=sys.stderr)
        print("Убедитесь, что Docker Desktop установлен в системе.", file=sys.stderr)
        sys.exit(1)

    if is_docker_running():
        print("\n[Внимание] Docker Desktop сейчас запущен!")
        print("Пожалуйста, полностью закройте Docker Desktop перед продолжением.")
        try:
            choice = input("Продолжить установку? [y/N]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            choice = "n"
        if choice not in ("y", "yes", "д", "да"):
            print("Установка отменена.")
            sys.exit(0)

    backup_asar = asar_path + ".bak"
    dict_path = os.path.join(SCRIPT_DIR, "ru.json")
    runtime_path = os.path.join(SCRIPT_DIR, "ui-runtime.js")

    if not os.path.exists(dict_path) or not os.path.exists(runtime_path):
        print(f"[Ошибка] Не найдены необходимые файлы словаря или рантайма в {SCRIPT_DIR}", file=sys.stderr)
        sys.exit(1)

    print("\nШаг 1/4: Чтение оригинального архива интерфейса...")
    with open(asar_path, "rb") as f:
        orig_data = f.read()

    asar = Asar(orig_data)
    if not asar.has_file("build/desktop-ui-preload.js"):
        print("[Ошибка] В архиве не найден файл build/desktop-ui-preload.js!", file=sys.stderr)
        sys.exit(1)

    preload_orig_bytes = asar.read("build/desktop-ui-preload.js")
    preload_orig = preload_orig_bytes.decode("utf-8", errors="replace")

    print("Шаг 2/4: Создание резервной копии (безопасный откат)...")
    if not os.path.exists(backup_asar):
        shutil.copy2(asar_path, backup_asar)
        print(f"   ✓ Резервная копия создана: {backup_asar}")
    else:
        print(f"   ✓ Исходная резервная копия сохранена ранее: {backup_asar}")

    print("Шаг 3/4: Подготовка перевода и внедрение...")
    with open(dict_path, "r", encoding="utf-8") as f:
        dict_content = f.read()

    with open(runtime_path, "r", encoding="utf-8") as f:
        runtime_content = f.read()

    runtime_injected = runtime_content.replace("__RU_DICTIONARY__", dict_content)
    full_patch_block = f"\n{SENTINEL}\n{runtime_injected}\n"

    # Clean previous patch if already patched
    if SENTINEL in preload_orig:
        print("   Обновление существующей русификации до последней версии...")
        preload_orig = preload_orig.split(SENTINEL)[0].rstrip()

    new_preload = (preload_orig + full_patch_block).encode("utf-8")

    print("Шаг 4/4: Сборка обновлённого архива с проверкой целостности...")
    new_asar_bytes, _ = asar.replace({"build/desktop-ui-preload.js": new_preload})

    # Atomic write to temporary file then replace
    temp_target = asar_path + ".tmp"
    with open(temp_target, "wb") as f:
        f.write(new_asar_bytes)
    os.replace(temp_target, asar_path)
    print("   ✓ Файл app.asar успешно обновлен.")

    print("\n" + "=" * 55)
    print("   [УСПЕХ] Docker Desktop успешно русифицирован!")
    print("   Запустите Docker Desktop и наслаждайтесь русским языком.")
    print("=" * 55 + "\n")

def restore(app_path: str = ""):
    asar_path = resolve_asar_path(app_path)
    plat = get_platform()
    backup_asar = asar_path + ".bak"

    print("\n" + "=" * 55)
    print("      Docker Desktop — Восстановление оригинала")
    print("=" * 55)

    if not os.path.exists(backup_asar):
        print(f"[Ошибка] Резервная копия не найдена: {backup_asar}", file=sys.stderr)
        print("Невозможно восстановить исходный файл.", file=sys.stderr)
        sys.exit(1)

    if is_docker_running():
        print("[Внимание] Docker Desktop сейчас запущен.")
        print("Закройте приложение перед восстановлением.")
        try:
            choice = input("Продолжить откат? [y/N]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            choice = "n"
        if choice not in ("y", "yes", "д", "да"):
            print("Откат отменен.")
            sys.exit(0)

    print("Восстановление исходного app.asar из резервной копии...")
    shutil.copy2(backup_asar, asar_path)
    print("   ✓ Исходный файл app.asar восстановлен.")

    print("\n[УСПЕХ] Исходный английский интерфейс Docker Desktop полностью возвращён!\n")

def main():
    parser = argparse.ArgumentParser(description="Русификатор Docker Desktop (macOS, Windows, Linux)")
    parser.add_argument("action", choices=["status", "install", "restore"], help="Действие: status, install или restore")
    parser.add_argument("--app", default="", help="Пользовательский путь к установке Docker Desktop")
    args = parser.parse_args()

    if args.action == "status":
        check_status(args.app)
    elif args.action == "install":
        install(args.app)
    elif args.action == "restore":
        restore(args.app)

if __name__ == "__main__":
    main()
