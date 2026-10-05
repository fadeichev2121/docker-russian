# Docker Desktop на русском — macOS, Windows и Linux

[![Лицензия: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python: 3.9+](https://img.shields.io/badge/Python-3.9%2B-brightgreen.svg)](https://www.python.org/)
[![Платформы](https://img.shields.io/badge/Платформы-macOS%20%7C%20Windows%20%7C%20Linux-orange.svg)]()
[![Версия](https://img.shields.io/badge/Версия-1.0.0-blueviolet.svg)](manifest.json)

Полноценный русификатор интерфейса для **Docker Desktop**: дашборд, контейнеры, образы, тома, сборки, Docker Scout, расширения, настройки движка, Kubernetes и панель устранения неполадок.

Патч модифицирует только графический интерфейс (Electron UI) **оригинальной установленной программы**, создаёт автоматическую резервную копию `app.asar.bak` и позволяет в один клик вернуть исходный английский интерфейс.

---

## ⚡ Особенности

- 🔒 **Безопасность данных и терминалов:** Терминалы контейнеров (`xterm`), логи (`Logs`), переменные окружения, хеши образов/контейнеров и поля ввода **строго защищены от перевода**.
- 🚀 **Zero Dependencies:** Встроенный чистый Python-движок распаковки и сборки архивов ASAR с пересчётом SHA256-хешей блоков целостности. Установка **не требует Node.js или npm**.
- 🍏 **Нативная совместимость с macOS:** Модифицируется исключительно интерфейсный архив `app.asar`, не затрагивая системные бинарники Docker, драйверы гипервизора Apple Virtualization и официальную цифровую подпись разработчика Docker Inc.
- 🪟 **Поддержка Windows и Linux:** Совместимо с Windows 10/11 (PowerShell 5.1+) и всеми дистрибутивами Linux с Docker Desktop (Ubuntu, Debian, Fedora, Arch).

---

## 📋 Совместимость

| Платформа | Расположение Docker Desktop | Поддерживаемые версии |
| :--- | :--- | :--- |
| **macOS** | `/Applications/Docker.app` (Apple Silicon & Intel) | **4.45.x**, **4.x** (все свежие сборки) |
| **Windows** | `C:\Program Files\Docker\Docker` (x64 & ARM64) | **4.45.x**, **4.x** (официальный EXE) |
| **Linux** | `/opt/docker-desktop` (amd64 & arm64) | **4.45.x**, **4.x** (официальные DEB / RPM) |

---

## 🚀 Быстрый старт

> [!IMPORTANT]
> Перед запуском полностью закройте Docker Desktop через меню (`Cmd+Q` на macOS, `ПКМ по значку в трее -> Quit Docker Desktop` на Windows/Linux).

### macOS

Откройте Терминал и выполните:

```bash
curl -fsSL https://raw.githubusercontent.com/fadeichev2121/docker-russian/main/install.sh | bash
```

*Или через клонирование репозитория:*
```bash
git clone https://github.com/fadeichev2121/docker-russian.git
cd docker-russian
bash install.sh
```

### Windows

Запустите **PowerShell** (при установке в `C:\Program Files` может потребоваться запуск от имени Администратора):

```powershell
irm https://raw.githubusercontent.com/fadeichev2121/docker-russian/main/windows/install.ps1 | iex
```

*Или через клонирование репозитория:*
```powershell
git clone https://github.com/fadeichev2121/docker-russian.git
cd docker-russian\windows
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

### Linux

Откройте терминал и выполните:

```bash
curl -fsSL https://raw.githubusercontent.com/fadeichev2121/docker-russian/main/linux/install.sh | bash
```

*Или через клонирование репозитория:*
```bash
git clone https://github.com/fadeichev2121/docker-russian.git
cd docker-russian
bash install.sh
```

---

## 🎮 Интерактивное меню

При запуске без аргументов открывается удобное интерактивное меню:

```text
===================================================
       Русский интерфейс для Docker Desktop         
===================================================

Выберите действие:
  1) Установить русский язык
  2) Проверить статус
  3) Откатить на оригинальный английский интерфейс
  0) Выход

Введите номер [1-3, 0]: 
```

### Прямые команды (CLI)

Вы можете автоматизировать запуск или вызывать установщик через флаги:

```bash
# Проверить статус русификации
bash install.sh status

# Установить перевод
bash install.sh install

# Восстановить оригинальный английский интерфейс
bash install.sh restore
```

---

## 🔍 Архитектура и безопасность

1. **Неинвазивное внедрение (Preload Injection):**
   Патч не изменяет скомпилированные бинарные файлы движка Docker, демона `dockerd` или виртуальной машины. Русификатор подключается через скрипт предзагрузки окна интерфейса (`desktop-ui-preload.js`), который Electron исполняет перед рендерингом React DOM.

2. **Защита целостности ASAR:**
   Собственный модуль `core/asar.py` пересобирает архив `app.asar` со строгим соблюдением формата Electron: пересчитываются SHA256-хеши 4MB блоков (`integrity blocks`), выравнивание смещений и заголовок pickle.

3. **DOM MutationObserver & Microtask Batching:**
   Переводчик отслеживает динамические обновления списков контейнеров, метрик памяти и CPU через `MutationObserver` с батчингом через `queueMicrotask`, что исключает зависания или просадки FPS дашборда.

---

## ↩️ Откат к оригиналу (Деинсталляция)

Чтобы вернуть Docker Desktop к первоначальному состоянию:

1. Закройте Docker Desktop.
2. Выберите пункт **3** в меню установщика или выполните:
   ```bash
   bash install.sh restore
   ```
3. Исходный архив `app.asar` будет восстановлен байт-в-байт из `.bak`, а подпись пересоздана.

---

## 📄 Лицензия

Распространяется под свободной лицензией [MIT](LICENSE). Разработано [fadeichev2121](https://github.com/fadeichev2121).
Docker® и Docker Desktop являются зарегистрированными товарными знаками Docker, Inc. Данный проект не аффилирован с компанией Docker, Inc.
