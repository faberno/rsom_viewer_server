import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { axisIndex, type Manifest } from './data';
import { vertexShader, fragmentShader } from './shader';

export class VolumeViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 100);
  controls!: OrbitControls;
  readonly maxTextureSize: number;
  private scene = new THREE.Scene();
  private passCamera = new THREE.Camera();
  private material: THREE.RawShaderMaterial;
  private geometry = new THREE.PlaneGeometry(2, 2);
  private texture?: THREE.Data3DTexture;
  private extent = new THREE.Vector3(1, 1, 1);
  private manifest?: Manifest;
  private raf = 0;
  private settleTimer = 0;
  private autoTimer = 0;
  private interacting = false;
  private lowQuality = false;
  private auto = false;
  private pausedUntil = 0;
  private lost = false;
  private resizeObserver: ResizeObserver;
  private orientationCallback: (axes: { label: string; x: number; y: number }[]) => void;

  constructor(readonly canvas: HTMLCanvasElement, onError: (message: string) => void,
              onRestore: () => void, orientation: VolumeViewer['orientationCallback']) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is unavailable. Enable WebGL in Safari, update iPadOS, and close other graphics-heavy tabs before trying again.');
    this.renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false, alpha: false });
    this.renderer.setClearColor(0x000000);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.debug.onShaderError = (_gl, _program, vertex, fragment) => {
      onError(`The volume shader could not compile. Update Safari/iPadOS. ${gl.getShaderInfoLog(vertex) || gl.getShaderInfoLog(fragment) || ''}`);
    };
    this.maxTextureSize = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
    this.orientationCallback = orientation;
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader, fragmentShader, depthTest: false, depthWrite: false,
      uniforms: {
        volume: { value: null }, eye: { value: new THREE.Vector3() },
        rightAxis: { value: new THREE.Vector3() }, upAxis: { value: new THREE.Vector3() }, direction: { value: new THREE.Vector3() },
        extent: { value: this.extent }, dimensions: { value: new THREE.Vector3() }, halfView: { value: new THREE.Vector2() },
        redRange: { value: new THREE.Vector2(0, 1) }, greenRange: { value: new THREE.Vector2(0, 1) },
        gammaValue: { value: new THREE.Vector2(1, 1) }, visibleChannels: { value: new THREE.Vector2(1, 1) },
        cropLow: { value: new THREE.Vector3(0, 0, 0) }, cropHigh: { value: new THREE.Vector3(1, 1, 1) },
        voxelStep: { value: .01 }, quality: { value: 1 }
      }
    });
    const quad = new THREE.Mesh(this.geometry, this.material); quad.frustumCulled = false; this.scene.add(quad);
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); this.lost = true; cancelAnimationFrame(this.raf); this.raf = 0;
      onError('Graphics memory was lost. Close other tabs. The viewer will reload the selected dataset when graphics recover; choose the light dataset if this repeats.');
    });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; onRestore(); });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
    canvas.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(canvas.parentElement!);
    document.addEventListener('visibilitychange', this.visibility);
    this.preset('front');
  }

  private createControls() {
    // OrbitControls captures camera.up at construction, so recreate it when changing view axes.
    this.controls?.dispose();
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enablePan = true; this.controls.screenSpacePanning = true; this.controls.enableDamping = false;
    this.controls.minZoom = .4; this.controls.maxZoom = 8;
    this.controls.rotateSpeed = .6; this.controls.zoomSpeed = .8; this.controls.autoRotateSpeed = .55;
    this.controls.touches.ONE = THREE.TOUCH.ROTATE; this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    this.controls.addEventListener('start', () => {
      this.interacting = true; this.pausedUntil = performance.now() + 2500; this.setLowQuality(true);
    });
    this.controls.addEventListener('change', () => this.invalidate());
    this.controls.addEventListener('end', () => { this.interacting = false; this.settle(); });
  }

  private visibility = () => {
    if (document.hidden) { cancelAnimationFrame(this.raf); this.raf = 0; window.clearTimeout(this.autoTimer); }
    else this.invalidate();
  };

  checkSize(m: Manifest) {
    if (m.dimensions.some(n => n > this.maxTextureSize)) throw new Error(`This device supports at most ${this.maxTextureSize} voxels per axis. Choose the light dataset or export with --downsample.`);
    // Conservative booth budget; browser/GPU copies can multiply this footprint.
    if (m.data.byteLength > 192 * 1024 * 1024) throw new Error('This volume exceeds the 192 MiB booth memory budget. Export a lower-resolution copy with --downsample 2 2 2.');
  }

  clear() {
    this.texture?.dispose(); this.texture = undefined; this.manifest = undefined;
    this.material.uniforms.volume.value = null; this.renderer.clear();
  }

  setVolume(m: Manifest, bytes: Uint8Array) {
    this.checkSize(m); this.clear();
    const gl = this.renderer.getContext();
    if (gl.isContextLost()) throw new Error('Graphics are still recovering. Wait a moment and retry.');
    for (let i = 0; i < 16 && gl.getError() !== gl.NO_ERROR; i++) { /* drain previous errors */ }
    const texture = new THREE.Data3DTexture(bytes, ...m.dimensions);
    texture.format = THREE.RGFormat; texture.type = THREE.UnsignedByteType; texture.internalFormat = 'RG8';
    texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.unpackAlignment = 1;
    texture.generateMipmaps = false; texture.colorSpace = THREE.NoColorSpace; texture.needsUpdate = true;
    try {
      this.renderer.initTexture(texture);
      const error = gl.getError();
      if (error !== gl.NO_ERROR || gl.isContextLost()) throw new Error(`GPU allocation failed (${error}). Choose the light dataset, close other tabs, or export a smaller volume.`);
    } catch (error) { texture.dispose(); throw error; }
    this.texture = texture; this.manifest = m;
    const physical = m.dimensions.map((n, i) => n * m.spacing[i]);
    const scale = Math.max(...physical); this.extent.set(physical[0] / scale, physical[1] / scale, physical[2] / scale);
    const u = this.material.uniforms;
    u.volume.value = texture; u.dimensions.value.set(...m.dimensions);
    u.voxelStep.value = Math.min(...m.spacing) / scale;
    u.cropLow.value.set(0, 0, 0); u.cropHigh.value.set(1, 1, 1);
    this.preset('front'); this.invalidate();
  }

  preset(view: 'front' | 'top' | 'side') {
    this.camera.zoom = 1; this.interacting = false; this.pausedUntil = performance.now() + 2500;
    // Surface up: increasing z runs down the screen, a clockwise rotation of the NumPy MIP.
    if (view === 'front') { this.camera.position.set(0, -3, 0); this.camera.up.set(0, 0, -1); }
    if (view === 'side') { this.camera.position.set(3, 0, 0); this.camera.up.set(0, 0, -1); }
    if (view === 'top') {
      const depth = axisIndex(this.manifest?.axes.depthAxis || 'z');
      this.camera.position.set(0, 0, 0).setComponent(depth, 3);
      this.camera.up.set(0, 0, 0).setComponent(depth === 2 ? 1 : 2, 1);
    }
    this.camera.lookAt(0, 0, 0); this.createControls(); this.resize();
  }

  setChannel(channel: number, visible: boolean, low: number, high: number, gamma: number) {
    const u = this.material.uniforms;
    u.visibleChannels.value.setComponent(channel, visible ? 1 : 0);
    u[channel === 0 ? 'redRange' : 'greenRange'].value.set(low, high);
    u.gammaValue.value.setComponent(channel, gamma); this.interaction();
  }

  setCrop(start: number, end: number) {
    if (!this.manifest) return;
    const axis = axisIndex(this.manifest.axes.depthAxis), n = this.manifest.dimensions[axis];
    this.material.uniforms.cropLow.value.setComponent(axis, start / n);
    this.material.uniforms.cropHigh.value.setComponent(axis, (end + 1) / n); this.interaction();
  }

  setAuto(enabled: boolean) { this.auto = enabled; this.invalidate(); }
  private interaction() { this.pausedUntil = performance.now() + 2500; this.setLowQuality(true); this.settle(); }
  private settle() {
    window.clearTimeout(this.settleTimer); this.pausedUntil = performance.now() + 2500;
    this.settleTimer = window.setTimeout(() => this.setLowQuality(false), 180);
  }
  private setLowQuality(value: boolean) { this.lowQuality = value; this.resize(); }
  private resize() {
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    const aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
    const half = .58 * this.extent.length();
    this.camera.top = half; this.camera.bottom = -half; this.camera.left = -half * aspect; this.camera.right = half * aspect;
    if (aspect < 1) { this.camera.left = -half; this.camera.right = half; this.camera.top /= aspect; this.camera.bottom /= aspect; }
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * (this.lowQuality ? .6 : 1));
    this.renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false); this.invalidate();
  }
  invalidate() { if (!this.raf && !this.lost && !document.hidden) this.raf = requestAnimationFrame(() => this.render()); }
  private render() {
    this.raf = -1; // Suppress change-triggered frames during this render; auto-rotation is throttled below.
    const spinning = this.auto && !this.interacting && performance.now() >= this.pausedUntil;
    if (spinning) { this.controls.autoRotate = true; this.controls.update(1 / 30); this.controls.autoRotate = false; }
    this.draw(this.camera, this.lowQuality || spinning ? 2.5 : 1);
    this.raf = 0;
    if (this.auto) {
      window.clearTimeout(this.autoTimer);
      this.autoTimer = window.setTimeout(() => this.invalidate(), spinning ? 33 : Math.max(33, this.pausedUntil - performance.now()));
    }
  }
  private draw(camera: THREE.OrthographicCamera, quality: number) {
    if (!this.texture || this.lost) return;
    camera.updateMatrixWorld(); const u = this.material.uniforms;
    u.eye.value.copy(camera.position);
    u.rightAxis.value.setFromMatrixColumn(camera.matrixWorld, 0);
    u.upAxis.value.setFromMatrixColumn(camera.matrixWorld, 1);
    camera.getWorldDirection(u.direction.value);
    u.halfView.value.set((camera.right - camera.left) / (2 * camera.zoom), (camera.top - camera.bottom) / (2 * camera.zoom));
    u.quality.value = quality; this.renderer.render(this.scene, this.passCamera);
    this.orientationCallback([0, 1, 2].map(i => ({ label: `+${this.manifest!.axes.labels[i]}`,
      x: u.rightAxis.value.getComponent(i), y: -u.upAxis.value.getComponent(i) })));
  }

  /** Test hook: voxel-centered pixels in original imshow or upright Front orientation. */
  referencePixels(upright = false): number[] {
    if (!this.manifest) throw new Error('No volume');
    const [nx, , nz] = this.manifest.dimensions;
    const width = upright ? nx : nz, height = upright ? nz : nx;
    const physicalWidth = upright ? this.extent.x : this.extent.z;
    const physicalHeight = upright ? this.extent.z : this.extent.x;
    const camera = new THREE.OrthographicCamera(-physicalWidth / 2, physicalWidth / 2, physicalHeight / 2, -physicalHeight / 2, .01, 100);
    camera.position.set(0, -3, 0); camera.up.set(upright ? 0 : -1, 0, upright ? -1 : 0); camera.lookAt(0, 0, 0);
    const target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false, type: THREE.UnsignedByteType });
    const pixels = new Uint8Array(nx * nz * 4);
    try {
      this.renderer.setRenderTarget(target); this.draw(camera, 1);
      this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    } finally { this.renderer.setRenderTarget(null); target.dispose(); this.invalidate(); }
    const topDown: number[] = [];
    for (let row = height - 1; row >= 0; row--) for (let col = 0; col < width; col++) {
      const i = (row * width + col) * 4; topDown.push(pixels[i], pixels[i + 1], pixels[i + 2]);
    }
    return topDown;
  }

  dispose() {
    cancelAnimationFrame(this.raf); window.clearTimeout(this.autoTimer); window.clearTimeout(this.settleTimer);
    this.resizeObserver.disconnect(); document.removeEventListener('visibilitychange', this.visibility);
    this.controls.dispose(); this.clear(); this.material.dispose(); this.geometry.dispose(); this.renderer.dispose();
  }
}
