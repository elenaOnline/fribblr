// References inside comments: the @ picker (items, drawn elements and boards on this board,
// grouped and filterable), reference chips in the composer and in posted messages, and the
// body <-> {text, refs} conversion the comments API stores. A chip click shows the target on
// the board (board.revealRef); ⌘-click or its small ↗ opens it (board.openRef).
import "./vendor/ui-sdk/web/trigger-menu.js";
const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[ch]);
const ICON = {
  item:'<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M5 6.5h6M5 9.5h4"/></svg>',
  decoration:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12.5 11.5 4M8.5 4h3v3"/></svg>',
  board:'<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/></svg>',
  open:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5H3.5v9h9V10M9 3.5h3.5V7M12.5 3.5 7 9"/></svg>',
};
export {esc, ICON as REF_ICONS};

// ---------- the stored form ----------
// The API keeps a chip's "@label" text in the body and the structured link in `refs` (the
// server does not parse the body). Rendering finds each ref's "@label" in the body again.
const REF_KINDS = new Set(["item", "placement", "decoration", "board"]);
export function cleanRef(ref) {
  if (!ref || !REF_KINDS.has(ref.kind) || typeof ref.id !== "string") return null;
  const out = {kind:ref.kind, id:ref.id, label:String(ref.label || ref.id).replace(/\n/g, " ").slice(0, 120)};
  if (ref.boardId) out.boardId = ref.boardId;
  if ((ref.kind === "placement" || ref.kind === "decoration") && !out.boardId) return null;
  return out;
}
const GONE = new Set(["removed", "deleted", "missing"]);

// ---------- readable labels ----------
const plain = text => String(text || "").replace(/[*_`~#>\[\]]/g, "").replace(/\s+/g, " ").trim();
const clip = (text, n = 40) => text.length > n ? text.slice(0, n - 1).trimEnd() + "…" : text;
const SHAPES = {rectangle:"Sticky", rounded:"Process", diamond:"Decision", ellipse:"Start / end"};
export function decorationLabel(d) {
  if (!d) return "Drawn element";
  const text = clip(plain(d.text));
  const kind = d.type === "line" ? "Arrow" : d.type === "text" ? "Text" : d.type === "region" ? (SHAPES[d.shape] || (d.shape ? "Shape" : "Region")) : "Drawn element";
  return text ? `${kind} · ${text}` : kind;
}
export function itemLabel(item) {
  if (!item) return "Item";
  return clip(`${item.number ? item.number + " · " : ""}${item.title || "Untitled"}`, 60);
}

/** Everything @ can reference from this board: its items, its drawn elements and boards. */
export function refCandidates(board) {
  const snap = board.snapshot || {}, boardId = snap.id, items = snap.items || {}, seen = new Set();
  const groups = {items:[], drawn:[], boards:[]};
  for (const p of snap.placements || []) {
    if (p.removedAt || p.deletedAt || p.archivedAt) continue;
    const item = items[p.itemId]; if (!item || seen.has(item.id)) continue; seen.add(item.id);
    if (item.childBoardId && !item.content) groups.boards.push({kind:"board", id:item.childBoardId, label:itemLabel(item)});
    else groups.items.push({kind:"item", id:item.id, boardId, placementId:p.id, label:itemLabel(item)});
  }
  for (const d of snap.decorations || []) groups.drawn.push({kind:"decoration", id:d.id, boardId, label:decorationLabel(d)});
  const known = new Set(groups.boards.map(b => b.id));
  for (const b of board.workspaceGraph?.boards || []) if (!known.has(b.id) && b.id !== boardId) { known.add(b.id); groups.boards.push({kind:"board", id:b.id, label:clip(b.title || b.id, 60)}); }
  if (boardId && !known.has(boardId)) groups.boards.unshift({kind:"board", id:boardId, label:clip(`${snap.title || "This board"} (this board)`, 60)});
  return groups;
}

/** Whether a ref still exists, judged from this board's snapshot (API status wins when given). */
export function refState(board, ref) {
  if (ref.exists === false || GONE.has(ref.state)) return "deleted";
  if (ref.exists === true) return ref.state || "active";
  const snap = board.snapshot || {};
  if (ref.kind === "decoration") return ref.boardId && ref.boardId !== snap.id ? "other" : (snap.decorations || []).some(d => d.id === ref.id) ? "active" : "deleted";
  if (ref.kind === "item") { const item = snap.items?.[ref.id]; return item ? (item.deletedAt ? "deleted" : "active") : ref.boardId && ref.boardId !== snap.id ? "other" : "deleted"; }
  if (ref.kind === "placement") return (snap.placements || []).some(p => p.id === ref.id && !p.removedAt) ? "active" : "deleted";
  return "active";
}

// ---------- chips ----------
export function chipElement(ref, {state = "active", editable = false} = {}) {
  const chip = document.createElement("span");
  chip.className = "cref" + (state === "deleted" ? " missing" : "");
  chip.contentEditable = "false";
  chip.dataset.ref = JSON.stringify(cleanRef(ref));
  chip.dataset.kind = ref.kind;
  const icon = ICON[ref.kind === "placement" ? "item" : ref.kind] || ICON.item;
  chip.innerHTML = `${icon}<span class="cref-label">${esc(ref.label)}</span>${!editable && ref.kind !== "board" && state !== "deleted" ? `<button type="button" class="cref-open" tabindex="-1" aria-label="Open ${esc(ref.label)}" data-tip="Open">${ICON.open}</button>` : ""}`;
  // A hint on the shared tooltip, served by its delegate (tips.js): the comment card is a tooltip zone, so a chip in
  // editable text gets no wrapper element.
  chip.dataset.tip = state === "deleted" ? "Deleted" : ref.kind === "board" ? "Open board" : "Show on board · ⌘-click or ↗ opens it";
  if (!editable) { chip.setAttribute("role", "link"); chip.tabIndex = 0; }
  return chip;
}
/** The name a chip shows now: a drawn element's readable label from this board, else the
 *  server's current label (plain text), else the label saved with the comment. */
export function chipLabel(board, ref) {
  if (ref.kind === "decoration" && (!ref.boardId || ref.boardId === board.snapshot?.id)) {
    const d = board.snapshot?.decorations?.find(x => x.id === ref.id); if (d) return decorationLabel(d);
  }
  return plain(ref.currentLabel) || ref.label;
}
/** A posted message: its text, with each ref's "@label" shown as a chip. */
export function renderBody(board, body, refs = []) {
  const frag = document.createDocumentFragment(), text = String(body || "");
  const labels = refs.map((ref, i) => ({i, token:"@" + ref.label})).filter(entry => entry.token.length > 1).sort((a, b) => b.token.length - a.token.length);
  let last = 0, at = 0;
  while (at < text.length) {
    const next = text.indexOf("@", at); if (next < 0) break;
    const hit = labels.find(entry => text.startsWith(entry.token, next));
    if (!hit) { at = next + 1; continue; }
    if (next > last) frag.append(document.createTextNode(text.slice(last, next)));
    const ref = refs[hit.i];
    frag.append(chipElement({...ref, label:chipLabel(board, ref)}, {state:refState(board, ref)}));
    last = at = next + hit.token.length;
  }
  if (last < text.length) frag.append(document.createTextNode(text.slice(last)));
  return frag;
}
/** Wire chip clicks inside `root`: show on the board, or open with ⌘-click / ↗. */
export function bindChips(root, board) {
  const act = (event, chip) => {
    let ref; try { ref = JSON.parse(chip.dataset.ref); } catch { return; }
    event.preventDefault(); event.stopPropagation();
    if (chip.classList.contains("missing")) return;
    const open = ref.kind === "board" || event.metaKey || event.ctrlKey || event.target.closest(".cref-open");
    if (open) openRef(board, ref); else board.revealRef?.(ref);
  };
  root.addEventListener("click", event => {
    const chip = event.target.closest?.(".cref[data-ref]");
    if (!chip || chip.closest("[contenteditable=true]")) return;
    act(event, chip);
  });
  root.addEventListener("keydown", event => {
    const chip = event.target.closest?.(".cref[data-ref]");
    if (chip && !chip.closest("[contenteditable=true]") && (event.key === "Enter" || event.key === " ")) act(event, chip);
  });
}
export function openRef(board, ref) {
  if (board.openRef) return board.openRef(ref);
  if (ref.kind === "board") return board.navigate?.(ref.id);
  const id = ref.placementId || board.snapshot?.placements?.find(p => p.itemId === ref.id)?.id;
  const open = id && document.querySelector(`[data-placement="${CSS.escape(id)}"] [data-open]:not(:disabled)`);
  if (open) open.click(); else board.revealRef?.(ref);
}

// ---------- the composer ----------
/** {text, refs} from a composer: each chip becomes its "@label" text plus a ref. */
export function composerValue(el) {
  const refs = [], keyOf = new Map();
  let text = "";
  const walk = node => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { text += child.nodeValue.replace(/​/g, ""); continue; }
      if (child.nodeType !== 1) continue;
      if (child.classList.contains("cref")) {
        let ref; try { ref = cleanRef(JSON.parse(child.dataset.ref)); } catch {}
        if (!ref) continue;
        const key = `${ref.kind}:${ref.boardId || ""}:${ref.id}`;
        if (!keyOf.has(key) && refs.length < 20) { keyOf.set(key, refs.length); refs.push(ref); }
        text += "@" + ref.label; continue;
      }
      if (child.tagName === "BR") { text += "\n"; continue; }
      if (/^(DIV|P)$/.test(child.tagName) && text && !text.endsWith("\n")) text += "\n";
      walk(child);
    }
  };
  walk(el);
  return {text:text.replace(/ /g, " ").replace(/\n{3,}/g, "\n\n").trim(), refs};
}
export function setComposerValue(el, board, text = "", refs = []) {
  el.replaceChildren(renderBody(board, text, refs.map(ref => ({...ref, exists:true, currentLabel:undefined}))));
  for (const chip of el.querySelectorAll(".cref")) { chip.querySelector(".cref-open")?.remove(); chip.removeAttribute("role"); chip.removeAttribute("tabindex"); }
}
export const composerEmpty = el => !el.textContent.replace(/​/g, "").trim() && !el.querySelector(".cref");

/** The @ picker for a contenteditable composer: a UI SDK Trigger Menu bound to the composer through an editor
 *  adapter. Chips count as one character (U+FFFC) in the adapter's text, as the SDK reads a token.
 *  A name may hold spaces (@Round item D): the list stays open while what follows the @ still matches something, and
 *  closes once a space has made it match nothing, so the rest is plain text (as Slack and Notion mentions do).
 *  `first()` may return {label, refs}: a group listed before the others (pointing lists the selected items first).
 *  Returns {close, open}. */
export function attachPicker(el, board, {onChange = () => {}, first = null} = {}) {
  const menu = document.createElement("ui-trigger-menu");
  const content = document.createElement("ui-trigger-menu-content");
  content.className = "cref-picker"; content.setAttribute("aria-label", "Reference");
  content.setAttribute("side", "bottom"); content.setAttribute("align", "start"); content.setAttribute("side-offset", "6"); content.setAttribute("collision-padding", "8");
  menu.append(content);
  el.before(menu); menu.append(el); // content first: a menu connected without one makes its own
  let flat = [], opened = false;
  const fill = () => {
    const groups = refCandidates(board), top = first?.(), key = r => `${r.kind}:${r.id}`, lead = new Set((top?.refs || []).map(key));
    if (lead.size) for (const name of ["items", "drawn", "boards"]) groups[name] = groups[name].filter(r => !lead.has(key(r)));
    flat = [];
    const group = (name, list) => list.length ? `<ui-trigger-menu-group><ui-trigger-menu-group-label>${name}</ui-trigger-menu-group-label>${list.map(r => `<ui-trigger-menu-item value="${flat.push(r) - 1}" label="${esc(r.label)}"><ui-trigger-menu-item-icon>${ICON[r.kind] || ICON.item}</ui-trigger-menu-item-icon><span>${esc(r.label)}</span></ui-trigger-menu-item>`).join("")}</ui-trigger-menu-group>` : "";
    content.innerHTML = `<ui-trigger-menu-empty class="cref-empty">No match</ui-trigger-menu-empty><ui-trigger-menu-list>${lead.size ? group(esc(top.label), top.refs) : ""}${group("Items", groups.items)}${group("Drawn", groups.drawn)}${group("Boards", groups.boards)}</ui-trigger-menu-list>`;
  };
  // ---- the editor adapter: the composer as text, chips as one character each
  const CHIP = "\uFFFC";
  const isChip = node => node.nodeType === 1 && node.classList.contains("cref");
  const parts = () => { // [{node, start, end}] in document order; text nodes, chips and <br>
    const out = []; let at = 0;
    const walk = parent => { for (const node of parent.childNodes) {
      if (node.nodeType === 3) { out.push({node, start:at, end:at += node.nodeValue.length}); }
      else if (isChip(node) || node.tagName === "BR") out.push({node, start:at, end:at += 1});
      else if (node.nodeType === 1) walk(node);
    } };
    walk(el); return out;
  };
  const textOf = () => parts().map(p => p.node.nodeType === 3 ? p.node.nodeValue : p.node.tagName === "BR" ? "\n" : CHIP).join("");
  const offsetOf = (node, offset) => { // a DOM position as a text offset
    const list = parts();
    if (node.nodeType === 3) { const p = list.find(x => x.node === node); return p ? p.start + offset : null; }
    const child = node.childNodes[offset];
    if (child) { const first = list.find(p => p.node === child || child.contains?.(p.node)); if (first) return first.start; }
    const last = [...list].reverse().find(p => node.contains(p.node)); return last ? last.end : (list.at(-1)?.end ?? 0);
  };
  const positionOf = offset => { // a text offset as a DOM position
    const list = parts();
    for (const p of list) {
      if (offset < p.start || offset > p.end) continue;
      if (p.node.nodeType === 3) return {node:p.node, offset:offset - p.start};
      const parent = p.node.parentNode, i = [...parent.childNodes].indexOf(p.node);
      return {node:parent, offset:offset === p.start ? i : i + 1};
    }
    return {node:el, offset:el.childNodes.length};
  };
  const range = () => { const s = getSelection(); return s.rangeCount && el.contains(s.anchorNode) ? s : null; };
  let internal = false;
  const adapter = {
    element: el,
    textBefore(length) {
      const s = range(); if (!s || document.activeElement !== el) return null;
      const caret = offsetOf(s.focusNode, s.focusOffset); if (caret == null) return null;
      const start = Math.max(0, caret - length); return {text:textOf().slice(start, caret), offset:start};
    },
    selection() {
      const s = range(); if (!s || document.activeElement !== el) return null;
      const a = offsetOf(s.anchorNode, s.anchorOffset), b = offsetOf(s.focusNode, s.focusOffset); if (a == null || b == null) return null;
      return {start:Math.min(a, b), end:Math.max(a, b)};
    },
    rectAt(offset) {
      const p = positionOf(offset), r = document.createRange(); r.setStart(p.node, p.offset); r.collapse(true);
      let b = r.getBoundingClientRect();
      if (!b.height && !b.width && !b.left && !b.top) b = el.getBoundingClientRect();
      return {x:b.left, y:b.top, width:0, height:b.height};
    },
    replace(rng, content) {
      const text = typeof content === "string" ? content : content.label || "";
      internal = true;
      try {
        const a = positionOf(rng.start), b = positionOf(rng.end), r = document.createRange(); r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        if (el.ownerDocument.activeElement !== el) el.focus({preventScroll:true});
        if (!(text === "" ? document.execCommand("delete") : document.execCommand("insertText", false, text))) { r.deleteContents(); if (text) r.insertNode(document.createTextNode(text)); el.dispatchEvent(new InputEvent("input", {bubbles:true, inputType:"insertText", data:text})); }
      } finally { internal = false; }
      last = textOf();
    },
    composing: () => composing,
    subscribe(listener) {
      listeners.add(listener); if (listeners.size === 1) bind();
      return () => { listeners.delete(listener); if (!listeners.size) unbind(); };
    },
  };
  const listeners = new Set(); let last = textOf(), composing = false, lastSel = "";
  const emit = change => listeners.forEach(fn => fn(change));
  const diff = (a, b) => { let n = 0; const m = Math.min(a.length, b.length); while (n < m && a[n] === b[n]) n++; let i = 0; while (i < m - n && a[a.length - 1 - i] === b[b.length - 1 - i]) i++; return {range:{start:n, end:a.length - i}, inserted:b.slice(n, b.length - i)}; };
  const onSelection = () => { if (document.activeElement !== el) return; const s = adapter.selection(), key = s ? `${s.start}:${s.end}` : ""; if (key !== lastSel) { lastSel = key; emit({type:"selection"}); } };
  const onInput = event => {
    if (event.isComposing) return;
    const now = textOf(), {range:r, inserted} = diff(last, now); last = now;
    emit({type:"input", range:r, inserted, user:!internal}); onSelection();
  };
  const onCompStart = () => { composing = true; last = textOf(); emit({type:"compositionstart"}); };
  const onCompEnd = () => { composing = false; const now = textOf(), {range:r, inserted} = diff(last, now); last = now; emit({type:"compositionend"}); if (r.start !== r.end || inserted) emit({type:"input", range:r, inserted, user:true}); };
  const onBlur = () => { composing = false; lastSel = ""; emit({type:"selection"}); };
  const onBefore = () => { if (!composing) last = textOf(); };
  const bind = () => { el.addEventListener("beforeinput", onBefore); el.addEventListener("input", onInput); el.addEventListener("compositionstart", onCompStart); el.addEventListener("compositionend", onCompEnd); el.addEventListener("blur", onBlur); for (const t of ["keyup", "pointerup", "focus"]) el.addEventListener(t, onSelection); document.addEventListener("selectionchange", onSelection); };
  const unbind = () => { el.removeEventListener("beforeinput", onBefore); el.removeEventListener("input", onInput); el.removeEventListener("compositionstart", onCompStart); el.removeEventListener("compositionend", onCompEnd); el.removeEventListener("blur", onBlur); for (const t of ["keyup", "pointerup", "focus"]) el.removeEventListener(t, onSelection); document.removeEventListener("selectionchange", onSelection); };
  // the @query before the caret, as a DOM range
  const typed = () => {
    const s = adapter.selection(); if (!s || s.start !== s.end) return null;
    const before = textOf().slice(0, s.start), m = /(^|[\s(\uFFFC])@([^@\uFFFC\n]{0,40})$/.exec(before); if (!m) return null;
    return {start:s.start - m[2].length - 1, end:s.start};
  };
  function choose(ref) {
    const found = typed(); if (!ref || !found) return;
    const a = positionOf(found.start), b = positionOf(found.end), r = document.createRange(); r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset); r.deleteContents();
    const chip = chipElement(ref, {editable:true}), space = document.createTextNode(" ");
    r.insertNode(space); r.insertNode(chip);
    const c = document.createRange(); c.setStart(space, 1); c.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(c);
    last = textOf(); onChange();
  }
  menu.editor = adapter;
  menu.triggers = [{char:"@", maxLength:40, pattern:/[^\s@]/, spaces:true, type:"reference"}];
  menu.addEventListener("openchange", event => { opened = !!event.detail.value; if (opened) fill(); });
  menu.addEventListener("querychange", event => {
    const query = String(event.detail.value || ""), empty = content.querySelector("ui-trigger-menu-empty");
    if (empty) empty.textContent = `No match for \u201C${query}\u201D`;
    // A space that leaves nothing matching ends the name: the list closes and what the user types is plain text.
    if (/\s/.test(query)) requestAnimationFrame(() => { if (opened && content.querySelector("ui-trigger-menu-empty")?.hasAttribute("data-empty")) menu.api?.close?.({reason:"imperative"}); });
  });
  menu.addEventListener("itemselect", event => { event.preventDefault(); choose(flat[+event.detail.value]); });
  fill();
  return {close() { menu.api?.close?.({reason:"imperative"}); }, get open() { return opened; }};
}
