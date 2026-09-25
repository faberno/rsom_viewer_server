export type Triple = [number, number, number];
export interface Manifest {
  format: 'rsom-rg8'; version: 1; name: string; description: string; synthetic: boolean;
  dimensions: Triple; spacing: Triple; origin: Triple; units: string;
  axes: { arrayOrder: 'xyzc'; textureOrder: 'zyxc'; labels: [string, string, string]; depthAxis: 'x' | 'y' | 'z' };
  channels: { name: string; color: string; sourceChannel: number; exportRange: [number, number]; defaultDisplayRange: [number, number]; gamma: number }[];
  data: { url: string; type: 'uint8'; channels: 2; layout: string; byteLength: number; sha256: string };
}
export interface Dataset {
  id: string; name: string; description: string; manifest: string; fallback?: string;
  volumeId?: string; volumeName?: string; resolution?: 'light' | 'full';
}
export const axisIndex = (axis: string) => ['x', 'y', 'z'].indexOf(axis);

export function validateManifest(m: Manifest): void {
  const positiveTriple = (a: number[]) => Array.isArray(a) && a.length === 3 && a.every(n => Number.isFinite(n) && n > 0);
  if (!m || m.format !== 'rsom-rg8' || m.version !== 1 || !positiveTriple(m.dimensions) || !m.dimensions.every(Number.isInteger)
      || !positiveTriple(m.spacing) || m.axes?.arrayOrder !== 'xyzc' || m.axes?.textureOrder !== 'zyxc'
      || axisIndex(m.axes.depthAxis) < 0 || !Array.isArray(m.axes.labels) || m.axes.labels.length !== 3
      || !m.axes.labels.every(s => typeof s === 'string' && s.length > 0)
      || m.data?.type !== 'uint8' || m.data.channels !== 2 || m.data.layout !== 'x-fastest-rg-interleaved'
      || !/^[a-f0-9]{64}$/.test(m.data.sha256) || typeof m.data.url !== 'string'
      || !Array.isArray(m.channels) || m.channels.length !== 2
      || !m.channels.every(c => Array.isArray(c.exportRange) && c.exportRange.length === 2 && c.exportRange.every(Number.isFinite)
        && c.exportRange[0] <= c.exportRange[1] && Array.isArray(c.defaultDisplayRange) && c.defaultDisplayRange.length === 2
        && c.defaultDisplayRange.every(Number.isFinite) && c.defaultDisplayRange[0] >= 0 && c.defaultDisplayRange[1] <= 1
        && c.defaultDisplayRange[0] < c.defaultDisplayRange[1] && Number.isFinite(c.gamma) && c.gamma > 0)) {
    throw new Error('Unsupported or malformed volume manifest. Export it again with rsom_export.py (format v1).');
  }
  const expected = m.dimensions.reduce((a, b) => a * b, 2);
  if (!Number.isSafeInteger(expected) || m.data.byteLength !== expected) throw new Error('Volume dimensions and byte count do not agree. Re-export this dataset.');
}

export function localURL(path: string, base = location.href): string {
  const url = new URL(path, base);
  if (url.origin !== location.origin) throw new Error('Datasets must be served from the same origin as the app for offline use.');
  return url.href;
}

export async function getManifest(url: string, signal?: AbortSignal): Promise<Manifest> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not load dataset manifest (HTTP ${response.status}). Connect to the setup server or prepare this dataset offline.`);
  const m: Manifest = await response.json();
  validateManifest(m);
  return m;
}

export async function getVolume(m: Manifest, manifestURL: string, signal: AbortSignal, progress: (fraction: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(localURL(m.data.url, manifestURL), { signal });
  if (!response.ok) throw new Error(`Volume download failed (HTTP ${response.status}). Prepare this dataset while online.`);
  const data = new Uint8Array(m.data.byteLength);
  let offset = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (offset + value.length > data.length) throw new Error('Volume file is larger than declared. Re-export the dataset.');
        data.set(value, offset); offset += value.length; progress(offset / data.length);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } else {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== data.length) throw new Error('Volume file has an incorrect size. Re-export the dataset.');
    data.set(new Uint8Array(buffer)); offset = data.length;
  }
  if (offset !== data.length) throw new Error('Incomplete volume download. Reconnect and try again.');
  await verifyVolume(m, data);
  return data;
}

export async function verifyVolume(m: Manifest, data: Uint8Array<ArrayBuffer>): Promise<void> {
  if (data.byteLength !== m.data.byteLength) throw new Error('Volume file has an incorrect size. Re-export the dataset.');
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', data);
    const hash = Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, '0')).join('');
    if (hash !== m.data.sha256) throw new Error('Volume checksum mismatch. Re-export or refresh the dataset on the server.');
  }
}
