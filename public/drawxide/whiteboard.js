// Drawxide whiteboard: Iron Drawxide's editor (Rust, compiled to wasm) driven
// from this page. The engine owns tools, shapes, hit testing, shortcuts, undo
// and the render IR; this file forwards DOM input and paints the IR on a canvas.
// Frame format and input rules: team/drawxide/renderer-spec.md and the bridge's
// module docs (examples/wasm-bridge/src/lib.rs in the engine worktree).

import init, {Whiteboard} from './pkg/wasm_bridge.js';

const canvas = document.getElementById('board');
const statusEl = document.getElementById('status');
const params = new URLSearchParams(location.search);
const docId = (params.get('doc') || 'poc').toLowerCase();
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const lowLatency = params.get('lowlatency') !== '0';
const ctx = canvas.getContext('2d', {alpha: false, desynchronized: lowLatency});
const say = (text) => { statusEl.textContent = text; };

// ---------------------------------------------------------------- metrics
// Input-to-paint: for each pointer move, DOM event timeStamp → end of the
// draw of the frame that processed it ("paint"), and → start of the next rAF
// after that ("present", an upper bound for when it reached the screen).
const metrics = {
  moves: [],   // {ts, tool, paint, present, drew}
  frames: [],  // {bridge, parse, apply, draw, total, bytes, nodes, drew}
  reset() { this.moves.length = 0; this.frames.length = 0; },
};

// ---------------------------------------------------------------- render state
let wb;
const revs = new Map();   // rev -> compiled node (Path2D built once)
let shapes = [];          // [[rev, a,b,c,d,e,f, opacity, clip(Path2D)|null]]
let overlays = [];        // compiled overlay nodes, page space
let camera = [0, 0, 1];
let htmlOffset = 0.125;
let background = '#ffffff';
let dpr = 1, cssW = 0, cssH = 0;
let lastCursor = '';
let toolPath = 'select.idle';
let pendingMoves = [], awaitingPresent = [];
let editing = null;       // {m, caret, visible, sel} of the label being edited

window.__dx = {
  metrics,
  state: () => ({
    camera: [...camera], shapes: shapes.length, docShapes: wb ? JSON.parse(wb.shapes_json()).length : 0,
    path: toolPath, cursor: lastCursor, saved: lastSaved.length, revs: revs.size,
  }),
};

const rgba = (c) => c[3] >= 1
  ? `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`
  : `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${c[3]})`;

function resize() {
  dpr = window.devicePixelRatio || 1;
  cssW = window.innerWidth; cssH = window.innerHeight;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  if (wb) { wb.resize(cssW, cssH); needsDraw = true; wake(); }
}

// ---------------------------------------------------------------- compile IR
// Turns a node of the frame JSON into a paint-ready object, once per rev.
function compile(n) {
  if (n.c && n.g) return {k: 'g', m: n.g, o: n.o, clip: n.clip ? new Path2D(n.clip) : null, c: n.c.map(compile)};
  if (n.p !== undefined) {
    const s = n.s ? {color: rgba(n.s.c), w: n.s.w, cap: {b: 'butt', r: 'round', s: 'square'}[n.s.cap] || 'round',
      join: {m: 'miter', r: 'round', b: 'bevel'}[n.s.join] || 'round', ml: n.s.ml, dash: n.s.dash || [], off: n.s.do || 0} : null;
    return {k: 'p', path: new Path2D(n.p), fill: n.f ? compilePaint(n.f) : null, rule: n.rule === 'eo' ? 'evenodd' : 'nonzero',
      stroke: s, shadow: n.sh || null, multiply: n.blend === 'm'};
  }
  if (n.t) {
    const font = (f) => `${f[0] || 'normal'} ${f[1] || 'normal'} ${f[2]}px ${f[3]}`;
    const base = font(n.font);
    return {k: 't', x: n.t[0], y: n.t[1], color: rgba(n.c), link: n.link ? rgba(n.link) : null, middle: n.base === 'm',
      spans: n.spans.map(([text, x, y, f, fill, outline]) => ({text, x, y, font: f ? font(f) : base, fill: fill ? rgba(fill) : null, outline: outline ? new Path2D(outline) : null})),
      boxes: n.boxes || []};
  }
  if (n.bs) return {k: 'bs', rect: n.bs, sh: n.sh || []};
  if (n.img) return {k: 'i', ...n.img};
  return {k: 'none'};
}

function compilePaint(f) {
  if (f.solid) return {solid: rgba(f.solid)};
  if (f.hatch) return {hatch: {color: rgba(f.hatch[0]), bg: rgba(f.hatch[1]), scale: f.hatch[2] || 1}};
  const g = f.lin || f.rad;
  if (!g) return null;
  let last = 0;
  const stops = g.stops.map(([o, c]) => { last = Math.max(last, Math.min(1, Math.max(0, o))); return [last, rgba(c)]; });
  return f.lin ? {lin: {...g, stops}} : {rad: {...g, stops}};
}

// ---------------------------------------------------------------- paint
let paintScale = 1;      // device px per local unit (hatch tile resolution)
const hatchTiles = new Map();
function hatchPattern(h) {
  // tldraw defaultStyleDefs generateImage: 8x8 tile, three round-capped marks, width 1.25,
  // rasterized at the power-of-two zoom above the current one.
  const res = Math.pow(2, Math.ceil(Math.log2(Math.max(1, paintScale * h.scale))));
  const key = h.color + '|' + res;
  let tile = hatchTiles.get(key);
  if (!tile) {
    const t = 8 / 12, c = document.createElement('canvas');
    c.width = c.height = 8 * res;
    const g = c.getContext('2d');
    g.scale(res, res);
    g.strokeStyle = h.color; g.lineWidth = 1.25; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(t, 3 * t); g.lineTo(3 * t, t);
    g.moveTo(5 * t, 7 * t); g.lineTo(7 * t, 5 * t);
    g.moveTo(9 * t, 11 * t); g.lineTo(11 * t, 9 * t);
    g.stroke();
    tile = {canvas: c, res};
    hatchTiles.set(key, tile);
  }
  const p = ctx.createPattern(tile.canvas, 'repeat');
  const s = h.scale / tile.res;
  p.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0]));
  return p;
}

function fillWithPaint(path, paint, rule) {
  if (paint.solid) { ctx.fillStyle = paint.solid; ctx.fill(path, rule); return; }
  if (paint.hatch) {
    ctx.fillStyle = paint.hatch.bg; ctx.fill(path, rule);
    ctx.fillStyle = hatchPattern(paint.hatch); ctx.fill(path, rule);
    return;
  }
  const g = paint.lin || paint.rad;
  const grad = paint.lin ? ctx.createLinearGradient(g.x1, g.y1, g.x2, g.y2) : ctx.createRadialGradient(g.fx, g.fy, 0, g.cx, g.cy, Math.max(0, g.r));
  for (const [o, c] of g.stops) grad.addColorStop(o, c);
  // the gradient lives in its own space (m maps it into the path's): fill the path mapped back
  const m = g.m || [1, 0, 0, 1, 0, 0];
  const p = new Path2D();
  p.addPath(path, new DOMMatrix(m).inverse());
  ctx.save();
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.fillStyle = grad;
  ctx.fill(p, rule);
  ctx.restore();
}

function drawPath(n, alpha) {
  ctx.globalAlpha = alpha;
  if (n.multiply) ctx.globalCompositeOperation = 'multiply';
  if (n.shadow && n.fill && n.fill.solid) {
    // approximation: one canvas shadow per layer, erode ignored; shadow params are screen px
    const z = camera[2] * dpr;
    for (const [, blur, dx, dy, op] of n.shadow) {
      if (!(op > 0)) continue;
      ctx.save();
      ctx.shadowColor = `rgba(0,0,0,${op})`;
      ctx.shadowBlur = 2 * blur * z; ctx.shadowOffsetX = dx * z; ctx.shadowOffsetY = dy * z;
      ctx.fillStyle = n.fill.solid;
      ctx.fill(n.path, n.rule);
      ctx.restore();
    }
  }
  if (n.fill) fillWithPaint(n.path, n.fill, n.rule);
  const s = n.stroke;
  if (s) {
    ctx.strokeStyle = s.color; ctx.lineWidth = s.w; ctx.lineCap = s.cap; ctx.lineJoin = s.join; ctx.miterLimit = s.ml;
    if (s.dash.length) { ctx.setLineDash(s.dash); ctx.lineDashOffset = s.off; }
    ctx.stroke(n.path);
    if (s.dash.length) ctx.setLineDash([]);
  }
  if (n.multiply) ctx.globalCompositeOperation = 'source-over';
}

function drawText(n, alpha) {
  ctx.globalAlpha = alpha;
  // highlights under the glyphs; underlines, strikes and bullets over them
  for (const b of n.boxes) if (b[0] === 'hl') {
    ctx.fillStyle = '#fddd00'; ctx.beginPath(); ctx.roundRect(n.x + b[1], n.y + b[2], b[3], b[4], 2); ctx.fill();
  }
  ctx.textAlign = 'left'; ctx.direction = 'ltr';
  ctx.textBaseline = n.middle ? 'middle' : 'alphabetic';
  let font = '';
  for (const s of n.spans) {
    ctx.fillStyle = s.fill || n.color;
    if (s.outline) { ctx.save(); ctx.translate(n.x, n.y); ctx.fill(s.outline); ctx.restore(); continue; }
    if (s.font !== font) { ctx.font = s.font; font = s.font; }
    ctx.fillText(s.text, n.x + s.x, n.y + s.y);
  }
  for (const b of n.boxes) {
    const [kind, x, y, w, h, link] = b;
    if (kind === 'hl') continue;
    ctx.fillStyle = link && n.link ? n.link : n.color;
    ctx.strokeStyle = ctx.fillStyle;
    if (kind === 'disc') { ctx.beginPath(); ctx.ellipse(n.x + x + w / 2, n.y + y + h / 2, w / 2, h / 2, 0, 0, 7); ctx.fill(); }
    else if (kind === 'circle') { ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(n.x + x + w / 2, n.y + y + h / 2, w / 2 - 0.5, h / 2 - 0.5, 0, 0, 7); ctx.stroke(); }
    else ctx.fillRect(n.x + x, n.y + y, w, h);
  }
}

function drawBoxShadow(n, alpha) {
  const [x, y, w, h, radius] = n.rect;
  const z = camera[2] * dpr, off = 100000;
  for (const [dx, dy, blur, spread, color, inset] of n.sh) {
    if (inset) continue;
    // the casting box sits far to the left, so only its shadow lands
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = rgba(color);
    ctx.shadowBlur = blur * z;
    ctx.shadowOffsetX = (dx + off) * z;
    ctx.shadowOffsetY = dy * z;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.roundRect(x - spread - off, y - spread, Math.max(0, w + 2 * spread), Math.max(0, h + 2 * spread), Math.max(0, radius + spread));
    ctx.fill();
    ctx.restore();
  }
}

const images = new Map();
function drawImage(n, alpha) {
  let img = images.get(n.src);
  if (!img) { img = new Image(); img.onload = () => { needsDraw = true; wake(); }; img.src = n.src; images.set(n.src, img); }
  if (!img.complete || !img.naturalWidth) return;
  const [x, y, w, h] = n.rect;
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, x, y, w, h);
}

function drawNode(n, alpha) {
  switch (n.k) {
    case 'g': {
      const a = alpha * n.o;
      if (a <= 0 || !n.c.length) return;
      ctx.save();
      ctx.transform(n.m[0], n.m[1], n.m[2], n.m[3], n.m[4], n.m[5]);
      if (n.clip) ctx.clip(n.clip);
      for (const c of n.c) drawNode(c, a);
      ctx.restore();
      return;
    }
    case 'p': drawPath(n, alpha); return;
    case 't': drawText(n, alpha); return;
    case 'bs': drawBoxShadow(n, alpha); return;
    case 'i': drawImage(n, alpha); return;
  }
}

function draw() {
  const [cx, cy, z] = camera;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // shapes: device px ← shapes layer (camera + tldraw's html-layer offset) ← page transform
  const sa = dpr * z, se = dpr * (cx * z + htmlOffset), sf = dpr * (cy * z + htmlOffset);
  paintScale = sa;
  for (const s of shapes) {
    const node = revs.get(s[0]);
    if (!node || s[7] <= 0) continue;
    if (s[8]) { // page-space clip (frame children)
      ctx.save();
      ctx.setTransform(sa, 0, 0, sa, dpr * cx * z, dpr * cy * z);
      ctx.clip(s[8]);
    }
    ctx.setTransform(sa * s[1], sa * s[2], sa * s[3], sa * s[4], sa * s[5] + se, sa * s[6] + sf);
    drawNode(node, s[7]);
    if (s[8]) ctx.restore();
  }
  // overlays (selection, handles, brush, scribbles, snaps): page space
  ctx.setTransform(sa, 0, 0, sa, dpr * cx * z, dpr * cy * z);
  for (const n of overlays) drawNode(n, 1);
  ctx.globalAlpha = 1;
  if (editing) {
    const m = editing.m;
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.fillStyle = 'rgba(66, 133, 244, 0.3)';   // tldraw's text selection tint
    for (const [x, y, w, h] of editing.sel) ctx.fillRect(x, y, w, h);
    if (editing.caret && editing.visible) {
      const [x, y, w, h] = editing.caret;
      ctx.fillStyle = '#1d1d1d';
      ctx.fillRect(x, y, Math.max(w, 1.5 / (z * Math.hypot(m[0], m[1]))), h);
    }
  }
}

const cssCursor = {
  default: 'default', pointer: 'pointer', grab: 'grab', grabbing: 'grabbing', text: 'text',
  cross: 'crosshair', move: 'move', 'zoom-in': 'zoom-in', 'zoom-out': 'zoom-out', none: 'none',
  'ew-resize': 'ew-resize', 'ns-resize': 'ns-resize', 'nesw-resize': 'nesw-resize', 'nwse-resize': 'nwse-resize',
  'resize-edge': 'ew-resize', 'resize-corner': 'nesw-resize',
  rotate: 'grab', 'nwse-rotate': 'grab', 'nesw-rotate': 'grab', 'senw-rotate': 'grab', 'swne-rotate': 'grab',
};
const resizeCycle = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
function cursorFor(c) {
  if (!c) return 'default';
  let css = cssCursor[c.type] || 'default';
  const i = resizeCycle.indexOf(css);
  if (i >= 0 && c.rotation) css = resizeCycle[(((i + Math.round(c.rotation / (Math.PI / 4))) % 4) + 4) % 4];
  return css;
}

// ---------------------------------------------------------------- frame loop
let raf = 0;
let needsDraw = true;
let lastChangeCount = -1;

function wake() { if (!raf) raf = requestAnimationFrame(frame); }

function applyFrame(f) {
  let n = 0;
  for (const k in f.nodes) { revs.set(+k, compile(f.nodes[k])); n++; }
  shapes = f.shapes;
  // keep only revs the paint list still uses
  const used = new Set();
  for (const s of shapes) { used.add(s[0]); if (s[8]) s[8] = new Path2D(s[8]); }
  for (const k of revs.keys()) if (!used.has(k)) revs.delete(k);
  if (f.overlays) overlays = f.overlays.map(compile);
  camera = f.cam;
  htmlOffset = f.htmlOffset;
  if (f.bg) background = rgba(f.bg);
  if ('editing' in f) editing = f.editing;
  const cur = cursorFor(f.cursor);
  if (cur !== lastCursor) { canvas.style.cursor = cur; lastCursor = cur; }
  return n;
}

function frame() {
  raf = 0;
  if (!wb) return;
  const t0 = performance.now();
  if (awaitingPresent.length) { for (const m of awaitingPresent) m.present = t0 - m.ts; awaitingPresent = []; }
  const json = wb.frame(t0);
  const t1 = performance.now();
  let t2 = t1, t3 = t1, t4 = t1, nodes = 0;
  const changed = json !== '';
  if (changed) {
    const f = JSON.parse(json);
    t2 = performance.now();
    nodes = applyFrame(f);
    t3 = performance.now();
  }
  const drew = changed || needsDraw;
  if (drew) {
    needsDraw = false;
    try { draw(); } catch (err) { console.error('draw failed', err); }
    t4 = performance.now();
  }
  metrics.frames.push({bridge: t1 - t0, parse: t2 - t1, apply: t3 - t2, draw: t4 - t3, total: t4 - t0, bytes: json.length, nodes, drew});
  if (pendingMoves.length) {
    const end = performance.now();
    for (const m of pendingMoves) { m.paint = end - m.ts; m.drew = changed; }
    metrics.moves.push(...pendingMoves);
    awaitingPresent = pendingMoves;
    pendingMoves = [];
  }
  if (changed) {
    const was = toolPath;
    toolPath = wb.tool_path();
    if (toolPath !== was && /editing_shape/.test(toolPath)) restartBlink();
    syncToolbar();
    const cc = wb.change_count();
    if (cc !== lastChangeCount) { lastChangeCount = cc; scheduleSave(); }
  }
  if (wb.wants_frames(performance.now()) || awaitingPresent.length) wake();
}

// ---------------------------------------------------------------- input
const mods = (e) => (e.shiftKey ? 1 : 0) | (e.altKey ? 2 : 0) | (e.ctrlKey ? 4 : 0) | (e.metaKey ? 8 : 0);
function localPoint(e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
// macOS: ctrl-click (without cmd) is a secondary click (tldraw getPointerEventButton)
const domButton = (e) => (isMac && e.button === 0 && e.ctrlKey && !e.metaKey) ? 2 : e.button;
function heldButton(e) {
  if (e.buttons & 1) return 0;
  if (e.buttons & 4) return 1;
  if (e.buttons & 2) return 2;
  if (e.buttons & 32) return 5;
  return 0;
}
const pointerIdOf = (e) => e.pointerType === 'mouse' ? 1 : e.pointerType === 'pen' ? 2 : e.pointerId;
const pressureOf = (e, down) => down ? (e.pointerType === 'mouse' ? 0.5 : (e.pressure || 0.5)) : 0;

let pointerIsDown = false;
// click count for the text editor (double click selects a word, triple a paragraph)
let clicks = 0, lastDownAt = -1e9, lastDownX = 0, lastDownY = 0;
function countClick(e, x, y) {
  const now = performance.now();
  clicks = (now - lastDownAt < 500 && Math.hypot(x - lastDownX, y - lastDownY) < 4) ? clicks + 1 : 1;
  lastDownAt = now; lastDownX = x; lastDownY = y;
  return clicks;
}
canvas.addEventListener('pointerdown', (e) => {
  const button = domButton(e);
  if (!(button <= 2 || button === 5)) return;
  e.preventDefault();
  canvas.focus();
  canvas.setPointerCapture(e.pointerId);
  pointerIsDown = true;
  const [x, y] = localPoint(e);
  const n = countClick(e, x, y);
  wb.pointer(0, x, y, pressureOf(e, true), button, pointerIdOf(e), e.pointerType === 'pen', mods(e), performance.now(), n);
  wake();
});

canvas.addEventListener('pointermove', (e) => {
  const now = performance.now();
  const down = e.buttons !== 0;
  const button = down ? heldButton(e) : 0;
  const m = mods(e), pen = e.pointerType === 'pen', id = pointerIdOf(e);
  const samples = e.getCoalescedEvents && wb.uses_coalesced_events() ? e.getCoalescedEvents() : [];
  const list = samples.length ? samples : [e];
  for (const s of list) {
    const [x, y] = localPoint(s);
    wb.pointer(1, x, y, pressureOf(s, down), button, id, pen, m, now, 0);
  }
  pendingMoves.push({ts: e.timeStamp, path: toolPath, down, samples: list.length});
  wake();
});

function up(e, kind) {
  pointerIsDown = false;
  const [x, y] = localPoint(e);
  wb.pointer(kind, x, y, 0, domButton(e), pointerIdOf(e), e.pointerType === 'pen', mods(e), performance.now(), clicks);
  wake();
}
canvas.addEventListener('pointerup', (e) => up(e, 2));
canvas.addEventListener('pointercancel', (e) => up(e, 3));
canvas.addEventListener('pointerenter', () => { wb && wb.set_hovering(true); wake(); });
canvas.addEventListener('pointerleave', () => { if (wb && !pointerIsDown) { wb.set_hovering(false); wake(); } });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Pan with wheel / two-finger scroll; zoom with ctrl/cmd+wheel, which is also
// how Chrome delivers a trackpad pinch. The bridge runs tldraw's normalizeWheel.
// Listened for on the window in the capture phase, registered before fribblr's
// opened-item view adds its own (on the frame's load), so stopping it here keeps
// the viewer from zooming or panning the whole frame as well.
window.addEventListener('wheel', (e) => {
  e.preventDefault();
  e.stopImmediatePropagation();
  if (!wb || e.target !== canvas) return;
  const [x, y] = localPoint(e);
  wb.wheel(x, y, e.deltaX, e.deltaY, e.deltaMode, mods(e), performance.now());
  wake();
}, {passive: false, capture: true});
// Safari's pinch: keep the viewer from scaling the frame (the engine zooms on ctrl+wheel).
for (const type of ['gesturestart', 'gesturechange', 'gestureend'])
  window.addEventListener(type, (e) => { e.preventDefault(); e.stopImmediatePropagation(); }, {passive: false, capture: true});

// Keys go through the engine's own shortcut layer (tool letters, undo/redo,
// delete, select all, arrows, Escape, Space panning).
const heldKeys = new Map(); // code -> key, released on blur
window.addEventListener('keydown', (e) => {
  if (!wb || (e.target !== canvas && e.target !== document.body)) return;
  heldKeys.set(e.code, e.key);
  if (wb.key_down(e.key, e.code, mods(e), e.repeat, performance.now())) {
    e.preventDefault();
    // tldraw's r and o shortcuts pick the geo kind; the bridge has no getter for it yet.
    if (!mods(e) && !wb.is_editing_text()) { const k = e.key.toLowerCase(); if (k === 'r') geoKind = 'rectangle'; else if (k === 'o') geoKind = 'ellipse'; }
  }
  else if (e.key === ' ' || e.key === 'Tab') e.preventDefault();
  restartBlink();
  wake();
});
// Paste (plain text) into the edited label.
window.addEventListener('paste', (e) => {
  if (!wb || !wb.is_editing_text()) return;
  const text = e.clipboardData && e.clipboardData.getData('text/plain');
  if (text) { e.preventDefault(); wb.insert_text(text); restartBlink(); wake(); }
});
// The caret blinks (Chromium: 500 ms on, 500 ms off) and shows after each key.
let blinkTimer = 0, caretOn = true;
function restartBlink() {
  clearInterval(blinkTimer); blinkTimer = 0;
  if (!wb.is_editing_text()) return;
  caretOn = true; wb.set_caret_visible(true);
  blinkTimer = setInterval(() => {
    if (!wb.is_editing_text()) { clearInterval(blinkTimer); blinkTimer = 0; return; }
    caretOn = !caretOn; wb.set_caret_visible(caretOn); wake();
  }, 500);
}
window.addEventListener('keyup', (e) => {
  if (!wb) return;
  heldKeys.delete(e.code);
  wb.key_up(e.key, e.code, mods(e), performance.now());
  wake();
});
window.addEventListener('blur', () => {
  if (!wb) return;
  const now = performance.now();
  for (const [code, key] of heldKeys) wb.key_up(key, code, 0, now);
  heldKeys.clear();
  wb.blur(now);
  wake();
});

// ---------------------------------------------------------------- toolbar
const toolbar = document.getElementById('tools');
let geoKind = 'rectangle';
function selectTool(name) {
  const [tool, geo] = name.split(':');
  if (tool === 'geo') { geoKind = geo || 'rectangle'; wb.set_geo(geoKind); }
  wb.set_tool(tool);
  toolPath = wb.tool_path();
  syncToolbar();
  canvas.focus();
  wake();
}
function syncToolbar() {
  const tool = toolPath.split('.')[0];
  for (const b of toolbar.querySelectorAll('button[data-tool]')) {
    const [t, geo] = b.dataset.tool.split(':');
    const on = t === tool && (t !== 'geo' || (geo || 'rectangle') === geoKind);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  const undo = toolbar.querySelector('[data-cmd=undo]'), redo = toolbar.querySelector('[data-cmd=redo]');
  undo.disabled = !wb.can_undo(); redo.disabled = !wb.can_redo();
}
toolbar.addEventListener('pointerdown', (e) => e.preventDefault());
toolbar.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.tool) selectTool(b.dataset.tool);
  if (b.dataset.cmd === 'undo') wb.undo();
  if (b.dataset.cmd === 'redo') wb.redo();
  canvas.focus();
  wake();
});

// ---------------------------------------------------------------- persistence
// Saves 500 ms after the document stops changing (and no pointer is down).
let workspaceId = null;
let saveTimer = 0, lastChange = 0, lastSaved = '', saving = false;
function scheduleSave() {
  lastChange = performance.now();
  if (!saveTimer) saveTimer = setTimeout(saveWhenQuiet, 500);
}
function saveWhenQuiet() {
  saveTimer = 0;
  const quiet = performance.now() - lastChange;
  if (pointerIsDown || quiet < 500 || saving) { saveTimer = setTimeout(saveWhenQuiet, pointerIsDown || saving ? 500 : 500 - quiet); return; }
  save();
}
const putDoc = (body, keepalive) => fetch(`/api/drawxide/docs/${docId}`, {
  method: 'PUT', keepalive, body,
  headers: {'Content-Type': 'application/json', 'x-tinka-workspace': workspaceId},
});
async function save() {
  if (!workspaceId) return;
  const body = wb.get_snapshot();
  if (body === lastSaved) return;
  saving = true;
  try {
    const r = await putDoc(body, false);
    if (r.ok) { lastSaved = body; say(`whiteboard “${docId}” · saved ${new Date().toLocaleTimeString()}`); }
    else say(`save failed: ${r.status} ${await r.text()}`);
  } catch (err) { say(`save failed: ${err.message}`); }
  finally { saving = false; }
}
window.addEventListener('pagehide', () => {
  if (!wb || !workspaceId || !saveTimer) return;
  const body = wb.get_snapshot();
  // fetch keepalive bodies are capped at 64 KB; bigger documents rely on the debounce
  if (body !== lastSaved && body.length < 60000) putDoc(body, true);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && saveTimer) { clearTimeout(saveTimer); saveTimer = 0; save(); }
});

// ---------------------------------------------------------------- start
async function loadFonts() {
  const style = document.createElement('style');
  style.textContent = Whiteboard.font_faces_css();
  document.head.appendChild(style);
  const wanted = [];
  for (const fam of ['tldraw_draw', 'tldraw_sans', 'tldraw_serif', 'tldraw_mono']) {
    for (const w of ['normal', 'bold']) for (const s of ['normal', 'italic']) wanted.push(document.fonts.load(`${s} ${w} 16px ${fam}`));
  }
  await Promise.all(wanted);
}

async function start() {
  await init();
  await loadFonts();   // before the first draw, or text lands in a fallback face
  resize();
  wb = new Whiteboard(cssW, cssH);
  wb.set_mac(isMac);
  window.__dx.wb = wb;
  try { workspaceId = (await (await fetch('/api/config')).json()).workspaceId; }
  catch { say('no /api/config: saving is off'); }
  const r = await fetch(`/api/drawxide/docs/${docId}`, {cache: 'no-store'});
  if (r.ok) {
    const text = await r.text();
    try { wb.load_snapshot(text); } catch (err) {
      try { wb.load_tldr(text); } catch { say(`could not load “${docId}”: ${err}`); }
    }
  }
  // One tick first: the editor's first frame may touch records (camera, page
  // state). Then opening a board does not save it again.
  wb.frame(performance.now());
  wb.reset_frames();
  lastSaved = wb.get_snapshot();
  lastChangeCount = wb.change_count();
  window.addEventListener('resize', resize);
  say(`whiteboard “${docId}”`);
  toolPath = wb.tool_path();
  syncToolbar();
  canvas.focus();
  window.__dx.ready = true;
  wake();
}
start().catch((err) => { say(`failed to start: ${err && err.message || err}`); console.error(err); });
