// The kind legend in the foot of a board: one entry per family on the board, a
// tiny slab in the family's side colour, its name and how many there are. It names
// the colours the cards' sides carry, since the cards themselves print no kind.
//
// Pointing at an entry (or focusing it) lights that family: every other card and
// drawn element dims. Clicking keeps it lit until clicked again (aria-pressed), and
// Escape on the legend lets go. The legend is a ui-toggle-group (one pressed at most, as before): one Tab stop, arrows
// move focus along the entries without pressing, Space or Enter presses. Dimming is the only effect: nothing moves.
//
// The lit family lives on #world as data-lit="<family>", which survives every
// re-render because the board reconciles #world's children, never #world itself.
// Counts are read from the cards just drawn, so they follow adds, removals, filters
// and live updates without a second source of truth.
import {FAMILIES, familyTitle} from "./kinds.js";
import "./vendor/ui-sdk/web/toggle.js";
import {tips, TIP_ID} from "./tips.js";

export class KindLegend {
  constructor(world, footer = document.querySelector(".canvas-footer")) {
    this.world = world;
    this.kept = null;
    this.board = null;
    if (!footer) return;
    const el = this.el = document.createElement("ui-toggle-group");
    el.className = "kind-legend";
    el.setAttribute("aria-label", "Kinds on this board");
    el.hidden = true;
    footer.insertBefore(el, footer.firstChild);
    const entry = event => event.target.closest?.("button[data-family]");
    el.addEventListener("pointerover", event => { const button = entry(event); if (button) this.light(button.dataset.family); });
    el.addEventListener("pointerleave", () => this.light(this.kept));
    el.addEventListener("focusin", event => { const button = entry(event); if (button && button.matches(":focus-visible")) this.light(button.dataset.family); });
    el.addEventListener("focusout", event => { if (!el.contains(event.relatedTarget)) this.light(this.kept); });
    // The group presses and unpresses; its value (one family at most) is the kept family.
    el.addEventListener("valuechange", event => this.keep(event.detail.value[0] || null, {fromGroup: true}));
    el.addEventListener("keydown", event => {
      // A showing tooltip takes Escape first (it closes only itself); the next Escape lets go.
      if (event.key !== "Escape" || !this.kept || document.querySelector("ui-tooltip-content[data-open]")) return;
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
    const existing = new Map([...this.el.children].map(button => [button.dataset.legendEntry, button]));
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
    tips(this.el);
    this.press();
    if (this.kept && !counts[this.kept]) this.keep(null);
    // A lit family that just left the board (by hover) must not keep the rest dim.
    if (this.world.dataset.lit && !counts[this.world.dataset.lit]) this.light(this.kept);
  }
  entry(family) {
    const toggle = document.createElement("ui-toggle");
    const name = familyTitle(family);
    toggle.setAttribute("value", family);
    toggle.innerHTML = `<button type="button" class="kind-legend-entry" data-family="${family}" data-tip="Pick out the ${name.toLowerCase()} on this board"><span class="kind-swatch" aria-hidden="true"></span><span class="kind-legend-name">${name}</span><span class="kind-legend-count"></span></button>`;
    // Each entry sits in its tooltip trigger (tips.js), the outermost wrapper, which carries the entry's key. Only the button
    // carries data-family (the kind's side colour, and what [data-family] queries find): wrappers never repeat it.
    const trigger = document.createElement("ui-tooltip-trigger");
    trigger.setAttribute("for", TIP_ID);
    trigger.dataset.legendEntry = family;
    trigger.append(toggle);
    return trigger;
  }
  // Write the kept family into the group (no event fires for a property write).
  press() {
    const want = this.kept ? [this.kept] : [];
    const have = this.el.value || [];
    if (have.length !== want.length || have[0] !== want[0]) this.el.value = want;
  }
  light(family) {
    if (family) { if (this.world.dataset.lit !== family) this.world.dataset.lit = family; }
    else delete this.world.dataset.lit;
  }
  keep(family, {fromGroup = false} = {}) {
    this.kept = family || null;
    if (!this.el) return;
    if (!fromGroup) this.press();
    // A click shows its result at once: letting go of a kept family un-dims the board
    // even while the pointer is still on its entry.
    this.light(this.kept);
  }
}
