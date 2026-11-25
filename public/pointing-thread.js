// A sent pointing message inside its comment thread card (comment-thread.js): her sentence with a numbered chip per
// mark, the same chips as in the composer. While the card is open the marks show on the board (pointing-mode.js
// showSent); a chip press brings its mark into view, ⌘/Ctrl-press opens what it points at.
import {esc, refState} from './comment-refs.js';

const clip = (text, n) => { text = String(text || '').replace(/\s+/g, ' ').trim(); return text.length > n ? text.slice(0, n - 1).trimEnd() + '…' : text; };
const label = mark => !mark.targets?.length ? (mark.shape?.kind === 'point' ? 'Board point' : 'Board area') : mark.targets.length === 1 ? mark.targets[0].title : `${mark.targets.length} items`;
const hint = mark => {
  const t = mark.targets || [];
  if (!t.length) return mark.shape?.kind === 'point' ? 'A point on the board' : 'An empty area of the board';
  if (t.length === 1) return `${t[0].whole ? '' : 'Part of '}${t[0].title}`;
  return `${t.length} items: ${t.slice(0, 3).map(x => x.title).join(', ')}${t.length > 3 ? ', …' : ''}`;
};
const refOf = target => target && (target.kind === 'board' ? {kind: 'board', id: target.id, label: target.title} : {kind: target.kind, id: target.id, boardId: target.boardId, label: target.title});

export function pointingBody(board, thread) {
  const frag = document.createDocumentFragment(), p = thread.pointing, marks = new Map((p.marks || []).map(m => [m.n, m]));
  for (const part of p.parts || []) {
    if (!('mark' in part)) { frag.append(document.createTextNode(part.text)); continue; }
    const mark = marks.get(part.mark); if (!mark) continue;
    const gone = (mark.targets || []).length > 0 && mark.targets.every(t => t.kind !== 'board' && refState(board, refOf(t)) === 'deleted');
    const chip = document.createElement('span');
    chip.className = `cref pointing-chip${gone ? ' missing' : ''}`;
    chip.dataset.pointThread = thread.id; chip.dataset.pointN = String(mark.n);
    chip.setAttribute('role', 'link'); chip.tabIndex = 0;
    chip.dataset.tip = gone ? 'Deleted' : `${hint(mark)} · press to show on the board`;
    chip.innerHTML = `<b class="pointing-n">${mark.n}</b><span class="cref-label">${esc(clip(label(mark), 32))}</span>`;
    frag.append(chip);
  }
  return frag;
}

// One listener for every card: capture, so it runs before the card's own chip handling.
const act = event => {
  const chip = event.target.closest?.('.pointing-chip[data-point-thread]'); if (!chip) return false;
  const board = act.board, thread = act.threads.get(chip.dataset.pointThread); if (!board || !thread) return false;
  event.preventDefault(); event.stopPropagation();
  if (chip.classList.contains('missing')) return true;
  const n = Number(chip.dataset.pointN), mark = thread.pointing.marks.find(m => m.n === n), target = mark?.targets?.[0];
  if ((event.metaKey || event.ctrlKey) && target) board.openRef?.(refOf(target));
  else board.pointing?.revealSent(thread, n);
  return true;
};
act.threads = new Map();
if (typeof document !== 'undefined') {
  document.addEventListener('click', act, true);
  document.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') act(event); }, true);
}
/** The card shows `thread`: its chips answer presses, and its marks show on the board. */
export function showPointing(board, thread) {
  if (!thread?.pointing) return;
  act.board = board; act.threads.set(thread.id, thread);
  board.pointing?.showSent(thread);
}
export function hidePointing(board, threadId) {
  act.threads.delete(threadId);
  board.pointing?.clearSent(threadId);
}
