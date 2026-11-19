// Side-by-side page support (public/compare.html, UI SDK experiment). Does nothing unless this page is inside a frame.
// It makes a framed page take and keep the keys the way a window does, so the two halves of the page compare honestly:
// - a press anywhere makes this frame the active one (the board cancels the press's default, which would otherwise
//   leave the keys in the other frame);
// - while another frame is active, a focus() call here only sets what will have focus when this frame becomes active
//   again, as in a background window (otherwise a board loading here would take the keys from the other half);
// - when this frame becomes active again, the element that had focus here gets it back;
// - the page asks for the first or last control when Tab wraps past either end of this frame.
if (window.top !== window) {
  const focusOf = HTMLElement.prototype.focus, svgFocusOf = SVGElement.prototype.focus;
  let last = null, wanted = null;
  const active = () => document.hasFocus();
  const hold = original => function (options) {
    if (active()) return original.call(this, options);
    wanted = this;
  };
  HTMLElement.prototype.focus = hold(focusOf);
  SVGElement.prototype.focus = hold(svgFocusOf);
  addEventListener('focusin', event => { if (active()) last = event.target; }, true);
  // Becoming active by a press first restores the focus this page asked for or had, then the press does its own thing.
  addEventListener('pointerdown', () => { if (!active()) window.focus(); }, true);
  addEventListener('focus', () => {
    const target = [wanted, last].find(el => el?.isConnected);
    wanted = null;
    if (target && (document.activeElement === document.body || !document.activeElement)) (target instanceof SVGElement ? svgFocusOf : focusOf).call(target, {preventScroll: true});
  });
  // Tab past the last control comes back to the first, and Shift+Tab past the first goes to the last, as in a window
  // (where one press would visit the browser's own controls first). The app's own Tab handling runs first.
  const TABBABLE = 'a[href],button,input,select,textarea,iframe,[tabindex],[contenteditable=""],[contenteditable=true]';
  const tabbables = () => [...document.querySelectorAll(TABBABLE)].filter(el => el.tabIndex >= 0 && !el.disabled && !el.closest('[inert],[hidden]') && el.getClientRects().length);
  addEventListener('keydown', event => {
    if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const all = tabbables(); if (!all.length) return;
    const edge = event.shiftKey ? all[0] : all.at(-1);
    const at = document.activeElement;
    if (at === edge || (at && edge.contains(at) && !event.shiftKey)) {
      event.preventDefault();
      focusOf.call(event.shiftKey ? all.at(-1) : all[0]);
    }
  });
}
