export interface OfflineReply { type: string; message: string; ready?: boolean; manifests?: string[] }
let registration: ServiceWorkerRegistration | undefined;

export async function registerOffline(onUpdate: () => void): Promise<void> {
  if (!import.meta.env.PROD) throw new Error('Offline preparation is available in the production build. Run npm run build, then npm run preview.');
  if (!isSecureContext || !('serviceWorker' in navigator)) throw new Error('Offline use requires HTTPS with a certificate trusted by the iPad. HTTP on a LAN address cannot prepare offline storage.');
  const existing = await navigator.serviceWorker.getRegistration('./');
  try { registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }); }
  catch (error) {
    // Offline launch can use the installed active worker even if an update check fails.
    if (existing?.active && navigator.serviceWorker.controller) registration = existing;
    else throw error;
  }
  if (registration.waiting) onUpdate();
  registration.addEventListener('updatefound', () => {
    const worker = registration!.installing;
    worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) onUpdate(); });
  });
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Offline worker setup did not finish. Keep the setup server connected, reload, and try again. Check available Safari storage if this repeats.')), 20000);
    navigator.serviceWorker.ready.then(() => { window.clearTimeout(timer); resolve(); }, error => { window.clearTimeout(timer); reject(error); });
  });
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
  }
}

export async function offlineRequest(type: 'PREPARE' | 'STATUS', manifests: string[], progress: (message: string) => void): Promise<OfflineReply> {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) throw new Error('Offline worker is not ready. Open the production app over HTTPS and retry.');
  if (type === 'PREPARE') await navigator.storage?.persist?.().catch(() => false);
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    let timer: number;
    const timeout = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { channel.port1.close(); reject(new Error('Offline preparation timed out. Keep the app open, check the connection, and retry.')); }, 120000); };
    timeout();
    channel.port1.onmessage = ({ data }: MessageEvent<OfflineReply>) => {
      timeout();
      if (data.type === 'PROGRESS') { progress(data.message); return; }
      window.clearTimeout(timer); channel.port1.close();
      if (data.type === 'ERROR') reject(new Error(data.message)); else resolve(data);
    };
    worker.postMessage({ type, manifests }, [channel.port2]);
  });
}

export function activateUpdate() {
  if (!registration?.waiting) { location.reload(); return; }
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  registration.waiting.postMessage({ type: 'ACTIVATE' });
}
