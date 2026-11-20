// The command buttons of the board's and the opened Tinka's top bars as one UI SDK Toolbar each (toolbar.md;
// ui-sdk.md § Top bars). The bar's left part (home, Navigator, the parent crumb, the title, Up, the path, the stepper)
// is navigation: links and places, each its own Tab stop, as other apps' headers and the SDK's Navigation Menu keep
// them. The right part acts on what is shown (Find, Undo, Redo, Inspector, Add; Favorite, Notes, Find, Inspector): a
// toolbar, one Tab stop, arrows along it, Home and End to its ends.
//
// The toolbar element (`ui-toolbar.chrome-actions`) is in board.html; its buttons come from several places (the page,
// workspace-board.js, a re-render), so each button is wrapped in its `ui-toolbar-button` here as it arrives. The part
// goes right around the button, inside any tooltip trigger (the tooltip trigger must stay the outermost wrapper,
// ui-sdk.md § Tooltips). A button that is not rendered (hidden, or dropped at a narrow width) leaves the arrow order;
// a disabled one (Undo with nothing to undo) stays reachable and says it is disabled, as the SDK's toolbar items do:
// set it with setItemDisabled(), not button.disabled.
import './vendor/ui-sdk/web/toolbar.js';

const PART_AROUND = 'ui-toolbar-button,ui-toolbar-input,ui-toggle,ui-toggle-group';

function wrap(toolbar) {
  for (const button of toolbar.querySelectorAll('button')) {
    if (button.closest('ui-toolbar') !== toolbar || button.closest(PART_AROUND) || button.closest('[data-slot$="-content"]')) continue;
    const part = document.createElement('ui-toolbar-button');
    if (button.disabled) { button.disabled = false; part.__off = true; }
    button.before(part);
    part.append(button);
  }
}

function sync(toolbar) {
  for (const part of toolbar.querySelectorAll('ui-toolbar-button')) {
    if (part.closest('ui-toolbar') !== toolbar) continue;
    const button = part.querySelector('button,a[href]');
    const gone = !button || button.getClientRects().length === 0;
    const disabled = gone || !!part.__off;
    if (gone) part.setAttribute('focusable-when-disabled', 'false'); else part.removeAttribute('focusable-when-disabled');
    if (part.disabled !== disabled) part.disabled = disabled;
  }
}

export function headerToolbar(toolbar) {
  if (!toolbar || toolbar.__headerToolbar) return toolbar;
  toolbar.__headerToolbar = true;
  let queued = 0;
  const run = () => { queued = 0; wrap(toolbar); sync(toolbar); };
  const queue = () => { if (!queued) queued = requestAnimationFrame(run); };
  // Only the bar's own few elements are watched; nothing here runs on the board's pan, zoom or drag paths.
  new MutationObserver(records => { if (records.some(record => record.type === 'childList' || record.target !== toolbar)) queue(); })
    .observe(toolbar, {subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class']});
  addEventListener('resize', queue);
  // A bar inside something shown and hidden (the board map) re-reads its items when it appears.
  if (typeof ResizeObserver === 'function') {
    const box = getComputedStyle(toolbar).display === 'contents' ? toolbar.parentElement : toolbar;
    if (box) new ResizeObserver(queue).observe(box);
  }
  run();
  return toolbar;
}

// Disabled, the item stays in the arrow order with aria-disabled (the SDK's default for toolbar items) and ignores
// presses. Outside a toolbar it is plain button.disabled.
export function setItemDisabled(button, on) {
  if (!button) return;
  const part = button.closest('ui-toolbar-button');
  if (!part || !part.closest('ui-toolbar')?.__headerToolbar) { button.disabled = !!on; return; }
  button.disabled = false;
  if (part.__off === !!on) return;
  part.__off = !!on;
  sync(part.closest('ui-toolbar'));
}
