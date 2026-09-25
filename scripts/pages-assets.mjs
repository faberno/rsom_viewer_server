import { copyFile, writeFile } from 'node:fs/promises';

// An allowlist avoids copying private exports even when building on the data workstation.
for (const name of ['icon.svg', 'app.webmanifest']) {
  await copyFile(`public/${name}`, `dist-pages/${name}`);
}
await writeFile('dist-pages/datasets.json', '[]\n');
