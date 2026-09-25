import { validateManifest, type Manifest } from './data';

// RSOMPK01 + uint32 LE JSON byte length + UTF-8 manifest + unchanged RG8 bytes.
export async function openLocalVolume(file: File): Promise<{ manifest: Manifest; payload: Blob }> {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (header.length !== 12 || new TextDecoder().decode(header.subarray(0, 8)) !== 'RSOMPK01') {
    throw new Error('Choose an exported .rsom file, not recon.npy. Create it with scripts/pack-volume.py.');
  }
  const length = new DataView(header.buffer).getUint32(8, true);
  if (!length || length > 1024 * 1024 || 12 + length > file.size) throw new Error('Invalid .rsom header. Copy or export the file again.');
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await file.slice(12, 12 + length).text());
    validateManifest(manifest);
  } catch { throw new Error('Invalid .rsom manifest. Export the file again with the current exporter.'); }
  if (file.size !== 12 + length + manifest.data.byteLength) throw new Error('Incomplete or oversized .rsom file. Copy the complete file to On My iPad and try again.');
  // Ignore data.url completely: opening a local file must never fetch a volume.
  return { manifest, payload: file.slice(12 + length) };
}

export function readLocalBytes(payload: Blob, signal: AbortSignal, progress: (fraction: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cancelled = () => new DOMException('Local load cancelled', 'AbortError');
    if (signal.aborted) { reject(cancelled()); return; }
    const abort = () => reader.abort();
    signal.addEventListener('abort', abort, { once: true });
    reader.onloadend = () => signal.removeEventListener('abort', abort);
    reader.onabort = () => reject(cancelled());
    reader.onerror = () => reject(new Error('Could not read this file. In Files, save a downloaded copy under On My iPad, then select it again.'));
    reader.onprogress = event => { if (event.lengthComputable) progress(event.loaded / event.total); };
    reader.onload = () => { progress(1); resolve(new Uint8Array(reader.result as ArrayBuffer)); };
    reader.readAsArrayBuffer(payload);
  });
}
