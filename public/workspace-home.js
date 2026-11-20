import {watchChanges} from "./live.js";
import {newestBoardsFirst} from "./board-order.js";
import {reconcileChildren} from "./reconcile.js";
import {coverMarkup,observeCovers} from "./board-covers.js";
import {timeHTML,toDate} from "./relative-dates.js";
import {kindsLine} from "./kinds.js";
import "./home-board-list.js";
import {followVisibility} from "./ui-toolbar.js";
import {tips} from "./tips.js";
import {
  WorkspaceClient,
  escape as esc,
  resourceURL,
  destinationDialog,
  makeDialog,
  newBoardDialog,
  enableOrganization,
  toast,
  showFailure,
} from "./workspace.js";
// Home view state shared by the graph Home and the legacy shelf (home.js owns the controls).
export const homeView = { query: "", sort: "created", count: null };
const TEN_MIN = 10 * 60e3, DAY = 24 * 60 * 60e3;
const msOf = (value) => toDate(value)?.getTime() ?? NaN;
const plural = (n, one, many = one + "s") => `${Number(n) || 0} ${Number(n) === 1 ? one : many}`;
/** The last edit, only when it came meaningfully after creation. */
export function editedAt(board) {
  const created = msOf(board.createdAt), updated = msOf(board.updatedAt);
  return Number.isFinite(updated) && (!Number.isFinite(created) || updated - created > TEN_MIN) ? updated : NaN;
}
/** Display order only. Newest keeps newestBoardsFirst semantics: equal dates keep
 *  source order and missing or invalid dates follow dated boards. */
export function sortHomeBoards(list, sort = homeView.sort) {
  if (sort === "az")
    return [...list].sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base", numeric: true }));
  if (sort === "updated")
    return newestBoardsFirst(list, (b) => {
      const edited = editedAt(b), time = Number.isFinite(edited) ? edited : msOf(b.createdAt);
      return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
    });
  return newestBoardsFirst(list);
}
export function matchesHome(fields, query = homeView.query) {
  const q = String(query || "").trim().toLocaleLowerCase();
  return !q || fields.filter(Boolean).join(" ").toLocaleLowerCase().includes(q);
}
export const FALLBACK_ART = '<div class="sheet"></div><div class="sheet second"><b>Room for an idea.</b></div>';
export const legacyCounts = (b) => [
  Number(b.conceptCount) ? plural(b.conceptCount, "experiment") : "No experiments yet",
  ...(b.buildingCount ? [`<span class="building">${Number(b.buildingCount)} taking shape</span>`] : []),
];
/** Title, New pill, description, the kinds line and the date line. Counts are trusted
 *  markup; `kinds` is a board cover's {kind: count} map. */
export function boardInfo(board, { description = "", counts = [], kinds = null, idBase = "" } = {}) {
  const id = (part) => (idBase ? ` id="${esc(idBase)}-${part}"` : "");
  const created = msOf(board.createdAt), edited = editedAt(board);
  const fresh = Number.isFinite(created) && Date.now() - created < DAY;
  const byEdit = homeView.sort === "updated" && Number.isFinite(edited);
  const primary = byEdit
    ? timeHTML(edited, { prefix: "Edited ", verb: "Edited" })
    : timeHTML(board.createdAt, { prefix: "Created ", verb: "Created" });
  const secondary = !Number.isFinite(edited) ? ""
    : byEdit ? timeHTML(board.createdAt, { prefix: "created ", verb: "Created" })
    : timeHTML(edited, { prefix: "edited ", verb: "Edited" });
  const line = [...counts, primary].filter(Boolean).join('<span class="board-sep" aria-hidden="true"> · </span>');
  return `<div class="board-info"><div class="board-title-row"><h3${id("title")} title="${esc(board.title)}">${esc(board.title)}</h3>${fresh ? '<span class="tk-new">New</span>' : ""}</div><p${id("desc")}>${esc(description)}</p>${kinds ? kindsLine(kinds) : ""}<div class="card-bottom"${id("meta")}><span class="board-meta">${line}</span><span class="board-edited">${secondary}</span></div></div>`;
}
const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 8.5 2.6 2.6L12.2 5.4"/></svg>';
const CLOSE = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 5.5 9 9m0-9-9 9"/></svg>';
// Places a marquee or an empty click must not start from.
const NOT_EMPTY = ".board-card,a,button,input,textarea,select,label,summary,[contenteditable],[role=dialog],[role=menu],[role=toolbar],dialog,.home-selection-bar";
const FIELD = "input,textarea,select,[contenteditable],[role=textbox],[role=dialog],[role=menu]";
// A board option is named by its title and described by its description and dates (not the whole card's text).
const optionIds = (boardId) => `home-board-${String(boardId).replace(/[^\w-]/g, "_")}`;
const optionNaming = (base) => `aria-labelledby="${base}-title" aria-describedby="${base}-desc ${base}-meta"`;
const STAR = '<svg class="tk-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="m8 2.2 1.8 3.7 4 .6-2.9 2.8.7 4L8 11.4l-3.6 1.9.7-4-2.9-2.8 4-.6z"/></svg>';
export class WorkspaceHome {
  constructor(config) {
    this.config = config;
    this.client = new WorkspaceClient(config);
    this.client.onSettled=()=>this.drainLive();
    this.selected = new Set();
    this.archive = false;
    this.favorites = false;
    this.active = false;
  }
  async init() {
    const ws = await this.client.get("/api/workspace?view=home");
    if (!ws.enabled) {
      const box = document.createElement("section");
      box.className = "workspace-enable";
      box.innerHTML =
        '<p>Want to arrange shared ideas, nested boards and freeform canvases? Enable flexible organization for this project.</p><button type="button" class="tk-btn tk-tonal">Enable organization…</button>';
      document.querySelector(".shelf-heading").after(box);
      box.querySelector("button").onclick = () =>
        enableOrganization(this.config);
      return false;
    }
    this.active = true;
    this.workspace = ws;
    this.catalog = (await this.client.get("/api/boards")).boards || [];
    this.client.revision = ws.revision;
    this.toolbar = document.createElement("ui-toolbar");
    this.toolbar.className = "workspace-toolbar workspace-home-toolbar";
    this.toolbar.setAttribute("aria-label", "Find and organize boards");
    this.toolbar.innerHTML =
      `<ui-toolbar-button><button type="button" class="tk-btn tk-sm" data-favorites aria-pressed="false">${STAR}Favorites</button></ui-toolbar-button><ui-toolbar-button><button type="button" class="tk-btn tk-sm" data-archive aria-pressed="false">Archive</button></ui-toolbar-button>`;
    document.querySelector(".shelf-heading").after(this.toolbar);
    this.toolbar.querySelector("[data-favorites]").onclick = (e) => {
      this.favorites = !this.favorites;
      e.currentTarget.setAttribute("aria-pressed", this.favorites);
      this.render();
    };
    this.toolbar.querySelector("[data-archive]").onclick = (e) => {
      this.archive = !this.archive;
      this.selected.clear();
      e.currentTarget.setAttribute("aria-pressed", this.archive);
      this.render();
    };
    // One floating selection bar, the same object as a board's.
    // A ui-toolbar (one Tab stop, arrows along the actions), built once on the first selection and updated in place.
    this.bar = document.createElement("ui-toolbar");
    this.bar.className = "home-selection-bar";
    this.bar.dataset.homeSelection = "";
    this.bar.setAttribute("aria-label", "Selected boards");
    this.bar.hidden = true;
    document.body.append(this.bar);
    this.bar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-home-action]");
      if (b) this.bulk(b.dataset.homeAction);
    });
    this.selectionGestures();
    this.render();
    this.liveDirty=false;
    this.stopLive=watchChanges(this.config,{onChange:()=>{this.liveDirty=true;return this.drainLive();},onConnection:connected=>{document.getElementById("connection").textContent=connected?"Live on this Mac":"Reconnecting";}});
    document.addEventListener("focusout",()=>queueMicrotask(()=>this.drainLive()));
    document.addEventListener("close",()=>this.drainLive(),true);
    return true;
  }
  async refresh() {
    this.workspace = await this.client.get("/api/workspace?view=home");
    this.catalog = (await this.client.get("/api/boards")).boards || [];
    this.client.revision = this.workspace.revision;
    this.render();
  }
  async drainLive() {
    if(!this.liveDirty||this.liveRunning||this.client.pendingWrites||document.querySelector("dialog[open]"))return;
    this.liveRunning=true;
    try{while(this.liveDirty&&!document.querySelector("dialog[open]")){this.liveDirty=false;await this.refresh();}}
    catch{this.liveDirty=true;document.getElementById("connection").textContent="Reconnecting";}
    finally{this.liveRunning=false;}
  }
  render() {
    const ws = this.workspace,
      items = new Map(ws.items.map((i) => [i.id, i]));
    const visible = ws.boards
      .filter((b) => ws.homeBoardIds.includes(b.id))
      .filter((b) => {
        const i = items.get(b.ownerItemId);
        return (
          i &&
          !i.deletedAt &&
          (this.archive ? !!i.archivedAt : !i.archivedAt) &&
          (!this.favorites || i.review?.star)
        );
      });
    const legacyAll = (this.catalog || []).filter(
      (b) => b.schemaVersion !== 2 && !this.archive && !this.favorites,
    );
    const boards = visible.filter((b) =>
      matchesHome([b.title, b.description, items.get(b.ownerItemId)?.description]),
    );
    const legacy = legacyAll.filter((b) => matchesHome([b.title, b.description]));
    const shown = boards.length + legacy.length;
    homeView.count?.(shown, visible.length + legacyAll.length);
    // Selection never outlives a board's place on this Home view.
    const present = new Set(visible.map((b) => b.ownerItemId));
    for (const id of this.selected) if (!present.has(id)) this.selected.delete(id);
    // The boards are one listbox (home-board-list.js); the empty-state line and the New board card sit beside it.
    const markup =
      '<fr-board-list aria-label="Boards">' +
      sortHomeBoards([...boards, ...legacy])
        .map((b) => {
          if (b.schemaVersion !== 2) return this.legacyCard(b);
          const i = items.get(b.ownerItemId),
            image = resourceURL(i.preview?.resource),
            cover = ws.boardCovers?.[b.id],
            selected = this.selected.has(i.id);
          const art = image
            ? `<img src="${esc(image)}" alt="">`
            : !cover?.tiles?.length && !b.itemCount
              ? '<span class="board-empty">Empty board</span>'
              : coverMarkup(cover, b.id);
          const counts = [
            b.itemCount ? plural(b.itemCount, "item") : "No items yet",
            ...(b.roundCount ? [`${plural(b.roundCount, "prior round")}`] : []),
          ];
          // The select circle is for the pointer: out of the Tab order and the accessibility tree (the board's
          // option carries aria-selected; Space toggles it). The wrapper's re-render key is data-home-entry, not
          // data-home-board: the card keeps that one alone, so [data-home-board=id] finds one element.
          return `<fr-board value="${esc(i.id)}" data-home-entry="${esc(b.id)}"><article data-home-board="${esc(b.id)}" data-home-item="${esc(i.id)}" class="board-card${selected ? " workspace-home-selected" : ""}" role="none" data-kind="board" data-family="board"><button type="button" class="home-select-dot" data-home-select="${esc(i.id)}" tabindex="-1" aria-hidden="true">${CHECK}</button><a class="board-link" href="/boards/${encodeURIComponent(b.id)}/" ${optionNaming(optionIds(b.id))}><div class="board-art" aria-hidden="true">${art}</div>${boardInfo(b, { description: b.description || i.description || "A place to gather what you make.", counts, kinds: cover?.kinds, idBase: optionIds(b.id) })}</a></article></fr-board>`;
        })
        .join("") +
      "</fr-board-list>" +
      (homeView.query.trim() && !shown
        ? `<p class="board-none">No boards match “${esc(homeView.query.trim())}”.</p>`
        : "") +
      (homeView.query.trim() ? "" : '<button class="new-board empty-card" type="button"><span class="plus" aria-hidden="true">+</span><strong>New board</strong><small>A place for the next idea.</small></button>');
    const grid = document.getElementById("board-grid"), template = document.createElement("template");
    template.innerHTML = markup;
    reconcileChildren(grid,template.content);
    this.coverObserver = observeCovers(grid,this.coverObserver);
    document.getElementById("shelf-status").textContent =
      boards.length + (boards.length === 1 ? " board" : " boards") + " · shared items, project-owned files";
    document.getElementById("connection").textContent = "Live on this Mac";
    document
      .querySelectorAll("[data-convert-legacy]")
      .forEach((b) => (b.onclick = () => enableOrganization(this.config)));
    this.syncSelection();
  }
  /** The board list (home-board-list.js), once it is in the page: its selection is ours, written back to it. */
  get list() {
    const list = document.querySelector("#board-grid fr-board-list");
    if (list && list !== this.boundList) {
      this.boundList = list;
      list.selectable = (key) => !key.startsWith("legacy:");
      // Every pointer and keyboard selection asks here first; Home's set stays the one source of truth.
      list.addEventListener("valuechange", (e) => this.setSelection(new Set(e.detail.value)));
    }
    return list;
  }
  /** Card state and the floating bar, without rebuilding the grid. */
  syncSelection() {
    for (const card of document.querySelectorAll("#board-grid .board-card[data-home-item]"))
      card.classList.toggle("workspace-home-selected", this.selected.has(card.dataset.homeItem));
    const list = this.list;
    if (list) list.value = [...this.selected];
    document.body.classList.toggle("home-selecting", this.selected.size > 0);
    if (this.marquee?.active) return; // The bar keeps its state until the box finishes.
    const n = this.selected.size, bar = this.bar;
    if (!n) {
      const hadFocus = bar.contains(document.activeElement);
      bar.hidden = true;
      if (hadFocus) this.list?.api?.focus();
      return;
    }
    // Built once, then only the count and the Archive/Restore label change, so a focused action keeps focus.
    if (!bar.dataset.built) {
      bar.dataset.built = "1";
      const part = (html) => `<ui-toolbar-button>${html}</ui-toolbar-button>`;
      const action = (name, label) => part(`<button type="button" class="tk-btn tk-sm" data-home-action="${name}">${label}</button>`);
      bar.innerHTML = `<strong role="status"></strong>${action("move", "Move…")}${action("reference", "Add reference…")}${action("archive", "")}${action("remove", "Remove from home…")}<span class="tk-divider" aria-hidden="true"></span>${part(`<button type="button" class="tk-btn tk-sm tk-icon" data-home-action="clear" aria-label="Clear selection" aria-keyshortcuts="Escape" data-tip="Clear selection">${CLOSE}</button>`)}`;
      tips(bar);
      followVisibility(bar);
    }
    const count = bar.querySelector("strong");
    if (count.textContent !== `${n} selected`) count.textContent = `${n} selected`;
    const label = this.archive ? "Restore everywhere" : "Archive everywhere";
    const archive = bar.querySelector('[data-home-action="archive"]');
    if (archive.textContent !== label) archive.textContent = label;
    bar.hidden = false;
  }
  setSelection(next) {
    if (next.size === this.selected.size && [...next].every((id) => this.selected.has(id))) return;
    this.selected = next;
    this.syncSelection();
  }
  /** The board's selection language on Home, as a file manager has it: the corner circle and ⌘/Ctrl-click toggle a
   *  board, Shift-click selects the range from the anchor, a marquee on empty space (mouse or pen), ⌘A, Escape.
   *  The list (home-board-list.js) owns the keys, focus and the anchor; this adds the pointer. Selection never writes. */
  selectionGestures() {
    const grid = document.getElementById("board-grid");
    let suppressClick = false;
    const cards = () => [...grid.querySelectorAll(".board-card[data-home-item]")];
    const press = (card, e, range) => this.list?.api?.press(card.dataset.homeItem, e, { range });
    document.addEventListener("click", (e) => {
      if (suppressClick) {
        suppressClick = false;
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (e.button !== 0 || e.altKey) return;
      const dot = e.target.closest("[data-home-select]");
      if (dot && grid.contains(dot)) {
        e.preventDefault();
        press(dot.closest(".board-card"), e, false);
        return;
      }
      // Shift-click selects a range, ⌘- or Ctrl-click toggles a board; a plain click still opens it.
      if (!(e.shiftKey || e.metaKey || e.ctrlKey)) return;
      const card = e.target.closest("#board-grid .board-card[data-home-item]");
      if (!card || e.target.closest("input,textarea,select,[contenteditable],.board-actions")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      press(card, e, e.shiftKey && !e.metaKey && !e.ctrlKey);
    }, true);
    // macOS turns Ctrl-click into a context menu with no click; treat it the same.
    document.addEventListener("contextmenu", (e) => {
      if (!e.ctrlKey || e.button !== 0 || e.altKey || e.metaKey) return;
      const card = e.target.closest?.("#board-grid .board-card[data-home-item]");
      if (!card || e.target.closest("[data-home-select],input,textarea,select,[contenteditable],.board-actions")) return;
      e.preventDefault();
      press(card, e, false);
    });
    // The circle never takes focus itself (the board does, in press()).
    document.addEventListener("mousedown", (e) => {
      if (e.button === 0 && e.target.closest?.("#board-grid [data-home-select]")) e.preventDefault();
    });
    // ⌘A / Ctrl+A selects every board (again clears) wherever focus is, except in a field or a dialog. Inside the
    // list the list handles it first.
    document.addEventListener("keydown", (e) => {
      if (!this.active || e.defaultPrevented || e.repeat || e.isComposing || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey ||
          e.key.toLowerCase() !== "a" || document.querySelector("dialog[open]") || e.target.closest?.(FIELD)) return;
      e.preventDefault();
      this.list?.api?.selectAll(e);
    });
    // A modified press on a card must not start a text selection either.
    document.addEventListener("mousedown", (e) => {
      if ((e.shiftKey || e.metaKey || e.ctrlKey) && e.button === 0 && e.target.closest?.("#board-grid .board-card[data-home-item]")) e.preventDefault();
    });
    const draw = () => {
      const m = this.marquee;
      if (!m?.active) return;
      const x = m.last.x + scrollX, y = m.last.y + scrollY;
      const page = { left: Math.min(m.x, x), top: Math.min(m.y, y), right: Math.max(m.x, x), bottom: Math.max(m.y, y) };
      Object.assign(m.box.style, { left: `${page.left}px`, top: `${page.top}px`, width: `${page.right - page.left}px`, height: `${page.bottom - page.top}px` });
      const box = { left: page.left - scrollX, top: page.top - scrollY, right: page.right - scrollX, bottom: page.bottom - scrollY };
      const next = new Set(m.additive ? m.original : []);
      if (box.right > box.left && box.bottom > box.top)
        for (const card of cards()) {
          const r = (card.querySelector(".board-link") || card).getBoundingClientRect();
          if (r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom) next.add(card.dataset.homeItem);
        }
      this.setSelection(next);
      const text = `${next.size} selected`;
      if (m.count.textContent !== text) m.count.textContent = text;
    };
    const finish = (cancelled) => {
      const m = this.marquee;
      if (!m) return;
      if (m.active && !cancelled) draw();
      this.marquee = null;
      removeEventListener("scroll", draw);
      m.box?.remove();
      document.documentElement.classList.remove("home-marquee-active");
      try { document.documentElement.releasePointerCapture(m.pointerId); } catch {}
      if (cancelled) this.setSelection(new Set(m.original));
      else if (!m.active && !m.additive) this.setSelection(new Set());
      if (m.active && !cancelled) suppressClick = true;
      this.syncSelection();
    };
    document.addEventListener("pointerdown", (e) => {
      suppressClick = false;
      if (this.marquee) { finish(true); return; }
      if (!this.active || e.button !== 0 || !e.isPrimary || !["mouse", "pen"].includes(e.pointerType) ||
          e.ctrlKey || e.metaKey || e.altKey || document.querySelector("dialog[open]")) return;
      const main = e.target.closest?.("main");
      if (!main || e.target.closest(NOT_EMPTY)) return;
      this.marquee = { pointerId: e.pointerId, start: { x: e.clientX, y: e.clientY }, last: { x: e.clientX, y: e.clientY },
        x: e.clientX + scrollX, y: e.clientY + scrollY, original: new Set(this.selected), additive: e.shiftKey, active: false };
    });
    document.addEventListener("selectstart", (e) => { if (this.marquee) e.preventDefault(); });
    document.addEventListener("pointermove", (e) => {
      const m = this.marquee;
      if (!m || m.pointerId !== e.pointerId) return;
      m.last = { x: e.clientX, y: e.clientY };
      if (!m.active) {
        if (Math.hypot(e.clientX - m.start.x, e.clientY - m.start.y) < 6) return;
        m.active = true;
        m.box = document.createElement("div");
        m.box.className = "home-marquee";
        m.box.innerHTML = '<span class="home-marquee-count" role="status"></span>';
        m.count = m.box.firstElementChild;
        document.body.append(m.box);
        document.documentElement.classList.add("home-marquee-active");
        getSelection()?.removeAllRanges();
        try { document.documentElement.setPointerCapture(e.pointerId); } catch {}
        addEventListener("scroll", draw, { passive: true });
      }
      draw();
    });
    document.addEventListener("pointerup", (e) => {
      if (this.marquee?.pointerId !== e.pointerId) return;
      this.marquee.last = { x: e.clientX, y: e.clientY };
      finish(false);
    });
    document.addEventListener("pointercancel", (e) => { if (this.marquee?.pointerId === e.pointerId) finish(true); });
    document.documentElement.addEventListener("lostpointercapture", (e) => { if (this.marquee?.active && this.marquee.pointerId === e.pointerId) finish(true); });
    addEventListener("blur", () => finish(true));
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !this.marquee) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      finish(true);
    }, true);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !this.selected.size || e.defaultPrevented || e.isComposing ||
          document.querySelector("dialog[open]") || e.target.closest?.(FIELD)) return;
      e.preventDefault();
      this.selected.clear();
      this.syncSelection();
    });
  }
  legacyCard(b) {
    return `<fr-board value="legacy:${esc(b.id)}" data-home-entry="${esc(b.id)}"><article data-home-board="${esc(b.id)}" class="board-card board-card-legacy" role="none" data-kind="board" data-family="board"><a class="board-link" href="/boards/${encodeURIComponent(b.id)}/" ${optionNaming(optionIds(b.id))}><div class="board-art" aria-hidden="true">${FALLBACK_ART}<span class="art-label">Legacy board · compare as before</span></div>${boardInfo(b, { description: b.description || "Existing rounds, revisions and feedback remain available.", counts: legacyCounts(b), idBase: optionIds(b.id) })}</a><div class="board-actions"><button type="button" class="tk-btn tk-sm" data-convert-legacy>Convert to organize…</button></div></article></fr-board>`;
  }
  create(opener) {
    const invoker = opener.classList.contains("empty-card") ? ".new-board.empty-card" : ".new-board:not(.empty-card)";
    newBoardDialog(this.client, {
      opener: () => opener.isConnected ? opener : document.querySelector(invoker),
      refresh: () => this.refresh(),
    });
  }
  async bulk(type) {
    const ids = [...this.selected];
    try {
      if (type === "clear") {
        this.selected.clear();
        this.syncSelection();
        return;
      }
      if (type === "move" || type === "reference") {
        await destinationDialog(this.client, {
          itemIds: ids,
          kind: type,
          refresh: async () => {
            this.selected.clear();
            await this.refresh();
          },
        });
        return;
      }
      if (type === "remove") {
        makeDialog(
          "Remove boards from home?",
          '<p>Remove these home placements. Their boards, items, references, notes and resource files remain intact. You can still reach them through existing links or references.</p><button type="submit" class="workspace-primary">Remove from home</button>',
          async () => {
            const homes = this.workspace.homeBoardIds.filter(
              (id) =>
                !ids.includes(
                  this.workspace.boards.find((b) => b.id === id)?.ownerItemId,
                ),
            );
            await this.client.write("updateWorkspace", {
              patch: { homeBoardIds: homes },
            });
            this.selected.clear();
            await this.refresh();
          },
        );
        return;
      }
      makeDialog(
        this.archive
          ? "Restore these boards everywhere?"
          : "Archive these boards everywhere?",
        `<p>${this.archive ? "Restore these canonical board items on home and every board where they are referenced." : "Archive these canonical board items on home and every board where they are referenced. Their content and resource files remain intact."}</p><button type="submit" class="workspace-primary">${this.archive ? "Restore everywhere" : "Archive everywhere"}</button>`,
        async () => {
          await this.client.write("archiveItem", {
            itemIds: ids,
            archived: !this.archive,
          });
          this.selected.clear();
          await this.refresh();
          toast(
            this.archive
              ? "Boards restored everywhere."
              : "Boards archived everywhere. Open Archive to restore.",
          );
        },
      );
    } catch (e) {
      showFailure(e);
    }
  }
}
