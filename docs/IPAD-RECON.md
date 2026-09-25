# This reconstruction on the iPad

`recon.npy` has been exported with the requested assumption of equal voxel spacing: `(1,1,1)` in **voxel units**, not millimeters. Positive z points from the skin surface into deeper tissue. The depth slider starts at the first input z slice. No actual surface location is inferred from intensity.

The original array is unchanged. Both channels range from 0 to 1, so both exports preserve that complete range in uint8 without additional percentile clipping.

| Dataset | Dimensions (x,y,z) | Spacing (voxel units) | Binary size |
| --- | --- | --- | --- |
| vol → Light | 168 × 85 × 561 | 2 × 2 × 2 | 15.3 MiB |
| vol → Full | 335 × 169 × 1121 | 1 × 1 × 1 | 121.1 MiB |

Start with the light version to check responsiveness. Select the full version afterward to assess the fine structures on the actual device. The light version uses every second voxel; it can omit small features. Black/white level and gamma controls adjust the exported data without re-exporting.

## Simple setup: HTTP viewer + a volume in iPad Files (no certificates)

The app is served by the computer; the selected volume is read directly from the iPad's Files app. No volume is uploaded. Use a trusted private LAN: HTTP does not encrypt or authenticate the app code. No Internet connection is needed once the server and iPad are on the same LAN, but **the computer must remain available to open/reload the app**. This is not the airplane-mode offline setup described later.

The current reconstruction is already packed into single-file exports:

- Light (~15.3 MiB): `public/data/private/transfers/vol-light.rsom`
- Full (~121.1 MiB): `public/data/private/transfers/vol-full.rsom`

1. Run `npm run build`, then `npm run preview -- --host 0.0.0.0 --port 4173 --strictPort` in this project. Leave the preview terminal running. If it is already running, only rebuild.
2. On the iPad, download [vol-light.rsom](http://192.168.178.91:4173/data/private/transfers/vol-light.rsom). If Safari asks to download, accept. Use Files to move/save the downloaded file under **On My iPad**. Optionally download [vol-full.rsom](http://192.168.178.91:4173/data/private/transfers/vol-full.rsom) as well. These URLs transfer data only across your LAN. Do not rely on a cloud-only placeholder; ensure the file is downloaded.
3. Open **http://192.168.178.91:4173/?local=1** in Safari. This startup mode does not automatically download a server volume.
4. Under Volume, tap **Open from Files**, browse to **On My iPad**, and select `vol-light.rsom`. Use the same button to open `vol-full.rsom` later. Light/Full buttons are hidden for local files because each file contains just one resolution.
5. Rotate, pan, zoom, and adjust channels normally. Reopening/reloading the app requires the server and selecting the file again. The file stays in Files; the app retains only the current file selection for this page session, not persistent file access or a second saved copy.

No certificate installation or trust setting is needed for this mode. Existing HTTPS configuration/certificates are not changed automatically. Removing the RSOM certificate profile stops trusting that local HTTPS setup, but does not affect this HTTP mode.

The file picker requests `.rsom` and binary-document files (`application/octet-stream`), rather than unrestricted media. This should bypass Safari's Photos/Camera source menu. Safari controls the native dialog; confirm its behavior on the actual iPad after refreshing the app. The app still validates the file contents even if the picker allows other binary documents.

For a new export, create the single-file package on the computer:

```powershell
python scripts/pack-volume.py public/data/private/recon-lite/manifest.json public/data/private/transfers/another-light.rsom
```

The packer verifies the existing binary checksum, adds the manifest, and preserves every exported voxel byte. It refuses to overwrite an existing package; choose a new output name. Raw `recon.npy` is not accepted by the browser. It must first be converted by `rsom_export.py`. The browser checks headers, manifest, file length, and GPU limits; it also checks SHA-256 when Web Crypto is available (HTTPS/localhost). On LAN HTTP, Web Crypto is unavailable, so browser checksum verification is skipped. This is not a claim of cryptographic integrity over HTTP.

Actual-iPad check: verify the downloaded file exists under On My iPad, open both sizes from Files, test gestures, background/restore Safari, then reload and confirm you can select the file again. A page that remains open may keep rendering if Wi-Fi disconnects, but Safari can discard it at any time. Do not use that as proof of offline readiness.

## Alternative: load the volume from the computer (HTTP)

From the project directory on the Windows computer:

```powershell
npm run build
npm run preview -- --host 0.0.0.0 --port 4173 --strictPort
```

Keep that terminal open. Connect the iPad to the same home router/network as the computer (the computer may use Ethernet). Open this address in Safari:

```text
http://192.168.178.91:4173
```

That is the computer's LAN address observed during setup; use `ipconfig` if it changes. If Windows asks about network access, allow the server on your trusted private network. Guest Wi-Fi/client isolation can prevent the iPad from reaching the computer. Do not configure router port forwarding for this local setup.

Choose **vol**, then **Light**. Drag with one finger to rotate, move two fingers together to pan, and pinch to zoom. **Reset view** recenters the image. Tap **Full** to try full resolution. The default Front view places shallow skin at the top and +z depth downward. Use the two handles on the single depth track to crop. This HTTP connection is only the first connectivity/rendering check. **It cannot prepare the iPad for offline use.**

## Offline setup (local HTTPS is configured)

The local HTTPS server is configured in `Caddyfile.local` and serves the production app at **https://192.168.178.91:8443/**. A portable Caddy executable is in `.local-https/bin`; its local certificate authority is named **RSOM iPad Offline Root**. This setup does not upload your data or install a certificate into the Windows trust store. Certificate trust on the iPad must be enabled manually.

1. While connected to the same home network, open **http://192.168.178.91:8080/rsom-root.cer** in Safari. Allow the certificate/profile download.
2. Open **Settings → Profile Downloaded → Install** and follow the prompts. If needed, look under **General → VPN & Device Management**. The certificate should be named **RSOM iPad Offline Root**. [Apple profile installation instructions](https://support.apple.com/en-us/102400).
3. Open **Settings → General → About → Certificate Trust Settings** and enable full trust for **RSOM iPad Offline Root**. [Apple certificate trust instructions](https://support.apple.com/en-us/102390).
4. Open **https://192.168.178.91:8443/** in Safari. The app must open without a certificate warning. The old HTTP app address is a different origin and cannot prepare offline storage.
5. For a Home Screen app, use Safari's Share menu → Add to Home Screen, then launch that icon. In that app, tap the gear to show controls, open **Take it offline**, select **vol · Light** and **vol · Full**, and tap **Prepare for offline use**. Keep the app open until **Verified offline** appears. The volumes total about 136 MiB before storage overhead.
6. Enable airplane mode and explicitly turn Wi-Fi off. Close/terminate the app, reopen it from its icon, and check both Light and Full. Only a successful cold start confirms readiness on this iPad. The computer/server is no longer needed once that test passes.

If either setup URL does not open, allow Caddy through Windows Firewall on the trusted private network if Windows asks. Keep the iPad off guest Wi-Fi. Keep the computer's LAN address stable, preferably with a DHCP reservation on the router; if it changes, update both addresses in `Caddyfile.local`, restart the server, and prepare the app at the new HTTPS origin.

### Restart the setup server later

From the project directory, run this and leave its terminal open:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local-https.ps1
```

The server reads `dist/`, so use `npm run build` after app/dataset changes, then install the app update and prepare offline data again. To provision this setup on another computer, run `scripts/install-local-https.ps1` first, start the server, and run `scripts/export-local-certificate.ps1` in a second terminal to publish its new public certificate. The install script downloads an official Windows x64 Caddy release and verifies its SHA-256 before extraction. Each computer's generated certificate must be trusted separately on the iPad.

Keep `.local-https/storage` private and retain it across server restarts; it contains the certificate authority's private keys. Only `.local-https/public/rsom-root.cer` is exposed for download. To remove the iPad's trust when this setup is no longer used, remove its RSOM certificate profile in Settings. Offline data may still be evicted by Safari, so recheck before the event.

The current `dist/` includes these real-data exports. They are excluded from Git, but they are still included in a website deployment. This local workflow does not upload them to an external host.
