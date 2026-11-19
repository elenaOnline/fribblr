// Segmented choice (a radio group drawn as a row of keys) on UI SDK's ui-segmented-control.
// Same look as the old `.tk-seg` of aria-pressed buttons: the chosen item is the raised cell in the sunken track.
// The SDK writes data-checked / aria-checked on the items; ui-sdk.css draws that state. No sliding indicator is
// used: the raised cell is the item's own face, so it moves only when she chooses.
import './vendor/ui-sdk/web/segmented-control.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// items: [{ value, html|label, title, ariaLabel, id, attrs: { 'data-x': 'y' } }]
// Returns markup. `value` is the checked value at the start.
export function segmentedHTML({ label, labelledby, className = '', id, attrs = {}, items, value }) {
  const root = Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  const name = labelledby ? ` aria-labelledby="${esc(labelledby)}"` : label ? ` aria-label="${esc(label)}"` : '';
  const cells = items.map(it => {
    const extra = Object.entries(it.attrs || {}).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    return `<ui-segmented-control-item value="${esc(it.value)}"${it.id ? ` id="${esc(it.id)}"` : ''}${it.title ? ` title="${esc(it.title)}"` : ''}${it.ariaLabel ? ` aria-label="${esc(it.ariaLabel)}"` : ''}${it.disabled ? ' disabled' : ''}${extra}>${it.html ?? esc(it.label)}</ui-segmented-control-item>`;
  }).join('');
  return `<ui-segmented-control class="tk-seg${className ? ` ${className}` : ''}"${id ? ` id="${esc(id)}"` : ''}${name}${value != null ? ` default-value="${esc(value)}"` : ''}${root}>${cells}</ui-segmented-control>`;
}

// Check an option from code. Fires no event, so writing our own model back never echoes.
export function setSegmented(el, value) {
  if (!el) return;
  if (el.api) el.value = value;
  else { el.setAttribute('default-value', value); el.setAttribute('value', value); }
}

// Run `fn(value, event)` when she chooses an option (pointer or arrow keys).
export function onSegmented(el, fn) {
  el.addEventListener('valuechange', event => { if (event.detail.value != null) fn(event.detail.value, event); });
}
