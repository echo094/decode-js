"""Exercise exact multipart archive readback and corruption refusal."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

TOOL = Path(__file__).with_name('retain_evidence.py')
spec = importlib.util.spec_from_file_location('retainer', TOOL)
retainer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retainer)


class RetentionTest(unittest.TestCase):
    def test_multipart_exact_bytes_and_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'input'
            source.mkdir()
            (source / 'bytes.bin').write_bytes(os.urandom(2 * 1024 * 1024))
            (source / 'text.txt').write_text('Exact retained evidence\n')
            (source / 'external-link').symlink_to('/separately/supplied/dependency')
            output = root / 'archive'
            process = subprocess.run([
                sys.executable, str(TOOL), '--root', str(root),
                '--input', 'input', '--output', str(output), '--part-mib', '1',
                '--boundary', 'Synthetic retention test',
            ], capture_output=True, text=True, timeout=30)
            self.assertEqual(process.returncode, 0, process.stderr)
            manifest_path = output / 'archive-manifest.json'
            manifest = json.loads(manifest_path.read_text())
            self.assertGreater(len(manifest['parts']), 1)
            self.assertEqual(retainer.verify(manifest_path)['members'], 3)
            member = next(m for m in manifest['members'] if m['path'].endswith('bytes.bin'))
            self.assertEqual(member['sha256'], retainer.file_identity(source / 'bytes.bin')['sha256'])
            part = output / manifest['parts'][0]['path']
            original = part.read_bytes()
            part.write_bytes(bytes([original[0] ^ 1]) + original[1:])
            with self.assertRaisesRegex(ValueError, 'Archive part identity changed'):
                retainer.verify(manifest_path)
            part.write_bytes(original)
            manifest['members'].append(manifest['members'][0])
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, 'Duplicate manifest member'):
                retainer.verify(manifest_path)


if __name__ == '__main__':
    unittest.main()
