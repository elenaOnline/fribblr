// A sent pointing message inside its comment thread card (comment-thread.js): the user's sentence with a numbered chip per
// mark, the same chips as in the composer. While the card is open the marks show on the board (pointing-mode.js
// showSent); a chip press brings its mark into view, ⌘/Ctrl-press opens what it points at.
import {esc, refState, decorationLabel} from './comment-refs.js';

const clip = (text, n) => { text = String(text || '').replace(/\s+/g, ' ').trim(); return text.length > n ? text.slice(0, n - 1).trimEnd() + '…' : text; };
// A target's name now, as the comment chips show it (comment-refs.js chipLabel): renamed or edited, the new one.
const nameNow = (board, t) => {
  const snap = board?.snapshot || {};
  if (t.kind === 'decoration') { const d = (snap.decorations || []).find(x => x.id === t.id); if (d) return d.sticker ? `Sticker ${d.text || ''}`.trim() : decorationLabel(d); }
  if (t.kind === 'placement') { const p = (snap.placements || []).find(x => x.id === t.id); const item = p && snap.items?.[p.itemId]; if (item?.title) return item.title; }
  return t.title;
};
const label = (mark, board) => !mark.targets?.length ? (mark.shape?.kind === 'point' ? 'Board point' : 'Board area') : mark.targets.length === 1 ? nameNow(board, mark.targets[0]) : `${mark.targets.length} items`;
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
    // The user's words are ordinary ink (pointing.css); the chips carry the user's red.
    if (!('mark' in part)) { const words = document.createElement('span'); words.className = 'pointing-words'; words.textContent = part.text; frag.append(words); continue; }
    const mark = marks.get(part.mark); if (!mark) continue;
    const chip = document.createElement('span');
    chip.className = 'cref pointing-chip';
    chip.dataset.pointThread = thread.id; chip.dataset.pointN = String(mark.n);
    chip.setAttribute('role', 'link'); chip.tabIndex = 0;
    chip.innerHTML = `<b class="pointing-n">${mark.n}</b><span class="cref-label"></span>`;
    fillChip(board, chip, mark);
    frag.append(chip);
  }
  return frag;
}
// A chip's name and state from the board as it is now: renamed, or deleted.
function fillChip(board, chip, mark) {
  const gone = (mark.targets || []).length > 0 && mark.targets.every(t => t.kind !== 'board' && refState(board, refOf(t)) === 'deleted');
  chip.classList.toggle('missing', gone);
  chip.dataset.tip = gone ? 'Deleted' : `${hint(mark)} · press to show on the board`;
  const text = clip(label(mark, board), 32), el = chip.querySelector('.cref-label');
  if (el.textContent !== text) el.textContent = text;
}
/** The board changed: the open cards' chips say what their marks point at now (pointing-mode.js sync). */
export function syncPointingChips(board) {
  for (const chip of document.querySelectorAll('.pointing-chip[data-point-thread]')) {
    const mark = act.threads.get(chip.dataset.pointThread)?.pointing.marks.find(m => m.n === Number(chip.dataset.pointN));
    if (mark) fillChip(board, chip, mark);
  }
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
