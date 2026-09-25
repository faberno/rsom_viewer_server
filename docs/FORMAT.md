# RSOM RG8 display volume, version 1

Each dataset is a UTF-8 `manifest.json` and a raw, headerless `volume.bin`. Version 1 uses **two interleaved unsigned 8-bit normalized channels**: low frequency in R, high frequency in G. There is no B or alpha channel in the file. Source channel 2, if present, is discarded. The binary is byte-oriented; endianness does not apply.

### Optional single-file package for iPad Files

`python scripts/pack-volume.py manifest.json volume.rsom` wraps an existing export without changing its data. The package is: 8 ASCII bytes `RSOMPK01` (package version 1), a 4-byte **little-endian unsigned integer** giving the UTF-8 JSON manifest length, that many JSON bytes, then the exact RG8 binary bytes. JSON length must be between 1 byte and 1 MiB. Total file length must be exactly `12 + JSON length + data.byteLength`; trailing or missing bytes are rejected. Package version and manifest version are separately validated. The browser ignores the embedded `data.url` and never fetches it for a local import. The packer verifies the payload size and SHA-256 before writing and refuses to overwrite existing outputs. Browser SHA-256 verification requires Web Crypto; on LAN HTTP only structure/length validation is available. The `.rsom` package is display data, not a lossless copy of the original floating-point reconstruction.

`dimensions`, `spacing`, `origin`, crop bounds, and downsampling strides always use **x, y, z** order. Spacing is center-to-center, in the manifest's `units`. Origin is the position of the first retained voxel center relative to input voxel `(0,0,0)`. Rendering centers the volume for rotation; origin is provenance, not a translation applied to the viewer. The physical box has side lengths `dimensions * spacing`, extending half a voxel beyond the first and last centers. A single common scale fits the physical box into rendering coordinates, preserving aspect ratios.

## Array-to-texture mapping

NumPy input has shape `(nx, ny, nz, 2|3)` and order `xyzc`. In a C-contiguous input, channel changes fastest, then z, y, x. WebGL `texImage3D(width=nx, height=ny, depth=nz)` requires x to change fastest spatially. Export therefore performs:

```python
q = np.stack([red_uint8, green_uint8], axis=-1)  # (nx, ny, nz, 2)
packed = q.transpose(2, 1, 0, 3).copy(order="C")  # (nz, ny, nx, 2)
binary = packed.tobytes()
byte_offset = 2 * ((z * ny + y) * nx + x) + channel
```

`axes.textureOrder = "zyxc"` describes the serialized C-order array; `data.layout = "x-fastest-rg-interleaved"` describes its spatial strides. It does **not** mean the x/z axes are swapped in physical space. The viewer creates a `Data3DTexture(bytes, nx, ny, nz)` with `RG8`, `RGFormat`, `UnsignedByteType`, `unpackAlignment = 1`, linear interpolation, clamped boundaries, and no mipmaps or color-space transform.

`tests/test_export.py` checks an asymmetric phantom using both an inverse transpose and explicit byte offsets. The browser test executes the production fragment shader against a separate `(5,7,9,2)` phantom with spacing `(2,1,3)` and compares every RGB pixel with a NumPy reference. Its red maximum is at y=1 and green maximum at y=5, so choosing one winning voxel would fail.

## Orientation and projection

Positive x/y/z mean increasing input index. `axes.labels` supplies human-readable labels (for example `lateral`, `scan`, `depth`); labels make no anatomical claims. `axes.depthAxis` selects the axis used by the depth sliders and the Top preset. Default depth is z; set it to match acquisition metadata.

Front looks along **+y**, with **-x screen-right** and **+z screen-down**. Shallow skin is at the top, and depth increases downward. It is the original `image.max(axis=1)` projection rotated clockwise by 90 degrees: `plt.imshow(np.rot90(image.max(axis=1), k=-1), origin="upper", aspect=spacing_z / spacing_x)`. Side looks along -x with -z up. Top looks along the negative configured depth axis, with +z up unless depth is z, in which case +y is up. An on-screen triad shows projected positive axes during rotation. Front remains the explicit y-projection even when the crop depth axis is configured differently. The GPU tests check both the original NumPy orientation and the upright rotation.

Each orthographic ray intersects the physical volume/crop box with robust slab intersection, including parallel rays. Samples accumulate `maxima = max(maxima, texture(...).rg)` component-wise. The output is `(mapped_red_max, mapped_green_max, 0, 1)`. There is no opacity integration or shared winning voxel.

Sampling uses midpoint samples at approximately one minimum voxel spacing when still, 2.5 spacings while interacting/rotating, and a maximum of 2,048 samples per ray. The cap keeps arbitrary large anisotropic volumes bounded but can miss thin peaks; this is a sampled, trilinearly interpolated MIP, not an analytic maximum. Axis-aligned voxel-centered sampling is validated; arbitrary angles can interpolate/attenuate isolated peaks. Depth cropping selects inclusive retained voxel indices. Texture coordinates are clamped to retained voxel centers so interpolation cannot include excluded voxels.

## Intensity mapping

`channels[c].exportRange = [lo, hi]` records the original source intensity range. Finite source values are clipped to this range and mapped to `floor(255 * (value-lo)/(hi-lo) + 0.5)`. Finite-only min/max is the default; explicit per-channel ranges or one percentile pair applied independently to each channel can be selected. Ranges are estimated after crop/downsampling. NaN and negative infinity become 0; positive infinity becomes 255. A constant range maps finite values to 0. All-nonfinite channels use `[0,0]`, with the same nonfinite rules.

Quantization irreversibly clips information outside the export range and limits intensities to 256 levels. Browser controls act on **exported display data**, not the full original reconstruction. For normalized stored value `v=q/255`, displayed value is:

```text
pow(clamp((v - black_level) / (white_level - black_level), 0, 1), 1/gamma)
```

Gamma >1 brightens intermediate signals. Display mapping is applied after the independent maxima. Channels have separate visibility, ranges, and gamma. There is deliberately no Three.js tone mapping or sRGB transfer; output RGB values follow Matplotlib RGB display conventions. A NumPy comparison must quantize first and use the same clipping/gamma and orientation. Quantization can differ by at most one output level near floating-point rounding boundaries.

## Manifest fields

| Field | Meaning |
| --- | --- |
| `format`, `version` | `rsom-rg8`, integer `1`; unsupported versions are rejected |
| `name`, `description`, `synthetic` | Display metadata and explicit synthetic-data flag |
| `dimensions`, `spacing`, `units`, `origin` | Physical grid metadata in x/y/z order |
| `axes` | Array and texture orders, axis labels, depth axis, positive direction, initial orientation |
| `channels` | Two channel names/colors, input indices, export ranges, normalized default display ranges and gamma |
| `intensityMapping` | Mapping, rounding, nonfinite/constant policies, optional percentile pair |
| `source` | Original shape, half-open crop bounds, integer strides, `strided-decimation` method |
| `data` | Relative binary URL, `uint8`, two channels, layout, exact byte length, SHA-256 |

Cropping keeps input indices `[start:stop]`. Downsampling takes every kth voxel after cropping; spacing is multiplied by k and origin retains the first selected voxel center. This is decimation, not averaging or antialiasing, and can lose small vessels. Full spatial resolution is preserved unless explicitly requested otherwise. The exporter overwrites `manifest.json` and `volume.bin` in its output directory; use a distinct directory for each variant.
