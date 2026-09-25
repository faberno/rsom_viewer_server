"""Deterministic synthetic vessels and an asymmetric GPU/NumPy validation fixture."""
import json
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rsom_export import export_volume

ROOT = Path(__file__).resolve().parents[1] / "public" / "data"


def main():
    nx, ny, nz = 96, 64, 128
    x, y, z = np.meshgrid(np.linspace(-1, 1, nx), np.linspace(-1, 1, ny),
                          np.linspace(-1, 1, nz), indexing="ij")
    a = np.zeros((nx, ny, nz, 2), dtype=np.float32)
    rng = np.random.default_rng(7)
    # Curving tubes in all three dimensions; separate fine and broad networks.
    for c in range(2):
        for j in range(9 if c == 0 else 18):
            phase = rng.uniform(0, 2 * np.pi)
            center_x = rng.uniform(-.8, .8) + .18 * np.sin(z * 3 + phase)
            center_y = rng.uniform(-.75, .75) + .22 * np.cos(z * 2.5 + phase)
            radius = rng.uniform(.026, .045) if c == 0 else rng.uniform(.012, .022)
            tube = np.exp(-((x - center_x)**2 + (y - center_y)**2) / (2 * radius**2))
            a[..., c] = np.maximum(a[..., c], tube * rng.uniform(.55, 1.))
        for j in range(5):
            p = -.8 + j * .4
            d = (z - (.3 * np.sin(x * 3 + j) + p))**2 + (y - .45 * np.sin(x * 2 + j))**2
            a[..., c] = np.maximum(a[..., c], np.exp(-d / (2 * (.028 if c == 0 else .018)**2)) * .8)
    for slug, stride, name in [("demo", (1, 1, 1), "Vascular garden"),
                                ("demo-lite", (2, 2, 2), "Vascular garden · light")]:
        export_volume(a, (.025, .035, .018), ROOT / slug, display_ranges=((0, 1), (0, 1)),
                      downsample=stride, name=name, synthetic=True,
                      description="Synthetic vessel-like networks. Red shows broad structures; green reveals finer branches. Not patient data.")
    # Distinct maxima at different y depths, asymmetric dimensions and spacing.
    phantom = np.zeros((5, 7, 9, 2), dtype=np.float32)
    for ix in range(5):
        for iz in range(9):
            phantom[ix, 1, iz, 0] = (ix * 9 + iz + 1) / 50
            phantom[ix, 5, iz, 1] = (45 - ix * 9 - iz) / 50
    export_volume(phantom, (2, 1, 3), ROOT / "validation", display_ranges=((0, 1), (0, 1)),
                  synthetic=True, depth_axis="y", name="Asymmetric validation phantom")
    reference = np.floor(phantom.max(axis=1) * 255 + .5).astype(np.uint8)
    (ROOT / "validation" / "reference.json").write_text(json.dumps(reference.tolist()), encoding="utf-8")


if __name__ == "__main__":
    main()
