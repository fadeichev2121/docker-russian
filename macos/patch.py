#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 fadeichev2121
"""
macOS entry point delegating to core/patch.py
"""
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CORE_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), "core")
if CORE_DIR not in sys.path:
    sys.path.insert(0, CORE_DIR)

from patch import main

if __name__ == "__main__":
    main()
