import './style.css';
import { VolumeViewer } from './viewer';
import { axisIndex, getManifest, getVolume, localURL, verifyVolume, type Dataset, type Manifest } from './data';
import { openLocalVolume, readLocalBytes } from './local-volume';
import { activateUpdate, offlineRequest, registerOffline } from './offline';
import { DepthRange } from './depth-range';

document.querySelector('#app')!.innerHTML = `
  <main>
    <section class="stage" aria-label="Interactive RSOM volume">
      <canvas id="volume" tabindex="0" aria-label="3D volume. Drag with one finger to rotate; move two fingers together to pan; pinch or scroll to zoom. Right-mouse drag also pans. Reset view recenters the volume."></canvas>
      <div class="orientation"><svg id="axes" viewBox="0 0 130 130" role="img" aria-label="Positive data axis directions"></svg></div>
      <button id="auto" aria-pressed="false" title="Slow automatic rotation">↻ <span>Auto-rotate</span></button>
      <button id="sidebar-toggle" aria-controls="sidebar" aria-expanded="true" aria-label="Hide controls" title="Hide controls"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.5 3-.6 2.2-1.5.9-2.2-.6-2.5 4.3 1.6 1.6v1.8l-1.6 1.6 2.5 4.3 2.2-.6 1.5.9.6 2.2h5l.6-2.2 1.5-.9 2.2.6 2.5-4.3-1.6-1.6v-1.8l1.6-1.6-2.5-4.3-2.2.6-1.5-.9-.6-2.2z"/><circle cx="12" cy="12.3" r="3"/></svg></button>
    </section>
    <aside id="sidebar" class="controls" aria-label="Viewer controls">
      <section class="control-section"><label class="section-label" for="dataset">Volume</label><select id="dataset"></select><div class="resolution" role="group" aria-label="Volume resolution"><button id="resolution-light" data-resolution="light" aria-pressed="true">Light</button><button id="resolution-full" data-resolution="full" aria-pressed="false">Full</button></div><button id="open-local">Open from Files</button><input id="local-file" type="file" accept=".rsom,application/octet-stream" hidden><p id="local-status" class="technical-note" role="status">Open an exported .rsom file stored on this iPad. Nothing is uploaded.</p></section>
      <div id="loading" class="loading" role="status"><span class="spinner"></span><span id="loading-text">Opening volume…</span><progress id="load-progress" max="1" value="0"></progress></div>
      <div id="error" class="error hidden" role="alert"><strong>Could not open volume</strong><p id="error-message"></p><div class="error-actions"><button id="retry">Try again</button><button id="fallback" class="hidden">Open light dataset</button></div></div>
      <section class="control-section"><div class="section-label">Perspective</div><div class="presets"><button data-view="front" class="active">Front</button><button data-view="top">Top</button><button data-view="side">Side</button></div><button id="reset" class="reset">⟲ &nbsp; Reset view</button></section>
      <section class="control-section channels"><div class="section-label">Channels</div><button class="channel-toggle red" id="toggle-0" aria-pressed="true"><span class="channel-dot"></span><span>Low frequency<small>Red channel</small></span><span class="switch"></span></button><button class="channel-toggle green" id="toggle-1" aria-pressed="true"><span class="channel-dot"></span><span>High frequency<small>Green channel</small></span><span class="switch"></span></button></section>
      <section class="crop-section"><div class="range-heading"><span>Depth window <span id="depth-axis">· z</span></span><output id="crop-value">Full depth</output></div><div id="depth-range"></div><div class="depth-values"><output id="crop-start-value">0</output><output id="crop-end-value">1</output></div></section>
      <details id="technical"><summary>Fine-tune the image <span>＋</span></summary><div id="channel-settings"></div></details>
      <details id="offline-panel"><summary>Take it offline <span>↓</span></summary><p class="muted">Select server volumes to keep, or prepare just the app for files stored on this iPad.</p><div id="offline-datasets"></div><button id="prepare" class="primary">Prepare for offline use</button><p id="offline-status" class="technical-note" role="status">Checking offline support…</p><button id="update" class="hidden">Install app update & reload</button></details>
    </aside>
  </main>`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const state = [0, 1].map(() => ({ visible: true, low: 0, high: 1, gamma: 1 }));
let viewer: VolumeViewer | undefined, datasets: Dataset[] = [], selected: Dataset | undefined;
let manifest: Manifest | undefined, abort: AbortController | undefined, loadGeneration = 0, offlineAvailable = false;
const validationMode = new URLSearchParams(location.search).has('validation');
const localMode = new URLSearchParams(location.search).has('local');
const viewerOnly = import.meta.env.MODE === 'pages';
let localFile: File | undefined;
const localDataset: Dataset = { id: 'local-file', name: 'From Files', description: '', manifest: '' };
const volumeId = (dataset: Dataset) => dataset.volumeId || dataset.id;
const depthRange = new DepthRange($('depth-range'), () => updateCrop());
function remember(key: string, value?: string): string | null {
  try { if (value !== undefined) localStorage.setItem(key, value); return localStorage.getItem(key); } catch { return null; }
}

function setSidebarVisible(visible: boolean) {
  $('sidebar').hidden = !visible;
  document.querySelector('main')!.classList.toggle('sidebar-hidden', !visible);
  $('sidebar-toggle').setAttribute('aria-expanded', String(visible));
  const label = visible ? 'Hide controls' : 'Show controls';
  $('sidebar-toggle').setAttribute('aria-label', label);
  $('sidebar-toggle').title = label;
}
$('sidebar-toggle').addEventListener('click', () => setSidebarVisible($('sidebar').hidden));

function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function showError(message: string) { setSidebarVisible(true); $('error-message').textContent = message; $('error').classList.remove('hidden'); $('loading').classList.add('hidden'); $('fallback').classList.toggle('hidden', !selected?.fallback); }
function showProgress(message: string, fraction: number) { $('loading').classList.remove('hidden'); $('loading-text').textContent = message; $<HTMLProgressElement>('load-progress').value = fraction; }
function orientation(axes: { label: string; x: number; y: number }[]) {
  const svg = $('axes'); svg.replaceChildren();
  axes.forEach((axis, i) => {
    const color = ['#a6b6c2', '#c4b5db', '#7dceb6'][i];
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '65'); line.setAttribute('y1', '65'); line.setAttribute('x2', String(65 + axis.x * 34)); line.setAttribute('y2', String(65 + axis.y * 34)); line.setAttribute('stroke', color); line.setAttribute('stroke-width', '2'); svg.append(line);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(65 + axis.x * 49)); text.setAttribute('y', String(70 + axis.y * 49)); text.setAttribute('fill', color); text.setAttribute('text-anchor', 'middle'); text.textContent = axis.label; svg.append(text);
  });
}

for (let c = 0; c < 2; c++) {
  const block = document.createElement('fieldset'); block.className = c === 0 ? 'red' : 'green';
  block.innerHTML = `<legend>${c === 0 ? 'Red · low frequency' : 'Green · high frequency'}</legend>
    <label class="slider-label" for="low-${c}">Black level <output id="low-value-${c}">0%</output></label><input id="low-${c}" type="range" min="0" max="0.99" step="0.01" value="0">
    <label class="slider-label" for="high-${c}">White level / brightness <output id="high-value-${c}">100%</output></label><input id="high-${c}" type="range" min="0.01" max="1" step="0.01" value="1">
    <label class="slider-label" for="gamma-${c}">Gamma <output id="gamma-value-${c}">1.00</output></label><input id="gamma-${c}" type="range" min="0.25" max="3" step="0.05" value="1">`;
  $('channel-settings').append(block);
  $(`toggle-${c}`).addEventListener('click', () => { state[c].visible = !state[c].visible; $(`toggle-${c}`).setAttribute('aria-pressed', String(state[c].visible)); updateChannel(c); });
  for (const key of ['low', 'high', 'gamma'] as const) input(`${key}-${c}`).addEventListener('input', () => {
    let value = Number(input(`${key}-${c}`).value);
    if (key === 'low') value = Math.min(value, state[c].high - .01);
    if (key === 'high') value = Math.max(value, state[c].low + .01);
    input(`${key}-${c}`).value = String(value); state[c][key] = value; updateChannel(c);
  });
}
function updateChannel(c: number) {
  const s = state[c]; viewer?.setChannel(c, s.visible, s.low, s.high, s.gamma);
  for (const key of ['low', 'high', 'gamma'] as const) $(`${key}-value-${c}`).textContent = key === 'gamma' ? s[key].toFixed(2) : `${Math.round(s[key] * 100)}%`;
}
function updateCrop() {
  if (!manifest) return;
  const { start, end } = depthRange;
  const axis = axisIndex(manifest.axes.depthAxis), spacing = manifest.spacing[axis];
  $('crop-value').textContent = `${end - start + 1} / ${manifest.dimensions[axis]} slices`;
  const format = (index: number) => `${Number((index * spacing).toFixed(3))} ${manifest!.units}`;
  $('crop-start-value').textContent = format(start); $('crop-end-value').textContent = format(end);
  depthRange.describe(format(start), format(end));
  viewer?.setCrop(start, end);
}

function updateResolution(dataset: Dataset) {
  $<HTMLSelectElement>('dataset').value = volumeId(dataset);
  document.querySelectorAll<HTMLButtonElement>('[data-resolution]').forEach(button => {
    button.disabled = !datasets.some(d => volumeId(d) === volumeId(dataset) && d.resolution === button.dataset.resolution);
    button.setAttribute('aria-pressed', String(dataset.resolution === button.dataset.resolution));
  });
  document.querySelector<HTMLElement>('.resolution')!.hidden = dataset === localDataset;
  $<HTMLButtonElement>('prepare').disabled = !offlineAvailable;
  if (dataset === localDataset) $('offline-status').textContent = offlineAvailable
    ? 'Prepare the app for offline use. Keep your .rsom files in On My iPad and select one after each launch.'
    : 'Over LAN HTTP, the computer must serve the app again after a reload. Offline app preparation requires trusted HTTPS.';
  else if (!offlineAvailable && !isSecureContext) $('offline-status').textContent = 'HTTP viewing works while connected to the computer. Offline app preparation requires trusted HTTPS.';
}

async function loadDataset(dataset: Dataset) {
  const generation = ++loadGeneration; abort?.abort(); abort = new AbortController();
  selected = dataset; manifest = undefined; $('error').classList.add('hidden'); viewer?.clear();
  delete document.body.dataset.ready; remember('rsom-last-dataset', dataset.id);
  updateResolution(dataset);
  showProgress('Reading volume details…', 0);
  try {
    if (!viewer) viewer = new VolumeViewer($<HTMLCanvasElement>('volume'), showError, () => { if (selected) void loadDataset(selected); }, orientation);
    const signal = abort.signal;
    const local = dataset === localDataset;
    const file = localFile;
    if (local && !file) throw new Error('Tap Open from Files to choose a .rsom volume again.');
    const url = local ? '' : localURL(dataset.manifest, document.baseURI);
    const opened = local ? await openLocalVolume(file!) : undefined;
    const m = opened ? opened.manifest : await getManifest(url, signal); if (generation !== loadGeneration) return;
    viewer.checkSize(m);
    const progress = (fraction: number) => { if (generation === loadGeneration) showProgress(`Loading volume · ${Math.round(fraction * 100)}%`, fraction * .9); };
    const bytes = opened ? await readLocalBytes(opened.payload, signal, progress) : await getVolume(m, url, signal, progress);
    if (opened) await verifyVolume(m, bytes);
    if (generation !== loadGeneration) return;
    showProgress('Uploading volume to the GPU…', .95);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (generation !== loadGeneration) return;
    viewer.setVolume(m, bytes); manifest = m;
    for (let c = 0; c < 2; c++) {
      state[c] = { visible: true, low: m.channels[c].defaultDisplayRange[0], high: m.channels[c].defaultDisplayRange[1], gamma: m.channels[c].gamma };
      for (const key of ['low', 'high', 'gamma'] as const) input(`${key}-${c}`).value = String(state[c][key]);
      $(`toggle-${c}`).setAttribute('aria-pressed', 'true'); updateChannel(c);
    }
    const axis = axisIndex(m.axes.depthAxis), last = m.dimensions[axis] - 1;
    depthRange.set(last);
    $('depth-axis').textContent = `· ${m.axes.labels[axis]}`; updateCrop();
    setView('front'); $('loading').classList.add('hidden');
    document.body.dataset.ready = dataset.id;
    if (local) $('local-status').textContent = `${file!.name} — read on this device, not uploaded. Select it again after reloading the app.`;
    void checkOffline();
  } catch (error) { if (generation === loadGeneration && !(error instanceof DOMException && error.name === 'AbortError')) showError(errorMessage(error)); }
}

function setView(view: 'front' | 'top' | 'side') {
  viewer?.preset(view);
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => { button.classList.toggle('active', button.dataset.view === view); button.setAttribute('aria-pressed', String(button.dataset.view === view)); });
}
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view as 'front' | 'top' | 'side')));
$('volume').addEventListener('pointerdown', () => { document.querySelectorAll('[data-view]').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); }); });
$('reset').addEventListener('click', () => setView('front'));
$('auto').addEventListener('click', () => { const enabled = $('auto').getAttribute('aria-pressed') !== 'true'; $('auto').setAttribute('aria-pressed', String(enabled)); viewer?.setAuto(enabled); });
// Include a recognized non-media MIME type: an unknown extension alone can make
// iPad Safari fall back to its unrestricted Photos/Camera/Files source menu.
// The picker filter is only a hint; openLocalVolume still validates the contents.
$('open-local').addEventListener('click', () => input('local-file').click());
input('local-file').addEventListener('change', () => {
  const file = input('local-file').files?.[0];
  if (!file) return;
  localFile = file;
  if (!datasets.includes(localDataset)) {
    datasets.push(localDataset);
    $<HTMLSelectElement>('dataset').add(new Option('From Files', localDataset.id));
  }
  input('local-file').value = ''; // Selecting the same file again should also retry.
  $('local-status').textContent = 'Reading the selected file on this device…';
  void loadDataset(localDataset);
});
$('dataset').addEventListener('change', () => {
  const variants = datasets.filter(d => volumeId(d) === $<HTMLSelectElement>('dataset').value);
  const d = variants.find(d => d.resolution === selected?.resolution) || variants[0]; if (d) void loadDataset(d);
});
document.querySelectorAll<HTMLButtonElement>('[data-resolution]').forEach(button => button.addEventListener('click', () => {
  const d = datasets.find(d => volumeId(d) === $<HTMLSelectElement>('dataset').value && d.resolution === button.dataset.resolution);
  if (d && d.id !== selected?.id) void loadDataset(d);
}));
$('retry').addEventListener('click', () => { if (selected) void loadDataset(selected); else location.reload(); });
$('fallback').addEventListener('click', () => { const d = datasets.find(d => d.id === selected?.fallback); if (d) void loadDataset(d); });
$('update').addEventListener('click', activateUpdate);
function offlineSelection() { if (selected === localDataset) return []; return [...document.querySelectorAll<HTMLInputElement>('.offline-choice:checked')].map(i => localURL(i.value, document.baseURI)); }
async function checkOffline() {
  if (!offlineAvailable) return;
  const current = selected;
  try { const result = await offlineRequest('STATUS', offlineSelection(), message => { if (selected === current) $('offline-status').textContent = message; }); if (selected === current) $('offline-status').textContent = result.message; }
  catch (error) { if (selected === current) $('offline-status').textContent = errorMessage(error); }
}
$('prepare').addEventListener('click', async () => {
  const button = $<HTMLButtonElement>('prepare'); button.disabled = true;
  const choices = [...document.querySelectorAll<HTMLInputElement>('.offline-choice')]; choices.forEach(c => c.disabled = true);
  try {
    if (!offlineAvailable) throw new Error('Offline preparation needs a production build served over trusted HTTPS. See the README setup instructions.');
    const result = await offlineRequest('PREPARE', offlineSelection(), message => { $('offline-status').textContent = message; });
    $('offline-status').textContent = result.message;
  } catch (error) { $('offline-status').textContent = `Not ready offline. ${errorMessage(error)}`; }
  finally { button.disabled = !offlineAvailable; choices.forEach(c => c.disabled = false); }
});

async function start() {
  try {
    const response = await fetch('./datasets.json'); if (!response.ok) throw new Error('Dataset catalog could not load. Reconnect to the setup server.');
    datasets = await response.json();
    if (!Array.isArray(datasets) || datasets.some(d => !d.id || !d.name || !d.manifest)) throw new Error('datasets.json must contain a list of dataset definitions.');
    // Keep synthetic fixtures available only in explicitly requested diagnostic mode.
    if (validationMode && !viewerOnly) datasets.push(
      { id: 'demo', volumeId: 'demo', volumeName: 'Synthetic test volume', resolution: 'full', name: 'Synthetic test · Full', description: '', manifest: 'data/demo/manifest.json', fallback: 'demo-lite' },
      { id: 'demo-lite', volumeId: 'demo', volumeName: 'Synthetic test volume', resolution: 'light', name: 'Synthetic test · Light', description: '', manifest: 'data/demo-lite/manifest.json' }
    );
    const savedSelection = remember('rsom-offline-selection')?.split('|');
    const volumeIds = new Set<string>();
    datasets.forEach((d, i) => {
      if (!volumeIds.has(volumeId(d))) {
        $<HTMLSelectElement>('dataset').add(new Option(d.volumeName || d.name, volumeId(d))); volumeIds.add(volumeId(d));
      }
      const label = document.createElement('label'); label.className = 'offline-label';
      const choice = document.createElement('input'); choice.type = 'checkbox'; choice.className = 'offline-choice'; choice.value = d.manifest; choice.checked = savedSelection ? savedSelection.includes(d.manifest) : i === 0;
      choice.addEventListener('change', () => {
        remember('rsom-offline-selection', [...document.querySelectorAll<HTMLInputElement>('.offline-choice:checked')].map(c => c.value).join('|'));
        void checkOffline();
      }); label.append(choice, document.createTextNode(d.name)); $('offline-datasets').append(label);
    });
    if (!datasets.length || localMode || remember('rsom-last-dataset') === localDataset.id) {
      datasets.push(localDataset);
      $<HTMLSelectElement>('dataset').add(new Option('From Files', localDataset.id));
      selected = localDataset; updateResolution(localDataset);
      $('loading').classList.add('hidden');
      $('local-status').textContent = 'Choose a .rsom volume from On My iPad. Select it again each time you open or reload this page.';
    } else {
      const saved = datasets.find(d => d.id === remember('rsom-last-dataset'));
      const initial = validationMode
        ? datasets.find(d => d.id === (saved?.volumeId === 'demo' ? saved.id : 'demo'))!
        : saved || datasets[0];
      await loadDataset(initial);
    }
    try {
      await registerOffline(() => { $('update').classList.remove('hidden'); $('offline-status').textContent = 'An app update is available. Install it while online, then prepare your datasets again.'; });
      offlineAvailable = true; if (selected) updateResolution(selected); await checkOffline();
    } catch (error) { $('offline-status').textContent = errorMessage(error); }
  } catch (error) { showError(errorMessage(error)); }
}
void start();

// Explicit opt-in diagnostic harness for the automated GPU comparison.
if (validationMode && !viewerOnly) {
  Object.assign(window, { rsomValidation: {
    load: async () => loadDataset({ id: 'validation', name: 'Validation phantom', description: 'Synthetic asymmetric phantom', manifest: 'data/validation/manifest.json' }),
    pixels: () => viewer!.referencePixels(),
    uprightPixels: () => viewer!.referencePixels(true),
    viewState: () => {
      viewer!.camera.updateMatrixWorld();
      return {
        center: viewer!.controls.target.clone().set(0, 0, 0).project(viewer!.camera).toArray(),
        zoom: viewer!.camera.zoom, rotation: viewer!.camera.quaternion.toArray()
      };
    },
    contextLoss: () => { const ext = viewer!.renderer.getContext().getExtension('WEBGL_lose_context'); ext?.loseContext(); setTimeout(() => ext?.restoreContext(), 500); }
  } });
}
