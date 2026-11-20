// ui-toolbar glue. The SDK's toolbar has no idea that an item can be absent: an item hidden with the `hidden`
// attribute, or by a media query (a narrow screen drops some actions), would still be a tab stop or an arrow-key
// stop, and focus would land on nothing. followVisibility() keeps those items out of the toolbar's order: any
// ui-toolbar-button whose button is not rendered is marked disabled and not focusable (the SDK's own
// focusable-when-disabled="false"), and comes back when it is shown again. A toolbar that is not rendered at all (it
// sits in a closed panel) leaves its items as they are; their visibility is read again when it shows.
//
// A button the app disables itself (the board Inspector's Undo with nothing to undo) is disabled through its part,
// with setButtonOff(button, off): the SDK owns a toolbar button's `disabled` attribute and writes it from the part
// (a natively disabled button behind an enabled part is an arrow stop focus can't land on, and the arrows stop
// there). The button still reads `disabled` as before, so code and tests that read it are unchanged.
import './vendor/ui-sdk/web/toolbar.js';

function sync(toolbar) {
  const shown = toolbar.getClientRects().length > 0;
  for (const part of toolbar.querySelectorAll('ui-toolbar-button')) {
    const button = part.querySelector('button');
    const gone = shown ? !button || button.getClientRects().length === 0 : !!part.__gone;
    part.__gone = gone;
    const skip = gone || !!part.__off;
    if (skip === !!part.__skipped) continue;
    part.__skipped = skip;
    if (skip) { part.setAttribute('focusable-when-disabled', 'false'); part.disabled = true; }
    else { part.disabled = false; part.removeAttribute('focusable-when-disabled'); }
  }
}

export function followVisibility(toolbar) {
  if (!toolbar || toolbar.__followVisibility) return;
  toolbar.__followVisibility = true;
  let queued = 0;
  const run = () => { queued = 0; sync(toolbar); };
  const queue = () => { if (!queued) queued = requestAnimationFrame(run); };
  new MutationObserver(queue).observe(toolbar, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
  if (typeof ResizeObserver === 'function') new ResizeObserver(queue).observe(toolbar);
  addEventListener('resize', queue);
  run();
}

export function setButtonOff(button, off) {
  const part = button?.closest?.('ui-toolbar-button'), toolbar = part?.closest('ui-toolbar');
  if (!toolbar?.__followVisibility) { if (button) button.disabled = !!off; return; }
  if (part.__off === !!off) return;
  part.__off = !!off;
  sync(toolbar);
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
  if (!group) return;
  const next = value == null || value === '' ? [] : [String(value)];
  if (!group.api) { if (next.length) group.setAttribute('default-value', next[0]); else group.removeAttribute('default-value'); return; }
  if (group.value?.join() !== next.join()) group.value = next;
}

export function onChoose(group, fn) {
  group?.addEventListener('valuechange', event => { event.preventDefault(); const value = event.detail.value[0] ?? null; queueMicrotask(() => fn(value)); });
}

// A set of buttons of which one is chosen, kept as real buttons (a ui-toggle-group of ui-toggle > button, single and not
// deselectable): arrows move focus, Space or Enter chooses, and the chosen one carries aria-pressed as before, so the
// raised-key look the theme draws for pressed buttons still applies. Used where the options are keys, not a segmented track.
// items: [{ value, html, label, tip, attrs }]. Write the choice with setChoice(group, value); listen with onChoice().
const escAttr = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function choiceHTML({ label, className = '', value, items, attrs = {} }) {
  const root = Object.entries(attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  const cells = items.map(it => {
    const extra = Object.entries(it.attrs || {}).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
    const name = it.ariaLabel ?? it.label;
    return `<ui-toggle value="${escAttr(it.value)}"><button type="button" class="${it.className || ''}"${name ? ` aria-label="${escAttr(name)}"` : ''}${it.tip ? ` data-tip="${escAttr(it.tip)}"` : ''}${extra}>${it.html ?? escAttr(it.label ?? '')}</button></ui-toggle>`;
  }).join('');
  return `<ui-toggle-group${className ? ` class="${className}"` : ''} aria-label="${escAttr(label)}" deselectable="false"${value != null ? ` default-value="${escAttr(value)}"` : ''}${root}>${cells}</ui-toggle-group>`;
}

// Run fn(value) when she chooses one (pointer or keys).
export function onChoice(group, fn) {
  group?.addEventListener('valuechange', event => { const value = event.detail.value[0]; if (value != null) fn(value, event); });
}
