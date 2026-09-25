/** One track, two independently focusable 44px handles; pointer and keyboard input. */
export class DepthRange {
  start = 0;
  end = 1;
  max = 1;
  private handles: HTMLButtonElement[];
  private drag?: { pointer: number; handle: number };

  constructor(private element: HTMLElement, private onChange: () => void) {
    element.classList.add('depth-range');
    element.setAttribute('role', 'group'); element.setAttribute('aria-label', 'Depth window');
    element.innerHTML = `<div class="depth-track"><div class="depth-selection"></div></div>
      <button type="button" role="slider" aria-label="Depth start" class="depth-handle" id="crop-start"></button>
      <button type="button" role="slider" aria-label="Depth end" class="depth-handle" id="crop-end"></button>`;
    this.handles = [...element.querySelectorAll<HTMLButtonElement>('.depth-handle')];
    element.addEventListener('pointerdown', event => {
      if (this.drag || event.button !== 0) return;
      const target = event.target as HTMLElement;
      const handle = this.handles.indexOf(target.closest('button') as HTMLButtonElement);
      const value = this.fromPointer(event.clientX);
      const nearest = Math.abs(value - this.start) < Math.abs(value - this.end) ? 0 : 1;
      this.drag = { pointer: event.pointerId, handle: handle >= 0 ? handle : nearest };
      element.setPointerCapture(event.pointerId);
      this.handles[this.drag.handle].focus({ preventScroll: true });
      if (handle < 0) this.move(this.drag.handle, value);
      event.preventDefault();
    });
    element.addEventListener('pointermove', event => {
      if (this.drag?.pointer === event.pointerId) this.move(this.drag.handle, this.fromPointer(event.clientX));
    });
    const stop = (event: PointerEvent) => { if (this.drag?.pointer === event.pointerId) this.drag = undefined; };
    element.addEventListener('pointerup', stop); element.addEventListener('pointercancel', stop); element.addEventListener('lostpointercapture', stop);
    this.handles.forEach((handle, i) => handle.addEventListener('keydown', event => {
      let value = i === 0 ? this.start : this.end;
      const page = Math.max(1, Math.round(this.max / 10));
      switch (event.key) {
        case 'ArrowLeft': case 'ArrowDown': value--; break;
        case 'ArrowRight': case 'ArrowUp': value++; break;
        case 'PageDown': value -= page; break;
        case 'PageUp': value += page; break;
        case 'Home': value = 0; break;
        case 'End': value = this.max; break;
        default: return;
      }
      event.preventDefault(); this.move(i, value);
    }));
    this.set(1);
  }

  set(max: number, start = 0, end = max) {
    this.max = Math.max(0, Math.round(max));
    this.start = Math.max(0, Math.min(this.max, Math.round(start)));
    this.end = Math.max(this.start, Math.min(this.max, Math.round(end)));
    this.paint();
  }
  private fromPointer(clientX: number) {
    const rect = this.element.getBoundingClientRect();
    return Math.round((clientX - rect.left - 22) / Math.max(1, rect.width - 44) * this.max);
  }
  private move(handle: number, value: number) {
    if (handle === 0) this.start = Math.max(0, Math.min(this.end, value));
    else this.end = Math.min(this.max, Math.max(this.start, value));
    this.paint(); this.onChange();
  }
  private paint() {
    const low = this.start / (this.max || 1), high = this.end / (this.max || 1);
    this.element.style.setProperty('--range-start', String(low)); this.element.style.setProperty('--range-end', String(high));
    // Separate nearly coincident handles vertically so both can always be grabbed.
    this.element.classList.toggle('handles-close', high - low < .14);
    this.handles.forEach((handle, i) => {
      handle.setAttribute('aria-valuemin', String(i === 0 ? 0 : this.start));
      handle.setAttribute('aria-valuemax', String(i === 0 ? this.end : this.max));
      handle.setAttribute('aria-valuenow', String(i === 0 ? this.start : this.end));
      handle.setAttribute('aria-orientation', 'horizontal');
    });
  }
  describe(start: string, end: string) {
    this.handles[0].setAttribute('aria-valuetext', start); this.handles[1].setAttribute('aria-valuetext', end);
  }
}
