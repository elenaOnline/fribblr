// Pointing mode's DOM snap source (team/pointing/CONTRACT.md § Round 2, "The snap-source seam").
//
// A gesture inside a same-origin HTML item (a card's live preview on a board, or the opened item in the reader) is
// tidied to the element she means: for a click, the element under the point a person would name (a button, link,
// field, heading, image, a paragraph, a visible card), never a wrapper div or a text node; for a marquee, lasso or
// wand swath, the smallest such element (or the tight union of a few) that the gesture mostly covers.
//
//   import {domSnap} from './pointing-snap-dom.js';
//   domSnap.prepare(el);                                   // optional, off the pointer's path (first hover)
//   domSnap.propose({kind, geometry, item, el})            // synchronous, ~0.1–2 ms
//     -> {shape, label, source: 'dom', score, element, elements?} | null
//
// `el` is the card (`[data-placement]`), its preview iframe, or the reader's iframe. The item's page is found by
// descending Tinka's own wrappers (`/app/item.html` → `#item-content > iframe.item-full-frame`); a cross-origin or
// unloaded page gives null. `geometry` is in the item's local coordinates: CSS px of that innermost page, document
// coordinates (scroll included) — `pageMapping(el)` converts from the board's client coordinates. Shapes:
// {kind: 'point', x, y} · {kind: 'rect', x, y, w, h} · {kind: 'path', points: [[x, y], …]} (a closed lasso) ·
// {kind: 'swath', width, points} (the wand's stroke). The answer's `shape` is a rect in the same coordinates.
//
// Everything below the "pure" line works on any DOM-like tree (tagName, getAttribute, children, parentElement,
// textContent), so tests run in Node with a tiny fake DOM; style and layout reads are guarded.

const ELEMENT = 1, TEXT = 3;

// ---------------------------------------------------------------- frames and coordinates

const WRAPPER_PATHS = new Set(['/app/item.html']);
// media.html shows these kinds as a single picture / player: the pixel source's job, not ours.
const MEDIA_ONLY = new Set(['image', 'video', 'audio', 'pdf']);

// The innermost same-origin page an item shows, with the chain of frames from the board down to it.
// Returns {doc, win, frame, chain: [iframe, …]} or null (cross-origin, not loaded, a picture, no frame).
export function resolveFrame(el) {
  if (!el) return null;
  let frame = el.tagName === 'IFRAME' ? el : el.querySelector?.('.workspace-live-preview iframe, iframe');
  const chain = [];
  for (let depth = 0; frame && depth < 4; depth++) {
    let doc = null, win = null;
    try { doc = frame.contentDocument; win = frame.contentWindow; } catch { return null; }
    if (!doc || !doc.documentElement || !win) return null;
    let url; try { url = new URL(doc.URL); } catch { return null; }
    if (url.protocol === 'about:' || (typeof location !== 'undefined' && url.origin !== location.origin)) return null;
    chain.push(frame);
    if (WRAPPER_PATHS.has(url.pathname)) { frame = doc.querySelector('#item-content > iframe.item-full-frame'); continue; }
    if (url.pathname === '/app/media.html' && MEDIA_ONLY.has(url.searchParams.get('kind'))) return null;
    if (!doc.body) return null;
    return {doc, win, frame, chain};
  }
  return null;
}

// Client (board page) coordinates <-> the item page's document coordinates, through every frame and CSS scale on
// the way (board zoom, the card's preview scale). Rotation is not supported (Tinka never rotates cards).
export function pageMapping(el) {
  const f = resolveFrame(el); if (!f) return null;
  const steps = () => f.chain.map(fr => { const r = fr.getBoundingClientRect(); const k = fr.offsetWidth ? r.width / fr.offsetWidth : 1; return {r, k: k || 1, bx: fr.clientLeft || 0, by: fr.clientTop || 0}; });
  return {
    doc: f.doc, win: f.win, frame: f.frame,
    toPage(x, y) {
      for (const s of steps()) { x = (x - s.r.left) / s.k - s.bx; y = (y - s.r.top) / s.k - s.by; }
      return {x: x + (f.win.scrollX || 0), y: y + (f.win.scrollY || 0)};
    },
    toClient(x, y) {
      x -= f.win.scrollX || 0; y -= f.win.scrollY || 0;
      for (const s of steps().reverse()) { x = (x + s.bx) * s.k + s.r.left; y = (y + s.by) * s.k + s.r.top; }
      return {x, y};
    },
    // How many client px one page px is (for a minimum on-screen size).
    scale() { return steps().reduce((k, s) => k * s.k, 1); },
  };
}

// ---------------------------------------------------------------- the source

const cache = new WeakMap(); // Document -> {index, dirty, at}

function stateOf(doc, win) {
  let s = cache.get(doc);
  if (!s) {
    s = {index: null, dirty: true};
    try {
      const mo = new win.MutationObserver(() => { s.dirty = true; });
      mo.observe(doc.documentElement, {subtree: true, childList: true, attributes: true, characterData: true});
      win.addEventListener('resize', () => { s.dirty = true; });
      s.observer = mo;
    } catch {}
    cache.set(doc, s);
  }
  return s;
}

// Every visible element with its document-coordinates box (one layout read, cached until the page changes).
function indexOf(doc, win) {
  const s = stateOf(doc, win);
  if (s.index && !s.dirty) return s.index;
  const sx = win.scrollX || 0, sy = win.scrollY || 0, out = [];
  const walk = doc.createTreeWalker(doc.body, 1 /* SHOW_ELEMENT */);
  let n = 0;
  for (let e = walk.currentNode; e && n < 6000; e = walk.nextNode(), n++) {
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    out.push({el: e, x: r.left + sx, y: r.top + sy, w: r.width, h: r.height});
  }
  s.index = out; s.dirty = false;
  return out;
}

export function createDomSnap() {
  return {
    // Build the page's element index now (first hover, entering the mode) so propose stays cheap.
    prepare(el) { const f = resolveFrame(el); if (f) indexOf(f.doc, f.win); return !!f; },
    forget(el) { const f = resolveFrame(el); if (f) cache.delete(f.doc); },
    propose({kind, geometry, el} = {}) {
      const f = resolveFrame(el); if (!f || !geometry) return null;
      kind = kind || geometry.kind;
      try {
        if (kind === 'point') return proposePoint(f, geometry);
        if (kind === 'rect' || kind === 'path' || kind === 'swath') return proposeRegion(f, {...geometry, kind});
      } catch { return null; }
      return null;
    },
  };
}

export const domSnap = createDomSnap();

function viewportArea(win) { return Math.max(1, (win.innerWidth || 1) * (win.innerHeight || 1)); }

function proposePoint({doc, win}, {x, y}) {
  const vx = x - (win.scrollX || 0), vy = y - (win.scrollY || 0);
  let leaf = vx >= 0 && vy >= 0 && vx <= win.innerWidth && vy <= win.innerHeight ? doc.elementFromPoint(vx, vy) : null;
  if (!leaf || leaf === doc.body || leaf === doc.documentElement) {
    // Outside the viewport (the reader scrolled or zoomed), or nothing under it: the deepest box holding the point.
    let best = null, depth = -1;
    for (const b of indexOf(doc, win)) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { const d = depthOf(b.el); if (d >= depth) { depth = d; best = b.el; } }
    leaf = best || leaf;
  }
  const view = viewportArea(win), fits = e => { const r = e.getBoundingClientRect(); return r.width * r.height < 0.85 * view; };
  let target = leaf && meaningfulAt(leaf, fits);
  if (!target) {
    // The hit test skips pointer-events: none (rulers, overlays drawn for show): the deepest named box holding the point.
    let depth = -1;
    for (const b of indexOf(doc, win)) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h && kindOf(b.el) && fits(b.el)) { const d = depthOf(b.el); if (d >= depth) { depth = d; target = b.el; } }
    if (target) target = meaningfulAt(target, fits);
  }
  if (!target) return null;
  const info = describeElement(target, doc, win), k = kindOf(target);
  const big = (info.box.w * info.box.h) / view;
  const score = round2(({control: .95, media: .9, heading: .9, text: .8, labelled: .75, boxed: .7, group: .65})[k] * (1 - Math.min(.4, big * .5)));
  return {shape: {kind: 'rect', ...info.box}, label: labelOf(info, k), source: 'dom', score, element: info};
}

// --- region gestures: a coverage mask of the gesture, then the smallest meaningful element(s) it mostly covers.

const COVER = {rect: .7, path: .65, swath: .5};   // an element counts when this much of its box is inside the gesture
const FILL = {rect: .3, path: .3, swath: .15};     // the snapped box must explain this much of the gesture (unless
                                                   //   nothing else is inside it)

function proposeRegion(f, g) {
  const a = proposeCovered(f, g);
  if (g.kind !== 'swath' || (a && a.fill >= .35)) return a && strip(a);
  const b = proposeWaved(f, g);
  return strip(b || a);
}
const strip = p => { if (!p) return null; const {fill, ...rest} = p; return rest; };

// A wand stroke waved over (or drawn just under) one thing: the smallest named element that holds nearly all of the
// stroke's centre line (its box grown by half the stroke's width, so an underline counts) and that the stroke spans
// at least half of along its longer side. Big things (a picture, a paragraph) are pointed at this way: the stroke
// covers too little of them for the coverage rule.
function proposeWaved({doc, win}, g) {
  const pts = resample(g.points || [], 4); if (pts.length < 2) return null;
  const tol = (g.width || 0) / 2, view = viewportArea(win);
  let best = null;
  for (const b of indexOf(doc, win)) {
    if (b.w < 3 || b.h < 3 || b.w * b.h >= .85 * view) continue;
    const k = kindOf(b.el); if (!k) continue;
    let inside = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [px, py] of pts) if (px >= b.x - tol && px <= b.x + b.w + tol && py >= b.y - tol && py <= b.y + b.h + tol) { inside++; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
    const share = inside / pts.length; if (share < .85) continue;
    const span = Math.max(Math.min(1, (x1 - x0) / b.w), Math.min(1, (y1 - y0) / b.h)); if (span < .5) continue;
    const area = b.w * b.h;
    if (!best || area < best.area) best = {el: b.el, area, share, span, k};
  }
  if (!best) return null;
  const info = describeElement(best.el, doc, win);
  return {shape: {kind: 'rect', ...info.box}, label: labelOf(info, best.k), source: 'dom', score: round2(best.share * (.6 + .4 * best.span)), element: info};
}
function resample(pts, step) {
  const out = []; if (!pts.length) return out;
  out.push(pts[0]);
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(d / step));
    for (let j = 1; j <= n; j++) out.push([ax + (bx - ax) * j / n, ay + (by - ay) * j / n]);
  }
  return out;
}

function proposeCovered({doc, win}, g) {
  const mask = gestureMask(g); if (!mask) return null;
  const hits = [];
  for (const b of indexOf(doc, win)) {
    if (b.x > mask.x1 || b.y > mask.y1 || b.x + b.w < mask.x0 || b.y + b.h < mask.y0) continue;
    if (b.w < 3 || b.h < 3 || !kindOf(b.el)) continue;
    const cov = mask.cover(b); if (cov >= COVER[g.kind]) hits.push({...b, cov});
  }
  if (!hits.length) return null;
  const inHits = new Set(hits.map(h => h.el));
  // The outermost hit elements: a covered card wins over its covered heading.
  let top = hits.filter(h => { for (let p = h.el.parentElement; p; p = p.parentElement) if (inHits.has(p)) return false; return true; });
  if (!top.length) return null;
  let chosen, members = null;
  if (top.length === 1) chosen = top[0].el;
  else {
    // Several: their nearest common ancestor stands for them when it is about their size; else their tight union.
    const lca = commonAncestor(top.map(t => t.el)), union = unionBox(top), ar = lca && lca !== doc.body && lca !== doc.documentElement ? boxOf(lca, win) : null;
    if (ar && ar.w * ar.h <= 1.35 * union.w * union.h && mask.cover(ar) >= COVER[g.kind] * .85) chosen = lca;
    else {
      top.sort((a, b) => (a.y - b.y) || (a.x - b.x));
      if (top.length > 12) return null; // a dozen separate things is a region, not an element: her shape stands
      members = top;
      chosen = lca;
    }
  }
  const box = members ? unionBox(members) : boxOf(chosen, win);
  const fill = mask.fill(box), cov = Math.min(1, mask.cover(box));
  // Content her gesture cuts through outside the snap (words, pictures, controls half inside it): a loose gesture
  // round one thing in empty space still snaps; one that also slices other content needs a closer fit.
  const kept = members ? members.map(m => m.el) : [chosen];
  let stray = 0;
  for (const b of indexOf(doc, win)) {
    if (b.x > mask.x1 || b.y > mask.y1 || b.x + b.w < mask.x0 || b.y + b.h < mask.y0) continue;
    const k = kindOf(b.el); if (!(k === 'text' || k === 'media' || k === 'control' || k === 'heading')) continue;
    if (kept.some(e => e === b.el || e.contains?.(b.el) || b.el.contains?.(e))) continue;
    stray += mask.cover(b) * b.w * b.h;
  }
  stray = mask.cells > 0 ? stray / (mask.area || 1) : 0;
  if (fill < FILL[g.kind] && !(fill >= .06 && stray < .04)) return null;
  const score = round2(cov * (.55 + .45 * Math.min(1, fill / .6)) * (1 - Math.min(.6, stray * 1.5)));
  if (score < (members ? .5 : .35)) return null; // a union of separate things must fit her gesture well
  const shape = {kind: 'rect', x: round1(box.x), y: round1(box.y), w: round1(box.w), h: round1(box.h)};
  if (!members) {
    const info = describeElement(chosen, doc, win);
    return {shape, label: labelOf(info, kindOf(chosen)), source: 'dom', score, element: info, fill};
  }
  const elements = members.map(m => describeElement(m.el, doc, win));
  const where = chosen && chosen !== doc.body && chosen !== doc.documentElement ? describeElement(chosen, doc, win) : null;
  const named = where && (where.name || where.id) ? ` in ${labelOf(where, kindOf(chosen) || 'group')}` : '';
  return {shape, label: `${elements.length} elements${named}`, source: 'dom', score, element: where || elements[0], elements, fill};
}

// A rasterised gesture over its bounding box (≤ 128 cells a side) with a summed-area table, so the share of any box
// inside the gesture is four lookups.
export function gestureMask(g) {
  let x0, y0, x1, y1;
  const pad = g.kind === 'swath' ? (g.width || 0) / 2 : 0;
  if (g.kind === 'rect') { x0 = g.x; y0 = g.y; x1 = g.x + g.w; y1 = g.y + g.h; }
  else {
    const pts = g.points || []; if (pts.length < 2) return null;
    x0 = y0 = Infinity; x1 = y1 = -Infinity;
    for (const [px, py] of pts) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  }
  const W = x1 - x0, H = y1 - y0; if (!(W >= 2 && H >= 2)) return null;
  const cell = Math.max(W, H) / 128, nx = Math.max(1, Math.ceil(W / cell)), ny = Math.max(1, Math.ceil(H / cell));
  const m = new Uint8Array(nx * ny);
  if (g.kind === 'rect') m.fill(1);
  else if (g.kind === 'path') fillPolygon(m, nx, ny, g.points.map(([px, py]) => [(px - x0) / cell, (py - y0) / cell]));
  else stampSwath(m, nx, ny, g.points.map(([px, py]) => [(px - x0) / cell, (py - y0) / cell]), pad / cell);
  const sat = new Float64Array((nx + 1) * (ny + 1));
  for (let j = 0; j < ny; j++) { let row = 0; for (let i = 0; i < nx; i++) { row += m[j * nx + i]; sat[(j + 1) * (nx + 1) + i + 1] = sat[j * (nx + 1) + i + 1] + row; } }
  const total = sat[ny * (nx + 1) + nx];
  // Cells of the gesture inside box b (fractional at the edges by area weighting of the clamped box).
  const inside = b => {
    const ax = clamp((b.x - x0) / cell, 0, nx), ay = clamp((b.y - y0) / cell, 0, ny), bx = clamp((b.x + b.w - x0) / cell, 0, nx), by = clamp((b.y + b.h - y0) / cell, 0, ny);
    if (bx <= ax || by <= ay) return 0;
    const S = (i, j) => satAt(sat, nx, ny, i, j);
    return S(bx, by) - S(ax, by) - S(bx, ay) + S(ax, ay);
  };
  return {
    x0, y0, x1, y1, cells: total, area: total * cell * cell,
    cover: b => { const a = (b.w / cell) * (b.h / cell); return a > 0 ? inside(b) / a : 0; },   // share of box b inside the gesture
    fill: b => total > 0 ? inside(b) / total : 0,                                             // share of the gesture inside box b
  };
}

// The summed-area table read at fractional cell coordinates (bilinear), so partial cells count partly.
function satAt(sat, nx, ny, i, j) {
  const i0 = Math.floor(i), j0 = Math.floor(j), fi = i - i0, fj = j - j0, W = nx + 1;
  const at = (a, b) => sat[Math.min(ny, b) * W + Math.min(nx, a)];
  return at(i0, j0) * (1 - fi) * (1 - fj) + at(i0 + 1, j0) * fi * (1 - fj) + at(i0, j0 + 1) * (1 - fi) * fj + at(i0 + 1, j0 + 1) * fi * fj;
}

export function fillPolygon(m, nx, ny, pts) {
  const n = pts.length;
  for (let j = 0; j < ny; j++) {
    const y = j + .5, xs = [];
    for (let a = 0, b = n - 1; a < n; b = a++) {
      const [xa, ya] = pts[a], [xb, yb] = pts[b];
      if ((ya > y) !== (yb > y)) xs.push(xa + (y - ya) / (yb - ya) * (xb - xa));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const s = Math.max(0, Math.ceil(xs[k] - .5)), e = Math.min(nx - 1, Math.floor(xs[k + 1] - .5));
      for (let i = s; i <= e; i++) m[j * nx + i] = 1;
    }
  }
}

export function stampSwath(m, nx, ny, pts, r) {
  const r2 = r * r;
  for (let s = 0; s < pts.length; s++) {
    const [ax, ay] = pts[s], [bx, by] = pts[Math.min(pts.length - 1, s + 1)];
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), i1 = Math.min(nx - 1, Math.ceil(Math.max(ax, bx) + r));
    const j0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), j1 = Math.min(ny - 1, Math.ceil(Math.max(ay, by) + r));
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = i + .5, py = j + .5;
      const t = L ? clamp(((px - ax) * dx + (py - ay) * dy) / L, 0, 1) : 0;
      const qx = ax + t * dx - px, qy = ay + t * dy - py;
      if (qx * qx + qy * qy <= r2) m[j * nx + i] = 1;
    }
  }
}

function boxOf(el, win) {
  const r = el.getBoundingClientRect();
  return {x: r.left + (win.scrollX || 0), y: r.top + (win.scrollY || 0), w: r.width, h: r.height};
}
function unionBox(bs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of bs) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  return {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
}

// ================================================================ pure (any DOM-like tree)

const INTERACTIVE_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'textbox', 'searchbox', 'combobox', 'slider', 'spinbutton', 'treeitem']);
const LANDMARK_TAGS = new Set(['nav', 'header', 'footer', 'main', 'aside', 'form', 'section', 'article', 'dialog', 'fieldset', 'figure', 'table', 'ul', 'ol', 'dl', 'details', 'menu']);
const TEXT_TAGS = new Set(['p', 'li', 'blockquote', 'pre', 'td', 'th', 'dt', 'dd', 'figcaption', 'caption', 'legend', 'label', 'address']);
const INLINE_TAGS = new Set(['span', 'b', 'i', 'em', 'strong', 'small', 'mark', 'code', 'kbd', 'sub', 'sup', 'u', 's', 'abbr', 'time', 'br', 'wbr', 'font', 'q', 'cite', 'var', 'samp', 'data']);
const HEADING_RE = /^h[1-6]$/;

const tagOf = el => (el.localName || el.tagName || '').toLowerCase();
const attr = (el, n) => el.getAttribute?.(n) ?? null;

function isHidden(el) {
  if (el.hidden || el.hasAttribute?.('hidden') || attr(el, 'aria-hidden') === 'true') return true;
  const win = el.ownerDocument?.defaultView;
  if (win?.getComputedStyle) { const cs = win.getComputedStyle(el); return cs.display === 'none' || cs.visibility === 'hidden'; }
  return /display\s*:\s*none|visibility\s*:\s*hidden/.test(attr(el, 'style') || '');
}

// What a person would call this element, or null for a wrapper: 'control' | 'media' | 'heading' | 'text' |
// 'labelled' (a region with a name) | 'boxed' (a visible card: own background, border or shadow) | 'group' (a list,
// table, form, nav… without a name).
export function kindOf(el) {
  if (!el || el.nodeType !== ELEMENT) return null;
  const t = tagOf(el), role = attr(el, 'role');
  if (t === 'html' || t === 'body' || t === 'head' || t === 'script' || t === 'style' || t === 'template') return null;
  if (role === 'presentation' || role === 'none') return null;
  if (INTERACTIVE_ROLES.has(role) || (t === 'a' && el.hasAttribute?.('href')) || t === 'button' || t === 'select' || t === 'textarea' || t === 'summary' ||
      (t === 'input' && attr(el, 'type') !== 'hidden') || attr(el, 'contenteditable') === 'true' || attr(el, 'contenteditable') === '') return 'control';
  if (t === 'img' || t === 'video' || t === 'canvas' || t === 'picture' || t === 'iframe' || t === 'audio' || t === 'object' || t === 'embed' || role === 'img') return 'media';
  if (t === 'svg') return el.parentElement && tagOf(el.parentElement) !== 'svg' && !isInSvg(el.parentElement) ? 'media' : null;
  if (isInSvg(el)) return null;
  if (HEADING_RE.test(t) || role === 'heading') return 'heading';
  if (attr(el, 'aria-label') || attr(el, 'aria-labelledby')) return 'labelled';
  if (TEXT_TAGS.has(t)) return hasText(el) || t === 'td' || t === 'th' ? 'text' : null;
  if (role && role !== 'generic') return LANDMARK_TAGS.has(t) || ['region', 'navigation', 'banner', 'contentinfo', 'complementary', 'main', 'form', 'dialog', 'group', 'list', 'listitem', 'table', 'row', 'cell', 'tabpanel', 'toolbar', 'menu', 'menubar', 'tablist', 'article', 'figure', 'alert', 'status'].includes(role) ? 'group' : 'labelled';
  if (LANDMARK_TAGS.has(t)) return 'group';
  if (INLINE_TAGS.has(t)) return null;
  if (isBoxed(el)) return 'boxed';
  if (ownText(el)) return 'text'; // a div whose own words are its content (div-soup mocks)
  return null;
}

function isInSvg(el) { for (let p = el; p; p = p.parentElement) if (tagOf(p) === 'svg') return true; return false; }

function hasText(el) { return !!collapse(el.textContent || ''); }
// Text written directly in this element (not only inside child blocks), ignoring whitespace.
function ownText(el) {
  let words = '';
  for (const c of el.childNodes || []) {
    if (c.nodeType === TEXT) words += c.nodeValue || c.textContent || '';
    else if (c.nodeType === ELEMENT && INLINE_TAGS.has(tagOf(c))) words += c.textContent || '';
  }
  return collapse(words).length >= 2;
}

// A visible card: its own background different from its parent's, a border, or a shadow (needs computed style).
function isBoxed(el) {
  const win = el.ownerDocument?.defaultView; if (!win?.getComputedStyle) return false;
  const cs = win.getComputedStyle(el);
  if (cs.boxShadow && cs.boxShadow !== 'none') return true;
  const bw = ['Top', 'Right', 'Bottom', 'Left'].filter(s => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none' && !transparent(cs[`border${s}Color`])).length;
  if (bw >= 3) return true;
  if (!transparent(cs.backgroundColor) || (cs.backgroundImage && cs.backgroundImage !== 'none')) {
    const p = el.parentElement; if (!p) return false;
    return effectiveBackground(p, win) !== norm(cs.backgroundColor) || (cs.backgroundImage && cs.backgroundImage !== 'none');
  }
  return false;
}
const transparent = c => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
const norm = c => (c || '').replace(/\s+/g, '');
function effectiveBackground(el, win) {
  for (let p = el; p; p = p.parentElement) { const c = win.getComputedStyle(p).backgroundColor; if (!transparent(c)) return norm(c); }
  return 'rgb(255,255,255)';
}

// From the element under a click, the nearest one a person would name. A control anywhere on the way up wins (the
// words inside a button are the button); else the first element with a kind. `fits` rejects page-sized boxes.
export function meaningfulAt(leaf, fits = () => true) {
  let e = leaf?.nodeType === ELEMENT ? leaf : leaf?.parentElement;
  const chain = [];
  for (let p = e; p && tagOf(p) !== 'body' && tagOf(p) !== 'html'; p = p.parentElement) chain.push(p);
  const control = chain.find(p => kindOf(p) === 'control');
  if (control && fits(control)) return control;
  // A link or label around media/text is still the control (handled above); otherwise the first named thing.
  for (const p of chain) { const k = kindOf(p); if (k && fits(p)) return p; }
  return null;
}

// ---- roles and names

const INPUT_ROLES = {button: 'button', submit: 'button', reset: 'button', image: 'button', checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton', search: 'searchbox', email: 'textbox', tel: 'textbox', text: 'textbox', url: 'textbox', password: 'textbox', '': 'textbox'};

export function roleOf(el) {
  const explicit = attr(el, 'role'); if (explicit) return explicit.trim().split(/\s+/)[0];
  const t = tagOf(el);
  if (t === 'a' || t === 'area') return el.hasAttribute?.('href') ? 'link' : null;
  if (t === 'button' || t === 'summary') return 'button';
  if (t === 'input') return INPUT_ROLES[(attr(el, 'type') || '').toLowerCase()] ?? 'textbox';
  if (t === 'textarea') return 'textbox';
  if (t === 'select') return attr(el, 'multiple') !== null || Number(attr(el, 'size')) > 1 ? 'listbox' : 'combobox';
  if (t === 'img') return attr(el, 'alt') === '' ? 'presentation' : 'img';
  if (t === 'svg') return 'img';
  if (HEADING_RE.test(t)) return 'heading';
  const named = !!(attr(el, 'aria-label') || attr(el, 'aria-labelledby'));
  return ({nav: 'navigation', main: 'main', aside: 'complementary', article: 'article', ul: 'list', ol: 'list', menu: 'list', li: 'listitem', table: 'table', tr: 'row', td: 'cell', th: 'columnheader', dialog: 'dialog', figure: 'figure', p: 'paragraph', fieldset: 'group', details: 'group', hr: 'separator', progress: 'progressbar', blockquote: 'blockquote', dl: 'list', dt: 'term', dd: 'definition', textarea: 'textbox', video: null, form: named ? 'form' : null, section: named ? 'region' : null,
    header: insideSectioning(el) ? null : 'banner', footer: insideSectioning(el) ? null : 'contentinfo'})[t] ?? null;
}
function insideSectioning(el) { for (let p = el.parentElement; p; p = p.parentElement) if (['article', 'aside', 'main', 'nav', 'section'].includes(tagOf(p))) return true; return false; }

const NAME_FROM_CONTENT = new Set(['button', 'link', 'heading', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'cell', 'columnheader', 'rowheader', 'checkbox', 'radio', 'switch', 'treeitem', 'tooltip', 'term', 'listitem', 'paragraph', 'figcaption', 'legend', 'caption']);

function byId(doc, id) {
  if (doc?.getElementById) return doc.getElementById(id);
  return findFirst(doc?.documentElement || doc, e => attr(e, 'id') === id);
}
function findFirst(root, pred) {
  if (!root) return null;
  const stack = [root];
  while (stack.length) { const e = stack.shift(); if (e.nodeType === ELEMENT && pred(e)) return e; stack.unshift(...(e.children || [])); }
  return null;
}
function findAll(root, pred) {
  const out = [], stack = root ? [root] : [];
  while (stack.length) { const e = stack.pop(); if (e.nodeType === ELEMENT && pred(e)) out.push(e); for (let i = (e.children || []).length - 1; i >= 0; i--) stack.push(e.children[i]); }
  return out;
}
function rootOf(el) { let r = el; while (r.parentElement) r = r.parentElement; return r; }

// The accessible name, after the accname rules a person would notice: aria-labelledby, aria-label, a native label
// (label[for], a wrapping label, alt, legend, caption, figcaption, an svg's <title>), the words inside for roles named
// by their content, then placeholder and title. A section, form, nav or dialog without a label is named by its first
// heading, when it opens it (not accname; what a person would call it).
export function accessibleName(el, depth = 0) {
  if (!el || el.nodeType !== ELEMENT || depth > 3) return '';
  const doc = el.ownerDocument;
  const by = attr(el, 'aria-labelledby');
  if (by && depth === 0) {
    const s = by.trim().split(/\s+/).map(id => byId(doc || rootOf(el), id)).filter(Boolean).map(r => textAlternative(r, depth + 1)).join(' ');
    if (collapse(s)) return clipName(s);
  }
  const label = attr(el, 'aria-label'); if (label && collapse(label)) return clipName(label);
  const t = tagOf(el), type = (attr(el, 'type') || '').toLowerCase();
  if (t === 'input' && ['button', 'submit', 'reset'].includes(type)) return clipName(attr(el, 'value') || ({submit: 'Submit', reset: 'Reset'})[type] || '');
  if (t === 'input' && type === 'image') return clipName(attr(el, 'alt') || attr(el, 'value') || 'Submit');
  if (t === 'input' || t === 'select' || t === 'textarea') {
    const id = attr(el, 'id'), root = doc?.documentElement || rootOf(el);
    const lab = id ? findAll(root, e => tagOf(e) === 'label' && attr(e, 'for') === id)[0] : null;
    const wrap = closest(el, e => tagOf(e) === 'label');
    const s = (lab && textAlternative(lab, depth + 1, el)) || (wrap && textAlternative(wrap, depth + 1, el));
    if (collapse(s || '')) return clipName(s);
    return clipName(attr(el, 'aria-placeholder') || attr(el, 'placeholder') || attr(el, 'title') || '');
  }
  if (t === 'img' || t === 'area') return clipName(attr(el, 'alt') || attr(el, 'title') || '');
  if (t === 'svg') { const title = (el.children ? [...el.children] : []).find(c => tagOf(c) === 'title'); return clipName(title?.textContent || attr(el, 'title') || ''); }
  const firstChild = name => (el.children ? [...el.children] : []).find(c => tagOf(c) === name);
  if (t === 'fieldset') { const l = firstChild('legend'); if (l) return clipName(textAlternative(l, depth + 1)); }
  if (t === 'figure') { const c = findFirst(el, e => tagOf(e) === 'figcaption'); if (c) return clipName(textAlternative(c, depth + 1)); }
  if (t === 'table') { const c = firstChild('caption'); if (c) return clipName(textAlternative(c, depth + 1)); }
  const role = roleOf(el);
  if (NAME_FROM_CONTENT.has(role) || HEADING_RE.test(t)) { const s = textAlternative(el, depth + 1); if (collapse(s)) return clipName(s); }
  if (['section', 'form', 'nav', 'aside', 'article', 'dialog', 'main', 'header', 'footer'].includes(t) || ['region', 'form', 'navigation', 'dialog', 'group', 'tabpanel'].includes(role)) {
    // only a heading that opens it (among its first three elements) is its title
    let seen = 0;
    const h = findFirst(el, e => { if (e === el) return false; seen++; return seen <= 3 && (HEADING_RE.test(tagOf(e)) || attr(e, 'role') === 'heading') && !isHidden(e); });
    // …and only when it is its one heading of that level (three columns' h2s do not name the row that holds them)
    if (h && seen <= 3 && findAll(el, e => tagOf(e) === tagOf(h) && e !== h).length === 0) return clipName(textAlternative(h, depth + 1));
  }
  return clipName(attr(el, 'title') || '');
}

// The words of an element as a screen reader would read them: text, image alts, labels of nested controls.
function textAlternative(el, depth, skip = null) {
  if (!el || depth > 6) return '';
  if (el.nodeType === TEXT) return el.nodeValue ?? el.textContent ?? '';
  if (el.nodeType !== ELEMENT || el === skip || isHidden(el)) return '';
  const t = tagOf(el);
  if (t === 'script' || t === 'style' || t === 'template') return '';
  const lab = attr(el, 'aria-label'); if (lab && depth > 1) return ` ${lab} `;
  if (t === 'img') return ` ${attr(el, 'alt') || ''} `;
  if (t === 'svg') return ` ${accessibleName(el, depth)} `;
  if (t === 'input') return ` ${attr(el, 'value') || ''} `;
  if (t === 'br') return ' ';
  let s = '';
  for (const c of el.childNodes || []) s += textAlternative(c, depth + 1, skip);
  return INLINE_TAGS.has(t) ? s : ` ${s} `;
}

function closest(el, pred) { for (let p = el.parentElement; p; p = p.parentElement) if (pred(p)) return p; return null; }
const collapse = s => String(s || '').replace(/\s+/g, ' ').trim();
const clipName = s => { const c = collapse(s); return c.length > 120 ? c.slice(0, 119) + '…' : c; };

// ---- selectors

const cssEscape = s => (globalThis.CSS?.escape ? globalThis.CSS.escape(s) : String(s).replace(/(^-?\d)|[^a-zA-Z0-9_ -￿-]/g, (m, d) => d ? `\\3${m.slice(-1)} ` : `\\${m}`));
const quote = v => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ')}"`;
const DATA_PREFERRED = ['data-testid', 'data-test', 'data-test-id', 'data-qa', 'data-cy', 'data-id', 'data-key', 'data-name', 'data-component', 'data-section'];
const NAME_ATTRS = ['aria-label', 'name', 'alt', 'title', 'for', 'placeholder', 'href'];

// A CSS selector that matches only `el` in its document: an id, else a data-* attribute, else an attribute that
// carries its role or name, else a nth-of-type path (the shortest unique suffix of the path from the nearest ancestor
// with an id). Uniqueness is checked by a matcher for exactly the selectors built here, so it works without a
// browser; in a browser the result is checked again with querySelectorAll.
export function uniqueSelector(el) {
  const root = rootOf(el), doc = el.ownerDocument, native = !!doc?.querySelectorAll && root === doc.documentElement;
  let all = null;
  const count = steps => countMatches(all ||= findAll(root, () => true), steps);
  // In a browser the native engine decides (fast on big pages); elsewhere the matcher for these selectors does.
  const verified = (sel, steps) => {
    if (native) { try { const r = doc.querySelectorAll(sel); return r.length === 1 && r[0] === el ? sel : null; } catch { return null; } }
    return count(steps) === 1 && matchesChain(el, steps) ? sel : null;
  };
  const uniqueId = id => native ? (() => { try { return doc.querySelectorAll(`#${cssEscape(id)}`).length === 1; } catch { return false; } })() : count([{id}]) === 1;
  const t = tagOf(el), id = attr(el, 'id');
  if (id && !/\s/.test(id)) { const s = verified(`#${cssEscape(id)}`, [{id}]); if (s) return s; }
  const attrs = el.attributes ? [...el.attributes].map(a => [a.name, a.value]) : [];
  const datas = attrs.filter(([n, v]) => n.startsWith('data-') && v && v.length <= 64).sort(([a], [b]) => rank(a) - rank(b));
  for (const [n, v] of datas) {
    const s = verified(`[${n}=${quote(v)}]`, [{attrs: [[n, v]]}]) || verified(`${t}[${n}=${quote(v)}]`, [{tag: t, attrs: [[n, v]]}]); if (s) return s;
  }
  const role = attr(el, 'role');
  for (const n of NAME_ATTRS) {
    const v = attr(el, n); if (!v || v.length > 120 || (n === 'href' && (v === '#' || v.length > 80))) continue;
    const s = (role && verified(`[role=${quote(role)}][${n}=${quote(v)}]`, [{attrs: [['role', role], [n, v]]}])) || verified(`${t}[${n}=${quote(v)}]`, [{tag: t, attrs: [[n, v]]}]);
    if (s) return s;
  }
  // nth-of-type path, from the nearest ancestor with a unique id (or the root), shortened to its shortest unique suffix.
  const chain = [];
  let anchor = null;
  for (let p = el; p; p = p.parentElement) {
    const pid = attr(p, 'id');
    if (p !== el && pid && !/\s/.test(pid) && uniqueId(pid)) { anchor = {id: pid}; break; }
    chain.unshift(stepOf(p));
    if (tagOf(p) === 'html') break;
  }
  for (let len = 1; len <= chain.length; len++) {
    const steps = chain.slice(chain.length - len);
    const s = verified(steps.map(stepText).join(' > '), steps); if (s) return s;
    if (anchor) { const st = [anchor, ...steps]; const s2 = verified(st.map(stepText).join(' > '), st); if (s2) return s2; }
  }
  const full = anchor ? [anchor, ...chain] : chain;
  return full.map(stepText).join(' > ');
}
const rank = n => { const i = DATA_PREFERRED.indexOf(n); return i < 0 ? 99 : i; };
function stepOf(el) {
  const t = tagOf(el), p = el.parentElement;
  if (!p || t === 'html' || t === 'body') return {tag: t};
  const same = [...p.children].filter(c => tagOf(c) === t);
  return same.length > 1 ? {tag: t, nth: same.indexOf(el) + 1} : {tag: t};
}
function stepText(s) {
  let out = s.tag || '';
  if (s.id) out += `#${cssEscape(s.id)}`;
  for (const [n, v] of s.attrs || []) out += `[${n}=${quote(v)}]`;
  if (s.nth) out += `:nth-of-type(${s.nth})`;
  return out || '*';
}
function matchesStep(el, s) {
  if (!el || el.nodeType !== ELEMENT) return false;
  if (s.tag && tagOf(el) !== s.tag) return false;
  if (s.id && attr(el, 'id') !== s.id) return false;
  for (const [n, v] of s.attrs || []) if (attr(el, n) !== v) return false;
  if (s.nth) { const p = el.parentElement; if (!p) return false; const same = [...p.children].filter(c => tagOf(c) === tagOf(el)); if (same.indexOf(el) + 1 !== s.nth) return false; }
  return true;
}
// steps joined by the child combinator; the first step may sit anywhere.
function matchesChain(el, steps) {
  let e = el;
  for (let i = steps.length - 1; i >= 0; i--) { if (!matchesStep(e, steps[i])) return false; if (i) e = e.parentElement; }
  return true;
}
export function countMatches(all, steps) { let n = 0; for (const e of all) if (matchesChain(e, steps)) n++; return n; }

// A readable ancestor path: the meaningful ancestors (ids, landmarks, forms, lists) and the element, ≤ 5 steps.
export function readablePath(el) {
  const steps = [];
  for (let p = el; p && tagOf(p) !== 'body' && tagOf(p) !== 'html'; p = p.parentElement) {
    const t = tagOf(p), id = attr(p, 'id');
    if (p === el || id || LANDMARK_TAGS.has(t) || attr(p, 'role')) {
      const cls = !id && p === el && typeof p.className === 'string' ? p.className.trim().split(/\s+/)[0] : '';
      steps.unshift(t + (id ? `#${id}` : cls ? `.${cls}` : ''));
    }
  }
  return (steps.length > 5 ? ['…', ...steps.slice(-4)] : steps).join(' > ');
}

function depthOf(el) { let d = 0; for (let p = el; p; p = p.parentElement) d++; return d; }
function commonAncestor(els) {
  const paths = els.map(e => { const a = []; for (let p = e; p; p = p.parentElement) a.unshift(p); return a; });
  let lca = null;
  for (let i = 0; ; i++) { const c = paths[0][i]; if (!c || paths.some(p => p[i] !== c)) break; lca = c; }
  return lca;
}

// ---- describing and labelling

export function describeElement(el, doc = el.ownerDocument, win = doc?.defaultView) {
  const t = tagOf(el), role = roleOf(el), name = accessibleName(el);
  const text = t === 'input' || t === 'textarea' ? collapse(el.value ?? attr(el, 'value') ?? '') : collapse(el.textContent || '');
  const out = {tag: t};
  if (role) out.role = role;
  if (name) out.name = name;
  if (text) out.text = text.length > 80 ? text.slice(0, 79) + '…' : text;
  const id = attr(el, 'id'); if (id) out.id = id;
  out.selector = uniqueSelector(el);
  out.path = readablePath(el);
  if (el.getBoundingClientRect && win) { const b = boxOf(el, win); out.box = {x: round1(b.x), y: round1(b.y), w: round1(b.w), h: round1(b.h)}; }
  if (doc?.URL) out.frameUrl = cleanUrl(doc.URL);
  return out;
}
// The page's own address without Tinka's theme/scale parameters.
function cleanUrl(u) { try { const x = new URL(u); for (const k of ['theme', 'scale', 'v']) x.searchParams.delete(k); return x.href; } catch { return u; } }

const NOUNS = {link: 'link', button: 'button', checkbox: 'checkbox', radio: 'radio button', switch: 'switch', tab: 'tab', textbox: 'field', searchbox: 'search field', combobox: 'menu', listbox: 'list box', slider: 'slider', spinbutton: 'number field', img: 'image', heading: 'heading', navigation: 'navigation', main: 'main', banner: 'header', contentinfo: 'footer', complementary: 'sidebar', article: 'article', list: 'list', listitem: 'list item', table: 'table', row: 'row', cell: 'cell', columnheader: 'column header', dialog: 'dialog', figure: 'figure', paragraph: 'paragraph', form: 'form', region: 'section', group: 'group', menuitem: 'menu item', option: 'option'};
export function labelOf(info, kind) {
  const noun = NOUNS[info.role] || ({media: info.tag === 'video' ? 'video' : info.tag === 'canvas' ? 'canvas' : 'image', heading: 'heading', text: 'text', boxed: 'box', labelled: 'section', group: info.tag === 'form' ? 'form' : 'group', control: 'control'})[kind] || info.tag;
  const words = info.name || (kind === 'text' || kind === 'boxed' ? info.text : '') || '';
  const short = words.length > 40 ? words.slice(0, 39) + '…' : words;
  return short ? `${noun} "${short}"` : info.id ? `${noun} #${info.id}` : noun;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round1 = v => Math.round(v * 10) / 10;
const round2 = v => Math.round(v * 100) / 100;
