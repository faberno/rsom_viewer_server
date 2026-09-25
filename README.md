# RSOM Explorer

A local, touch-friendly WebGL2 viewer for a conference booth. Two signals reveal a 3D volume through **independent red/green maximum-intensity projection**. No Python server or remote rendering is involved. The booth menu contains the real volume; synthetic data remains available only as explicitly labeled diagnostic fixtures.

The original `view3d.py` and `recon.npy` are left untouched. This workspace now includes local full/light exports of `recon.npy`, using the requested assumption of equal voxel spacing and z as depth. See [the current iPad setup guide](docs/IPAD-RECON.md). These private exports are excluded from Git but included in local production builds; fresh clones need their own exports or the bundled synthetic datasets.

## Run locally

Requires Node.js 22.12+ (or 20.19+) and Python 3.12+. JavaScript dependencies are bundled locally; there are no CDN scripts, remote fonts, analytics, or accounts.

```sh
npm install
npm run dev
```

Open the printed URL. This workspace's real exports are ready to view; Python is needed only when exporting new data. A fresh clone without private exports can run the bundled synthetic fixtures through `/?validation` (select Synthetic test volume). For reproducible installs after initial setup use `npm ci`.

Production and offline preparation:

```sh
npm run build
npm run preview
```

`dist/` is a static website. The build generates a versioned service worker containing hashes for the app HTML, JS, CSS, icons, and dataset catalog. Offline preparation is intentionally unavailable in the development server. On a desktop, `http://localhost:4173` is suitable for local service-worker testing. Opening `index.html` directly through `file://` is not supported.

## iPad Files + ordinary local HTTP (simpler connected mode)

To avoid certificate setup while keeping the volume in iPad Files, package an existing export:

```sh
python scripts/pack-volume.py public/data/private/sample/manifest.json public/data/private/sample/volume.rsom
npm run build
npm run preview -- --host 0.0.0.0 --port 4173 --strictPort
```

Transfer `volume.rsom` to **On My iPad** (download from the LAN server or another file-transfer method). Open `http://COMPUTER-LAN-IP:4173/?local=1`, then **Open from Files**. The selected file is read locally, never uploaded; no server volume is fetched in this startup mode. Raw `.npy` files must be exported first. Each package contains one resolution; open another package to change resolution. File headers, layout, size, and GPU limits are checked before payload allocation/upload. The packer verifies SHA-256, but browser SHA-256 verification is available only when Web Crypto is available, not over ordinary LAN HTTP.

**This mode is connected, not offline-ready.** You need the computer to open/reload the app and must select the file again after each reload. Keeping the volume in Files does not cache the app. Use a trusted private LAN: HTTP has no transport encryption or server authentication. Local imports are not included in the HTTPS service-worker preparation feature. See [step-by-step instructions and current reconstruction download links](docs/IPAD-RECON.md).

## iPad setup and fully offline use (HTTPS)

Serve **the production `dist/` directory over HTTPS using a certificate trusted by the iPad**, via a local HTTPS server/reverse proxy or an HTTPS static host. For a private LAN setup, provision a certificate for the server's actual hostname, install/trust the issuing local CA on the iPad if needed, and test without certificate warnings. On iPadOS, a manually installed root certificate may also need explicit trust in Settings → General → About → Certificate Trust Settings. An HTTPS reverse proxy can forward to `npm run preview -- --host 0.0.0.0`. Keep the hostname, port, and app path stable.

Safari on an iPad cannot register this worker over plain `http://192.168.…`; the desktop localhost exception does not make a LAN server secure. See [MDN service-worker setup](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers) and [CacheStorage requirements](https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage). The device downloads the app and volumes once; after successful preparation, rendering and navigation run locally on the iPad without the setup server.

1. Open the production HTTPS URL in Safari while connected to the setup server.
2. Open **Take it offline**, select the datasets required at the booth, and tap **Prepare for offline use**. Include the light variant as a fallback.
3. Keep Safari open until **Verified offline** appears. This requires reading back and hashing every required app file, manifest, and binary. Download success alone does not count. Insufficient quota, invalid manifests, mismatched hashes, and failed writes produce an error, not readiness.
4. Optionally use Share → Add to Home Screen. Launch that installed app and perform/verify preparation there too; storage behavior can differ between browsing contexts. Adding the icon alone is not proof of readiness.
5. Complete the airplane-mode checklist below on the actual target device.

The app requests persistent storage when supported; Safari may decline or evict cached data. Avoid Private Browsing. Verify readiness before every booth session and after device/browser updates. Offline status checks the selected set, so selecting an unprepared dataset removes the readiness claim. Unselected datasets remain unavailable offline unless previously prepared for this version.

App updates install a new verified shell and wait for the **Install app update & reload** action. Activate updates while connected, then prepare datasets again. New versions retire old app/data caches; no previous readiness receipt is reused. Dataset changes at an existing URL require preparing again while connected. When changing catalog entries, rebuild the app so its catalog hash and worker version change. Keep hashed assets from the previous deployment available until existing clients have updated; serve `sw.js` with `Cache-Control: no-cache`.

## Export your data

Install the importable Python module and CLI:

```sh
python -m pip install -e .
```

The existing repository virtual environment already has NumPy; it can also run `python rsom_export.py …` directly without installing the module.

```sh
# Replace these example spacings and ranges with acquisition-specific values.
python rsom_export.py recon.npy public/data/private/sample --spacing 0.02 0.02 0.01 --ranges 0 1500 0 900 --name "Sample A" --description "Ex vivo RSOM volume" --depth-axis z

# Independent finite-only percentile ranges, same percentile pair for both channels.
python rsom_export.py recon.npy public/data/private/sample-lite --spacing 0.02 0.02 0.01 --percentiles 1 99.5 --downsample 2 2 2 --name "Sample A · light"

# Optional half-open input crop, then per-axis stride.
rsom-export recon.npy public/data/private/crop --spacing 0.02 0.02 0.01 --crop 10 100 0 120 100 500 --downsample 1 2 2
```

Python API:

```python
import numpy as np
from rsom_export import export_volume

image = np.load("recon.npy", mmap_mode="r")  # shape (x, y, z, 2 or 3)
export_volume(
    image, spacing=(0.02, 0.02, 0.01), output="public/data/private/sample",
    display_ranges=((0, 1500), (0, 900)),
    depth_axis="z", axis_labels=("x", "y", "depth"), units="mm",
    name="Sample A", description="Your short visitor-facing description",
)
```

Both channels are quantized to uint8; source channel 2 is ignored. Explicit ranges and percentiles are mutually exclusive. Finite-only min/max is the default. **Export quantization clips information outside its selected range. Browser display controls cannot recover that information.** Constant finite channels become zero; NaN/-inf become zero, +inf becomes 255. Full resolution is preserved by default. Optional decimation multiplies spacing correctly but can miss thin structures. See [the format and ordering specification](docs/FORMAT.md) for the byte layout, crop origin, intensity mapping, and reference orientation.

## Dataset catalog

Edit `public/datasets.json`, then rebuild. Entries sharing `volumeId` appear once in the dropdown, labeled by `volumeName`; their `resolution` values drive the Light/Full buttons. Paths are relative to the app and must use the same origin and service-worker scope. The `fallback` is the ID of a lower-resolution export offered after errors. Manifest binary paths are relative to their manifest URL. Offline preparation still selects individual resolution variants.

```json
[
  {
    "id": "sample", "name": "Sample A", "description": "A short description.",
    "volumeId": "sample", "volumeName": "Sample A", "resolution": "full",
    "manifest": "data/private/sample/manifest.json", "fallback": "sample-lite"
  },
  {
    "id": "sample-lite", "name": "Sample A · light", "description": "Lower-resolution copy.",
    "volumeId": "sample", "volumeName": "Sample A", "resolution": "light",
    "manifest": "data/private/sample-lite/manifest.json"
  }
]
```

Files under `public/` are copied into the built website, including datasets absent from the catalog. Include only volumes intended for that installation. Never deploy the source `.npy` by accident. `public/data/private/` and NumPy inputs are excluded from Git, not from the Vite build. The viewer uses no network transmission of volumes beyond fetching them from its setup origin.

## Interaction and performance

Tap the **settings icon** at the top right of the viewer to hide or restore the sidebar. The icon has a 44px touch target and an accessible Hide controls / Show controls label. Image settings and the current view are retained. Errors reopen the sidebar so recovery actions remain visible.

Drag with one finger or the left mouse button to rotate. Move two fingers together to pan the image in the direction of the gesture; right-mouse dragging also pans. Pinch or scroll to zoom. Panning operates in the screen plane, including after rotation. Reset view and the perspective presets recenter the volume. Preset/reset buttons, channel toggles, and range inputs support keyboard operation; touch targets are large. The canvas suppresses scrolling and Safari pinch/page gestures; the control panel scrolls independently. The depth window is an inclusive pair of slice indices on the configured axis, displayed as distances from the first exported voxel center.

The initial orthographic Front view is `image.max(axis=1)` rotated clockwise by 90 degrees: -x right, +z down, with physical spacing respected. This puts the skin surface toward the top. Top follows the configured depth axis. The coordinate gizmo and auto-rotate button are the only canvas overlays; loading and errors appear in the sidebar. The depth window uses one track with two 44px handles; drag either handle or use Tab and arrow/Home/End keys. Handles separate vertically when close together so both remain usable, including a one-slice crop. Separate black/white levels and gamma remain in the collapsible fine-tuning panel. Lowering white level brightens the image; gamma >1 brightens intermediate signals. Reset view resets orientation/zoom, not channel settings or crop. Auto-rotation is off by default and pauses during interaction and for 2.5 seconds afterward.

The renderer uses a custom Three.js GLSL3 fullscreen ray-marching pass and an [RG8 3D texture](https://threejs.org/docs/pages/Data3DTexture.html). It reduces resolution and sampling density while interacting, restores quality after 180 ms of inactivity, caps DPR at 1.5, and renders only on changes or during auto-rotation. Hidden tabs stop rendering. Switching datasets aborts obsolete downloads and disposes the old texture. Texture-axis limits, a conservative 192 MiB raw texture budget, upload errors, and context loss have actionable messages. This budget is not a guarantee that a device can allocate that much; browser copies and GPU overhead also consume memory.

Quality is bounded at 2,048 midpoint samples per ray. Very anisotropic or large volumes can reach that cap; tiny peaks can then be undersampled. Arbitrary-angle linear interpolation can also lower isolated maxima. The exact axis-aligned validation uses voxel-centered sampling. No opacity rendering is implemented.

## Validation

```sh
python -m unittest discover -s tests -p "test_export.py" -v
python scripts/generate_demo.py  # regenerate deterministic demos and NumPy reference
npm run build
npx playwright install chromium
npm test
```

The Python suite tests explicit texture byte offsets on an asymmetric phantom, physical spacing/origin after crop/stride, separate channel maxima at different depths, nonfinite/constant/percentile/extreme ranges, and invalid metadata. The browser suite compares every pixel of the production GPU shader's axis-aligned output with a NumPy MIP (tolerance one uint8 level), checks channel/crop behavior, exercises the UI and dataset switching, tests context restoration, and verifies cold-page offline startup plus missing-cache detection. Screenshots are saved under `test-results/`.

Desktop automated browser checks are **not actual iPad testing**. Software WebGL validates logic, not iPad performance, thermal limits, touch gesture behavior, or Safari storage retention.

### Actual iPad acceptance checklist

- Record iPad model, iPadOS/Safari version, app build, dataset dimensions, and spacings. Use the intended Safari/Home Screen context.
- Confirm no certificate warnings; prepare every intended dataset and the light fallback. Wait for **Verified offline**.
- Enable airplane mode and explicitly disable Wi-Fi. Stop the setup server. Close the app/tab, terminate Safari or the installed app, then reopen the saved URL/icon from a cold start. Do not rely on an already-open page or a restored screenshot.
- Confirm the app loads, each prepared dataset renders, and offline verification succeeds. Selecting an unprepared dataset must show a helpful error.
- Exercise one-finger rotation, two-finger panning, pinch, reset/recentering, portrait/landscape rotation, every preset, channel toggle, display range/gamma, one-slice and full-depth crop, and auto-rotation pause/resume. Check the canvas does not scroll or zoom the page.
- Check the upright Front orientation (+z down, +x left), anisotropic proportions, and independent red/green maxima. Inspect a real dataset with known anatomy/acquisition axes.
- Repeatedly switch full/light datasets. Run a booth-length session, checking responsiveness, battery, thermal throttling, and context recovery after backgrounding/returning.
- Restart the iPad and repeat the offline cold start. Repeat after storage pressure and browser/OS updates.
- Reconnect, install a changed build, prepare again, then repeat airplane-mode startup. Reconfirm readiness on the day of the event.

Keep a charging source available and retain the setup server as a recovery option. Final dataset size and quality should be chosen from measurements on the actual booth iPad.
