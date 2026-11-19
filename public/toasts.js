// Toasts: one UI SDK toast region per page, where the old status node sat (bottom centre).
// toast(message, options) is the whole API; it is synchronous to callers and returns the toast's id.
// Stacking (three visible), timers that pause while the pointer or focus is in the stack or the window is inactive,
// F6 to reach the newest toast, Escape to dismiss it, swipe, a close button and announcements come from the SDK.
// Non-toast live regions (connection status, form status) are not routed through here.

import './vendor/ui-sdk/web/toast.js';
import { toaster, defined } from './ui-sdk.js';

const DURATION = 6000;
let sequence = 0, ready = null;

const TEMPLATE = `<ui-toast class="workspace-toast">
  <ui-toast-title></ui-toast-title>
  <ui-toast-action><button type="button" class="workspace-toast-action"></button></ui-toast-action>
  <ui-toast-close><button type="button" class="workspace-toast-close" aria-label="Close notification"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"/></svg></button></ui-toast-close>
</ui-toast>`;

function ensure() {
  ready ??= (async () => {
    const t = await toaster();
    await defined('ui-toast-region');
    let region = document.querySelector('ui-toast-region');
    if (!region) {
      region = document.createElement('ui-toast-region');
      region.className = 'workspace-toasts';
      region.setAttribute('side', 'bottom');
      region.setAttribute('align', 'center');
      region.setAttribute('aria-label', 'Notifications');
      const template = document.createElement('template');
      template.innerHTML = TEMPLATE;
      region.append(template);
      (document.body || document.documentElement).append(region);
    }
    region.toaster = t;
    return t;
  })();
  return ready;
}

/** Show a toast. Options are UI SDK's: type, action {label, onAction}, duration, id, priority, onDismiss. */
export function toast(message, options = {}) {
  if (!message) return null;
  const id = options.id || `toast-${++sequence}`;
  ensure().then(t => t(String(message), { duration: DURATION, ...options, id })).catch(error => console.error('toast', error));
  return id;
}

/** Dismiss one toast by the id toast() returned (or all, with no id). */
export function dismissToast(id) {
  ensure().then(t => t.dismiss(id)).catch(() => {});
}
