// The kind legend in the foot of a board: one entry per family on the board, a
// tiny slab in the family's side colour, its name and how many there are. It names
// the colours the cards' sides carry, since the cards themselves print no kind.
//
// Pointing at an entry (or focusing it) lights that family: every other card and
// drawn element dims. Clicking keeps it lit until clicked again (aria-pressed), and
// Escape on the legend lets go. Dimming is the only effect: nothing moves.
//
// The lit family lives on #world as data-lit="<family>", which survives every
// re-render because the board reconciles #world's children, never #world itself.
// Counts are read from the cards just drawn, so they follow adds, removals, filters
// and live updates without a second source of truth.
import {FAMILIES, familyTitle} from "./kinds.js";

export class KindLegend {
  constructor(world, footer = document.querySelector(".canvas-footer")) {
    this.world = world;
    this.kept = null;
    this.board = null;
    if (!footer) return;
    const el = this.el = document.createElement("div");
    el.className = "kind-legend";
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", "Kinds on this board");
    el.hidden = true;
    footer.insertBefore(el, footer.firstChild);
    const entry = event => event.target.closest?.("button[data-family]");
    el.addEventListener("pointerover", event => { const button = entry(event); if (button) this.light(button.dataset.family); });
    el.addEventListener("pointerleave", () => this.light(this.kept));
    el.addEventListener("focusin", event => { const button = entry(event); if (button && button.matches(":focus-visible")) this.light(button.dataset.family); });
    el.addEventListener("focusout", event => { if (!el.contains(event.relatedTarget)) this.light(this.kept); });
    el.addEventListener("click", event => {
      const button = entry(event);
      if (button) this.keep(this.kept === button.dataset.family ? null : button.dataset.family);
    });
    el.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !this.kept) return;
      event.preventDefault(); event.stopPropagation();
      this.keep(null);
    });
  }
  /** Families and counts of the cards on the board right now. */
  counts() {
    const counts = {};
    for (const card of this.world.querySelectorAll(".workspace-card[data-placement][data-family]"))
      counts[card.dataset.family] = (counts[card.dataset.family] || 0) + 1;
    return counts;
  }
  /** Call after every render of the board's cards. */
  update(boardId) {
    if (!this.el) return;
    if (boardId !== this.board) { this.board = boardId; this.keep(null); }
    const counts = this.counts(), present = FAMILIES.filter(family => counts[family]);
    // Update in place, so an entry that has focus keeps it through live updates.
    const existing = new Map([...this.el.children].map(button => [button.dataset.family, button]));
    for (const [family, button] of existing) if (!counts[family]) button.remove();
    let cursor = this.el.firstElementChild;
    for (const family of present) {
      let button = existing.get(family);
      if (!button || !button.isConnected) button = this.entry(family);
      const count = String(counts[family]);
      const shown = button.querySelector(".kind-legend-count");
      if (shown.textContent !== count) shown.textContent = count;
      if (button !== cursor) this.el.insertBefore(button, cursor);
      cursor = button.nextElementSibling;
    }
    this.el.hidden = !present.length;
    if (this.kept && !counts[this.kept]) this.keep(null);
    // A lit family that just left the board (by hover) must not keep the rest dim.
    if (this.world.dataset.lit && !counts[this.world.dataset.lit]) this.light(this.kept);
  }
  entry(family) {
    const button = document.createElement("button");
    const name = familyTitle(family);
    button.type = "button";
    button.className = "kind-legend-entry";
    button.dataset.family = family;
    button.setAttribute("aria-pressed", String(this.kept === family));
    button.title = `Pick out the ${name.toLowerCase()} on this board`;
    button.innerHTML = `<span class="kind-swatch" aria-hidden="true"></span><span class="kind-legend-name">${name}</span><span class="kind-legend-count"></span>`;
    return button;
  }
  light(family) {
    if (family) { if (this.world.dataset.lit !== family) this.world.dataset.lit = family; }
    else delete this.world.dataset.lit;
  }
  keep(family) {
    this.kept = family || null;
    if (!this.el) return;
    for (const button of this.el.children) button.setAttribute("aria-pressed", String(button.dataset.family === this.kept));
    // A click shows its result at once: letting go of a kept family un-dims the board
    // even while the pointer is still on its entry.
    this.light(this.kept);
  }
}
