// Snapping for pointing mode (pointing-mode.js; team/pointing/CONTRACT.md § Round 2). No DOM here (tests import it).
//
// A hand-drawn region round a card, a sticky or a heading is sloppy; snapping tidies it to the thing so the reference
// names it exactly and the crop frames it. It is shown before it commits (the snapped outline while the user drags) and one
// key takes exactly what the user drew (⌘ on a Mac, Ctrl elsewhere, held: the same key that turns off alignment guides
// while dragging in Keynote, and snapping in tldraw, Miro and Figma).
//
// Sources propose; the best proposal over SNAP_MIN wins. The board-object source is here (`objectSnap`): it tidies a
// marquee, lasso or wand area to the object(s) it mostly covers. Sources inside one item (elements in a same-origin
// card frame, edges in a picture) plug in through PointingMode.addSnapSource (pointing-mode.js says what they get).
//
// A proposal: {source: 'object' | 'dom' | 'pixels', shape: {kind: 'rect' | 'path', …} (board units), label, score 0..1,
// targets?: [{candidate, whole: true}] (object), candidate?, element? (a source inside an item)}.

export const SNAP_MIN = 0.35;
// How much of a thing a gesture must cover to be tidied to it: a marquee or lasso half of it; the wand, a wide brush
// that rarely fills a card, 40 %, or running along most of it (an underline).
export const SNAP_COVER = {marquee: 0.5, lasso: 0.5, wand: 0.4};

const area = b => Math.max(0, b.w) * Math.max(0, b.h);
/** A candidate's own outline in board units: its box, a text element's words, an arrow's drawn line. */
export function candidateBox(c) {
  if (c.line && c.points?.length > 1) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of c.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
  }
  return {x: c.x, y: c.y, w: c.w, h: c.h};
}
const union = boxes => {
  const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y));
  return {x: x0, y: y0, w: Math.max(...boxes.map(b => b.x + b.w)) - x0, h: Math.max(...boxes.map(b => b.y + b.h)) - y0};
};

/**
 * The board-object source. `hits`: what the raw gesture hit (pointing-geometry.js, with `cover` and `along` per
 * target); `tool`: marquee | lasso | wand; `gestureArea`: the raw gesture's area in board units²; `name(candidate)`:
 * how the label names one thing ('card "Hero B"').
 * It proposes only when every thing hit is mostly covered (so it never drops something the user half meant), and when those
 * things are not a speck in a big gesture (a wide box over empty board with a sticker in its corner stays a board area).
 */
export function objectSnap(hits, {tool, gestureArea = 0, name = () => 'object'} = {}) {
  const ts = hits?.targets || [];
  if (!ts.length || hits.more) return null;
  const need = SNAP_COVER[tool] ?? 0.5;
  const ok = t => t.whole || t.cover >= need || (tool === 'wand' && t.along >= 0.75);
  if (!ts.every(ok)) return null;
  const boxes = ts.map(t => candidateBox(t.candidate));
  const things = boxes.reduce((s, b) => s + area(b), 0);
  if (gestureArea > 0 && things < 0.2 * gestureArea && !ts.some(t => t.candidate.line)) return null;
  const score = Math.min(...ts.map(t => t.whole ? 1 : t.cover >= need ? Math.max(t.cover, 0.6) : 0.6));
  const b = union(boxes);
  return {source: 'object', shape: {kind: 'rect', x: b.x, y: b.y, w: b.w, h: b.h}, score,
    label: ts.length === 1 ? name(ts[0].candidate) : `${ts.length} objects`,
    targets: ts.map(t => ({candidate: t.candidate, whole: true}))};
}

/** The best proposal over the floor, or null. */
export function bestProposal(proposals, floor = SNAP_MIN) {
  let best = null;
  for (const p of proposals) if (p?.shape && p.score >= floor && (!best || p.score > best.score)) best = p;
  return best;
}
