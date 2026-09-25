# Publish the viewer on GitHub Pages

The Pages build hosts only the viewer. Volumes stay in the user's Files app and are read locally without uploading. No real or synthetic volume files, private manifests, or local dataset catalog are included in the published artifact.

## Publish

1. Commit and push the project changes to `main` in `faberno/rsom_viewer_server`. The workflow listens to `main`; change `.github/workflows/pages.yml` if using another deployment branch.
2. In the GitHub repository, open **Settings → Pages → Build and deployment → Source**, and select **GitHub Actions**.
3. Open **Actions → Publish viewer to GitHub Pages → Run workflow**, choose `main`, and run it. If the push already triggered a successful deployment, no manual run is needed. A run started before Pages was enabled may need to be rerun.
4. Wait for both **build** and **deploy** to succeed. The deployment link should be **https://faberno.github.io/rsom_viewer_server/** (or the URL shown under Settings → Pages if a custom domain is configured).

Future pushes to `main` rebuild, test, and publish automatically. No personal access token or custom deployment secret is needed: the workflow uses GitHub's provided token. The account/organization must allow Actions and Pages for this repository. Public repositories support Pages on GitHub Free; private repository support depends on the plan. A private repository does not normally make the Pages website private.

The workflow runs `npm ci`, `npm run build:pages`, and the Pages browser test before uploading **only `dist-pages/`**. It follows [GitHub's custom workflow setup](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## First use on the iPad

1. Transfer `lfov-light.rsom` to **On My iPad** using your preferred file-transfer method. Its local project path is `public/data/private/transfers/lfov-light.rsom`; GitHub Pages will not host it. Ensure it is downloaded, not a cloud-only placeholder.
2. Open the HTTPS Pages URL in Safari while online. Use **Share → Add to Home Screen**, then launch the installed icon.
3. Open **Take it offline → Prepare for offline use**. Wait for **Verified offline · app only**.
4. Use **Open from Files** to select the `.rsom` file. Raw `.npy` files must be exported and packed first.
5. Turn on airplane mode and turn Wi-Fi off. Close the app completely, reopen its icon, and select the file again. Confirm it renders.

The app is cached; your selected file is not copied into browser storage. Select it again after every reload or launch. Offline preparation verifies the cached app's bytes, not the existence of your file in Files. Safari can evict app storage; check offline startup before presentations. Actual iPad behavior still requires this device test; automated tests use desktop Chromium.

After a deployment, open the app online and use **Install app update & reload** when offered, then prepare/verify the app again. A Home Screen icon alone does not establish offline readiness.

## Local checks

```sh
npm ci
npm run build:pages
npx playwright install chromium
npm run test:pages
npm run preview:pages
```

The Pages test serves the site under `/rsom_viewer_server/`, verifies an offline cold page start, opens a local package without requesting server volumes, and checks detection of missing cached app files.

`build:pages` disables Vite's normal `public/` copying. It copies only `icon.svg` and `app.webmanifest`, writes an empty catalog, generates the service worker, and checks the artifact allowlist. It does not delete or modify private exports. Regular `npm run build` still creates the local dataset-serving version in `dist/`; **do not publish that directory for this workflow**.

Before committing, review `git diff --cached --stat` and keep `.npy`, `.npz`, `.rsom`, private exports, and certificate keys out of Git. The deployment allowlist protects the website artifact, not files deliberately committed to the repository.
