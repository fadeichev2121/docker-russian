import contextlib
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch as mock_patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'core'))
import patch
from asar import digest


def archive(version, preload=b'original'):
    package = json.dumps({'version': version}).encode()
    header = {'files': {
        'package.json': {'offset': '0', 'size': len(package)},
        'build': {'files': {'desktop-ui-preload.js': {
            'offset': str(len(package)), 'size': len(preload)}}},
    }}
    encoded = json.dumps(header).encode()
    payload = struct.pack('<I', len(encoded)) + encoded
    payload += b'\0' * (-len(payload) % 4)
    header_pickle = struct.pack('<I', len(payload)) + payload
    return struct.pack('<II', 4, len(header_pickle)) + header_pickle + package + preload


class PatchSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = Path(self.temp.name) / 'app.asar'
        self.original = archive('4.93.0')
        self.app.write_bytes(self.original)
        Path(str(self.app) + '.bak').write_bytes(self.original)

    def snapshot(self):
        return {p.name: p.read_bytes() for p in Path(self.temp.name).iterdir()}

    def validate(self, current=None):
        return patch.validate_backup(str(self.app), str(self.app), current or self.original)

    def metadata(self):
        patch.save_backup_metadata(str(self.app), self.original, None)

    def test_macos_install_and_restore_never_write_files(self):
        # No plist is needed: older signed macOS bundles must also be protected.
        for action in (patch.install, patch.restore):
            before = self.snapshot()
            with mock_patch.object(patch, 'get_platform', return_value='macos'), \
                    mock_patch.object(patch, 'atomic_write', side_effect=AssertionError('write')), \
                    mock_patch.object(patch, 'is_docker_running', side_effect=AssertionError('process check')), \
                    contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(RuntimeError, 'заблокирован'):
                    action(str(self.app))
            self.assertEqual(before, self.snapshot())

    def test_old_version_backup_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'другой версии'):
            self.validate(archive('4.94.0'))

    def test_backup_without_metadata_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'метаданных'):
            self.validate()

    def test_changed_same_version_backup_is_rejected(self):
        self.metadata()
        Path(str(self.app) + '.bak').write_bytes(archive('4.93.0', b'changed'))
        with self.assertRaisesRegex(ValueError, 'повреждена'):
            self.validate()

    def test_missing_installed_build_is_rejected_when_backup_has_build(self):
        patch.save_backup_metadata(str(self.app), self.original, '4.93.0.2')
        with mock_patch.object(patch, 'get_docker_version', return_value=None):
            with self.assertRaisesRegex(ValueError, 'обновился'):
                self.validate()

    def test_verified_backup_is_returned(self):
        self.metadata()
        self.assertEqual(self.original, self.validate())

    def test_plist_write_failure_restores_both_original_files(self):
        info = Path(self.temp.name) / 'Info.plist'
        import plistlib
        original_plist = plistlib.dumps({'ElectronAsarIntegrity': {}})
        info.write_bytes(original_plist)
        with mock_patch.object(patch, 'get_platform', return_value='macos'), \
                mock_patch.object(patch, 'get_info_plist_path', return_value=str(info)), \
                mock_patch.object(patch, 'set_asar_integrity_hash', side_effect=OSError('write failed')):
            with self.assertRaises(OSError):
                patch.replace_archive_and_integrity(str(self.app), str(self.app), archive('4.93.0', b'patched'))
        self.assertEqual(self.original, self.app.read_bytes())
        self.assertEqual(original_plist, info.read_bytes())


if __name__ == '__main__':
    unittest.main()
