import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(name)); else result.push(name);
  }
  return result;
}
const output = process.argv[2] || 'dist';
const files = (await walk(output)).filter(f => !path.relative(output, f).replaceAll('\\', '/').startsWith('data/') && !f.endsWith('sw.js')).sort();
const resources = [];
for (const file of files) resources.push({ url: './' + path.relative(output, file).replaceAll('\\', '/'), sha256: hash(await readFile(file)) });
const template = await readFile('scripts/sw-template.js', 'utf8');
const version = hash(JSON.stringify(resources) + template).slice(0, 16);
await writeFile(path.join(output, 'sw.js'), template.replace('__VERSION__', version).replace('__SHELL__', JSON.stringify(resources)));
console.log(`Offline worker ${version}: ${resources.length} verified app resources. Datasets are cached only on request.`);
