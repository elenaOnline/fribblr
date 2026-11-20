// ui-toolbar glue. The SDK's toolbar has no idea that an item can be absent: an item hidden with the `hidden`
// attribute, or by a media query (a narrow screen drops some actions), would still be a tab stop or an arrow-key
// stop, and focus would land on nothing. followVisibility() keeps those items out of the toolbar's order: any
// ui-toolbar-button whose button is not rendered is marked disabled and not focusable (the SDK's own
// focusable-when-disabled="false"), and comes back when it is shown again.
import './vendor/ui-sdk/web/toolbar.js';

export function followVisibility(toolbar) {
  if (!toolbar || toolbar.__followVisibility) return;
  toolbar.__followVisibility = true;
  let queued = 0;
  const run = () => {
    queued = 0;
    for (const part of toolbar.querySelectorAll('ui-toolbar-button')) {
      const button = part.querySelector('button');
      const skip = !button || button.getClientRects().length === 0;
      if (skip === !!part.__skipped) continue;
      part.__skipped = skip;
      if (skip) { part.setAttribute('focusable-when-disabled', 'false'); part.disabled = true; }
      else { part.disabled = false; part.removeAttribute('focusable-when-disabled'); }
    }
  };
  const queue = () => { if (!queued) queued = requestAnimationFrame(run); };
  new MutationObserver(queue).observe(toolbar, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
  if (typeof ResizeObserver === 'function') new ResizeObserver(queue).observe(toolbar);
  addEventListener('resize', queue);
  run();
}

// ---- Toggle buttons the app owns -------------------------------------------------------------------------------------
// A pressed/unpressed button (the board map, the canvas tools rail) is a ui-toggle around our button: the SDK writes
// aria-pressed / data-pressed and takes Space and Enter, and in a toolbar it joins the arrow order. The app owns the
// state (the map also opens by itself, a key flips it): `onPress(toggle, fn)` hears the press, cancels the SDK's own flip
// and hands the request to the app (after the event returns), which then writes its answer back with `setPressed` (a property write, no event).
import './vendor/ui-sdk/web/toggle.js';

const toggleOf = el => (el?.matches?.('ui-toggle') ? el : el?.closest?.('ui-toggle'));

export function setPressed(el, on) {
  const toggle = toggleOf(el);
  if (toggle && 'pressed' in toggle) { if (toggle.pressed !== !!on) toggle.pressed = !!on; return; }
  (el?.matches?.('button') ? el : toggle?.querySelector('button'))?.setAttribute('aria-pressed', String(!!on));
}

export function onPress(el, fn) {
  const toggle = toggleOf(el);
  // The answer is written after the SDK has put the state back (it restores a canceled change when the event returns).
  toggle?.addEventListener('pressedchange', event => { event.preventDefault(); const value = event.detail.value; queueMicrotask(() => fn(value)); });
}

// A set of toggles of which at most one is pressed (a tool choice) is a ui-toggle-group. The app owns the value too:
// `onChoose(group, fn)` cancels the SDK's change and calls fn(value|null, event); write the answer with `setChoice`.
export function setChoice(group, value) {
  if (!group || !('value' in group)) return;
  const next = value == null || value === '' ? [] : [value];
  if (group.value?.join() !== next.join()) group.value = next;
}

export function onChoose(group, fn) {
  group?.addEventListener('valuechange', event => { event.preventDefault(); const value = event.detail.value[0] ?? null; queueMicrotask(() => fn(value)); });
}
