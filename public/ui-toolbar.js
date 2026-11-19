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
