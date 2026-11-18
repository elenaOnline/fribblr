// Prints a command's shortcut on its labelled key, as a small keycap ("Fit F").
// It teaches the keyboard at the place you click. Hidden on touch and at phone
// width (legend.css).
//
// The source is the button's aria-keyshortcuts: the binding the control declares
// for assistive technology, in the standard "Shift+1" form. The cap is that
// attribute's first shortcut, so the cap, the screen reader and the button's own
// declaration say the same thing, and a cap follows the attribute when the app
// changes it (Fit switches between "F Shift+1" and "F Shift+2"). Icon-only keys
// and keys that already print a <kbd> are left alone.
import {isMacPlatform} from "./reader-keys.js";

const MAC = isMacPlatform();
const NAMES = {
  Shift: "⇧", Enter: "↩", Escape: "Esc", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  Space: "Space", Tab: "⇥", Backspace: "⌫", Delete: "⌦", Minus: "−", Plus: "+",
};
/** "Shift+1" -> "⇧1", "Meta+K" -> "⌘K" on a Mac; "Control+K" -> "Ctrl+K" elsewhere. */
export function capLabel(shortcut, mac = MAC) {
  const parts = String(shortcut || "").split("+").filter(Boolean);
  if (!parts.length) return "";
  const name = part => part === "Meta" ? (mac ? "⌘" : "Win") : part === "Control" ? (mac ? "⌃" : "Ctrl") : part === "Alt" ? (mac ? "⌥" : "Alt")
    : NAMES[part] ?? (part.length === 1 ? part.toUpperCase() : part);
  const names = parts.map(name);
  return names.join(names.every(n => n.length === 1) ? "" : "+");
}
/** The first shortcut a control declares, as printed on its cap, or "". */
export const capFor = (button, mac = MAC) => capLabel((button.getAttribute("aria-keyshortcuts") || "").trim().split(/\s+/)[0], mac);

const LABELLED = "button.tk-btn[aria-keyshortcuts]:not(.tk-icon)";
function print(root = document) {
  for (const button of root.querySelectorAll(LABELLED)) {
    let cap = button.querySelector(":scope > kbd.keycap-printed");
    if (!cap && button.querySelector("kbd")) continue;
    const label = capFor(button);
    if (!label || label.length > 4) { cap?.remove(); continue; }
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
