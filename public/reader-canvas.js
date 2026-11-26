// The opened Tinka's canvas: the content window is a sheet on a plane that pans and
// zooms like a board. ⌘/Ctrl-scroll and pinch zoom the sheet about the pointer; the
// page and Tinka's own chrome never zoom. Fit returns to the fitted view (the whole
// window in sight, never past 100%) and Back returns to the view before that fit.
// Canvas zoom magnifies; it never reflows the content (Window and Type size do).
//
// The fitted view is the floor: zooming out stops there. A fresh zoom-out from the floor (one more − press, wheel notch
// or pinch) goes back to the board the Tinka lives on (onLeave; canvas.js lands on its card), as pinching in on a fitted
// photo returns to the grid in Photos. Expanded, the window fills the stage, past 100% if need be, and
// the floor is a wall: zooming out stops there and never leaves (ui-sdk.md § Opened item).
import {clampZoom, MAX_ZOOM, sameView, wheelZoomFactor, wheelSource, zoomOutGate, LEAVE_RATIO, GESTURE_GAP} from './canvas-zoom.js';

// A fitted Tinka shows its window at its true size or smaller.
export const READER_FIT_MAX_ZOOM = 1;
// Leaving is the same gate as a board's (canvas-zoom.js zoomOutGate): the leave band shows it building (onLeaveProgress).
export {LEAVE_RATIO, GESTURE_GAP};
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Whether wheel movement (dx, dy) over `target` would scroll something in Tinka's content:
// an overflowing scroll box or a scrolling page, in `target`'s frame or any frame around it up
// to `top`. Being at the end of a scroll does not count, so a document never pans the canvas.
const SCROLLS = /^(auto|scroll|overlay)$/;
function viewportScrolls(doc, dx, dy) {
  const win = doc.defaultView, root = doc.documentElement, body = doc.body;
  if (!win || !root) return false;
  const rs = win.getComputedStyle(root), bs = body ? win.getComputedStyle(body) : null;
  // The page's own overflow comes from the root, or from the body when the root leaves it visible.
  const ox = rs.overflowX !== 'visible' ? rs.overflowX : bs?.overflowX || 'visible';
  const oy = rs.overflowY !== 'visible' ? rs.overflowY : bs?.overflowY || 'visible';
  const el = doc.scrollingElement || root, open = value => value !== 'hidden' && value !== 'clip';
  return !!((dy && open(oy) && el.scrollHeight > win.innerHeight + 1) || (dx && open(ox) && el.scrollWidth > win.innerWidth + 1));
}
export function contentScrolls(target, dx, dy, top = window) {
  let node = target?.nodeType === 1 ? target : target?.parentElement;
  try {
    while (node) {
      const doc = node.ownerDocument, win = doc.defaultView;
      if (!win || win === top) return false;
      const rs = win.getComputedStyle(doc.documentElement), rootVisible = rs.overflowX === 'visible' && rs.overflowY === 'visible';
      for (let el = node; el && el !== doc.documentElement; el = el.parentElement) {
        if (el === doc.body && rootVisible) continue; // the body's overflow is the page's (below)
        const style = win.getComputedStyle(el);
        if ((dy && SCROLLS.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) || (dx && SCROLLS.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1)) return true;
      }
      if (viewportScrolls(doc, dx, dy)) return true;
      node = win.frameElement;
    }
  } catch { return true; } // a frame we cannot read keeps its own wheel
  return false;
}

// The stage's pattern offset changes on every pan frame and only the stage's own background reads it: registered as
// non-inherited, a pan restyles the stage alone instead of everything in the opened item (see canvas.js).
for (const name of ['--reader-pattern-x', '--reader-pattern-y']) {
  try { CSS.registerProperty({ name, syntax: '*', inherits: false }); } catch {}
}

// Saved viewports use 40–10000; decoded images may be larger. Bound layout work
// without changing their aspect ratio, and reject nonfinite/untrusted dimensions.
export function resourceSize(width, height) {
  if (![width, height].every(n => Number.isFinite(n) && n > 0)) return null;
  const scale = Math.min(1, 16384 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export class ReaderCanvas {
  constructor(stage, plane, sheet, { onChange = () => {}, onBack = () => {}, onLeave = () => {}, onLeaveProgress = () => {}, reserveBottom = () => 0 } = {}) {
    Object.assign(this, { stage, plane, sheet, onChange, onBack, onLeave, reserveBottom });
    this.view = { zoom: 1, x: 0, y: 0 };
    this.fitted = true;
    this.expanded = false;
    this.locked = false;
    this.gate = zoomOutGate({ onProgress: onLeaveProgress });
    this.floorKey = '';
    this.floorZoom_ = 1;
    this.backView = null;
    this.glide = 0;
    this.pointers = new Map();
    this.pan = null;
    this.pinch = null;
    this.shield = document.createElement('div');
    this.shield.className = 'reader-pan-shield';
    this.shield.hidden = true;
    this.shield.setAttribute('aria-hidden', 'true');
    stage.append(this.shield);
    this.bind();
  }
  // Native controls float over the resource; the surface owns the complete stage. fribblr: the resource is the
  // reader's slab, its side drawn below its box (depth.css), so the stage keeps a strip under it for the side, but
  // only when the strip costs no scale: content that fits at a zoom in the whole stage fits at that zoom here, and a
  // document fitted to the stage owns all of it, as upstream. Otherwise the side runs off the stage's bottom edge.
  insets() {
    const none = { top: 0, right: 0, left: 0, bottom: 0 };
    // Expanded, the window fills the stage above the zoom pill (reserveBottom: the pill and its gap), so the pill never
    // covers a corner of it; the slab's side, a few pixels, runs under the pill.
    if (this.expanded) return { ...none, bottom: Math.max(0, Math.ceil(this.reserveBottom())) };
    const fit = (this.sheet.dataset?.size || 'fit') === 'fit';
    if (fit && !this.resourceSize) return none;
    const css = getComputedStyle(this.sheet);
    const strip = Math.ceil((parseFloat(css.getPropertyValue('--depth-slab')) || 0) + (parseFloat(css.getPropertyValue('--depth-edge-low')) || 0) + 1);   // and its hairline contour
    const { width, height } = this.area();
    const w = Math.max(1, fit ? this.resourceSize.width : this.sheet.offsetWidth), h = Math.max(1, fit ? this.resourceSize.height : this.sheet.offsetHeight);
    const zoom = room => Math.min(this.fitMax(), width / w, room / h);
    return zoom(height - strip) < zoom(height) ? none : { ...none, bottom: strip };
  }
  setResourceSize(width, height) {
    const size = resourceSize(width, height);
    if (this.resourceSize?.width === size?.width && this.resourceSize?.height === size?.height) return;
    this.resourceSize = size;
    this.dropBack();
    // A late image load must not reset a view the person has already zoomed or panned.
    this.resize();
  }
  area() { return { width: this.stage.clientWidth, height: this.stage.clientHeight }; }
  // Fitted, a window is shown at 100% or smaller; expanded, it fills the stage.
  fitMax() { return this.expanded ? MAX_ZOOM : READER_FIT_MAX_ZOOM; }
  // Fit uses authored resource dimensions, or the responsive stage for documents.
  fitSize() {
    if (this.resourceSize) return this.resourceSize;
    const { width, height } = this.area(), i = this.insets();
    return { width: Math.max(240, Math.floor(width - i.left - i.right)), height: Math.max(200, Math.floor(height - i.top - i.bottom)) };
  }
  syncFitSize() {
    const { width, height } = this.fitSize();
    this.stage.style.setProperty('--reader-fit-w', `${width}px`);
    this.stage.style.setProperty('--reader-fit-h', `${height}px`);
  }
  fittedView() {
    const { width, height } = this.area(), i = this.insets();
    const w = Math.max(1, this.sheet.offsetWidth), h = Math.max(1, this.sheet.offsetHeight);
    const room = { width: width - i.left - i.right, height: height - i.top - i.bottom };
    const zoom = clampZoom(Math.min(this.fitMax(), room.width / w, room.height / h));
    return { zoom, x: Math.round(i.left + (room.width - w * zoom) / 2), y: Math.round(i.top + (room.height - h * zoom) / 2) };
  }
  clamp({ zoom, x, y }) {
    // Centred and bounded above the strip the slab's side stands in.
    const { width } = this.area(), height = this.area().height - (this.insets?.().bottom ?? 0);
    const w = this.sheet.offsetWidth * zoom, h = this.sheet.offsetHeight * zoom;
    return { zoom, x: w <= width ? (width - w) / 2 : Math.min(0, Math.max(width - w, x)), y: h <= height ? (height - h) / 2 : Math.min(0, Math.max(height - h, y)) };
  }
  apply() {
    // Measured before anything is written, so onChange can read it without forcing style and layout mid-frame.
    this.floor = this.floorZoom();
    this.view = this.clamp(this.view);
    const { zoom, x, y } = this.view;
    this.plane.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) scale(${zoom})`;
    // The zoom, for depth.css: the sheet's side keeps its strength on screen when zoomed out, as on a board.
    this.stage.style.setProperty('--canvas-zoom', String(zoom));
    // The board's background values: a 22-unit step (110 major) that fades out towards 25%.
    let step = 22 * zoom;
    while (step < 9) step *= 2;
    this.stage.style.setProperty('--reader-pattern-step', `${step}px`);
    this.stage.style.setProperty('--reader-pattern-fade', String(Math.max(0, Math.min(1, (zoom - .25) / .75)) ** 1.5));
    this.stage.style.setProperty('--reader-pattern-x', `${Math.round(x)}px`);
    this.stage.style.setProperty('--reader-pattern-y', `${Math.round(y)}px`);
    this.stage.dataset.fitted = String(this.fitted);
    // fribblr: a document fitted to the stage fills it edge to edge, its side off the bottom (depth.css reads this)
    this.sheet.dataset.flush = String((this.sheet.dataset?.size || 'fit') === 'fit' && !this.resourceSize);
    this.onChange(this.view);
  }
  // The floor's zoom (the fitted view's), measured again only when the stage, the window or the mode changes: the reads
  // are ones clamp() already makes on every zoom event, so the zoom path gains no style or layout work.
  floorZoom() {
    const key = `${this.stage.clientWidth} ${this.stage.clientHeight} ${this.sheet.offsetWidth} ${this.sheet.offsetHeight} ${this.expanded} ${this.sheet.dataset?.size} ${this.resourceSize?.width} ${this.resourceSize?.height}`;
    if (key !== this.floorKey) { this.floorKey = key; this.floorZoom_ = this.fittedView().zoom; }
    return this.floorZoom_;
  }
  atFloor() { return this.view.zoom <= this.floorZoom() * (1 + 1e-3); }
  // The same, from the floor measured at the last apply(): no reads, for code that runs after the view was written.
  atLastFloor() { return this.view.zoom <= (this.floor ?? this.floorZoom()) * (1 + 1e-3); }
  setExpanded(on) {
    if (this.expanded === !!on) return;
    this.expanded = !!on;
    this.stage.dataset.expanded = String(this.expanded);
    this.gate.reset();
    this.dropBack();
    this.rest();
  }
  stopGlide() { cancelAnimationFrame(this.glide); this.glide = 0; }
  // Any view change of your own ends Back.
  dropBack() { if (this.backView) { this.backView = null; this.onBack(false); } }
  // The fitted view, without remembering where you were (opening, resizing, a new window size).
  rest() { this.stopGlide(); this.fitted = true; this.syncFitSize(); this.view = this.fittedView(); this.apply(); }
  isFitted() { return sameView(this.view, this.fittedView()); }
  fit() {
    this.stopGlide();
    const before = { ...this.view };
    this.syncFitSize();
    const target = this.fittedView();
    if (sameView(before, target)) { this.fitted = true; this.apply(); return false; }
    this.backView = before;
    this.fitted = true;
    this.view = target;
    this.apply();
    this.onBack(true);
    return true;
  }
  back() {
    if (!this.backView) return false;
    const to = this.backView;
    this.backView = null;
    this.onBack(false);
    this.fitted = false;
    this.glideTo(to);
    return true;
  }
  glideTo(to) {
    this.stopGlide();
    if (reduced()) { this.view = { ...to }; this.apply(); return; }
    const from = { ...this.view }, start = performance.now();
    const frame = now => {
      const t = Math.min(1, (now - start) / 320), e = 1 - (1 - t) ** 3;
      this.view = { zoom: from.zoom + (to.zoom - from.zoom) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      this.apply();
      this.glide = t < 1 ? requestAnimationFrame(frame) : 0;
    };
    this.glide = requestAnimationFrame(frame);
  }
  // Zoom to `zoom` keeping the stage point (sx, sy) still; never below the floor (a zoom there is the fitted view).
  zoomTo(zoom, sx = this.stage.clientWidth / 2, sy = this.stage.clientHeight / 2) {
    this.stopGlide(); this.dropBack();
    const { zoom: z0, x, y } = this.view, z = clampZoom(zoom);
    if (z <= this.floorZoom() * (1 + 1e-3)) { this.fitted = true; this.view = this.fittedView(); this.apply(); return; }
    this.fitted = false;
    this.view = { zoom: z, x: sx - (sx - x) * z / z0, y: sy - (sy - y) * z / z0 };
    this.apply();
  }
  // Zoom by `factor` about the stage point (sx, sy). `source` is 'step' (a key, a button), 'notch' (a mouse-wheel
  // click) or 'wheel' / 'pinch' (a gesture); `repeat` marks a held key. Returns 'zoomed', 'held' (at the floor: nothing
  // zoomed, the leave band may have moved) or 'leave' (onLeave has been called).
  zoomBy(factor, sx, sy, { source = 'step', repeat = false } = {}) {
    if (!(factor < 1)) {
      const rest = this.gate.back(factor, { source });
      if (!(rest > 1)) return 'held';
      this.zoomTo(this.view.zoom * rest, sx, sy);
      return 'zoomed';
    }
    // Expanded, or pointing inside it (pointing-mode.js sets `locked`), zooming out stops at the floor and never leaves.
    const verdict = this.gate.out(factor, { above: !this.atFloor(), source, repeat, locked: this.expanded || this.locked });
    if (verdict === 'zoom') {
      this.zoomTo(this.view.zoom * factor, sx, sy);
      if (this.atLastFloor()) this.gate.reachedFloor();
      return 'zoomed';
    }
    if (verdict === 'held') return 'held';
    this.pointers.clear(); this.pinch = null; this.pan = null;
    this.stage.classList.remove('panning');
    this.onLeave(source);
    return 'leave';
  }
  // A zoom step about a point given in this document's client coordinates.
  zoomAtClient(factor, clientX, clientY, options) {
    const r = this.stage.getBoundingClientRect();
    const sx = Math.max(0, Math.min(r.width, clientX - r.left)), sy = Math.max(0, Math.min(r.height, clientY - r.top));
    return this.zoomBy(factor, sx, sy, options);
  }
  // Part of the window is out of view (zoomed in past what fits): there is something to pan to. The arrow keys pan then,
  // and step to another Tinka only while it all fits (canvas.js, ui-sdk.md § Opened item).
  overflows() {
    const { width } = this.area(), height = this.area().height - (this.insets?.().bottom ?? 0), zoom = this.view.zoom;
    return this.sheet.offsetWidth * zoom > width + 1 || this.sheet.offsetHeight * zoom > height + 1;
  }
  panBy(dx, dy) {
    if (!dx && !dy) return;
    this.stopGlide(); this.dropBack();
    this.fitted = false;
    this.view = { ...this.view, x: this.view.x + dx, y: this.view.y + dy };
    this.apply();
  }
  resize() { this.syncFitSize(); if (this.fitted) this.rest(); else this.apply(); }
  // Holding Space over the stage lets a drag anywhere pan, even when the sheet fills it.
  setSpacePan(on) { this.shield.hidden = !on; this.stage.classList.toggle('space-pan', !!on); }
  background(target) { return target === this.stage || target === this.plane || target === this.shield; }
  // A wheel event's movement in pixels; Shift-scroll moves sideways.
  wheelDelta(event) {
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.stage.clientHeight : 1;
    let dx = event.deltaX * unit, dy = event.deltaY * unit;
    if (event.shiftKey && !dx) [dx, dy] = [dy, 0];
    return { dx, dy };
  }
  bind() {
    const stage = this.stage;
    stage.addEventListener('wheel', event => {
      if (event.ctrlKey || event.metaKey) { event.preventDefault(); this.zoomAtClient(wheelZoomFactor(event), event.clientX, event.clientY, { source: wheelSource(event) }); return; }
      // The window's own edge and padding pan too; wheel over content is handled where it lands.
      if (!this.background(event.target) && event.target !== this.sheet) return;
      event.preventDefault();
      const { dx, dy } = this.wheelDelta(event);
      this.panBy(-dx, -dy);
    }, { passive: false });
    stage.addEventListener('pointerdown', event => {
      if (!this.background(event.target) || (event.pointerType === 'mouse' && event.button !== 0)) return;
      this.stopGlide();
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size === 1) this.pan = { id: event.pointerId, x: event.clientX, y: event.clientY, active: false };
      else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
        this.pan = null;
      }
    });
    stage.addEventListener('pointermove', event => {
      const point = this.pointers.get(event.pointerId);
      if (!point) return;
      const last = { ...point };
      point.x = event.clientX; point.y = event.clientY;
      if (this.pinch && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        // Each move zooms by its own change in spread, so a pinch held at the floor counts only what the fingers did.
        const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1, ratio = distance / this.pinch.distance;
        this.pinch.distance = distance;
        this.zoomAtClient(ratio, (a.x + b.x) / 2, (a.y + b.y) / 2, { source: 'pinch' });
        return;
      }
      if (!this.pan || this.pan.id !== event.pointerId) return;
      if (!this.pan.active && Math.hypot(event.clientX - this.pan.x, event.clientY - this.pan.y) > 4) {
        this.pan.active = true; stage.classList.add('panning');
        try { stage.setPointerCapture(event.pointerId); } catch {}
      }
      if (this.pan.active) this.panBy(event.clientX - last.x, event.clientY - last.y);
    });
    const end = event => {
      if (!this.pointers.delete(event.pointerId)) return;
      if (this.pointers.size < 2) { if (this.pinch) this.gate.end(); this.pinch = null; }  // fingers up: the band goes
      if (!this.pointers.size) { this.pan = null; stage.classList.remove('panning'); }
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    let gestureScale = 1;
    stage.addEventListener('gesturestart', event => { event.preventDefault(); gestureScale = 1; });
    stage.addEventListener('gesturechange', event => {
      event.preventDefault();
      const scale = event.scale > 0 ? event.scale : 1;
      this.zoomAtClient(scale / gestureScale, event.clientX, event.clientY, { source: 'pinch' });
      gestureScale = scale;
    });
    stage.addEventListener('gestureend', () => this.gate.end());
  }
}
