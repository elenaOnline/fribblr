// Pointing mode's pixel snap source (team/pointing/CONTRACT.md § Round 2, "The snap-source seam";
// team/pointing/spike2/SNAP.md for what it does on real pictures and where it falls back).
//
// Inside a picture there are no elements, only edges. This source tidies a gesture to a region bounded by edges, the
// way image editors do, and only when the edges are clear; otherwise it answers null and the user's drawn shape stands.
//
// - a click: a magic wand with an edge-aware tolerance. The minimax ("barrier") distance from the clicked spot over
//   the colour gradient gives every pixel the lowest edge it must cross to be reached; the region kept is the most
//   stable one (its area changes least as the tolerance rises: a maximally stable region), tried in a small window at
//   full detail first and in wider, coarser windows when the region runs past the window.
// - a marquee or lasso: a marker-controlled watershed. The gesture's core is the object, everything outside it is
//   background, and pixels inside it whose colour matches the background better than the core (a colour-histogram
//   likelihood ratio, GrabCut's idea without the graph cut) become background too; the two then flood the gradient
//   and meet on the strongest edge between them.
// - a wand swath: the wand from points along the stroke; the region that holds most of the stroke.
// Each answer carries a confidence from the edge's contrast against the texture on either side, the colour separation
// inside and outside, the area's stability, and whether the outline merely ran to the user's line (no edge found).
//
//   import {pixelSnap} from './pointing-snap-pixels.js';
//   pixelSnap.prepare(item, el)                       // first hover / entering the mode: decodes and caches (async)
//   pixelSnap.onReady = (answer, request) => …        // a worker answer arrived (re-propose to show it)
//   pixelSnap.propose({kind, geometry, item, el})     // sync: the answer for this gesture if the worker has it, else
//                                                     //   null now and onReady later  -> {shape, label, source: 'pixels', score} | null
//   pixelSnap.proposeAsync({…})                       // -> Promise of the same
//   pixelSnap.ready(item, el)                         // true once prepared (an answer then takes one worker trip)
//
// Coordinates are image pixels of the file (CONTRACT "content": `unit: 'px'`), both ways. The work runs in a module
// worker (pointing-snap-pixels-worker.js); without one it runs on the main thread. Everything above the "source"
// line is pure (typed arrays in, typed arrays out) and is what the worker and the tests import.

// ================================================================ pure: fields

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const fLab = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
export const G8 = 8; // gradient (ΔE per pixel) to the 0..255 levels the floods use

// RGBA (Uint8ClampedArray, w*h*4) -> {w, h, L, A, B, g, g8}: CIELAB blurred by a 5-tap binomial (σ ≈ 1), and the colour
// gradient magnitude (Sobel on each Lab channel, combined) in ΔE per pixel, also quantised for the bucket queues.
// Transparent pixels count as white paper (pictures on a card sit on paper).
export function fieldFromRGBA(data, w, h) {
  const n = w * h, L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const al = data[j + 3] / 255;
    const r = LIN[data[j]] * al + (1 - al), g = LIN[data[j + 1]] * al + (1 - al), b = LIN[data[j + 2]] * al + (1 - al);
    const x = fLab((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = fLab(0.2126 * r + 0.7152 * g + 0.0722 * b), z = fLab((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    L[i] = 116 * y - 16; A[i] = 500 * (x - y); B[i] = 200 * (y - z);
  }
  const tmp = new Float32Array(n);
  for (const ch of [L, A, B]) blur5(ch, tmp, w, h);
  const g = new Float32Array(n), g8 = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : 0, yp = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0, xp = x < w - 1 ? x + 1 : w - 1;
      let s = 0;
      for (const c of [L, A, B]) {
        const a = c[ym * w + xm], b = c[ym * w + x], cc = c[ym * w + xp], d = c[y * w + xm], f = c[y * w + xp], gg = c[yp * w + xm], hh = c[yp * w + x], ii = c[yp * w + xp];
        const gx = (cc + 2 * f + ii - a - 2 * d - gg) / 8, gy = (gg + 2 * hh + ii - a - 2 * b - cc) / 8;
        s += gx * gx + gy * gy;
      }
      const v = Math.sqrt(s), k = y * w + x;
      g[k] = v; g8[k] = Math.min(255, Math.round(v * G8));
    }
  }
  return {w, h, L, A, B, g, g8};
}

function blur5(c, t, w, h) {
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      const a = c[o + Math.max(0, x - 2)], b = c[o + Math.max(0, x - 1)], d = c[o + Math.min(w - 1, x + 1)], e = c[o + Math.min(w - 1, x + 2)];
      t[o + x] = (a + 4 * b + 6 * c[o + x] + 4 * d + e) / 16;
    }
  }
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - 2) * w, yb = Math.max(0, y - 1) * w, yd = Math.min(h - 1, y + 1) * w, ye = Math.min(h - 1, y + 2) * w, o = y * w;
    for (let x = 0; x < w; x++) c[o + x] = (t[ya + x] + 4 * t[yb + x] + 6 * t[o + x] + 4 * t[yd + x] + t[ye + x]) / 16;
  }
}

// A window of an RGBA image (copy), and a 2× box downsample, for the pyramid.
export function cropRGBA(data, w, h, x0, y0, cw, ch) {
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) out.set(data.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x0 + cw) * 4), y * cw * 4);
  return out;
}
export function halveRGBA(data, w, h) {
  const W = Math.max(1, w >> 1), H = Math.max(1, h >> 1), out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = ((2 * y) * w + 2 * x) * 4, b = a + (2 * x + 1 < w ? 4 : 0), c = a + (2 * y + 1 < h ? w * 4 : 0), d = c + (2 * x + 1 < w ? 4 : 0), o = (y * W + x) * 4;
    for (let k = 0; k < 4; k++) out[o + k] = (data[a + k] + data[b + k] + data[c + k] + data[d + k] + 2) >> 2;
  }
  return {data: out, w: W, h: H};
}

// ================================================================ pure: masks

export function fillPolygonMask(w, h, pts) {
  const m = new Uint8Array(w * h), n = pts.length;
  for (let j = 0; j < h; j++) {
    const y = j + .5, xs = [];
    for (let a = 0, b = n - 1; a < n; b = a++) { const [xa, ya] = pts[a], [xb, yb] = pts[b]; if ((ya > y) !== (yb > y)) xs.push(xa + (y - ya) / (yb - ya) * (xb - xa)); }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) { const s = Math.max(0, Math.ceil(xs[k] - .5)), e = Math.min(w - 1, Math.floor(xs[k + 1] - .5)); for (let i = s; i <= e; i++) m[j * w + i] = 1; }
  }
  return m;
}
export function rectMask(w, h, x, y, rw, rh) {
  const m = new Uint8Array(w * h);
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y)), x1 = Math.min(w, Math.round(x + rw)), y1 = Math.min(h, Math.round(y + rh));
  for (let j = y0; j < y1; j++) m.fill(1, j * w + x0, j * w + x1);
  return m;
}

// Chamfer (3-4) distance to the nearest 0 pixel, in pixels (approximate Euclidean).
export function distanceInside(m, w, h) {
  const BIG = 1e9, d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = m[i] ? BIG : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!d[i]) continue; let v = d[i];
    v = Math.min(v, x > 0 ? d[i - 1] + 3 : 3, y > 0 ? d[i - w] + 3 : 3, x > 0 && y > 0 ? d[i - w - 1] + 4 : 4, x < w - 1 && y > 0 ? d[i - w + 1] + 4 : 4); d[i] = v; }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; if (!d[i]) continue; let v = d[i];
    v = Math.min(v, x < w - 1 ? d[i + 1] + 3 : 3, y < h - 1 ? d[i + w] + 3 : 3, x < w - 1 && y < h - 1 ? d[i + w + 1] + 4 : 4, x > 0 && y < h - 1 ? d[i + w - 1] + 4 : 4); d[i] = v; }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

// Fill the holes of a mask (anything not reachable from the border through 0s), in place.
export function fillHoles(m, w, h) {
  const seen = new Uint8Array(w * h), st = [];
  const push = i => { if (!m[i] && !seen[i]) { seen[i] = 1; st.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (st.length) { const i = st.pop(), x = i % w; if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (i >= w) push(i - w); if (i < w * (h - 1)) push(i + w); }
  for (let i = 0; i < m.length; i++) if (!m[i] && !seen[i]) m[i] = 1;
  return m;
}

// Keep only the 4-connected components of m that contain a pixel of `keep` (or the largest, without one), in place.
export function keepComponents(m, w, h, keep = null) {
  const lab = new Int32Array(w * h), sizes = [0], hits = [false];
  let next = 0;
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || lab[s]) continue;
    next++; let size = 0, hit = false; const st = [s]; lab[s] = next;
    while (st.length) { const i = st.pop(); size++; if (keep && keep[i]) hit = true; const x = i % w;
      for (const q of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (q >= 0 && q < m.length && m[q] && !lab[q]) { lab[q] = next; st.push(q); } }
    sizes.push(size); hits.push(hit);
  }
  let best = 0; for (let c = 1; c <= next; c++) if (!best || sizes[c] > sizes[best]) best = c;
  const anyHit = hits.some(Boolean);
  for (let i = 0; i < m.length; i++) if (m[i] && !(anyHit ? hits[lab[i]] : lab[i] === best)) m[i] = 0;
  return m;
}

// The outer boundary of a mask's first component in raster order, as polygon corners (marching squares perimeter).
export function traceOutline(m, w, h) {
  let start = -1; for (let i = 0; i < m.length; i++) if (m[i]) { start = i; break; }
  if (start < 0) return [];
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] ? 1 : 0;
  const sx = start % w, sy = (start / w) | 0;
  let x = sx, y = sy, prev = 0, pts = [];
  const UP = 1, DOWN = 2, LEFT = 3, RIGHT = 4;
  for (let guard = 0; guard < 4 * (w + h) * 8 + 16; guard++) {
    const sv = at(x - 1, y - 1) | (at(x, y - 1) << 1) | (at(x - 1, y) << 2) | (at(x, y) << 3);
    let step;
    switch (sv) {
      case 1: case 5: case 13: step = UP; break;
      case 8: case 10: case 11: step = DOWN; break;
      case 4: case 12: case 14: step = LEFT; break;
      case 2: case 3: case 7: step = RIGHT; break;
      case 6: step = prev === UP ? LEFT : RIGHT; break;
      case 9: step = prev === RIGHT ? UP : DOWN; break;
      default: return pts;
    }
    if (step !== prev) pts.push([x, y]);
    prev = step;
    if (step === UP) y--; else if (step === DOWN) y++; else if (step === LEFT) x--; else x++;
    if (x === sx && y === sy) break;
  }
  return pts;
}

// One round of Chaikin corner cutting on a closed polygon.
export function chaikin(pts) {
  if (pts.length < 3) return pts;
  const out = [];
  for (let i = 0; i < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length]; out.push([.75 * ax + .25 * bx, .75 * ay + .25 * by], [.25 * ax + .75 * bx, .25 * ay + .75 * by]); }
  return out;
}

// Douglas–Peucker on a closed polygon.
export function simplifyClosed(pts, eps) {
  if (pts.length < 4) return pts;
  // split at the two farthest-apart points so each half is an open polyline
  let a = 0, b = 0, best = -1;
  for (let i = 0; i < pts.length; i++) { const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2; if (d > best) { best = d; b = i; } }
  const open = (s, e) => { const seg = []; for (let i = s; ; i = (i + 1) % pts.length) { seg.push(pts[i]); if (i === e) break; } return dp(seg, eps); };
  const one = open(a, b), two = open(b, a);
  return [...one.slice(0, -1), ...two.slice(0, -1)];
}
function dp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
  let idx = 0, far = -1;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > far) { far = d; idx = i; } }
  if (far <= eps) return [pts[0], pts[pts.length - 1]];
  const l = dp(pts.slice(0, idx + 1), eps), r = dp(pts.slice(idx), eps);
  return [...l.slice(0, -1), ...r];
}

// ================================================================ pure: bucket queue

class Buckets {
  constructor() { this.b = Array.from({length: 256}, () => []); this.cur = 0; this.size = 0; }
  push(level, i) { this.b[level].push(i); this.size++; if (level < this.cur) this.cur = level; }
  pop() { while (this.cur < 256 && !this.b[this.cur].length) this.cur++; if (this.cur >= 256) return -1; this.size--; return this.b[this.cur].pop(); }
}

// ================================================================ pure: the wand (a click)

// Minimax ("barrier") levels from a seed: the lowest maximum of cost along any 4-connected path from the seed, where a
// pixel's cost is the larger of its gradient level and its colour distance to the seed's colour (scaled by `alpha`,
// so a slow ramp cannot leak where no edge stands). O(n) with a bucket queue.
export function barrierLevels(F, sx, sy, {alpha = 2} = {}) {
  const {w, h, L, A, B, g8} = F, n = w * h;
  let l0 = 0, a0 = 0, b0 = 0, k = 0;
  for (let y = Math.max(0, sy - 1); y <= Math.min(h - 1, sy + 1); y++) for (let x = Math.max(0, sx - 1); x <= Math.min(w - 1, sx + 1); x++) { const i = y * w + x; l0 += L[i]; a0 += A[i]; b0 += B[i]; k++; }
  l0 /= k; a0 /= k; b0 /= k;
  const cost = i => { const d = Math.sqrt((L[i] - l0) ** 2 + (A[i] - a0) ** 2 + (B[i] - b0) ** 2); return Math.max(g8[i], Math.min(255, Math.round(d * alpha))); };
  const level = new Uint8Array(n).fill(255), done = new Uint8Array(n), hist = new Float64Array(256);
  const q = new Buckets(), s = sy * w + sx;
  level[s] = 0; q.push(0, s);
  for (let i; (i = q.pop()) >= 0;) {
    if (done[i]) continue; done[i] = 1;
    const cur = level[i]; hist[cur]++;
    const x = i % w;
    for (const nb of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < n - w ? i + w : -1]) {
      if (nb < 0 || done[nb]) continue;
      const c = Math.max(cur, cost(nb));
      if (c < level[nb]) { level[nb] = c; q.push(c, nb); }
    }
  }
  return {level, hist};
}

// The wand's region in a field: the maximally stable level set of the barrier levels from (sx, sy) with an area in
// [minArea, maxArea]. Returns {mask, level, stability, touchesEdge, area} or null.
export function wandField(F, sx, sy, {minArea = 48, maxFrac = .8, delta = 12, alpha = 2} = {}) {
  const {w, h} = F, n = w * h;
  sx = Math.max(0, Math.min(w - 1, Math.round(sx))); sy = Math.max(0, Math.min(h - 1, Math.round(sy)));
  const {level, hist} = barrierLevels(F, sx, sy, {alpha});
  const cum = new Float64Array(256); let acc = 0; for (let l = 0; l < 256; l++) { acc += hist[l]; cum[l] = acc; }
  let edgeMin = 255; // the lowest level at which the region reaches the window's edge
  for (let x = 0; x < w; x++) edgeMin = Math.min(edgeMin, level[x], level[(h - 1) * w + x]);
  for (let y = 0; y < h; y++) edgeMin = Math.min(edgeMin, level[y * w], level[y * w + w - 1]);
  const maxArea = maxFrac * n, full = !!F.full;
  // The tolerance must at least clear the picture's own texture here (half the window's pixels are smoother than it),
  // or every speck of noise is a "stable" region.
  const gh = new Float64Array(256); for (let i = 0; i < n; i++) gh[F.g8[i]]++;
  let floor = 0; for (let acc2 = 0; floor < 255 && (acc2 += gh[floor]) < n * .5; floor++);
  floor = Math.min(200, Math.round(floor * 1.5) + 2);
  // The most stable level set (MSER): its area changes least as the tolerance moves by ±delta.
  let best = -1, bestS = Infinity;
  for (let l = floor; l < 254; l++) {
    const a = cum[l]; if (a < minArea || a > maxArea) continue;
    const s = (cum[Math.min(255, l + delta)] - cum[Math.max(0, l - delta)]) / a;
    if (s < bestS - 1e-9) { bestS = s; best = l; }
  }
  if (best < 0) return null;
  let top = best; while (top < 254 && cum[top + 1] <= cum[best] * 1.04) top++;
  let breakAt = top + 1; while (breakAt < 255 && cum[breakAt] < 1.5 * cum[top]) breakAt++;
  const bestR = breakAt - top;
  const mask = new Uint8Array(n); for (let i = 0; i < n; i++) if (level[i] <= top) mask[i] = 1;
  return {mask, level: top, stability: bestS, breakout: bestR, touchesEdge: top >= edgeMin, area: cum[top]};
}

// ================================================================ pure: the watershed (a marquee or lasso)

const HB = {l: 8, ab: 12};
function binOf(F, i) {
  const l = Math.min(HB.l - 1, Math.max(0, (F.L[i] / 100 * HB.l) | 0));
  const a = Math.min(HB.ab - 1, Math.max(0, ((F.A[i] + 60) / 120 * HB.ab) | 0)), b = Math.min(HB.ab - 1, Math.max(0, ((F.B[i] + 60) / 120 * HB.ab) | 0));
  return (l * HB.ab + a) * HB.ab + b;
}
function histogram(F, pick) {
  const H = new Float64Array(HB.l * HB.ab * HB.ab); let n = 0;
  for (let i = 0; i < F.w * F.h; i++) if (pick(i)) { H[binOf(F, i)]++; n++; }
  // a little smoothing over neighbouring lightness bins, then normalise
  const S = new Float64Array(H.length), P = HB.ab * HB.ab;
  for (let k = 0; k < H.length; k++) S[k] = H[k] * .6 + (k >= P ? H[k - P] * .2 : 0) + (k + P < H.length ? H[k + P] * .2 : 0);
  for (let k = 0; k < S.length; k++) S[k] = (S[k] + .01) / (n + .01 * S.length);
  return {H: S, n};
}
const bhattacharyya = (p, q) => { let s = 0; for (let k = 0; k < p.length; k++) s += Math.sqrt(p[k] * q[k]); return s; };

// Meyer's flooding from labelled seeds (1 = object, 2 = background) over g8. Every pixel ends labelled.
export function watershed(F, labels) {
  const {w, h, g8} = F, n = w * h, q = new Buckets();
  const queued = new Uint8Array(n);
  const near = i => { const x = i % w; return [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < n - w ? i + w : -1]; };
  for (let i = 0; i < n; i++) if (labels[i]) for (const nb of near(i)) if (nb >= 0 && !labels[nb] && !queued[nb]) { queued[nb] = 1; q.push(g8[nb], nb); }
  for (let i; (i = q.pop()) >= 0;) {
    if (labels[i]) continue;
    // the label of the neighbour across the lowest gradient
    let lab = 0, lo = 256;
    for (const nb of near(i)) if (nb >= 0 && labels[nb] && g8[nb] < lo) { lo = g8[nb]; lab = labels[nb]; }
    labels[i] = lab || 2;
    for (const nb of near(i)) if (nb >= 0 && !labels[nb] && !queued[nb]) { queued[nb] = 1; q.push(Math.max(q.cur, g8[nb]), nb); }
  }
  return labels;
}

// The region a marquee/lasso gesture (mask `gm`, same size as F) encloses, snapped to edges, with the measures that
// decide whether to trust it. Returns {mask, measures} or null.
export function outlineField(F, gm, {coreFrac = .45, seedRatio = 8} = {}) {
  const {w, h} = F, n = w * h;
  const din = distanceInside(gm, w, h);
  let maxD = 0, gArea = 0; for (let i = 0; i < n; i++) { if (din[i] > maxD) maxD = din[i]; if (gm[i]) gArea++; }
  if (maxD < 3 || gArea < 64) return null;
  const outside = new Uint8Array(n); for (let i = 0; i < n; i++) outside[i] = gm[i] ? 0 : 1;
  const dout = distanceInside(outside, w, h);
  const band = Math.max(4, .12 * Math.sqrt(gArea));
  const core = i => din[i] >= coreFrac * maxD;
  const inBand = i => !gm[i] && dout[i] <= band;
  const bg0 = histogram(F, inBand);
  if (bg0.n < 16) return null; // the gesture fills the picture: no background to tell the object from
  let fg0 = histogram(F, core);
  // GrabCut's first step: the core's background-coloured pixels are not object evidence.
  const ratio = (fg, i) => { const k = binOf(F, i); return fg.H[k] / bg0.H[k]; };
  fg0 = histogram(F, i => core(i) && ratio(fg0, i) >= 1);
  if (fg0.n < 8) return null;
  const labels = new Uint8Array(n);
  let fgSeeds = 0;
  for (let i = 0; i < n; i++) {
    if (!gm[i]) { labels[i] = 2; continue; }
    const r = ratio(fg0, i);
    if (core(i) && r >= 1) { labels[i] = 1; fgSeeds++; }
    else if (r <= 1 / seedRatio && din[i] < coreFrac * maxD) labels[i] = 2;
    else if (r >= seedRatio) { labels[i] = 1; fgSeeds++; }
  }
  if (!fgSeeds) return null;
  const coreMask = new Uint8Array(n); for (let i = 0; i < n; i++) coreMask[i] = labels[i] === 1 && core(i) ? 1 : 0;
  watershed(F, labels);
  const mask = new Uint8Array(n); for (let i = 0; i < n; i++) mask[i] = labels[i] === 1 ? 1 : 0;
  keepComponents(mask, w, h, coreMask); fillHoles(mask, w, h);
  return {mask, measures: measure(F, mask, {gm, din, band, dout})};
}

// How much to trust a region: edge contrast against texture, colour separation, whether it only ran to the user's line.
export function measure(F, mask, {gm = null, din = null, band = 6, dout = null} = {}) {
  const {w, h, g} = F, n = w * h;
  const edge = [], tex = [];
  let area = 0, hug = 0, edgeN = 0, imgEdge = 0;
  const notMask = new Uint8Array(n); for (let i = 0; i < n; i++) notMask[i] = mask[i] ? 0 : 1;
  const dIn = distanceInside(mask, w, h), dOut = distanceInside(notMask, w, h);
  for (let i = 0; i < n; i++) {
    const x = i % w, y = (i / w) | 0;
    if (mask[i]) {
      area++;
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (dIn[i] <= 1) {
        if (border) { imgEdge++; continue; }
        edgeN++;
        // the edge's strength: the strongest gradient within a pixel of the boundary
        let m = g[i]; for (const q of [i - 1, i + 1, i - w, i + w]) if (q >= 0 && q < n && g[q] > m) m = g[q];
        edge.push(m);
        if (gm && din && din[i] <= 2.5) hug++;
      } else if (dIn[i] >= 3) tex.push(g[i]);
    } else if (dOut[i] >= 3 && dOut[i] <= 3 + band) tex.push(g[i]);
  }
  if (!edge.length) return {area, contrast: 0, separation: 0, hug: 1, edgeShare: imgEdge / Math.max(1, imgEdge + edgeN)};
  const med = a => { a.sort((p, q) => p - q); return a[a.length >> 1] || 0; };
  const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))] || 0;
  const em = med(edge), tm = med(tex.length ? tex : [0]), t75 = pct(tex, .75);
  const fgH = histogram(F, i => mask[i] && dIn[i] >= 2), bgH = histogram(F, i => !mask[i] && dOut[i] >= 2 && dOut[i] <= 2 + 2 * band);
  return {area, edge: em, texture: tm, texture75: t75, contrast: em / (t75 + 1), separation: 1 - bhattacharyya(fgH.H, bgH.H), hug: hug / edge.length, edgeShare: imgEdge / Math.max(1, imgEdge + edgeN)};
}

// Measures -> a confidence 0..1 (the thresholds were read off the spike's pictures; SNAP.md).
export function confidence(m, {kind = 'outline', stability = 0} = {}) {
  const c01 = v => Math.max(0, Math.min(1, v));
  const contrast = c01((m.contrast - 1.3) / 2.7), sep = c01((m.separation - .25) / .55), loose = 1 - c01((m.hug - .15) / .45);
  let s = kind === 'wand'
    ? .5 * contrast + .3 * sep + .2 * c01(1 - stability / .6)
    : .45 * contrast + .3 * sep + .25 * loose;
  if (kind !== 'wand' && m.hug > .6) s *= .5; // the outline is mostly the user's own line: no edge was found
  if (kind !== 'wand' && m.separation < .5) s = Math.min(s, .45); // inside and outside share their colours: a guess
  return Math.round(c01(s) * 100) / 100;
}

// ================================================================ pure: pyramid + proposals (image px in, image px out)

const WORK_MAX = 1600;  // the finest level's longest side
const WIN = 256;        // the wand's window, in pixels of a level
const OUTLINE_MAX = 384;

// A picture prepared for proposals: an RGBA pyramid (level 0 at most WORK_MAX px a side, each next level half), with
// fields computed per window on demand.
export class PixelPicture {
  constructor(data, w, h, naturalW = w, naturalH = h) {
    this.levels = [{data, w, h}];
    while (Math.max(this.levels.at(-1).w, this.levels.at(-1).h) > 160) { const l = this.levels.at(-1); this.levels.push(halveRGBA(l.data, l.w, l.h)); }
    this.nw = naturalW; this.nh = naturalH;
  }
  // image px per level-k px
  scale(k) { return this.nw / this.levels[k].w; }
  field(k, x0, y0, cw, ch) {
    const l = this.levels[k];
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); cw = Math.min(l.w - x0, Math.ceil(cw)); ch = Math.min(l.h - y0, Math.ceil(ch));
    const F = fieldFromRGBA(cropRGBA(l.data, l.w, l.h, x0, y0, cw, ch), cw, ch);
    F.x0 = x0; F.y0 = y0; F.k = k; F.full = x0 === 0 && y0 === 0 && cw === l.w && ch === l.h;
    return F;
  }
  bytes() { return this.levels.reduce((s, l) => s + l.data.byteLength, 0); }
}

const LABEL = 'region in the picture';

function regionAnswer(pic, F, mask, score, extra = {}) {
  const k = pic.scale(F.k);
  const corners = traceOutline(mask, F.w, F.h);
  // pixel stairs -> a smooth outline: simplify, round the corners once (Chaikin), simplify again to ≤ 200 points
  let pts = chaikin(simplifyClosed(corners, 1));
  for (let eps = .35; pts.length > 200; eps *= 1.6) pts = simplifyClosed(pts, eps);
  if (pts.length < 3) return null;
  // A region that fills its bounding box (a dialog, a button, a panel in a screenshot) is that box.
  let area = 0; for (let i = 0; i < mask.length; i++) area += mask[i];
  let rx0 = Infinity, ry0 = Infinity, rx1 = -Infinity, ry1 = -Infinity;
  for (const [x, y] of corners) { rx0 = Math.min(rx0, x); ry0 = Math.min(ry0, y); rx1 = Math.max(rx1, x); ry1 = Math.max(ry1, y); }
  if (area >= .82 * (rx1 - rx0) * (ry1 - ry0)) {
    const x = round1((rx0 + F.x0) * k), y = round1((ry0 + F.y0) * k), w = round1((rx1 - rx0) * k), h = round1((ry1 - ry0) * k);
    return {shape: {kind: 'rect', x, y, w, h}, box: {x, y, w, h}, label: LABEL, source: 'pixels', score, ...extra};
  }
  const points = pts.map(([x, y]) => [round1((x + F.x0) * k), round1((y + F.y0) * k)]);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return {shape: {kind: 'path', points}, box: {x: x0, y: y0, w: x1 - x0, h: y1 - y0}, label: LABEL, source: 'pixels', score, ...extra};
}

// A click at (x, y) image px. Small window at full detail first; wider and coarser while the region runs past it.
export function proposeClick(pic, x, y, {threshold = .6, debug = false} = {}) {
  const tries = [];
  for (let k = 0; k < pic.levels.length; k++) {
    const l = pic.levels[k], s = pic.scale(k), px = x / s, py = y / s;
    const full = l.w <= WIN * 1.6 && l.h <= WIN * 1.6;
    const F = full ? pic.field(k, 0, 0, l.w, l.h) : pic.field(k, px - WIN / 2, py - WIN / 2, WIN, WIN);
    const r = wandField(F, px - F.x0, py - F.y0, {minArea: Math.max(64, F.w * F.h * .004), maxFrac: F.full ? .45 : .8});
    tries.push({k, full: F.full, found: !!r?.mask, touches: r?.touchesEdge, area: r?.area, breakout: r?.breakout});
    if (!r) { if (F.full) break; continue; }
    if (r.touchesEdge && !F.full) continue;
    fillHoles(r.mask, F.w, F.h);
    const m = measure(F, r.mask);
    // A region running along most of the picture's border is the background the user clicked through, not a thing.
    if (F.full && borderShare(r.mask, F.w, F.h) > .3) return debug ? {answer: null, candidate: regionAnswer(pic, F, r.mask, 0), why: 'background', tries, m} : null;
    const score = confidence(m, {kind: 'wand', stability: r.stability});
    const ans = score >= threshold ? regionAnswer(pic, F, r.mask, score) : null;
    return debug ? {answer: ans, candidate: ans || regionAnswer(pic, F, r.mask, score), score, m, stability: r.stability, breakout: r.breakout, tries, why: ans ? 'ok' : 'low confidence'} : ans;
  }
  return debug ? {answer: null, why: 'no stable region', tries} : null;
}

// The share of the picture's border pixels inside the mask.
function borderShare(m, w, h) {
  let k = 0; for (let x = 0; x < w; x++) k += m[x] + m[(h - 1) * w + x];
  for (let y = 1; y < h - 1; y++) k += m[y * w] + m[y * w + w - 1];
  return k / (2 * w + 2 * h - 4);
}

// A marquee {x, y, w, h} or lasso [[x, y], …] in image px.
export function proposeOutline(pic, g, {threshold = .6, debug = false} = {}) {
  let bx0, by0, bx1, by1;
  if (g.kind === 'rect') { bx0 = g.x; by0 = g.y; bx1 = g.x + g.w; by1 = g.y + g.h; }
  else { bx0 = by0 = Infinity; bx1 = by1 = -Infinity; for (const [px, py] of g.points) { bx0 = Math.min(bx0, px); by0 = Math.min(by0, py); bx1 = Math.max(bx1, px); by1 = Math.max(by1, py); } }
  const gw = bx1 - bx0, gh = by1 - by0; if (!(gw > 4 && gh > 4)) return null;
  const mx = gw * .3 + 8 * pic.scale(0), my = gh * .3 + 8 * pic.scale(0);
  // the finest level at which the gesture and its surroundings fit in OUTLINE_MAX px
  let k = 0; while (k < pic.levels.length - 1 && Math.max(gw + 2 * mx, gh + 2 * my) / pic.scale(k) > OUTLINE_MAX) k++;
  const s = pic.scale(k);
  const F = pic.field(k, (bx0 - mx) / s, (by0 - my) / s, (gw + 2 * mx) / s, (gh + 2 * my) / s);
  const local = ([px, py]) => [px / s - F.x0, py / s - F.y0];
  const gm = g.kind === 'rect' ? rectMask(F.w, F.h, g.x / s - F.x0, g.y / s - F.y0, g.w / s, g.h / s) : fillPolygonMask(F.w, F.h, g.points.map(local));
  const r = outlineField(F, gm);
  if (!r) return debug ? {answer: null, why: 'no core or no background'} : null;
  const score = confidence(r.measures, {kind: 'outline'});
  const area = r.measures.area / Math.max(1, gm.reduce((a, b) => a + b, 0));
  const fits = area >= .04 && area <= .98;
  const ans = score >= threshold && fits ? regionAnswer(pic, F, r.mask, score) : null;
  return debug ? {answer: ans, candidate: ans || regionAnswer(pic, F, r.mask, score), score, m: r.measures, areaShare: area, why: ans ? 'ok' : fits ? 'low confidence' : 'area'} : ans;
}

// A wand swath {width, points} in image px: the wand from three points along the stroke; the region that holds
// most of the stroke's centre line wins, if it holds at least 60 % of it.
export function proposeSwath(pic, g, {threshold = .6, debug = false} = {}) {
  const pts = g.points || []; if (pts.length < 2) return null;
  const seeds = [.5, .25, .75].map(u => pts[Math.min(pts.length - 1, Math.round(u * (pts.length - 1)))]);
  let best = null;
  for (const [sx, sy] of seeds) {
    const r = proposeClick(pic, sx, sy, {threshold, debug: true});
    if (!r.answer) continue;
    const sh = r.answer.shape, poly = sh.kind === 'rect' ? [[sh.x, sh.y], [sh.x + sh.w, sh.y], [sh.x + sh.w, sh.y + sh.h], [sh.x, sh.y + sh.h]] : sh.points;
    const held = pts.filter(([x, y]) => pointInPolygon(x, y, poly)).length / pts.length;
    if (!best || held > best.held) best = {answer: r.answer, held};
    if (held >= .8) break;
  }
  const ans = best && best.held >= .6 ? {...best.answer, score: Math.round(best.answer.score * (.7 + .3 * best.held) * 100) / 100} : null;
  return debug ? {answer: ans, held: best?.held ?? 0} : ans;
}

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function proposePixels(pic, kind, g, opts) {
  if (kind === 'point') return proposeClick(pic, g.x, g.y, opts);
  if (kind === 'rect' || kind === 'path') return proposeOutline(pic, {...g, kind}, opts);
  if (kind === 'swath') return proposeSwath(pic, g, opts);
  return null;
}

const round1 = v => Math.round(v * 10) / 10;

// ================================================================ source (browser only below)

// The picture an item shows in `el` (a card, an <img>, or the reader's frame): {url, img} or null. Only same-origin
// pictures can be read (a remote preview taints the canvas): null for those.
export function pictureOf(item, el) {
  let img = el?.tagName === 'IMG' ? el : el?.querySelector?.('.workspace-card-preview img');
  if (!img && el?.tagName === 'IFRAME') {
    try {
      let doc = el.contentDocument;
      const inner = doc?.querySelector('#item-content > iframe.item-full-frame'); if (inner) doc = inner.contentDocument;
      img = doc?.querySelector('.image-stage img, video[poster]') || null;
    } catch { img = null; }
  }
  if (!img) return null;
  const url = img.currentSrc || img.src || img.poster;
  try { if (new URL(url, location.href).origin !== location.origin) return null; } catch { return null; }
  return {url, img};
}

let worker = null, workerFailed = false, seq = 0;
const pending = new Map();
function getWorker() {
  if (worker || workerFailed || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./pointing-snap-pixels-worker.js', import.meta.url), {type: 'module'});
    worker.onmessage = e => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.result); } };
    worker.onerror = () => { workerFailed = true; worker = null; for (const p of pending.values()) p.reject(new Error('worker failed')); pending.clear(); };
  } catch { workerFailed = true; worker = null; }
  return worker;
}
function ask(msg, transfer = []) {
  const w = getWorker(); if (!w) return null;
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, {resolve, reject}); w.postMessage({...msg, id}, transfer); });
}

// Decode a same-origin picture to RGBA at ≤ WORK_MAX px a side (the browser's own resampling).
async function decode(url) {
  const blob = await (await fetch(url, {cache: 'force-cache'})).blob();
  const bmp = await createImageBitmap(blob);
  const nw = bmp.width, nh = bmp.height, k = Math.min(1, WORK_MAX / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * k)), h = Math.max(1, Math.round(nh * k));
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), {width: w, height: h});
  const g = canvas.getContext('2d', {willReadFrequently: true});
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h); bmp.close?.();
  return {data: g.getImageData(0, 0, w, h).data, w, h, nw, nh};
}

// Two ways to ask. `proposeAsync` resolves with the answer. `propose` fits the mode's synchronous seam: it answers at
// once with the last worker answer when that was for (nearly) this gesture, else null, and asks the worker for this
// gesture (latest wins while one is in flight); when the answer arrives `onReady(answer, request)` is called so the
// mode can show the snapped outline (and call `propose` again, which then returns it).
// The card's own decoded <img> drawn at ≤ WORK_MAX px a side (main thread; null if tainted or not loaded).
function drawImg(img) {
  if (!img?.naturalWidth) return null;
  const nw = img.naturalWidth, nh = img.naturalHeight, vector = /\.svgz?(?:$|[?#])|^data:image\/svg/i.test(img.currentSrc || img.src);
  // a vector picture has no pixels of its own: draw it at 1600 px on its long side
  const k = vector ? WORK_MAX / Math.max(nw, nh) : Math.min(1, WORK_MAX / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * k)), h = Math.max(1, Math.round(nh * k));
  try {
    const c = Object.assign(document.createElement('canvas'), {width: w, height: h}), g = c.getContext('2d', {willReadFrequently: true});
    g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, w, h);
    return {data: g.getImageData(0, 0, w, h).data, w, h, nw, nh};
  } catch { return null; }
}

export function createPixelSnap({threshold = .6, onReady = null} = {}) {
  const prepared = new Map(); // url -> Promise<{nw, nh}> (worker) or Promise<PixelPicture> (main thread)
  const done = new Set();
  const prepare = (item, el) => {
    const p = pictureOf(item, el); if (!p) return null;
    if (!prepared.has(p.url)) {
      const job = (async () => {
        const w = getWorker();
        const url = new URL(p.url, location.href).href;
        if (w) {
          let r;
          try { r = await ask({type: 'prepare', url}); }
          catch {
            // a picture the worker cannot decode (an SVG: createImageBitmap has no document there) is drawn here
            // from the card's own <img>, once, and handed over
            const d = drawImg(p.img); if (!d) throw new Error('unreadable');
            r = await ask({type: 'adopt', url, ...d}, [d.data.buffer]);
          }
          done.add(p.url); return r;
        }
        const d = drawImg(p.img) || await decode(p.url); const pic = new PixelPicture(d.data, d.w, d.h, d.nw, d.nh); done.add(p.url); return pic;
      })();
      job.catch(() => prepared.delete(p.url));
      prepared.set(p.url, job);
    }
    return prepared.get(p.url);
  };
  const proposeAsync = async ({kind, geometry, item, el} = {}) => {
    kind = kind || geometry?.kind;
    const p = pictureOf(item, el); if (!p || !geometry) return null;
    try {
      const pic = await prepare(item, el); if (!pic) return null;
      if (pic instanceof PixelPicture) return proposePixels(pic, kind, geometry, {threshold});
      return await ask({type: 'propose', url: new URL(p.url, location.href).href, kind, geometry, threshold});
    } catch { return null; }
  };
  let last = null, inFlight = false, queued = null;
  const run = req => {
    inFlight = true;
    proposeAsync(req).then(answer => {
      last = {req, answer, url: pictureOf(req.item, req.el)?.url};
      inFlight = false;
      if (queued) { const q = queued; queued = null; run(q); }
      api.onReady?.(answer, req);
    });
  };
  const api = {
    onReady,
    prepare: (item, el) => (prepare(item, el) || Promise.resolve(null)).catch(() => null),
    ready(item, el) { const p = pictureOf(item, el); return !!p && done.has(p.url); },
    proposeAsync,
    propose(req = {}) {
      const kind = req.kind || req.geometry?.kind, p = pictureOf(req.item, req.el);
      if (!p || !req.geometry) return null;
      const r = {...req, kind};
      if (last && last.url === p.url && sameGesture(last.req, r)) return last.answer;
      if (inFlight) queued = r; else run(r);
      return null;
    },
    forget(item, el) { const p = pictureOf(item, el); if (p) { prepared.delete(p.url); done.delete(p.url); if (last?.url === p.url) last = null; ask({type: 'forget', url: new URL(p.url, location.href).href}); } },
  };
  return api;
}

// Two requests for (nearly) the same gesture: same kind, and boxes overlapping ≥ 92 % (a click: within 4 px).
export function sameGesture(a, b) {
  if (a.kind !== b.kind) return false;
  const g = a.geometry, h = b.geometry;
  if (a.kind === 'point') return Math.hypot(g.x - h.x, g.y - h.y) <= 4;
  const bb = q => { if (q.w != null) return {x: q.x, y: q.y, w: q.w, h: q.h}; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of q.points || []) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return {x: x0, y: y0, w: x1 - x0, h: y1 - y0}; };
  const p = bb(g), o = bb(h);
  const ix = Math.max(0, Math.min(p.x + p.w, o.x + o.w) - Math.max(p.x, o.x)) * Math.max(0, Math.min(p.y + p.h, o.y + o.h) - Math.max(p.y, o.y));
  const u = p.w * p.h + o.w * o.h - ix;
  return u > 0 && ix / u >= .92;
}

export const pixelSnap = createPixelSnap();
export {decode as decodePicture};
