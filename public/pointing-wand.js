// The Wand's area (pointing-mode.js): a field of cells in board units that a held drag paints, and the dither that
// draws it. No DOM here beyond a 2D context passed in, so the tests and the server's crop render can use it too.
//
// The area of one wand gesture is the band its centre line sweeps (the swath, `width` across) plus the inside of any
// loop it closes (a circle round something means the thing inside). That is all a swath shape needs to rebuild it:
// `SwathField.fromShape({kind: 'swath', width, points})` gives back the same cells, so the board, the crop and a reader
// of the record all see one area. Cells have a strength: one pass is light, each return over the same place (a wave)
// makes it denser, the middle of the band a little denser than its edges, a loop's inside lightest. Strength is only
// how densely the dither is drawn; every cell with any strength is inside the area.
//
// The look (paintField, below): a translucent red fill under an ordered dither on a grid fixed to the board, densest along
// the hand's path and dissolving toward the edge, with a few still glints; see `LOOK`. Nothing is blurred, nothing glows,
// and nothing moves once drawn.
const BLUE_B64 = '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';
let BLUE = null;
const blue = () => {
  if (BLUE) return BLUE;
  const bin = atob(BLUE_B64); BLUE = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) BLUE[i] = bin.charCodeAt(i);
  return BLUE;
};
/** The rank (0 ≤ t < 1) of cell (i, j) in a 64 × 64 blue-noise table (which cells carry a glint). */
export const rankAt = (i, j) => (blue()[(i & 63) | ((j & 63) << 6)] + 0.5) / 256;

export const WAND = {
  pitch: 4,                       // CSS px per cell on screen when the gesture was made (a cell is 2 × 2 texels)
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
  /** `width` across the band and `cell`, both in board units. */
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
  // A path that names several things is filled ring by ring.
  static fromRegion(shape, cell, edge) {
    const f = new SwathField({width: edge * 2, cell});
    f.region = true;
    const loops = shape.kind === 'rect' ? [[[shape.x, shape.y], [shape.x + shape.w, shape.y], [shape.x + shape.w, shape.y + shape.h], [shape.x, shape.y + shape.h]]] : ringsOf(shape);
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
 * The closed outlines of a snapped shape (CONTRACT § Round 2 review fixes; lib/feedback.mjs validates the same): a
 * path that names several things carries `rings`, each thing's own outline (`points` is the first of them, so a reader
 * of one outline still gets a valid shape); any other path is its one ring.
 */
export const ringsOf = shape => shape?.kind !== 'path' ? [] : shape.rings?.length ? shape.rings : [shape.points];
/** Every point of a shape's outlines (for its bounds). */
export const outlinePointsOf = shape => shape?.kind === 'path' ? ringsOf(shape).flat() : shape?.points || [];
/** Whether a point is inside any of a path's rings. */
export function inRings([x, y], shape) {
  for (const ring of ringsOf(shape)) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}
function segDist(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let u = L2 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0; u = u < 0 ? 0 : u > 1 ? 1 : u;
  return Math.hypot(ax + u * dx - x, ay + u * dy - y);
}


// ---- the dither ----
// An ordered dither on a 4 × 4 Bayer matrix, in texels half a cell across (2 CSS px at the pitch the gesture was made at),
// anchored to the board: texel (u, v) is the same board square at every redraw, so the pattern never crawls. One ramp
// runs from the hand's path to the edge (dither-kit's floor-to-line ramp, turned round a stroke): along the path the
// matrix lights the most texels, solid in the mark red, and every texel between them carries a quiet tint of it; toward
// the edge the lit texels thin out and then the tint itself dissolves, texel by texel, so the area has one edge and it
// dissolves. Only alpha varies, never the shade, so it reads alike on paper and a dark board (the kit's rule: opacities,
// not shades). A few glints, four-point stars in a small clearing, are the sparkle.
// A snapped outline filled is drawn quietly over the sweep as cast (pointing-mode.js draws that beneath it, the same
// material): inside, a light tint; a dotted line a cell outside the outline. Nothing dense lands on the thing it names.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
const bayer = (u, v) => BAYER[(u & 3) | ((v & 3) << 2)];
// The tint's own threshold: the matrix shifted half a tile, so the tint's dissolve and the lit texels interleave.
const bayerT = (u, v) => BAYER[((u + 2) & 3) | (((v + 1) & 3) << 2)];
export const LOOK = {
  tint: 0.11,       // alpha of the tint texels (the translucent area); tones[4] (pointing.css --wand-tint) overrides
  dot: 0.82,        // alpha of a texel the matrix lights
  core: 0.3,        // density along the hand's path at full strength, falling to 0 at the edge
  ramp: [3, 7],     // cells over which it falls: the band's half-width, kept within these
  tintReach: 0.6,   // the tint is whole over the inner 60 % of the ramp and dissolves over the rest
  line: 0,          // alpha of a solid edge line (0: none; a crop for the agent draws one)
  keyline: 0,       // alpha of a pale line just outside the edge (0: none; a crop for the agent draws one)
  pad: 1,           // a snapped outline: cells between the thing's edge and its dotted line,
  regionTint: 0.6,  //   and the tint inside, as a share of `tint`
  glint: 0.012,     // share of cells carrying a still glint, per unit of strength
};
/**
 * What a crop for the agent draws over the same dither: the area's edge as a line with a pale keyline outside it, so
 * the area reads in a still image on any content, a red subject included (where the tint and the dots go unseen).
 */
export const CROP_LOOK = {line: 0.9, keyline: 0.8};
/** How far (cells) a changed cell changes the drawing: the ramp's reach and a glint's arm. */
export const reach = () => LOOK.ramp[1] + 3;
/** How far (board units) the drawing reaches past the area's bounds: a glint's arm, or a snapped outline's dotted line. */
export const extent = field => field.cell * (field.region ? LOOK.pad + 2 : 2);
/** A texel's size in device pixels at the gesture's own zoom. */
export const fleckSize = dpr => Math.max(1, Math.round(WAND.pitch / 2 * dpr));

let probe = null, scratch = null;
const rgbCache = new Map();
function rgbOf(colour) {
  let v = rgbCache.get(colour);
  if (v) return v;
  probe ||= typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : Object.assign(document.createElement('canvas'), {width: 1, height: 1});
  const p = probe.getContext('2d', {willReadFrequently: true});
  p.clearRect(0, 0, 1, 1); p.fillStyle = '#000'; p.fillStyle = colour; p.fillRect(0, 0, 1, 1);
  const d = p.getImageData(0, 0, 1, 1).data; v = [d[0], d[1], d[2]];
  rgbCache.set(colour, v);
  return v;
}
const pack = ([r, g, b], a) => ((Math.round(Math.max(0, Math.min(1, a)) * 255) << 24) | (b << 16) | (g << 8) | r) >>> 0;
const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;
// 3-4 chamfer distance (in thirds of a step) from the cells where `seed` is 0, capped at `big`; edges of the grid count as 0.
function chamfer(D, W, H) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const q = x + y * W; if (!D[q]) continue;
    D[q] = Math.min(D[q], x ? D[q - 1] + 3 : 3, y ? D[q - W] + 3 : 3, x && y ? D[q - W - 1] + 4 : 4, y && x < W - 1 ? D[q - W + 1] + 4 : 4);
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const q = x + y * W; if (!D[q]) continue;
    D[q] = Math.min(D[q], x < W - 1 ? D[q + 1] + 3 : 3, y < H - 1 ? D[q + W] + 3 : 3, x < W - 1 && y < H - 1 ? D[q + W + 1] + 4 : 4, x && y < H - 1 ? D[q + W - 1] + 4 : 4);
  }
}

/**
 * Draws the area into `ctx` (identity transform, device pixels). `view`: {ox, oy, k}: device px = (board − o) × k.
 * `w`: cell bounds to draw (default all). `tones`: [ink, dot, pale, deep, tint] (pointing.css --wand-ink, --wand-dot,
 * --wand-pale, --wand-star, --wand-tint as a number); `ink` alone draws one colour. `fresh`: {now, ms}: while the user
 * sweeps, the cells swept in the last `ms` carry glints that go out as they age (drawn over a canvas that already holds
 * the area). `look`: overrides of LOOK (CROP_LOOK for the agent's crops).
 */
export function paintField(ctx, field, view, {ink, tones = null, w = null, fresh = null, look: over = null} = {}) {
  const L = over ? {...LOOK, ...over} : LOOK, c = field.cell, k = view.k, b = field.box;
  if (!b) return;
  const red = rgbOf(tones ? tones[0] : ink), dot = rgbOf(tones ? tones[1] || tones[0] : ink), pale = rgbOf(tones ? tones[2] || tones[0] : ink);
  const tint = tones && tones[4] !== undefined && tones[4] !== '' && Number.isFinite(+tones[4]) ? +tones[4] : L.tint;
  const region = !!field.region, ext = region ? L.pad + 2 : 2;
  w ||= {i0: b.i0 - ext, j0: b.j0 - ext, i1: b.i1 + ext, j1: b.j1 + ext};
  const i0 = Math.max(w.i0, b.i0 - ext), i1 = Math.min(w.i1, b.i1 + ext), j0 = Math.max(w.j0, b.j0 - ext), j1 = Math.min(w.j1, b.j1 + ext);
  if (i1 < i0 || j1 < j0) return;
  const ts = c * k / 2;
  if (fresh) return paintFresh(ctx, field, view, L, dot, pale, {i0, j0, i1, j1}, fresh, ts);
  const R = Math.max(L.ramp[0], Math.min(L.ramp[1], field.r / c));
  // The strengths of the window and a margin round it (as far as the ramp or the aura reaches).
  const M = Math.ceil(region ? L.pad : R) + 3, gi0 = i0 - M, gj0 = j0 - M, GW = i1 - i0 + 1 + 2 * M, GH = j1 - j0 + 1 + 2 * M;
  const S = new Float32Array(GW * GH);
  field.forEach((i, j, s) => { S[(i - gi0) + (j - gj0) * GW] = s; }, {i0: gi0, j0: gj0, i1: gi0 + GW - 1, j1: gj0 + GH - 1});
  const TW = 2 * (i1 - i0 + 1), TH = 2 * (j1 - j0 + 1);
  scratch ||= typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(TW, TH) : document.createElement('canvas');
  if (scratch.width < TW || scratch.height < TH) { scratch.width = Math.max(scratch.width, TW); scratch.height = Math.max(scratch.height, TH); }
  const sx = scratch.getContext('2d');
  const img = sx.createImageData(TW, TH), px = new Uint32Array(img.data.buffer);
  const TINT = pack(red, tint), DOT = pack(dot, L.dot), LINE = pack(dot, L.line), KEY = pack(pale, L.keyline);
  const at = (u, v) => (u - 2 * i0) + (v - 2 * j0) * TW;
  if (!region) {
    // Each cell's distance from outside, in cells.
    const D = new Uint16Array(GW * GH), BIG = 3 * (M + 1);
    for (let q = 0; q < S.length; q++) D[q] = S[q] > 0 ? BIG : 0;
    chamfer(D, GW, GH);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const q = (i - gi0) + (j - gj0) * GW, s = S[q];
      if (!(s > 0)) continue;
      const ramp = clamp01((D[q] / 3 - 0.5) / R);
      const dens = Math.min(1, s / 0.6) * L.core * ramp, tdens = clamp01(ramp / L.tintReach);
      const oL = !(S[q - 1] > 0), oR = !(S[q + 1] > 0), oU = !(S[q - GW] > 0), oD = !(S[q + GW] > 0);
      for (let b2 = 0; b2 < 2; b2++) for (let a2 = 0; a2 < 2; a2++) {
        const u = 2 * i + a2, v = 2 * j + b2;
        if (L.line && ((a2 === 0 && oL) || (a2 === 1 && oR) || (b2 === 0 && oU) || (b2 === 1 && oD))) { px[at(u, v)] = LINE; continue; }
        px[at(u, v)] = dens > bayer(u, v) ? DOT : tdens > bayerT(u, v) ? TINT : 0;
      }
    }
    // A pale keyline just outside the edge (the agent's crop): the texels beside each edge texel.
    if (L.keyline) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const q = (i - gi0) + (j - gj0) * GW; if (S[q] > 0) continue;
      const iL = S[q - 1] > 0, iR = S[q + 1] > 0, iU = S[q - GW] > 0, iD = S[q + GW] > 0;
      if (!(iL || iR || iU || iD)) continue;
      const u = 2 * i, v = 2 * j;
      if (iL) { px[at(u, v)] = KEY; px[at(u, v + 1)] = KEY; }
      if (iR) { px[at(u + 1, v)] = KEY; px[at(u + 1, v + 1)] = KEY; }
      if (iU) { px[at(u, v)] = KEY; px[at(u + 1, v)] = KEY; }
      if (iD) { px[at(u, v + 1)] = KEY; px[at(u + 1, v + 1)] = KEY; }
    }
  } else {
    // A snapped outline: each texel's distance outside it, in texels (inside: 0).
    const XW = 2 * GW, XH = 2 * GH, DX = new Uint16Array(XW * XH), BIG = 6 * (M + 1);
    for (let y = 0; y < XH; y++) for (let x = 0; x < XW; x++) DX[x + y * XW] = S[(x >> 1) + (y >> 1) * GW] > 0 ? 0 : BIG;
    // (chamfer measures from the zeros: here the inside)
    for (let y = 0; y < XH; y++) for (let x = 0; x < XW; x++) {
      const q = x + y * XW; if (!DX[q]) continue;
      DX[q] = Math.min(DX[q], x ? DX[q - 1] + 3 : BIG, y ? DX[q - XW] + 3 : BIG, x && y ? DX[q - XW - 1] + 4 : BIG, y && x < XW - 1 ? DX[q - XW + 1] + 4 : BIG);
    }
    for (let y = XH - 1; y >= 0; y--) for (let x = XW - 1; x >= 0; x--) {
      const q = x + y * XW; if (!DX[q]) continue;
      DX[q] = Math.min(DX[q], x < XW - 1 ? DX[q + 1] + 3 : BIG, y < XH - 1 ? DX[q + XW] + 3 : BIG, x < XW - 1 && y < XH - 1 ? DX[q + XW + 1] + 4 : BIG, x && y < XH - 1 ? DX[q + XW - 1] + 4 : BIG);
    }
    const IN = pack(red, tint * L.regionTint), P = 2 * L.pad;
    for (let v = 2 * j0; v < 2 * j1 + 2; v++) for (let u = 2 * i0; u < 2 * i1 + 2; u++) {
      const d = DX[(u - 2 * gi0) + (v - 2 * gj0) * XW] / 3;
      let col = 0;
      if (d < P - 0.5) col = IN;
      else if (d < P + 0.5) col = ((u + v) & 1) ? 0 : DOT;            // the dotted line
      px[at(u, v)] = col;
    }
  }
  // Still glints: a four-point star (a pale centre, red arms) in a small clearing, at the cells whose blue-noise rank is
  // under `glint` × strength, never at the very edge.
  if (L.glint && !region) {
    const GC = pack(pale, 1), GA = pack(dot, 1);
    const put = (u, v, col) => { const x = u - 2 * i0, y = v - 2 * j0; if (x >= 0 && y >= 0 && x < TW && y < TH) px[x + y * TW] = col; };
    for (let j = j0 - 3; j <= j1 + 3; j++) for (let i = i0 - 3; i <= i1 + 3; i++) {
      const q = (i - gi0) + (j - gj0) * GW, s = S[q];
      if (!(s > 0) || rankAt(i, j) >= L.glint * Math.min(1, s / 0.6)) continue;
      if (!(S[q - 1] > 0 && S[q + 1] > 0 && S[q - GW] > 0 && S[q + GW] > 0)) continue;
      const u = 2 * i, v = 2 * j;
      for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [-2, -1], [-1, -2], [2, -1], [1, -2], [-2, 1], [-1, 2], [2, 1], [1, 2]]) put(u + x, v + y, 0);
      put(u, v, GC); put(u - 1, v, GA); put(u + 1, v, GA); put(u, v - 1, GA); put(u, v + 1, GA);
      put(u - 2, v, GA); put(u + 2, v, GA); put(u, v - 2, GA); put(u, v + 2, GA);
    }
  }
  sx.putImageData(img, 0, 0);
  const x0 = Math.round((i0 * c - view.ox) * k), y0 = Math.round((j0 * c - view.oy) * k);
  const smooth = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, 0, 0, TW, TH, x0, y0, Math.round(TW * ts), Math.round(TH * ts));
  ctx.imageSmoothingEnabled = smooth;
}
// While sweeping: glints on the cells swept in the last `ms`, more of them the fresher the cell, on the same texels.
function paintFresh(ctx, field, view, L, dot, pale, w, {now, ms}, ts) {
  const k = view.k, t = Math.max(1, Math.round(ts));
  const centres = [], arms = [];
  field.forEach((i, j, s, born) => {
    const age = now - born; if (!(age >= 0 && age < ms)) return;
    if (rankAt(i, j) >= 0.12 * (1 - age / ms)) return;
    const x = Math.round(2 * i * ts - view.ox * k), y = Math.round(2 * j * ts - view.oy * k);
    centres.push(x, y);
    arms.push(x - t, y, x + t, y, x, y - t, x, y + t);
    if (age < ms * 0.5) arms.push(x - 2 * t, y, x + 2 * t, y, x, y - 2 * t, x, y + 2 * t);
  }, w);
  if (!centres.length) return;
  ctx.fillStyle = `rgb(${dot[0]},${dot[1]},${dot[2]})`; ctx.beginPath();
  for (let q = 0; q < arms.length; q += 2) ctx.rect(arms[q], arms[q + 1], t, t);
  ctx.fill();
  ctx.fillStyle = `rgb(${pale[0]},${pale[1]},${pale[2]})`; ctx.beginPath();
  for (let q = 0; q < centres.length; q += 2) ctx.rect(centres[q], centres[q + 1], t, t);
  ctx.fill();
}
