// The Wand's area (pointing-mode.js): a field of cells in board units that a held drag paints, and the glitter that
// draws it. No DOM here beyond a 2D context passed in, so the tests and the server's crop render can use it too.
//
// The area of one wand gesture is the band its centre line sweeps (the swath, `width` across) plus the inside of any
// loop it closes (a circle round something means the thing inside). That is all a swath shape needs to rebuild it:
// `SwathField.fromShape({kind: 'swath', width, points})` gives back the same cells, so the board, the crop and a reader
// of the record all see one area. Cells have a strength: one pass is light, each return over the same place (a wave)
// makes it denser, the middle of the band a little denser than its edges, a loop's inside lightest. Strength is only
// how densely the glitter is drawn; every cell with any strength is inside the area.
//
// The glitter: one fleck site per cell, a cell being `pitch` CSS px on screen, anchored to the board (a site keeps its
// place as the board pans). A site shows when its rank in a 64 × 64 blue-noise table is under the cell's strength, so
// density follows strength with no clumps and no grid. Flecks are small hard-edged squares in device pixels; the
// sparsest ranks are drawn as four-point sparkles. Nothing is blurred and nothing glows. Content under a patch stays
// readable: at full strength about a fifth of the area is ink.

const BLUE_B64 = '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';
let BLUE = null;
const blue = () => {
  if (BLUE) return BLUE;
  const bin = atob(BLUE_B64); BLUE = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) BLUE[i] = bin.charCodeAt(i);
  return BLUE;
};
/** The rank (0 ≤ t < 1) of the fleck site at cell (i, j). */
export const rankAt = (i, j) => (blue()[(i & 63) | ((j & 63) << 6)] + 0.5) / 256;

export const WAND = {
  pitch: 4,                       // CSS px between fleck sites on screen when the gesture was made
  width: 56,                      // CSS px across the band, the default
  sizes: [32, 56, 80, 112],       // ⌥[ and ⌥] step through these
};
const TILE = 32, TA = TILE * TILE;
const PASS = [0, 0.42, 0.62, 0.76, 0.85, 0.9, 0.93];
export const STRENGTH = {loop: 0.24, fill: 0.2, edge: 0.82};
const passStrength = (n, near) => PASS[Math.min(n, PASS.length - 1)] * (1 - 0.32 * near * near);

function roundness(points) {
  let a = 0, p = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const [x1, y1] = points[i], [x2, y2] = points[(i + 1) % n];
    a += x1 * y2 - x2 * y1; p += Math.hypot(x2 - x1, y2 - y1);
  }
  return p ? 4 * Math.PI * (Math.abs(a) / 2) / (p * p) : 0;
}
function boxOf(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
}
function crossAt(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (!d) return null;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t > 0 && t <= 1 && u >= 0 && u < 1 ? [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])] : null;
}

export class SwathField {
  /** `width` across the band and `cell` (one fleck site), both in board units. */
  constructor({width, cell}) {
    this.width = width; this.r = width / 2; this.cell = cell;
    this.tiles = new Map();
    this.points = []; this.arcs = [];
    this.count = 0;               // cells inside the area
    this.box = null;              // cell bounds {i0, j0, i1, j1} of the area
    this.dirty = null;            // cell bounds changed since takeDirty()
    this.loopFrom = 0;
    this.loops = 0;
  }
  static fromShape(shape, cell) {
    const f = new SwathField({width: shape.width, cell});
    for (const [x, y] of shape.points) f.add(x, y);
    return f;
  }
  /** A region (a snapped rect or path) filled: a light dusting inside, a dense band `edge` wide just inside its edge. */
  // A path made of several outlines (pathLoops) is filled loop by loop, so the bridges between them draw nothing.
  static fromRegion(shape, cell, edge) {
    const f = new SwathField({width: edge * 2, cell});
    const loops = shape.kind === 'rect' ? [[[shape.x, shape.y], [shape.x + shape.w, shape.y], [shape.x + shape.w, shape.y + shape.h], [shape.x, shape.y + shape.h]]] : pathLoops(shape.points || []);
    for (const poly of loops) {
      if (poly.length < 3) continue;
      const b = boxOf(poly);
      const segs = poly.map((p, k) => [p, poly[(k + 1) % poly.length]]);
      const toEdge = shape.kind === 'rect' ? (x, y) => Math.min(x - b.x, b.x + b.w - x, y - b.y, b.y + b.h - y)
        : (x, y) => { let d = Infinity; for (const [a, q] of segs) d = Math.min(d, segDist(x, y, a[0], a[1], q[0], q[1])); return d; };
      f.scanFill(poly, (x, y) => toEdge(x, y) <= edge ? STRENGTH.edge : STRENGTH.fill);
    }
    return f;
  }
  tile(ti, tj, make) {
    const key = ti * 65536 + tj; let t = this.tiles.get(key);
    if (!t && make) { t = {s: new Float32Array(TA), last: new Float32Array(TA).fill(-1e9), passes: new Uint8Array(TA), born: new Float64Array(TA)}; this.tiles.set(key, t); }
    return t;
  }
  get(i, j) { const t = this.tile(Math.floor(i / TILE), Math.floor(j / TILE), false); return t ? t.s[(i - Math.floor(i / TILE) * TILE) + (j - Math.floor(j / TILE) * TILE) * TILE] : 0; }
  born(i, j) { const t = this.tile(Math.floor(i / TILE), Math.floor(j / TILE), false); return t ? t.born[(i - Math.floor(i / TILE) * TILE) + (j - Math.floor(j / TILE) * TILE) * TILE] : 0; }
  // Set a cell's strength to at least `s`; `born` is when it last grew (live sparkle).
  raise(i, j, s, now) {
    const ti = Math.floor(i / TILE), tj = Math.floor(j / TILE), t = this.tile(ti, tj, true), k = (i - ti * TILE) + (j - tj * TILE) * TILE;
    if (s <= t.s[k] + 1e-4) return;
    if (!(t.s[k] > 0)) { this.count++; this.grow(i, j); }
    t.s[k] = s; t.born[k] = now || 0;
    const d = this.dirty;
    if (!d) this.dirty = {i0: i, j0: j, i1: i, j1: j};
    else { if (i < d.i0) d.i0 = i; if (i > d.i1) d.i1 = i; if (j < d.j0) d.j0 = j; if (j > d.j1) d.j1 = j; }
  }
  grow(i, j) {
    const b = this.box;
    if (!b) this.box = {i0: i, j0: j, i1: i, j1: j};
    else { if (i < b.i0) b.i0 = i; if (i > b.i1) b.i1 = i; if (j < b.j0) b.j0 = j; if (j > b.j1) b.j1 = j; }
  }
  takeDirty() { const d = this.dirty; this.dirty = null; return d; }

  /** The centre line goes on to (x, y): the band is swept from the last point, and a loop it closes is filled. */
  add(x, y, now = 0) {
    const pts = this.points, n = pts.length;
    if (n && Math.hypot(x - pts[n - 1][0], y - pts[n - 1][1]) < this.cell * 0.25) return false;
    const arc = n ? this.arcs[n - 1] + Math.hypot(x - pts[n - 1][0], y - pts[n - 1][1]) : 0;
    pts.push([x, y]); this.arcs.push(arc);
    if (n) this.sweep(pts[n - 1], pts[n], this.arcs[n - 1], arc, now); else this.sweep(pts[0], pts[0], 0, 0, now);
    this.closeLoop(now);
    return true;
  }
  // Every cell whose centre lies within r of the segment a–b. A cell met again after the line has gone more than r away
  // from it (a wave coming back) counts one more pass.
  sweep(a, b, arcA, arcB, now) {
    const c = this.cell, r = this.r;
    const i0 = Math.floor((Math.min(a[0], b[0]) - r) / c), i1 = Math.floor((Math.max(a[0], b[0]) + r) / c);
    const j0 = Math.floor((Math.min(a[1], b[1]) - r) / c), j1 = Math.floor((Math.max(a[1], b[1]) + r) / c);
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy, r2 = r * r;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = (i + 0.5) * c, y = (j + 0.5) * c;
      let u = L2 ? ((x - a[0]) * dx + (y - a[1]) * dy) / L2 : 0; u = u < 0 ? 0 : u > 1 ? 1 : u;
      const ex = a[0] + u * dx - x, ey = a[1] + u * dy - y, d2 = ex * ex + ey * ey;
      if (d2 > r2) continue;
      const ti = Math.floor(i / TILE), tj = Math.floor(j / TILE), t = this.tile(ti, tj, true), k = (i - ti * TILE) + (j - tj * TILE) * TILE;
      const at = arcA + u * (arcB - arcA);
      if (at - t.last[k] > r) t.passes[k] = Math.min(250, t.passes[k] + 1);
      if (at > t.last[k]) t.last[k] = at;
      this.raise(i, j, passStrength(t.passes[k], Math.sqrt(d2) / r), now);
    }
  }
  // A loop closed by the newest point: the line crossing itself, or coming back within 0.6 of a band-width of where it was at least
  // three band-widths of line ago. It is filled when it is round enough to be a circle drawn on purpose (4πA/P² ≥ 0.3:
  // a circle is 1, a back-and-forth wave near 0) and wider than the band itself (a smaller one is all band already).
  closeLoop(now) {
    const pts = this.points, n = pts.length; if (n < 5) return;
    const a = pts[n - 2], b = pts[n - 1], arcN = this.arcs[n - 1];
    let loop = null, from = -1;
    for (let k = n - 4; k >= this.loopFrom; k--) {
      const hit = crossAt(a, b, pts[k], pts[k + 1]);
      if (hit) { loop = [hit, ...pts.slice(k + 1, n - 1)]; from = k; break; }
    }
    if (!loop) for (let k = this.loopFrom; k < n - 3; k++) {
      if (arcN - this.arcs[k] < 3 * this.width) break;
      if (Math.hypot(b[0] - pts[k][0], b[1] - pts[k][1]) <= this.width * 0.6) { loop = pts.slice(k, n); from = k; break; }
    }
    if (!loop || loop.length < 4) return;
    const box = boxOf(loop);
    if (Math.min(box.w, box.h) < this.width * 0.9 || roundness(loop) < 0.3) return;
    this.scanFill(loop, () => STRENGTH.loop, now);
    this.loops++;
    this.loopFrom = n - 1;
    void from;
  }
  // Every cell whose centre is inside the polygon (even-odd), at strength f(x, y).
  scanFill(poly, f, now = 0) {
    const c = this.cell, b = boxOf(poly);
    const j0 = Math.floor(b.y / c), j1 = Math.floor((b.y + b.h) / c);
    for (let j = j0; j <= j1; j++) {
      const y = (j + 0.5) * c, xs = [];
      for (let k = 0, m = poly.length; k < m; k++) {
        const [x1, y1] = poly[k], [x2, y2] = poly[(k + 1) % m];
        if ((y1 > y) !== (y2 > y)) xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let i = Math.ceil(xs[k] / c - 0.5); (i + 0.5) * c <= xs[k + 1]; i++) this.raise(i, j, f((i + 0.5) * c, y), now);
      }
    }
  }

  // ---- what the area covers, in board units ----
  /** The area's bounds in board units, or null. */
  bounds() { const b = this.box, c = this.cell; return b ? {x: b.i0 * c, y: b.j0 * c, w: (b.i1 - b.i0 + 1) * c, h: (b.j1 - b.j0 + 1) * c} : null; }
  area() { return this.count * this.cell * this.cell; }
  contains([x, y]) { return this.get(Math.floor(x / this.cell), Math.floor(y / this.cell)) > 0; }
  /** The part of a box (board units) inside the area: {area, bounds}, or null. */
  covered(box) {
    const b = this.box, c = this.cell; if (!b) return null;
    const i0 = Math.max(b.i0, Math.ceil(box.x / c - 0.5)), i1 = Math.min(b.i1, Math.floor((box.x + box.w) / c - 0.5));
    const j0 = Math.max(b.j0, Math.ceil(box.y / c - 0.5)), j1 = Math.min(b.j1, Math.floor((box.y + box.h) / c - 0.5));
    if (i1 < i0 || j1 < j0) return null;
    let n = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let j = j0; j <= j1; j++) {
      const tj = Math.floor(j / TILE), row = (j - tj * TILE) * TILE;
      for (let i = i0; i <= i1;) {
        const ti = Math.floor(i / TILE), t = this.tile(ti, tj, false), end = Math.min(i1, ti * TILE + TILE - 1);
        if (!t) { i = end + 1; continue; }
        for (; i <= end; i++) if (t.s[i - ti * TILE + row] > 0) { n++; if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
      }
    }
    if (!n) return null;
    const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const bx0 = cl(x0 * c, box.x, box.x + box.w), by0 = cl(y0 * c, box.y, box.y + box.h);
    const bx1 = cl((x1 + 1) * c, box.x, box.x + box.w), by1 = cl((y1 + 1) * c, box.y, box.y + box.h);
    return {area: Math.min(n * c * c, box.w * box.h), bounds: {x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0}};
  }
  /**
   * How much of a box's length the area runs along, beside or over it: the share of its columns (rows, for a box taller
   * than wide) that have area cells within a band-width of the box. An underline or a stroke through a heading runs
   * along all of it while covering only part.
   */
  span(box) {
    const b = this.box, c = this.cell; if (!b) return 0;
    const wide = box.w >= box.h, pad = this.width;
    const i0 = Math.ceil((box.x - (wide ? 0 : pad)) / c - 0.5), i1 = Math.floor((box.x + box.w + (wide ? 0 : pad)) / c - 0.5);
    const j0 = Math.ceil((box.y - (wide ? pad : 0)) / c - 0.5), j1 = Math.floor((box.y + box.h + (wide ? pad : 0)) / c - 0.5);
    const [a0, a1] = wide ? [i0, i1] : [j0, j1]; if (a1 < a0) return 0;
    let hit = 0;
    for (let a = a0; a <= a1; a++) {
      const [lo, hi] = wide ? [Math.max(j0, b.j0), Math.min(j1, b.j1)] : [Math.max(i0, b.i0), Math.min(i1, b.i1)];
      if (wide ? a < b.i0 || a > b.i1 : a < b.j0 || a > b.j1) continue;
      for (let q = lo; q <= hi; q++) if ((wide ? this.get(a, q) : this.get(q, a)) > 0) { hit++; break; }
    }
    return hit / (a1 - a0 + 1);
  }
  /** Calls fn(i, j, s, born) for every area cell in cell bounds `w` (default: all). */
  forEach(fn, w = null) {
    w ||= this.box;
    if (!w || !this.box) return;
    const b = this.box, i0 = Math.max(w.i0, b.i0), i1 = Math.min(w.i1, b.i1), j0 = Math.max(w.j0, b.j0), j1 = Math.min(w.j1, b.j1);
    for (let tj = Math.floor(j0 / TILE); tj <= Math.floor(j1 / TILE); tj++) for (let ti = Math.floor(i0 / TILE); ti <= Math.floor(i1 / TILE); ti++) {
      const t = this.tile(ti, tj, false); if (!t) continue;
      const ja = Math.max(j0, tj * TILE), jb = Math.min(j1, tj * TILE + TILE - 1), ia = Math.max(i0, ti * TILE), ib = Math.min(i1, ti * TILE + TILE - 1);
      for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) { const k = (i - ti * TILE) + (j - tj * TILE) * TILE, s = t.s[k]; if (s > 0) fn(i, j, s, t.born[k]); }
    }
  }
  shape(round = v => Math.round(v * 10) / 10) { return {kind: 'swath', width: round(this.width), points: this.points.map(([x, y]) => [round(x), round(y)])}; }
}
/**
 * Several outlines as one closed path (a snap that names several things: CONTRACT § Round 2 review fixes): each loop
 * ends on its own first point, the next loop starts from there, and after the last one the path walks back through
 * the loops' first points to where it began. The way out and the way back between two loops are the same line, so
 * the path has the loops' area and nothing else (even-odd fill, point-in-polygon and the shoelace area all agree).
 * `pathLoops` gives the loops back (a path with no loop closed on its first point is one loop, as any lasso).
 */
export function outlinesPath(loops) {
  loops = loops.filter(l => l?.length >= 3);
  if (loops.length <= 1) return loops[0] ? loops[0].map(p => [p[0], p[1]]) : [];
  const out = [];
  for (const l of loops) { for (const p of l) out.push([p[0], p[1]]); out.push([l[0][0], l[0][1]]); }
  for (let k = loops.length - 2; k >= 0; k--) out.push([loops[k][0][0], loops[k][0][1]]);
  return out;
}
export function pathLoops(points) {
  if (!points?.length) return [];
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  if (!points.slice(1).some(p => same(p, points[0]))) return [points];
  const loops = [];
  for (let i = 0; i < points.length;) {
    const start = points[i]; let j = i + 1;
    while (j < points.length && !same(points[j], start)) j++;
    if (j >= points.length) break;            // the walk back through the loops' first points
    if (j - i >= 3) loops.push(points.slice(i, j));
    i = j + 1;
  }
  return loops;
}
function segDist(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let u = L2 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0; u = u < 0 ? 0 : u > 1 ? 1 : u;
  return Math.hypot(ax + u * dx - x, ay + u * dy - y);
}

// ---- the glitter ----
const hash = (i, j) => { let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1); h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
/** A fleck's size in device pixels: about 1.5 CSS px, whole device pixels so its edges are hard. */
export const fleckSize = dpr => Math.max(2, Math.round(1.5 * dpr));
// The glitter's mix (reviewed 2026-11-26 against a stipple of red crosses that vanished on a red apple): fewer sites
// lit (DENSITY of the cell's strength), flecks of three sizes and a few short dashes, each two-tone so it reads on any
// ground: a mark-red fleck with a light keyline on its top and left edges, or (about one in four) a light fleck with a deep
// keyline on its bottom and right, like a glint cut at an angle. A rare sparkle (STAR of the lit sites) is a light
// point with short red arms. Nothing blurred, nothing glowing; at full strength about a tenth of the area is ink.
const DENSITY = 0.72, STAR = 0.03;
const SIZES = [[0.42, 1], [0.8, 1.5], [1, 2.25]];   // [share up to, size in units of `size / 2` CSS px]
/**
 * Draws the area's flecks into `ctx` (identity transform, device pixels). `view`: {ox, oy, k}: device px =
 * (board − o) × k. `w`: cell bounds to draw (default all). `tones`: [ink, ink, light, deep] (pointing.css --wand-ink,
 * --wand-ink, --wand-pale, --wand-star); `ink` alone draws one colour. `fresh`: {now, ms}, cells that grew within
 * `ms` draw denser, settling to their own density as they age (the user's motion only).
 */
export function paintField(ctx, field, view, {ink, tones = null, w = null, dpr = 1, fresh = null, size: css = 2, rim = 0.7} = {}) {
  const c = field.cell, k = view.k, unit = css / 2;
  const body = tones ? tones[0] : ink, light = tones ? tones[2] || tones[0] : ink, deep = tones ? tones[3] || tones[0] : ink;
  const edge = Math.max(1, Math.round(dpr * 0.5)), px = n => Math.max(1, Math.round(n * unit * dpr));
  const red = [], pale = [], stars = [];
  field.forEach((i, j, s, born) => {
    const t = rankAt(i, j);
    // The area's own edge: a cell with a neighbour outside draws at least `rim`, so the edge reads as a line of flecks.
    if (rim && s < rim && (!(field.get(i - 1, j) > 0) || !(field.get(i + 1, j) > 0) || !(field.get(i, j - 1) > 0) || !(field.get(i, j + 1) > 0))) s = rim;
    if (fresh) { const age = fresh.now - born; if (age >= 0 && age < fresh.ms) s += (1 - s) * 0.55 * (1 - age / fresh.ms); else if (fresh.only) return; }
    const lit = s * DENSITY; if (t >= lit) return;
    const jx = (hash(i, j) - 0.5) * 0.5, jy = (hash(j + 7919, i) - 0.5) * 0.5;
    const x = Math.round(((i + 0.5 + jx) * c - view.ox) * k), y = Math.round(((j + 0.5 + jy) * c - view.oy) * k);
    if (t < lit * STAR) { stars.push(x, y); return; }
    const h = hash(i + 31, j - 17), g = hash(j + 101, i + 7);
    const sz = px(SIZES.find(([upTo]) => g < upTo)[1]);
    // One in eight a short dash, across or down.
    const dash = h > 0.875, fw = dash && g < 0.5 ? 2 * sz : sz, fh = dash && g >= 0.5 ? 2 * sz : sz;
    (h < 0.28 ? pale : red).push(x - (fw >> 1), y - (fh >> 1), fw, fh);
  }, w);
  const fill = (colour, list, dx, dy, grow) => {
    if (!list.length) return;
    ctx.fillStyle = colour; ctx.beginPath();
    for (let q = 0; q < list.length; q += 4) ctx.rect(list[q] + dx, list[q + 1] + dy, list[q + 2] + grow, list[q + 3] + grow);
    ctx.fill();
  };
  // Keylines first (a light one up and left of each red fleck, a deep one down and right of each light fleck), then
  // the flecks over them, so no keyline cuts into a neighbour.
  fill(light, red, -edge, -edge, edge);
  fill(deep, pale, 0, 0, edge);
  fill(body, red, 0, 0, 0);
  fill(light, pale, 0, 0, 0);
  if (stars.length) {
    const a = px(1), arm = px(1.25), core = px(1.5);
    ctx.fillStyle = body; ctx.beginPath();
    for (let q = 0; q < stars.length; q += 2) { const x = stars[q], y = stars[q + 1]; ctx.rect(x - arm - (core >> 1), y - (a >> 1), core + 2 * arm, a); ctx.rect(x - (a >> 1), y - arm - (core >> 1), a, core + 2 * arm); }
    ctx.fill();
    ctx.fillStyle = light; ctx.beginPath();
    for (let q = 0; q < stars.length; q += 2) ctx.rect(stars[q] - (core >> 1), stars[q + 1] - (core >> 1), core, core);
    ctx.fill();
  }
}
