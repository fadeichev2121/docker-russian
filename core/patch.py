#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 fadeichev2121
"""
Universal Cross-Platform Docker Desktop Russian Localizer.
Supports macOS, Windows, and Linux.
Zero external dependencies (pure Python 3.9+).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import plistlib
import shutil
import stat
import struct
import subprocess
import sys
import tempfile

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

def get_info_plist_path(app_path: str) -> str:
    """Returns path to Info.plist of the nested Electron app (macOS only)."""
    if app_path.endswith(".asar"):
        return os.path.join(os.path.dirname(os.path.dirname(app_path)), "Info.plist")
    nested = get_nested_macos_app(app_path)
    return os.path.join(nested, "Contents", "Info.plist")

def read_plist(plist_path: str) -> dict:
    """Read a macOS plist file and return its contents as a dict."""
    with open(plist_path, "rb") as f:
        return plistlib.load(f)

def atomic_write(path: str, data: bytes):
    """Replace one file without exposing partially written contents."""
    mode = stat.S_IMODE(os.stat(path).st_mode) if os.path.exists(path) else 0o644
    fd, temporary = tempfile.mkstemp(prefix=".docker-ru-", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def write_plist(plist_path: str, data: dict):
    """Preserve the plist format and replace its contents atomically."""
    with open(plist_path, "rb") as f:
        fmt = plistlib.FMT_BINARY if f.read(8) == b"bplist00" else plistlib.FMT_XML
    atomic_write(plist_path, plistlib.dumps(data, fmt=fmt, sort_keys=False))

def archive_header_hash(data: bytes) -> str:
    Asar(data)  # Validate before using the encoded header length.
    json_size = struct.unpack("<4I", data[:16])[3]
    return digest(data[16:16 + json_size])

def archive_version(data: bytes) -> str | None:
    archive = Asar(data)
    if not archive.has_file("package.json"):
        return None
    return json.loads(archive.read("package.json")).get("version")

def load_metadata(asar_path: str) -> dict:
    path = asar_path + ".meta.json"
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        metadata = json.load(f)
    if not isinstance(metadata, dict):
        raise ValueError("Некорректный файл метаданных резервной копии.")
    return metadata

def validate_backup(asar_path: str, app_path: str, current_data: bytes) -> bytes:
    """Reject patched, damaged or stale backups before touching the installed app."""
    with open(asar_path + ".bak", "rb") as f:
        backup_data = f.read()
    archive = Asar(backup_data)
    if SENTINEL.encode() in archive.read("build/desktop-ui-preload.js"):
        raise ValueError("Резервная копия уже содержит перевод; откат небезопасен.")
    current_version = archive_version(current_data)
    backup_version = archive_version(backup_data)
    if not current_version or not backup_version or current_version != backup_version:
        raise ValueError("Резервная копия относится к другой версии Docker. Откат отменён.")
    metadata = load_metadata(asar_path)
    expected_hash = metadata.get("backup_sha256")
    if not expected_hash or metadata.get("archive_version") != backup_version:
        raise ValueError("Нет подтверждённых метаданных резервной копии. Автоматический откат отменён.")
    saved_version = metadata.get("docker_version")
    installed_version = get_docker_version(app_path)
    if saved_version and saved_version != installed_version:
        raise ValueError("После создания резервной копии Docker обновился. Откат отменён.")
    if expected_hash != digest(backup_data):
        raise ValueError("Резервная копия повреждена или заменена. Откат отменён.")
    return backup_data

def save_backup_metadata(asar_path: str, backup_data: bytes, docker_version: str | None):
    metadata = {
        "original_integrity_hash": archive_header_hash(backup_data),
        "backup_sha256": digest(backup_data),
        "archive_version": archive_version(backup_data),
        "docker_version": docker_version,
    }
    atomic_write(asar_path + ".meta.json", json.dumps(metadata, indent=2).encode("utf-8"))

def replace_archive_and_integrity(asar_path: str, app_path: str, data: bytes):
    """Update the archive and plist together, rolling back both on ordinary failures."""
    with open(asar_path, "rb") as f:
        previous_archive = f.read()
    plist_path = get_info_plist_path(app_path) if get_platform() == "macos" else None
    previous_plist = None
    if plist_path and os.path.exists(plist_path):
        with open(plist_path, "rb") as f:
            previous_plist = f.read()
        read_plist(plist_path)  # Fail before changing the archive if the plist is invalid.
    try:
        atomic_write(asar_path, data)
        if previous_plist is not None:
            set_asar_integrity_hash(plist_path, archive_header_hash(data))
    except Exception:
        atomic_write(asar_path, previous_archive)
        if previous_plist is not None:
            atomic_write(plist_path, previous_plist)
        raise

def get_asar_integrity_hash(plist_path: str) -> str | None:
    """Get the current ElectronAsarIntegrity hash for app.asar from Info.plist."""
    try:
        plist = read_plist(plist_path)
        integrity = plist.get("ElectronAsarIntegrity", {})
        asar_entry = integrity.get("Resources/app.asar", {})
        return asar_entry.get("hash")
    except Exception:
        return None

def set_asar_integrity_hash(plist_path: str, new_hash: str):
    """Update the ElectronAsarIntegrity hash for app.asar in Info.plist."""
    plist = read_plist(plist_path)
    if "ElectronAsarIntegrity" not in plist:
        return  # No integrity dict — older Docker, nothing to do
    if "Resources/app.asar" not in plist["ElectronAsarIntegrity"]:
        return
    plist["ElectronAsarIntegrity"]["Resources/app.asar"]["hash"] = new_hash
    write_plist(plist_path, plist)

def get_docker_version(app_path: str) -> str | None:
    """Get Docker Desktop version from Info.plist (macOS) or similar."""
    plat = get_platform()
    if plat == "macos":
        plist_path = get_info_plist_path(app_path)
        if os.path.exists(plist_path):
            try:
                plist = read_plist(plist_path)
                return plist.get("CFBundleVersion", plist.get("CFBundleShortVersionString"))
            except Exception:
                return None
    elif plat == "windows":
        # Try to read version from Docker Desktop.exe properties
        exe_path = os.path.join(app_path, "Docker Desktop.exe")
        if os.path.exists(exe_path):
            try:
                res = subprocess.run(
                    ["powershell", "-Command", f"(Get-Item '{exe_path}').VersionInfo.FileVersion"],
                    capture_output=True, text=True
                )
                v = res.stdout.strip()
                return v if v else None
            except Exception:
                return None
    return None

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

    print(f"Статус перевода: {'✓ ПАТЧ ОБНАРУЖЕН (запуск не проверен)' if is_patched else '○ ПАТЧ НЕ ОБНАРУЖЕН'}")
    print(f"Резервная копия: {'✓ ЕСТЬ (' + backup_asar + ')' if has_backup else '○ НЕТ'}")
    print(f"Docker запущен:  {'ДА (нужно закрыть перед установкой/откатом)' if running else 'НЕТ'}")
    if plat == "macos":
        print("Установка и автоматический откат на macOS заблокированы.")
    print("=" * 55 + "\n")
    return is_patched

def install(app_path: str = ""):
    raise RuntimeError(
        "Старый ASAR-патч заблокирован: он может нарушать подпись Docker. "
        "Используйте новый установщик: bash install.sh (Windows: windows/install.ps1). "
        "Для восстановления ранее повреждённого Docker нужен официальный установщик."
    )

    app_path = os.path.expanduser(os.path.expandvars(app_path or get_default_app_path()))
    asar_path = resolve_asar_path(app_path)

    if not os.path.exists(asar_path):
        print(f"[Ошибка] Docker Desktop не найден по пути: {asar_path}", file=sys.stderr)
        print("Убедитесь, что Docker Desktop установлен в системе.", file=sys.stderr)
        sys.exit(1)

    if get_platform() == "macos":
        raise RuntimeError(
            "Установка на macOS заблокирована: изменение app.asar или подписанного "
            "Info.plist может привести к Code Signature Invalid. Пересчёт хеша ASAR "
            "не сохраняет подпись. Файлы приложения не изменены."
        )

    if is_docker_running():
        raise RuntimeError("Полностью закройте Docker Desktop перед установкой перевода.")

    backup_asar = asar_path + ".bak"
    dict_path = os.path.join(SCRIPT_DIR, "ru.json")
    runtime_path = os.path.join(SCRIPT_DIR, "ui-runtime.js")

    if not os.path.exists(dict_path) or not os.path.exists(runtime_path):
        print(f"[Ошибка] Не найдены необходимые файлы словаря или рантайма в {SCRIPT_DIR}", file=sys.stderr)
        sys.exit(1)

    # Detect Docker version for backup freshness check
    docker_version = get_docker_version(app_path)
    if docker_version:
        print(f"\nОбнаружена версия Docker Desktop: {docker_version}")

    print("\nШаг 1/5: Чтение оригинального архива интерфейса...")
    with open(asar_path, "rb") as f:
        orig_data = f.read()

    asar = Asar(orig_data)
    if not asar.has_file("build/desktop-ui-preload.js"):
        print("[Ошибка] В архиве не найден файл build/desktop-ui-preload.js!", file=sys.stderr)
        sys.exit(1)

    preload_orig_bytes = asar.read("build/desktop-ui-preload.js")
    preload_orig = preload_orig_bytes.decode("utf-8", errors="replace")

    print("Шаг 2/5: Управление резервной копией (безопасный откат)...")
    if SENTINEL in preload_orig:
        if not os.path.exists(backup_asar):
            raise ValueError("Перевод уже установлен, но оригинальная резервная копия отсутствует.")
        backup_data = validate_backup(asar_path, app_path, orig_data)
        print("   ✓ Сохранён оригинал текущей версии Docker.")
    else:
        backup_data = orig_data
        if os.path.exists(backup_asar) and calculate_file_hash(backup_asar) != digest(orig_data):
            # Keep older backups recoverable instead of overwriting them after an update.
            archived_backup = backup_asar + "." + calculate_file_hash(backup_asar)[:16]
            if not os.path.exists(archived_backup):
                shutil.copy2(backup_asar, archived_backup)
            old_meta = asar_path + ".meta.json"
            if os.path.exists(old_meta) and not os.path.exists(archived_backup + ".meta.json"):
                shutil.copy2(old_meta, archived_backup + ".meta.json")
            print(f"   ✓ Старая копия сохранена отдельно: {archived_backup}")
        atomic_write(backup_asar, backup_data)
        print(f"   ✓ Резервная копия текущей версии: {backup_asar}")
    # Always derive the original hash from the original archive, never the patched plist.
    save_backup_metadata(asar_path, backup_data, docker_version)

    print("Шаг 3/5: Подготовка перевода и внедрение...")
    with open(dict_path, "r", encoding="utf-8") as f:
        dict_content = f.read()
    json.loads(dict_content)

    with open(runtime_path, "r", encoding="utf-8") as f:
        runtime_content = f.read()

    runtime_injected = runtime_content.replace("__RU_DICTIONARY__", dict_content)
    full_patch_block = f"\n{SENTINEL}\n{runtime_injected}\n"

    # Clean previous patch if already patched
    if SENTINEL in preload_orig:
        print("   Обновление существующей русификации до последней версии...")
        preload_orig = preload_orig.split(SENTINEL)[0].rstrip()

    new_preload = (preload_orig + full_patch_block).encode("utf-8")

    print("Шаг 4/5: Сборка обновлённого архива с проверкой целостности...")
    new_asar_bytes, _ = asar.replace({"build/desktop-ui-preload.js": new_preload})
    print("Шаг 5/5: Обновление проверки целостности Electron...")
    replace_archive_and_integrity(asar_path, app_path, new_asar_bytes)
    print("   ✓ Архив интерфейса и его хеш целостности обновлены.")

    print("\n" + "=" * 55)
    print("   [УСПЕХ] Docker Desktop успешно русифицирован!")
    print("   Запустите Docker Desktop и наслаждайтесь русским языком.")
    print("=" * 55 + "\n")

def restore(app_path: str = ""):
    raise RuntimeError(
        "Старый ASAR-патч заблокирован: он может нарушать подпись Docker. "
        "Используйте новый установщик: bash install.sh (Windows: windows/install.ps1). "
        "Для восстановления ранее повреждённого Docker нужен официальный установщик."
    )

    app_path = os.path.expanduser(os.path.expandvars(app_path or get_default_app_path()))
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

    if plat == "macos":
        raise RuntimeError(
            "Автоматический откат на macOS заблокирован: восстановление app.asar и "
            "пересчёт хеша не восстанавливают подпись приложения. Используйте официальный "
            "установщик Docker той же версии и сборки. Файлы приложения не изменены."
        )

    if is_docker_running():
        raise RuntimeError("Полностью закройте Docker Desktop перед восстановлением.")

    with open(asar_path, "rb") as f:
        current_data = f.read()
    backup_data = validate_backup(asar_path, app_path, current_data)

    print("Восстановление исходного app.asar из резервной копии...")
    replace_archive_and_integrity(asar_path, app_path, backup_data)
    print("   ✓ Исходный файл app.asar восстановлен.")
    if plat == "macos":
        print("   ✓ Хеш целостности восстановлен из исходного архива.")
    # Keep metadata: it must still identify this backup after a future Docker update.
    save_backup_metadata(asar_path, backup_data, get_docker_version(app_path))

    if plat == "macos":
        bundle = os.path.dirname(os.path.dirname(get_info_plist_path(app_path)))
        signed = subprocess.run(["codesign", "--display", bundle], capture_output=True)
        if signed.returncode == 0:
            verified = subprocess.run(["codesign", "--verify", bundle], capture_output=True)
            if verified.returncode:
                raise RuntimeError(
                    "Архив восстановлен, но подпись приложения невалидна. "
                    "Для полного восстановления нужен исходный Info.plist из официального "
                    "установщика той же версии Docker."
                )

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
    try:
        main()
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        print(f"[Ошибка] {error}", file=sys.stderr)
        sys.exit(1)
