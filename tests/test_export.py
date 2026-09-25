import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

from rsom_export import export_volume, quantize


class ExportTests(unittest.TestCase):
    def test_asymmetric_order_spacing_and_crop(self):
        a = np.zeros((5, 7, 9, 3), dtype=float)
        for x in range(5):
            for y in range(7):
                for z in range(9):
                    a[x, y, z, :2] = (x * 50 + y * 5 + z, z * 20 + y + x)
        a[..., 2] = 99999  # unused, must not enter the RG texture
        with tempfile.TemporaryDirectory() as temp:
            m = export_volume(a, (.2, .3, .7), temp, display_ranges=((0, 255), (0, 255)),
                              crop=((1, 5), (1, 7), (2, 9)), downsample=(2, 3, 2), depth_axis='x')
            self.assertEqual(m['dimensions'], [2, 2, 4])
            np.testing.assert_allclose(m['spacing'], [.4, .9, 1.4])
            np.testing.assert_allclose(m['origin'], [.2, .3, 1.4])
            self.assertEqual(m['axes']['depthAxis'], 'x')
            gpu = np.fromfile(Path(temp) / 'volume.bin', dtype=np.uint8).reshape(4, 2, 2, 2)
            expected = a[1:5:2, 1:7:3, 2:9:2, :2].astype(np.uint8)
            np.testing.assert_array_equal(gpu.transpose(2, 1, 0, 3), expected)
            # Byte-offset formula is independent of numpy reshape conventions.
            raw = gpu.ravel()
            for x, y, z, c in np.ndindex(expected.shape):
                self.assertEqual(raw[2 * ((z * 2 + y) * 2 + x) + c], expected[x, y, z, c])

    def test_independent_maxima_different_depths(self):
        a = np.zeros((3, 5, 7, 2))
        a[:, 1, :, 0] = 1
        a[:, 4, :, 1] = .8
        with tempfile.TemporaryDirectory() as temp:
            export_volume(a, (1, 2, 3), temp, display_ranges=((0, 1), (0, 1)))
            restored = np.fromfile(Path(temp) / 'volume.bin', dtype=np.uint8).reshape(7, 5, 3, 2).transpose(2, 1, 0, 3)
            mip = restored.max(axis=1)
            np.testing.assert_array_equal(mip[..., 0], 255)
            np.testing.assert_array_equal(mip[..., 1], 204)
            self.assertFalse(np.any(np.all(restored == [255, 204], axis=-1)))

    def test_quantization_edges(self):
        q, limits = quantize(np.array([np.nan, -np.inf, np.inf, -1, 0, .5, 1, 2]), (0, 1))
        np.testing.assert_array_equal(q, [0, 0, 255, 0, 0, 128, 255, 255])
        self.assertEqual(limits, [0., 1.])
        np.testing.assert_array_equal(quantize(np.ones(8) * 12)[0], 0)
        np.testing.assert_array_equal(quantize(np.array([np.nan, -np.inf, np.inf]))[0], [0, 0, 255])
        q, limits = quantize(np.array([np.nan, 0, 1, 2, 3, np.inf]), percentiles=(25, 75))
        self.assertEqual(limits, [.75, 2.25])
        np.testing.assert_array_equal(q, [0, 0, 43, 213, 255, 255])
        np.testing.assert_array_equal(quantize(np.array([-1e308, 0, 1e308]), (-1e308, 1e308))[0], [0, 128, 255])

    def test_full_resolution_and_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            a = np.zeros((3, 4, 5, 2))
            m = export_volume(a, (1, 2, 3), temp)
            self.assertEqual(m['dimensions'], [3, 4, 5])
            self.assertEqual(m['spacing'], [1, 2, 3])
            self.assertEqual(m['data']['byteLength'], 120)
            self.assertEqual(json.loads((Path(temp) / 'manifest.json').read_text()), m)

    def test_invalid_input(self):
        with tempfile.TemporaryDirectory() as temp:
            a = np.zeros((3, 4, 5, 2))
            for spacing in [(0, 1, 1), (1, np.nan, 1), (1, 2)]:
                with self.assertRaises(ValueError): export_volume(a, spacing, temp)
            with self.assertRaises(ValueError): export_volume(a, (1, 1, 1), temp, downsample=(1.5, 1, 1))
            with self.assertRaises(ValueError): export_volume(a, (1, 1, 1), temp, crop=((0, 4), (0, 4), (0, 5)))
            with self.assertRaises(ValueError): quantize(a, (1, 0))
            with self.assertRaises(ValueError): quantize(a, percentiles=(99, 1))


if __name__ == '__main__':
    unittest.main()
