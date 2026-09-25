import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("pack_volume", Path(__file__).parents[1] / "scripts/pack-volume.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PackTests(unittest.TestCase):
    def test_header_payload_and_source_preservation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload = bytes(range(128))
            manifest = {"format": "rsom-rg8", "version": 1, "name": "Skin µm", "data": {
                "url": "volume.bin", "byteLength": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}}
            source = root / "manifest.json"
            source.write_text(json.dumps(manifest), encoding="utf-8")
            (root / "volume.bin").write_bytes(payload)
            output = root / "test.rsom"
            module.pack_volume(source, output)
            packed = output.read_bytes()
            self.assertEqual(packed[:8], b"RSOMPK01")
            length, = struct.unpack("<I", packed[8:12])
            self.assertEqual(json.loads(packed[12:12 + length]), manifest)
            self.assertEqual(packed[12 + length:], payload)
            self.assertEqual((root / "volume.bin").read_bytes(), payload)
            with self.assertRaises(FileExistsError): module.pack_volume(source, output)
            with self.assertRaises(ValueError): module.pack_volume(source, source)
            (root / "volume.bin").write_bytes(b"bad")
            with self.assertRaises(ValueError): module.pack_volume(source, root / "bad.rsom")
            self.assertFalse((root / "bad.rsom").exists())


if __name__ == "__main__":
    unittest.main()
