// The Inspectors (the board's, an item's, the opened Tinka's) as UI SDK's non-modal Dialog (dialog.md § Modal;
// ui-sdk.md § Inspectors). A side panel is a working surface beside the board, like the Navigator: the board stays
// usable around it, so it is not modal and not a Popover (a Popover hangs off its trigger and closes when focus
// leaves; a Drawer is a modal sheet with a drag handle).
//
// Markup: <ui-dialog modal="false" close-on-outside-press><ui-dialog-content inline class="calm-side …" hidden>.
// `inline` keeps the panel in its fixed place and stacking (no top layer). What the SDK then does:
// - Opening focuses the first control in the panel's body (not its × key), or nothing when opened without focus.
// - Escape closes it while focus is inside; focus goes back to the control that opened it (`final-focus`), or, when a
//   shortcut opened it (⌘I), to whatever had focus before.
// - Tab leaves it like any part of the page, and it stays open ("A non-modal dialog stays open", popups.md § Focus).
// - A press outside closes it; a press on one of its own openers is theirs (they toggle it), not a click-away.
import './vendor/ui-sdk/web/dialog.js';
import {tabStops} from './reader-dialog.js';

export function sidePanel(root, {openers = () => [], keepOpen = () => false, body = content => content, onClosed = () => {}} = {}) {
  const content = root.querySelector('ui-dialog-content');
  root.setAttribute('modal', 'false');
  root.setAttribute('close-on-outside-press', '');
  let closing = false;
  // A press that began inside the panel is never a click-away, even when what was pressed is re-rendered away before
  // the press ends (a Copy button, a choice that redraws its row): the SDK then finds the target outside.
  let pressedInside = false;
  document.addEventListener('pointerdown', event => { pressedInside = root.open && content.contains(event.target); }, true);
  root.addEventListener('openchange', event => {
    const {value, reason, event: cause} = event.detail || {};
    if (value) return;
    const target = cause?.target instanceof Node ? cause.target : null;
    if (reason === 'outside-press' && (pressedInside || (target && !target.isConnected) || openers().some(el => el?.contains?.(target)) || keepOpen(target))) { event.preventDefault(); return; }
    // The panels slide in and have no exit; the SDK keeps a closing popup until its animations end, so closing is
    // immediate only when they are finished (as the Navigator does).
    for (const animation of content.getAnimations?.() || []) animation.finish();
    if (closing) return;
    closing = true;
    panel.hadFocus = content.contains(document.activeElement);
    queueMicrotask(() => { closing = false; onClosed(reason); });
  });
  const panel = {
    root, content,
    get isOpen() { return !!root.open; },
    // `opener`: the control focus goes back to (an element with an id, or a selector that finds it again after a
    // re-render). `focus`: false opens it without moving focus; an element inside it starts there.
    open({opener = null, focus = true} = {}) {
      const finalFocus = typeof opener === 'string' ? opener : opener?.id ? `#${CSS.escape(opener.id)}` : '';
      if (finalFocus) content.setAttribute('final-focus', finalFocus); else content.removeAttribute('final-focus');
      content.querySelectorAll('[data-initial-focus]').forEach(element => element.removeAttribute('data-initial-focus'));
      if (focus) {
        // The SDK's initial focus is the first focusable element, which is the header's × key; the first control of
        // the panel's body is where the work is (as in the SDK's examples, which put Close last).
        let first = focus instanceof Element && content.contains(focus) ? focus : null;
        if (!first) {
          content.hidden = false;
          first = tabStops(body(content))[0];
          content.hidden = !root.open;
        }
        first?.setAttribute('data-initial-focus', '');
        content.setAttribute('initial-focus', first ? '[data-initial-focus]' : 'auto');
      } else content.setAttribute('initial-focus', 'none');
      if (root.open) { if (focus) content.querySelector('[data-initial-focus]')?.focus({preventScroll: true}); return; }
      if (root.api?.open) root.api.open(); else root.open = true;
    },
    // True when focus was inside as it last closed (read it in onClosed).
    hadFocus: false,
    close() {
      if (!root.open) return;
      panel.hadFocus = content.contains(document.activeElement);
      if (root.api?.close) root.api.close(); else root.open = false;
    },
    toggle(options) { if (root.open) panel.close(); else panel.open(options); },
  };
  return panel;
}

// Closes the side panel `content` belongs to (for code that only knows the panel element, as workspace-board.js
// knows #board-info). Its openers' aria-expanded follow through the panel's onClosed.
export function closePanel(content) {
  const root = content?.closest?.('ui-dialog');
  if (!root?.open) return;
  if (root.api?.close) root.api.close(); else root.open = false;
}
