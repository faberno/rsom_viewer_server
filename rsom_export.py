"""Portable RSOM display-volume exporter. See docs/FORMAT.md for byte layout."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Sequence

import numpy as np


def quantize(channel: np.ndarray, display_range: Sequence[float] | None = None,
             percentiles: Sequence[float] | None = None) -> tuple[np.ndarray, list[float]]:
    """Finite-only range estimation. NaN/-inf -> 0, +inf -> 255; constants -> 0."""
    if display_range is not None and percentiles is not None:
        raise ValueError("Choose display ranges or percentiles, not both")
    if percentiles is not None:
        if len(percentiles) != 2 or not 0 <= percentiles[0] < percentiles[1] <= 100:
            raise ValueError("Percentiles must satisfy 0 <= low < high <= 100")
    finite = channel[np.isfinite(channel)]
    if display_range is not None:
        limits = np.asarray(display_range, dtype=np.float64)
    elif finite.size:
        limits = (np.percentile(finite, percentiles) if percentiles is not None
                  else np.array([finite.min(), finite.max()], dtype=np.float64))
    else:
        limits = np.array([0., 0.])
    if limits.shape != (2,) or not np.isfinite(limits).all() or limits[0] > limits[1]:
        raise ValueError("Each display range must be two finite values, low <= high")
    lo, hi = limits
    # Scale before subtraction only when necessary for extreme finite float64 data.
    scale = max(abs(lo), abs(hi), 1.)
    clean = np.nan_to_num(channel.astype(np.float64), nan=lo, neginf=lo, posinf=hi)
    clean = np.clip(clean, lo, hi)
    with np.errstate(over="ignore"):
        width = hi - lo
    mapped = (np.zeros_like(clean) if hi == lo else (clean - lo) / width
              if np.isfinite(width) else (clean / scale - lo / scale) / (hi / scale - lo / scale))
    out = np.floor(np.clip(mapped, 0, 1) * 255 + .5).astype(np.uint8)
    out[np.isposinf(channel)] = 255
    return out, [float(lo), float(hi)]


def export_volume(image: np.ndarray, spacing: Sequence[float], output: str | Path, *,
                  display_ranges: Sequence[Sequence[float]] | None = None,
                  percentiles: Sequence[float] | None = None,
                  crop: Sequence[Sequence[int]] | None = None,
                  downsample: Sequence[int] = (1, 1, 1), depth_axis: str = "z",
                  axis_labels: Sequence[str] = ("x", "y", "z"), units: str = "mm",
                  name: str = "RSOM volume", description: str = "",
                  synthetic: bool = False) -> dict:
    """Export (x,y,z,2|3) data; output is a directory containing manifest.json/volume.bin.

    Crops are half-open input index bounds. Downsampling uses strided decimation,
    keeps the first selected voxel, and multiplies voxel spacing by each stride.
    Full resolution is preserved by default. Range estimation follows crop/stride.
    """
    image = np.asarray(image)
    if image.ndim != 4 or image.shape[3] not in (2, 3) or min(image.shape[:3]) < 1:
        raise ValueError("Expected a nonempty array of shape (x, y, z, 2 or 3)")
    if image.dtype.kind not in "fiu":
        raise ValueError("Volume must contain real numeric values")
    spacing_arr = np.asarray(spacing, dtype=float)
    if spacing_arr.shape != (3,) or not np.isfinite(spacing_arr).all() or (spacing_arr <= 0).any():
        raise ValueError("Spacing must contain three positive finite values in x,y,z order")
    stride = np.asarray(downsample)
    if stride.shape != (3,) or stride.dtype.kind not in "iu" or (stride < 1).any():
        raise ValueError("Downsampling must contain three positive integers")
    bounds = np.asarray(crop if crop is not None else [(0, n) for n in image.shape[:3]])
    if (bounds.shape != (3, 2) or bounds.dtype.kind not in "iu"
            or any(not 0 <= lo < hi <= n for (lo, hi), n in zip(bounds, image.shape[:3]))):
        raise ValueError("Crop must contain valid half-open (start, stop) bounds for x,y,z")
    if depth_axis not in ("x", "y", "z") or len(axis_labels) != 3 or any(not s for s in axis_labels):
        raise ValueError("Specify a depth axis x/y/z and three nonempty axis labels")
    if display_ranges is not None and len(display_ranges) != 2:
        raise ValueError("Provide exactly two channel display ranges")
    sampled = image[tuple(slice(int(lo), int(hi), int(step))
                          for (lo, hi), step in zip(bounds, stride)) + (slice(0, 2),)]
    channels, mappings = [], []
    for c in range(2):
        q, limits = quantize(sampled[..., c], None if display_ranges is None else display_ranges[c], percentiles)
        channels.append(q)
        mappings.append({"name": ["Low frequency", "High frequency"][c],
                         "color": ["red", "green"][c], "sourceChannel": c,
                         "exportRange": limits, "defaultDisplayRange": [0, 1], "gamma": 1})
    # NumPy input: z changes fastest spatially. WebGL: x changes fastest.
    # GPU byte offset = 2 * ((z * ny + y) * nx + x) + channel.
    packed = np.stack(channels, axis=-1).transpose(2, 1, 0, 3).copy(order="C")
    data = packed.tobytes()
    manifest = {
        "format": "rsom-rg8", "version": 1, "name": name, "description": description,
        "synthetic": synthetic, "dimensions": list(sampled.shape[:3]),
        "spacing": (spacing_arr * stride).tolist(), "units": units,
        "origin": (bounds[:, 0] * spacing_arr).tolist(),
        "axes": {"arrayOrder": "xyzc", "textureOrder": "zyxc", "labels": list(axis_labels),
                 "depthAxis": depth_axis, "positiveDirection": "increasing input index",
                 "initialView": {"lookAlong": "+y", "screenRight": "-x", "screenDown": "+z"}},
        "channels": mappings,
        "intensityMapping": {"type": "linear-clipped-uint8", "rounding": "floor(t * 255 + 0.5)",
                             "nan": 0, "negativeInfinity": 0, "positiveInfinity": 255,
                             "constant": 0, "percentiles": list(percentiles) if percentiles is not None else None},
        "source": {"shape": list(image.shape), "crop": bounds.tolist(),
                   "downsample": stride.tolist(), "method": "strided-decimation"},
        "data": {"url": "volume.bin", "type": "uint8", "channels": 2,
                 "layout": "x-fastest-rg-interleaved", "byteLength": len(data),
                 "sha256": hashlib.sha256(data).hexdigest()}
    }
    destination = Path(output)
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "volume.bin").write_bytes(data)
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="NumPy .npy file (x,y,z,2|3)")
    parser.add_argument("output", type=Path, help="Output dataset directory")
    parser.add_argument("--spacing", type=float, nargs=3, required=True, metavar=("SX", "SY", "SZ"))
    ranges = parser.add_mutually_exclusive_group()
    ranges.add_argument("--ranges", type=float, nargs=4, metavar=("R_MIN", "R_MAX", "G_MIN", "G_MAX"))
    ranges.add_argument("--percentiles", type=float, nargs=2, metavar=("LOW", "HIGH"))
    parser.add_argument("--crop", type=int, nargs=6, metavar=("X0", "X1", "Y0", "Y1", "Z0", "Z1"))
    parser.add_argument("--downsample", type=int, nargs=3, default=(1, 1, 1))
    parser.add_argument("--depth-axis", choices=["x", "y", "z"], default="z")
    parser.add_argument("--axis-labels", nargs=3, default=("x", "y", "z"))
    parser.add_argument("--units", default="mm")
    parser.add_argument("--name", default="RSOM volume")
    parser.add_argument("--description", default="")
    args = parser.parse_args()
    try:
        m = export_volume(np.load(args.input, mmap_mode="r", allow_pickle=False), args.spacing, args.output,
                          display_ranges=np.reshape(args.ranges, (2, 2)) if args.ranges else None,
                          percentiles=args.percentiles, crop=np.reshape(args.crop, (3, 2)) if args.crop else None,
                          downsample=args.downsample, depth_axis=args.depth_axis, axis_labels=args.axis_labels,
                          units=args.units, name=args.name, description=args.description)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(f"Exported {m['dimensions']} RG8 voxels ({m['data']['byteLength']:,} bytes) to {args.output}")


if __name__ == "__main__":
    main()
