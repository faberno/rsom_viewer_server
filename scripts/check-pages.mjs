import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const allowed = new Set(['assets', 'index.html', 'icon.svg', 'app.webmanifest', 'datasets.json', 'sw.js']);
for (const entry of await readdir('dist-pages', { withFileTypes: true })) {
  assert(allowed.has(entry.name), `Unexpected Pages artifact: ${entry.name}`);
  assert(entry.isDirectory() === (entry.name === 'assets'), `Unexpected file type: ${entry.name}`);
}
for (const entry of await readdir('dist-pages/assets', { withFileTypes: true })) {
  assert(entry.isFile() && /\.(js|css)$/.test(entry.name), `Unexpected bundled asset: ${entry.name}`);
}
assert.deepEqual(JSON.parse(await readFile('dist-pages/datasets.json', 'utf8')), []);
for (const name of allowed) if (name !== 'assets') await readFile(`dist-pages/${name}`);
console.log('Pages artifact verified: app only, empty catalog, no volume files.');
