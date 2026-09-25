"""Pack an existing exported manifest + binary into one iPad-selectable .rsom file.

Usage: python scripts/pack-volume.py path/to/manifest.json path/to/volume.rsom
No NumPy dependency; no resampling or further quantization.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct


def pack_volume(manifest_path: Path, output: Path) -> None:
    manifest_path, output = Path(manifest_path), Path(output)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("format") != "rsom-rg8" or manifest.get("version") != 1:
        raise ValueError("Expected an rsom-rg8 version 1 manifest")
    binary = (manifest_path.parent / manifest["data"]["url"]).resolve()
    if not binary.is_relative_to(manifest_path.parent.resolve()):
        raise ValueError("Binary must be inside the exported dataset directory")
    if output.resolve() in (manifest_path.resolve(), binary):
        raise ValueError("Output must not overwrite the source manifest or binary")
    with binary.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    if binary.stat().st_size != manifest["data"]["byteLength"] or digest != manifest["data"]["sha256"]:
        raise ValueError("Binary size/checksum mismatch; re-export the dataset")
    header = json.dumps(manifest, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    if len(header) > 1024 * 1024:
        raise ValueError("Manifest exceeds the 1 MiB header limit")
    output.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation prevents accidentally overwriting another volume.
    with output.open("xb") as destination, binary.open("rb") as source:
        destination.write(b"RSOMPK01" + struct.pack("<I", len(header)) + header)
        shutil.copyfileobj(source, destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        pack_volume(args.manifest, args.output)
    except (OSError, ValueError, KeyError) as error:
        parser.error(str(error))
    print(f"Packed {args.output} ({args.output.stat().st_size:,} bytes)")
