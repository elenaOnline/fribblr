// Pointing mode's geometry: what a gesture hit, in board units. No DOM here (tests import it).
//
// A candidate is {key, kind, id, x, y, w, h, line, frame} in board units: a card or a drawn element as rendered.
// `line` marks an arrow, `points` its drawn line in board units (see decide);
// `frame` marks a container or plain region (covered whole, it stands for what it holds).

const area = r => Math.max(0, r.w) * Math.max(0, r.h);
const round3 = v => Math.round(v * 1000) / 1000;
export function intersectRect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), r = Math.min(a.x + a.w, b.x + b.w), btm = Math.min(a.y + a.h, b.y + b.h);
  return r > x && btm > y ? {x, y, w: r - x, h: btm - y} : null;
}
/** Shoelace area of a closed polygon [[x, y], …] (absolute). */
export function polygonArea(points) {
  let s = 0;
  for (let i = 0, n = points.length; i < n; i++) { const [x1, y1] = points[i], [x2, y2] = points[(i + 1) % n]; s += x1 * y2 - x2 * y1; }
  return Math.abs(s) / 2;
}
export function polygonLength(points, closed = true) {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  if (closed && points.length > 2) s += Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]);
  return s;
}
export function boundsOf(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
}
/** Sutherland–Hodgman: the part of a polygon inside an axis-aligned box. */
export function clipPolygon(points, box) {
  const edges = [
    [p => p[0] >= box.x, (a, b) => { const t = (box.x - a[0]) / (b[0] - a[0]); return [box.x, a[1] + t * (b[1] - a[1])]; }],
    [p => p[0] <= box.x + box.w, (a, b) => { const X = box.x + box.w, t = (X - a[0]) / (b[0] - a[0]); return [X, a[1] + t * (b[1] - a[1])]; }],
    [p => p[1] >= box.y, (a, b) => { const t = (box.y - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), box.y]; }],
    [p => p[1] <= box.y + box.h, (a, b) => { const Y = box.y + box.h, t = (Y - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), Y]; }],
  ];
  let out = points;
  for (const [inside, cross] of edges) {
    const input = out; out = [];
    if (!input.length) break;
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cross(prev, cur)); out.push(cur); }
      else if (inside(prev)) out.push(cross(prev, cur));
    }
  }
  return out;
}
export function pointInPolygon([x, y], points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Ramer–Douglas–Peucker, then thinned to at most `max` points. */
export function simplify(points, tolerance = 1, max = 400) {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(), [ax, ay] = points[a], [bx, by] = points[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let worst = -1, at = -1;
    // A closed loop starts and ends at one point: distances are then measured from that point.
    for (let i = a + 1; i < b; i++) { const d = len < 1e-9 ? Math.hypot(points[i][0] - ax, points[i][1] - ay) : Math.abs(dy * points[i][0] - dx * points[i][1] + bx * ay - by * ax) / len; if (d > worst) { worst = d; at = i; } }
    if (worst > tolerance) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  let out = points.filter((_, i) => keep[i]);
  while (out.length > max) out = out.filter((_, i) => i % 2 === 0 || i === out.length - 1);
  return out;
}
const near = ([x, y], b, d) => x >= b.x - d && x <= b.x + b.w + d && y >= b.y - d && y <= b.y + b.h + d;
const regionOf = (part, box) => ({x: round3((part.x - box.x) / box.w), y: round3((part.y - box.y) / box.h), w: round3(part.w / box.w), h: round3(part.h / box.h)});
const inRect = ([x, y], r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
/** Whether segment p1–p2 meets segment p3–p4 (ends included). */
export function segmentsMeet(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (!d) return false;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
const rectEdges = r => { const a = [r.x, r.y], b = [r.x + r.w, r.y], c = [r.x + r.w, r.y + r.h], d = [r.x, r.y + r.h]; return [[a, b], [b, c], [c, d], [d, a]]; };
const polyEdges = points => points.map((p, i) => [p, points[(i + 1) % points.length]]);
// An arrow against a gesture, by its drawn line (`points`, a polyline in board units): 'enclosed' when every point is
// inside, 'crossed' when the line meets the gesture anywhere, else null.
function lineAgainst(points, inside, edges) {
  let all = true, any = false;
  for (const p of points) { if (inside(p)) any = true; else all = false; }
  if (all) return 'enclosed';
  if (any) return 'crossed';
  for (let i = 1; i < points.length; i++) for (const [a, b] of edges) if (segmentsMeet(points[i - 1], points[i], a, b)) return 'crossed';
  return null;
}

// What a gesture covering `shapeArea` hit, given each candidate's covered area and the bounds of that covered part.
// A thing counts when a quarter of it is covered, or a quarter of the gesture lies on it; it is whole at 90 %, or, for a
// loose gesture (the laser's circle, which rounds off corners), when the gesture holds its centre and 60 % of it.
// Of things stacked inside one another, a partly covered outer one gives way to the inner one (a box drawn on a
// card inside a container points at the card); a container covered whole stands for its members.
// Arrows go by their drawn line when they have one (`points`): one wholly inside counts alongside everything else; one
// the gesture only crosses counts when nothing else was hit. Without a line, an arrow counts only wholly inside its box,
// and only when nothing else was hit.
function decide(candidates, shapeArea, covered, {loose = false, inside = null, edges = [], span = null, about = null} = {}) {
  let hits = [];
  const lines = [];
  for (const c of candidates) {
    const box = {x: c.x, y: c.y, w: c.w, h: c.h}, boxArea = area(box);
    if (c.line && c.points?.length > 1 && inside) {
      const how = lineAgainst(c.points, inside, edges);
      if (how && (!about || about(c))) lines.push({c, box, whole: true, inter: 0, enclosed: how === 'enclosed'});
      continue;
    }
    if (!(boxArea > 0)) continue;
    const got = covered(c, box); if (!got || !(got.area > 0)) continue;
    const cover = got.area / boxArea, share = shapeArea > 0 ? got.area / shapeArea : 0;
    const whole = cover >= 0.9 || (loose && !c.line && cover >= 0.6 && !!inside?.([c.x + c.w / 2, c.y + c.h / 2]));
    // `span` (the wand): a stroke that runs along most of a thing's length while touching it (an underline, a stroke
    // through a heading) points at it even when it covers little of it.
    const along = span && !c.line ? span(box, c) : 0;
    if (c.line ? !whole : cover < 0.25 && share < 0.25 && !(along >= 0.75 && cover >= 0.08)) continue;
    hits.push({c, box, whole, inter: got.area, part: got.bounds, cover, along});
  }
  const within = (inner, outer) => { const i = intersectRect(inner.box, outer.box); return !!i && area(i) >= 0.9 * area(inner.box) && area(outer.box) > area(inner.box); };
  hits = hits.filter(h => !(!h.whole && hits.some(o => o !== h && !o.c.line && within(o, h))));
  hits = hits.filter(h => !hits.some(o => o !== h && o.whole && o.c.frame && within(h, o)));
  if (hits.some(h => !h.c.line)) hits = hits.filter(h => !h.c.line);
  hits.sort((a, b) => b.inter - a.inter);
  const others = hits.length > 0;
  // An arrow joins the other things only when the gesture is clearly about it: wholly inside, and not leading out to
  // something the gesture left out (circling a card does not take the arrow that arrives at it from another card).
  const kept = new Set(hits.map(h => h.c));
  const leadsOut = l => [l.c.points[0], l.c.points.at(-1)].some(end => candidates.some(o => o !== l.c && !o.line && !kept.has(o) && near(end, o, 12)));
  hits.push(...lines.filter(l => !others || (l.enclosed && !leadsOut(l))));
  const more = Math.max(0, hits.length - 12);
  // `cover` (how much of the thing the gesture covers) and `along` go with each target for snapping (pointing-snap.js).
  return {more, targets: hits.slice(0, 12).map(h => ({candidate: h.c, whole: h.whole, cover: h.c.line ? 1 : Math.min(1, h.cover), along: h.along || 0,
    ...(h.whole ? {} : {region: regionOf(h.part, h.box)})}))};
}
export function rectHits(rect, candidates) {
  return decide(candidates, area(rect), (c, box) => { const i = intersectRect(rect, box); return i && {area: area(i), bounds: i}; },
    {inside: p => inRect(p, rect), edges: rectEdges(rect)});
}
/** A free shape (lasso, or the laser's circle with `loose`): what lies inside it, by area. */
export function pathHits(points, candidates, {loose = false} = {}) {
  const shapeBox = boundsOf(points);
  return decide(candidates, polygonArea(points), (c, box) => {
    if (!intersectRect(shapeBox, box)) return null;
    const clipped = clipPolygon(points, box); if (clipped.length < 3) return null;
    return {area: polygonArea(clipped), bounds: boundsOf(clipped)};
  }, {loose, inside: p => inRect(p, shapeBox) && pointInPolygon(p, points), edges: polyEdges(points)});
}
/**
 * The wand's area (a SwathField, pointing-wand.js): what lies inside it, by area, loose as a circle is (a band round a
 * thing's centre over most of it is the whole thing), and along (an underline points at what it runs under).
 */
export function areaHits(field, candidates) {
  const fb = field.bounds(); if (!fb) return {more: 0, targets: []};
  const along = underlines(field.points, field.r, candidates);
  // The wide band holds a short arrow it merely crosses: an arrow counts only when the gesture is round or along it
  // (the gesture no longer than three times the arrow, or the band's width, and its middle near the arrow's).
  const mid = [fb.x + fb.w / 2, fb.y + fb.h / 2];
  const about = c => {
    const p = c.points, a = p[0], b = p.at(-1), m = p[p.length >> 1], size = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), field.width);
    return Math.max(fb.w, fb.h) <= 3 * size && Math.hypot(m[0] - mid[0], m[1] - mid[1]) <= size;
  };
  return decide(candidates, field.area(), (c, box) => intersectRect(fb, box) ? field.covered(box) : null,
    {loose: true, inside: p => field.contains(p), edges: [], span: (box, c) => along.get(c) || 0, about});
}
/**
 * How much of each thing's length a stroke runs along (0..1), by its centre line (`points`, a band `r` either side):
 * through the thing, or under it and close (within 0.6 r of its bottom edge; beside a thing taller than wide). Under
 * means under one thing: where the line runs between two things, under one and just over (or in) the next, as along
 * the gap between two rows of cards, it is under neither.
 */
export function underlines(points, r, candidates) {
  const out = new Map(); if (!points?.length) return out;
  const step = Math.max(1, r / 4), pts = [];
  for (let i = 0; i < points.length; i++) {
    const [bx, by] = points[i];
    if (!i) { pts.push([bx, by]); continue; }
    const [ax, ay] = points[i - 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) pts.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
  }
  const lb = boundsOf(pts), d = 0.6 * r, reach = {x: lb.x - d - r, y: lb.y - d - r, w: lb.w + 2 * (d + r), h: lb.h + 2 * (d + r)};
  const things = candidates.filter(c => !c.line && c.w > 0 && c.h > 0 && intersectRect(reach, c));
  const holds = (a, b) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;
  // [along, across] for a thing laid out wide (x along it) or tall (y along it).
  const axes = c => c.w >= c.h ? {a: p => p[0], b: p => p[1], a0: c.x, a1: c.x + c.w, b0: c.y, b1: c.y + c.h, wide: true}
    : {a: p => p[1], b: p => p[0], a0: c.y, a1: c.y + c.h, b0: c.x, b1: c.x + c.w, wide: false};
  // Where p is against c: 'in', 'under' (below its bottom, close; beside a tall one), 'over' (above its top, close), or null.
  const against = (p, c) => {
    const ax = axes(c), u = ax.a(p), v = ax.b(p);
    if (u < ax.a0 || u > ax.a1) return null;
    if (v >= ax.b0 && v <= ax.b1) return 'in';
    if (v > ax.b1 && v - ax.b1 <= d) return 'under';
    if (v < ax.b0 && ax.b0 - v <= d) return ax.wide ? 'over' : 'under';
    return null;
  };
  for (const c of things) {
    const ax = axes(c), got = [];
    for (const p of pts) {
      const how = against(p, c); if (!how || how === 'over') continue;
      if (how === 'under' && things.some(o => o !== c && !holds(o, c) && !holds(c, o) && (({in: 1, over: 1})[against(p, o)]))) continue;
      got.push(ax.a(p));
    }
    if (!got.length) continue;
    got.sort((x, y) => x - y);
    let run = 0;
    for (let i = 1; i < got.length; i++) { const g = got[i] - got[i - 1]; if (g <= 2 * step) run += g; }
    out.set(c, Math.min(1, run / (ax.a1 - ax.a0)));
  }
  return out;
}
/** A click: the whole thing under it (found by the page), and the spot clicked as fractions of its own box. */
export function pointTarget(candidate, point) {
  const box = {x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h};
  const f = (v, a, l) => round3(Math.min(1, Math.max(0, l > 0 ? (v - a) / l : .5)));
  return {candidate, whole: true, spot: {x: f(point.x, box.x, box.w), y: f(point.y, box.y, box.h)}};
}

// ---- the laser's circle: a loop closed by the pointer's own trail ----
function crossing(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (!d) return null;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t > 0 && t <= 1 && u >= 0 && u < 1 ? [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])] : null;
}
/**
 * The newest segment of a trail (screen points [x, y, t]) closing a loop: the loop's points and where it closed, or
 * null. A loop counts when it is round enough to be a circle drawn on purpose (isoperimetric ratio 4πA/P² ≥ 0.3:
 * a circle is 1, a square 0.79, a back-and-forth wave near 0), at least `minSize` px across its long side and `minSide`
 * across its short one (a scribble's turnaround makes thin loops), drawn within `window` ms (a deliberate circle at a
 * natural speed takes up to about 3 s).
 */
export function closedLoop(trail, {minSize = 40, minSide = 24, window = 3500, roundness = 0.3} = {}) {
  const n = trail.length; if (n < 5) return null;
  const a = trail[n - 2], b = trail[n - 1];
  for (let i = n - 4; i >= 0; i--) {
    if (b[2] - trail[i][2] > window) break;
    const hit = crossing(a, b, trail[i], trail[i + 1]); if (!hit) continue;
    const loop = [hit, ...trail.slice(i + 1, n - 1).map(p => [p[0], p[1]])];
    if (loop.length < 4) return null;
    const box = boundsOf(loop), A = polygonArea(loop), P = polygonLength(loop);
    if (Math.max(box.w, box.h) < minSize || Math.min(box.w, box.h) < minSide || !P || 4 * Math.PI * A / (P * P) < roundness) return null;
    return {loop, index: i, at: trail[i][2]};
  }
  return null;
}
