# SPDX-License-Identifier: MIT
# Copyright (c) 2026 fadeichev2121
"""
Pure Python ASAR archive reader and patcher.
Preserves untouched metadata, block SHA256 integrity, and file alignment.
Requires zero external dependencies (no Node.js or npm needed).
"""

import copy
import hashlib
import json
import struct

def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

class Asar:
    def __init__(self, data: bytes):
        self.data = data
        if len(data) < 16:
            raise ValueError("Invalid asar archive: file is too small")
        _, header_size, _, json_size = struct.unpack("<4I", data[:16])
        self.header = json.loads(data[16:16 + json_size].decode("utf-8"))
        self.base = 8 + header_size

    def entry(self, name: str) -> dict:
        item = self.header
        for part in name.strip("/").split("/"):
            if "files" not in item or part not in item["files"]:
                raise KeyError(f"File not found in asar: {name}")
            item = item["files"][part]
        return item

    def has_file(self, name: str) -> bool:
        try:
            self.entry(name)
            return True
        except (KeyError, TypeError):
            return False

    def read(self, name: str) -> bytes:
        item = self.entry(name)
        if "offset" not in item:
            raise ValueError(f"Entry {name} is a directory, not a file")
        start = self.base + int(item["offset"])
        return self.data[start:start + item["size"]]

    def replace(self, updates: dict) -> tuple[bytes, str]:
        """
        Replaces files specified in `updates` (mapping {relative_path: bytes_content}).
        Returns tuple of (new_asar_bytes, header_sha256).
        """
        header = copy.deepcopy(self.header)
        parts = []
        offset = 0

        def walk(directory, prefix=""):
            nonlocal offset
            for name, entry in directory["files"].items():
                full = prefix + name
                if "files" in entry:
                    walk(entry, full + "/")
                elif "offset" in entry and not entry.get("unpacked"):
                    content = updates.get(full, self.read(full))
                    entry["offset"] = str(offset)
                    entry["size"] = len(content)
                    if "integrity" in entry and full in updates:
                        block_size = entry["integrity"].get("blockSize", 4 * 1024 * 1024)
                        entry["integrity"] = {
                            "algorithm": "SHA256",
                            "hash": digest(content),
                            "blockSize": block_size,
                            "blocks": [digest(content[i:i + block_size]) for i in range(0, len(content), block_size)] or [digest(b"")]
                        }
                    parts.append(content)
                    offset += len(content)

        walk(header)
        encoded = json.dumps(header, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        payload = struct.pack("<I", len(encoded)) + encoded
        payload += b"\0" * (-len(payload) % 4)
        header_pickle = struct.pack("<I", len(payload)) + payload
        new_data = struct.pack("<II", 4, len(header_pickle)) + header_pickle + b"".join(parts)
        return new_data, digest(encoded)
