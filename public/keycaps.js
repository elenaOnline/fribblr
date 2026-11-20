// Prints a command's shortcut on its labelled key, as a small keycap ("Fit F").
// It teaches the keyboard at the place you click. Hidden on touch and at phone
// width (legend.css).
//
// The source is the button's aria-keyshortcuts: the binding the control declares
// for assistive technology, in the standard "Shift+1" form. The cap is that
// attribute's first shortcut, so the cap, the screen reader and the button's own
// declaration say the same thing, and a cap follows the attribute when the app
// changes it (Fit switches between "F Shift+1" and "F Shift+2"). A control declares
// only a binding the app really has, for that same command (Details… and ⌘I both
// open the one selected item's details). Icon-only keys and keys that already print
// a <kbd> are left alone. Caps join the raised height (depth.css).
import {isMacPlatform} from "./reader-keys.js";

const MAC = isMacPlatform();
const NAMES = {
  Enter: "↩", Escape: "Esc", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  Space: "Space", Tab: "⇥", Backspace: "⌫", Delete: "⌦", Minus: "−", Plus: "+",
};
/** "Shift+1" -> "⇧1", "Meta+K" -> "⌘K" on a Mac; "Control+K" -> "Ctrl+K" elsewhere. */
export function capLabel(shortcut, mac = MAC) {
  const parts = String(shortcut || "").split("+").filter(Boolean);
  if (!parts.length) return "";
  const name = part => part === "Shift" ? (mac ? "⇧" : "Shift") : part === "Meta" ? (mac ? "⌘" : "Win") : part === "Control" ? (mac ? "⌃" : "Ctrl") : part === "Alt" ? (mac ? "⌥" : "Alt")
    : NAMES[part] ?? (part.length === 1 ? part.toUpperCase() : part);
  const names = parts.map(name);
  return names.join(names.every(n => n.length === 1) ? "" : "+");
}
/** The shortcut a control declares, as printed on its cap, or "". A command bound to
 *  ⌘ on a Mac and Ctrl elsewhere declares both ("Meta+D Control+D"); the cap shows
 *  the first one that belongs to this platform. */
export function capFor(button, mac = MAC) {
  const all = (button.getAttribute("aria-keyshortcuts") || "").trim().split(/\s+/).filter(Boolean);
  const foreign = mac ? /(^|\+)Control\+/ : /(^|\+)Meta\+/;
  return capLabel(all.find(shortcut => !foreign.test(shortcut)) || all[0], mac);
}

// Labelled keys and menu rows; icon-only keys print nothing.
// (the drawing bar's text-label actions, the Add menu's rows and a drawing's More rows are labelled keys too)
const LABELLED = ":is(button.tk-btn, .tk-mi, button.whiteboard-action-caption, .workspace-add-menu button, .whiteboard-menu button)[aria-keyshortcuts]:not(.tk-icon)";
function print(root = document) {
  for (const button of root.querySelectorAll(LABELLED)) {
    let cap = button.querySelector(":scope > kbd.keycap-printed");
    if (!cap && button.querySelector("kbd")) continue;
    const label = capFor(button);
    if (!label) { cap?.remove(); continue; }
    if (!cap) {
      cap = document.createElement("kbd");
      cap.className = "tk-kbd keycap-printed";
      cap.setAttribute("aria-hidden", "true");
      button.append(cap);
    }
    if (cap.textContent !== label) cap.textContent = label;
  }
}

if (typeof document !== "undefined") {
  let queued = false;
  const run = () => { queued = false; print(); };
  const start = () => {
    run();
    // Chrome is built and changed by script; the board's cards are not chrome, so
    // their constant re-rendering never schedules a pass.
    new MutationObserver(records => {
      if (queued || records.every(record => record.target.closest?.("#world"))) return;
      queued = true; requestAnimationFrame(run);
    }).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ["aria-keyshortcuts"]});
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
}
