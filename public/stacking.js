// One shared stacking order for everything on a board: Tinka placements and drawn
// elements (text, stickies, shapes, stickers, regions, containers and arrows).
// Pure and shared by the store (lib/workspace.mjs) and the browser; no DOM.
//
// Placements keep their stored `z`. A drawn element may store an optional `z` in
// the same numeric space. One without it (every drawing saved before this order
// existed) keeps its kind's level: plain regions and containers, then text and
// shapes, sit beneath everything that has a stored `z`, and stickers and arrows
// above it, so no migration is needed. Those levels used to be compared with
// placement z, which was a creation count: shapes and text covered a board's first
// card (z 0), and every card after its third covered the arrows and stickers on it.
// Ties put drawn elements beneath placements, then follow array order, which is
// the order the board has always painted in. A container is drawn directly beneath
// its lowest member, so its members always show on it.
import {decorationBounds} from './whiteboard-geometry.js';

export const STACK_RANGE = 10000000;
const live = p => !p.removedAt && !p.deletedAt;
export const stackRef = (kind, id) => `${kind === 'placement' ? 'p' : 'd'}:${id}`;
const childRef = child => typeof child === 'string' ? stackRef('decoration', child)
  : child?.placementId ? stackRef('placement', child.placementId) : null;

export function legacyStackLevel(d) {
  if (d.type === 'line') return 2;
  if (d.type === 'text') return d.sticker ? 2 : 1;
  return d.shape ? 1 : 0;
}

// Bottom-to-top entries: {kind,id,ref,value,key}.
export function stackOrder(board) {
  const entries = [];
  // Drawings without a stored z go beneath (levels 0, 1) or above (level 2) every stored value.
  const stored = [...(board.decorations || []).filter(d => Number.isFinite(d.z)).map(d => d.z),
    ...(board.placements || []).filter(live).map(p => Number.isFinite(p.z) ? p.z : 0)];
  const low = stored.length ? Math.min(...stored) : 0, high = stored.length ? Math.max(...stored) : 0;
  const legacyKey = d => { const level = legacyStackLevel(d); return level === 2 ? high + 1 : low - 2 + level; };
  (board.decorations || []).forEach((d, index) => entries.push({kind:'decoration', id:d.id, ref:stackRef('decoration', d.id), value:d,
    key:Number.isFinite(d.z) ? d.z : legacyKey(d), tie:0, index}));
  (board.placements || []).forEach((p, index) => { if (live(p)) entries.push({kind:'placement', id:p.id, ref:stackRef('placement', p.id), value:p,
    key:Number.isFinite(p.z) ? p.z : 0, tie:1, index}); });
  entries.sort((a, b) => a.key - b.key || a.tie - b.tie || a.index - b.index);
  for (const container of entries.filter(e => e.kind === 'decoration' && e.value.container?.children?.length)) {
    const members = new Set(container.value.container.children.map(childRef));
    const at = entries.indexOf(container), lowest = entries.findIndex(e => members.has(e.ref));
    if (lowest >= 0 && lowest < at) { entries.splice(at, 1); entries.splice(lowest, 0, container); }
  }
  return entries;
}

// ref -> 1-based paint rank, cached per board snapshot (arrays are replaced on change).
const rankCache = new WeakMap();
export function stackRanks(board, {fresh = false} = {}) {
  const cached = rankCache.get(board);
  if (!fresh && cached && cached.decorations === board.decorations && cached.placements === board.placements &&
      cached.counts === `${board.decorations?.length}:${board.placements?.length}`) return cached.ranks;
  const ranks = new Map(stackOrder(board).map((entry, index) => [entry.ref, index + 1]));
  rankCache.set(board, {decorations:board.decorations, placements:board.placements,
    counts:`${board.decorations?.length}:${board.placements?.length}`, ranks});
  return ranks;
}
export function stackRank(board, kind, id) {
  if (!board) return 1;
  const ref = stackRef(kind, id);
  return stackRanks(board).get(ref) ?? stackRanks(board, {fresh:true}).get(ref) ?? 1;
}

// A selected container brings its members with it.
export function expandStackRefs(board, refs) {
  const set = new Set(refs);
  for (const d of board.decorations || [])
    if (d.container && set.has(stackRef('decoration', d.id)))
      for (const child of d.container.children) { const ref = childRef(child); if (ref) set.add(ref); }
  return set;
}

function boxOf(entry, board) {
  const box = entry.kind === 'placement' ? entry.value : decorationBounds(entry.value, board);
  return {x:box.x, y:box.y, width:Math.max(1, box.width || 0), height:Math.max(1, box.height || 0)};
}
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const area = box => box.width * box.height;
// An object rests on a base when more than half of it lies inside the base and it is
// at most half the base's size. Arrows and stickers are never bases.
export function restsOn(top, base) {
  const w = Math.min(top.x + top.width, base.x + base.width) - Math.max(top.x, base.x);
  const h = Math.min(top.y + top.height, base.y + base.height) - Math.max(top.y, base.y);
  return w > 0 && h > 0 && w * h > area(top) / 2 && area(top) <= area(base) / 2;
}
const canBeBase = entry => !(entry.kind === 'decoration' && (entry.value.type === 'line' || entry.value.sticker));
const isLine = entry => entry.kind === 'decoration' && entry.value.type === 'line';
const shown = entry => !(entry.kind === 'placement' && entry.value.archivedAt);

// The order the board paints in once `changes` are written: the same objects, in
// their own array order, with the new z values.
function orderAfter(order, changes) {
  const z = new Map(changes.map(change => [change.entry.ref, change.z])), board = {decorations:[], placements:[]};
  for (const entry of [...order].sort((a, b) => a.tie - b.tie || a.index - b.index))
    (entry.kind === 'placement' ? board.placements : board.decorations).push(z.has(entry.ref) ? {...entry.value, z:z.get(entry.ref)} : entry.value);
  return stackOrder(board).map(entry => entry.ref).join('\n');
}
// The z changes that turn the current order into `desired`, touching as few objects
// as possible: unchanged bottom (or top) runs keep their values. Those runs keep
// their place only if their keys stay where they were; a drawing without a stored z
// does not (its key follows the stored range), and equal keys can fall either side
// of a tie. So the result is checked against writing every object its rank in
// `desired`, and that is written instead whenever the two would paint differently:
// a reorder never moves anything it was not asked to move.
function changesFor(order, desired) {
  let prefix = 0;
  while (prefix < order.length && order[prefix].ref === desired[prefix].ref) prefix++;
  if (prefix === order.length) return [];
  let suffix = 0;
  while (suffix < order.length && order[order.length - 1 - suffix].ref === desired[desired.length - 1 - suffix].ref) suffix++;
  const keys = list => list.map(entry => entry.key);
  const needed = list => list.filter(change => change.entry.key !== change.z || !Number.isFinite(change.entry.value.z));
  const ranks = needed(desired.map((entry, index) => ({entry, z:index + 1})));
  let changes;
  if (order.length - prefix <= order.length - suffix) {
    const base = prefix ? Math.max(...keys(order.slice(0, prefix))) : 0;
    changes = desired.slice(prefix).map((entry, index) => ({entry, z:base + 1 + index}));
  } else {
    const head = desired.length - suffix, base = suffix ? Math.min(...keys(order.slice(order.length - suffix))) : 0;
    changes = desired.slice(0, head).map((entry, index) => ({entry, z:base - head + index}));
  }
  changes = needed(changes);
  if (changes.some(change => Math.abs(change.z) > STACK_RANGE - 1) || orderAfter(order, changes) !== orderAfter(order, ranks))
    changes = ranks;
  return changes.map(({entry, z}) => ({kind:entry.kind, id:entry.id, z}));
}
// `block` moves above everything else, and `resting` (if any) stays above `block`.
function lift(order, block, resting = new Set()) {
  const rest = order.filter(e => !block.has(e.ref) && !resting.has(e.ref));
  return changesFor(order, [...rest, ...order.filter(e => block.has(e.ref)), ...order.filter(e => resting.has(e.ref))]);
}

// Bring to front / Send to back: the selection keeps its own relative order.
export function restack(board, refs, to) {
  const order = stackOrder(board), block = expandStackRefs(board, refs);
  if (to === 'back') return changesFor(order, [...order.filter(e => block.has(e.ref)), ...order.filter(e => !block.has(e.ref))]);
  return lift(order, block);
}

// Objects resting on any base in `block` (and not in it) at the current geometry.
function restingOn(order, block, board, {above = true} = {}) {
  const bases = order.filter(e => block.has(e.ref) && canBeBase(e)).map(e => ({entry:e, box:boxOf(e, board)}));
  const resting = new Set();
  if (!bases.length) return resting;
  const position = new Map(order.map((e, index) => [e.ref, index]));
  for (const e of order) {
    if (block.has(e.ref) || !shown(e)) continue;
    const box = boxOf(e, board);
    if (bases.some(base => (!above || position.get(e.ref) > position.get(base.entry.ref)) && restsOn(box, base.box))) resting.add(e.ref);
  }
  return resting;
}

// New, pasted and duplicated objects land on top, beneath anything resting on them.
export function landOnTop(board, refs) {
  const order = stackOrder(board), block = expandStackRefs(board, refs);
  const resting = restingOn(order, block, board, {above:false});
  return changesFor(order, [...order.filter(e => !block.has(e.ref) && !resting.has(e.ref)),
    ...order.filter(e => block.has(e.ref)), ...order.filter(e => resting.has(e.ref))]);
}

// A pointer drop reorders only when it makes the moved objects overlap something
// above them that they did not overlap before (arrows do not count). Then they rise
// above everything except the objects resting on them. `before` and `after` are the
// board before and after the move; z values are the same in both.
export function dropRestack(before, after, refs) {
  const order = stackOrder(after), block = expandStackRefs(after, refs);
  const moved = order.filter(e => block.has(e.ref));
  if (!moved.length) return [];
  const prior = new Map(stackOrder(before).map(e => [e.ref, e]));
  const position = new Map(order.map((e, index) => [e.ref, index]));
  const others = order.filter(e => !block.has(e.ref) && shown(e) && !isLine(e));
  let raise = false;
  for (const m of moved) {
    const now = boxOf(m, after), was = prior.get(m.ref) && boxOf(prior.get(m.ref), before);
    for (const o of others) {
      if (position.get(o.ref) < position.get(m.ref)) continue;
      const box = boxOf(o, after);
      if (!overlaps(now, box) || canBeBase(m) && restsOn(box, now)) continue;
      const old = prior.get(o.ref);
      if (was && old && overlaps(was, boxOf(old, before))) continue;
      raise = true; break;
    }
    if (raise) break;
  }
  return raise ? lift(order, block, restingOn(order, block, after)) : [];
}

// Writes the z changes onto the board's own objects and returns the board.
export function applyStack(board, changes) {
  for (const {kind, id, z} of changes) {
    const list = kind === 'placement' ? board.placements : board.decorations;
    const index = list.findIndex(entry => entry.id === id && (kind !== 'placement' || live(entry)));
    if (index >= 0) list[index] = {...list[index], z};
  }
  return board;
}
