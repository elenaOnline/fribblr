import './vendor/ui-sdk/web/dialog.js';
import './vendor/ui-sdk/web/popover.js';
import {sharedPopover} from './popups.js';
import {defined} from './ui-sdk.js';
// Tinka's own updates, where Tinka already says "Live": the board's floating
// status line and Home's live line (on phones, a pill). A compatible update is
// quiet grey text; a major one has the accent and a dot and asks first in a
// dialog. Installing pauses editing (writes wait), then offers the existing
// Refresh; nothing reloads by itself. "Copy a request for your agent" is always
// there, and it is the only route when an update needs review. The settings are
// the CLI's own (`update policy notify|auto|off`, `update later`), shown in the
// board Inspector as Ask first / Automatic / Off.
import {holdWrites, releaseWrites} from './update-hold.js';
import {segmentedHTML, onSegmented, focusSegmented} from './ui-segmented.js';

const ICON = {
  up: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7"/></svg>',
  copy: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5"/></svg>',
  ext: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5"/></svg>',
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>',
};
const POLL_MS = 1500, GIVE_UP_MS = 5 * 60 * 1000;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const $ = selector => document.querySelector(selector);
const line = $('.canvas-footer .status-line');
const surface = line ? 'board' : $('.masthead .live') ? 'home' : null;
let config = {}, view = null, pageVersion = null;
let phase = 'idle', target = null, localFailure = null, pollTimer = null, giveUpAt = 0, popover = null, aboutMessage = '';

async function getView() {
  const response = await fetch('/api/update', {cache: 'no-store'});
  if (!response.ok) throw new Error(`Update state unavailable (${response.status}).`);
  return response.json();
}
async function post(url, body) {
  const response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', 'x-tinka-workspace': config.workspaceId}, body: JSON.stringify(body)});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}
const preference = body => post('/api/update/preference', body).then(next => { view = next; render(); return next; });

// What the status line shows, if anything.
function current() {
  if (!view?.installed) return null;
  if (phase === 'ready') return {kind: 'ready', display: target};
  if (phase === 'updating') return {kind: 'busy', display: target};
  if (localFailure) return localFailure;
  const notice = view.notice;
  return notice && !notice.snoozed && notice.kind !== 'deferred' && notice.version ? notice : null;
}

// ---- Agent requests: the user's words, with the exact command ----------------
function request(notice) {
  const command = view.agentCommand, to = notice.display, have = view.display, major = notice.major ? ' --major' : '';
  const commit = view.pin ? ', then commit the updated fribblr/project.json' : '';
  if (notice.kind === 'review') return `fribblr ${to} is available for this project (${view.project}), but fribblr says this copy needs a review before it can update itself (${notice.reason}).\n\nPlease check what fribblr found, tell me, and update fribblr to ${to} if it is safe${notice.major ? `. It is a major update, so ask me before installing it` : ''}:\n${command} now${major}${view.pin ? '\n\nThen commit the updated fribblr/project.json.' : ''}`;
  if (notice.kind === 'failed') return `fribblr tried to update this project (${view.project}) to ${to} and stopped. It says it is still on ${have}.\nReason: ${notice.reason}\n\nPlease check what happened (${command} status) and, if it is safe, try again${notice.major ? ' with the same consent I gave' : ''}:\n${command} now${major}`;
  if (notice.major) return `Please update fribblr in this project (${view.project}) to ${to}.\nI know ${to} is a major update, and I agree to install it.\n\nRun:\n${command} now --major\n\nTell me when fribblr is back${commit}.`;
  return `Please update fribblr in this project (${view.project}) to ${to}.\n\nRun:\n${command} now\n\nTell me when fribblr is back${commit}.`;
}
// The clipboard may be unavailable; then the text is shown, selected, to copy by hand.
async function copy(text, status, done) {
  try { await navigator.clipboard.writeText(text); status.textContent = done; }
  catch {
    status.textContent = 'Select the request and copy it.';
    let area = status.parentElement.querySelector('textarea.update-copy-text');
    if (!area) { area = document.createElement('textarea'); area.className = 'update-copy-text'; area.readOnly = true; area.rows = 5; area.setAttribute('aria-label', 'Request for your agent'); status.before(area); }
    area.value = text; area.focus(); area.select();
  }
}

// ---- Popover beside the status line -----------------------------------------
// A non-modal UI SDK popover (ui-sdk.md § Popups) opened from code: the chip is rebuilt on every render, so it is no
// trigger. The SDK gives Escape (one layer, focus back to the chip), a press outside, focus leaving, and placement
// beside the chip (below, flipping above near the bottom of the window). popups.js steers Tab out of it, from
// `tabTrigger`, to the chip so the browser's Tab continues from there.
let sdkPopover = null;
const chipOrAnchor = () => popover?.anchor?.isConnected ? popover.anchor : document.querySelector('.update-chip');
function popoverParts() {
  if (sdkPopover) return sdkPopover;
  sdkPopover = sharedPopover({id: 'update-popover', className: 'tk-menu update-pop workspace-popover'});
  const {root, content} = sdkPopover;
  root.setAttribute('modal', 'false');
  content.setAttribute('side', 'bottom'); content.setAttribute('align', 'start'); content.setAttribute('side-offset', '8'); content.setAttribute('collision-padding', '8');
  content.setAttribute('final-focus', 'none');
  content.tabTrigger = () => chipOrAnchor();
  root.addEventListener('openchange', event => {
    if (event.detail.value) return;
    closeReason = event.detail.reason;
    const had = popover; popover = null;
    had?.anchor?.setAttribute('aria-expanded', 'false');
    document.querySelector('.update-chip')?.setAttribute('aria-expanded', 'false');
  });
  // Focus goes back to the chip (a fresh copy after a re-render) unless it went somewhere on purpose.
  root.addEventListener('openchangecomplete', event => {
    if (event.detail.value || popover) return;
    // Escape and a code close always return; a press outside or focus moving elsewhere keeps where it went.
    const now = document.activeElement, lost = !now || now === document.body || content.contains(now);
    if (!lost && closeReason !== 'escape-key' && closeReason !== 'imperative') return;
    (returnTo?.isConnected ? returnTo : document.querySelector('.update-chip'))?.focus({preventScroll: true});
  });
  return sdkPopover;
}
let returnTo = null, closeReason = '';
function closePopover({focus = false} = {}) {
  if (!popover) return;
  const {anchor} = popover;
  anchor?.setAttribute('aria-expanded', 'false');
  popover = null;
  sdkPopover?.root.api?.close?.({reason: 'imperative'});
  if (focus && anchor?.isConnected) anchor.focus({preventScroll: true});
}
function openPopover(anchor, html, label) {
  closePopover();
  const {root, content} = popoverParts();
  content.setAttribute('aria-label', label);
  content.innerHTML = html;
  content.style.width = `${Math.min(340, innerWidth - 16)}px`;
  anchor.setAttribute('aria-expanded', 'true');
  popover = {anchor};
  returnTo = anchor;
  // The opener holds focus as the popover opens, so the SDK's "return to what had focus" lands on it.
  if (document.activeElement !== anchor) anchor.focus({preventScroll: true});
  defined('ui-popover').then(() => { if (popover?.anchor === anchor) root.api.open({anchor}); });
  return content;
}
const eyebrow = () => `<p class="update-eyebrow">fribblr for ${esc(view.project)}</p>`;
const notesLink = (label = "What's new") => view.latest?.notes ? `<a class="update-notes" href="${esc(view.latest.notes)}" target="_blank" rel="noopener noreferrer">${label} ${ICON.ext}</a>` : '';

function compatiblePopover(anchor, notice) {
  const pop = openPopover(anchor, `<div class="update-pop-body">${eyebrow()}<h4>fribblr ${esc(notice.display)} is available</h4><p class="update-copy">You have ${esc(view.display)}. This is a compatible update: your boards, notes and files stay as they are.</p>
  <div class="update-row"><button class="tk-btn tk-primary" type="button" data-update="install">Update now</button><button class="tk-btn tk-tonal" type="button" data-update="later">Later</button>${notesLink()}</div>
  <p class="update-meta">fribblr restarts for a few seconds. Open boards wait, then offer Refresh.</p>
  <div class="tk-msep"></div>
  <label class="update-switch"><input type="checkbox" data-update="auto"${view.policy === 'auto' ? ' checked' : ''}><span>Install compatible updates automatically</span><small>Only as fribblr starts, never in the middle of your work. Major updates always ask.</small></label>
  <button class="tk-mi" type="button" data-update="agent">${ICON.copy}Copy a request for your agent</button><p class="update-status" role="status"></p></div>`, `fribblr ${notice.display} is available`);
  const status = pop.querySelector('.update-status');
  pop.querySelector('[data-update=install]').onclick = event => install(notice, {status, button: event.currentTarget});
  pop.querySelector('[data-update=later]').onclick = () => later(status);
  pop.querySelector('[data-update=auto]').onchange = async event => {
    const box = event.currentTarget; box.disabled = true;
    try { await preference({action: 'policy', policy: box.checked ? 'auto' : 'notify'}); status.textContent = box.checked ? 'Compatible updates now install as fribblr starts.' : 'fribblr asks first again.'; }
    catch (error) { box.checked = !box.checked; status.textContent = error.message; }
    finally { box.disabled = false; }
  };
  pop.querySelector('[data-update=agent]').onclick = () => copy(request(notice), status, 'Request copied. Paste it into your agent conversation.');
}
function reviewPopover(anchor, notice) {
  const pop = openPopover(anchor, `<div class="update-pop-body">${eyebrow()}<h4>fribblr ${esc(notice.display)} needs a quick review</h4><p class="update-copy">fribblr won't replace itself from here this time. Your agent can check what it found and update it.</p>
  <p class="update-reason"><b>Reason:</b> ${esc(notice.reason)}</p>
  <div class="update-row"><button class="tk-btn tk-primary" type="button" data-update="agent">${ICON.copy}<span>Copy request for your agent</span></button><button class="tk-btn tk-tonal" type="button" data-update="later">Later</button>${notesLink()}</div><p class="update-status" role="status"></p></div>`, `fribblr ${notice.display} needs a review`);
  const status = pop.querySelector('.update-status');
  pop.querySelector('[data-update=agent]').onclick = () => copy(request(notice), status, 'Request copied. Paste it into your agent conversation.');
  pop.querySelector('[data-update=later]').onclick = () => later(status);
}
function failedPopover(anchor, notice) {
  const lost = notice.lost;
  const pop = openPopover(anchor, `<div class="update-pop-body">${eyebrow()}<h4>fribblr didn't update to ${esc(notice.display)}</h4><p class="update-copy">${lost ? "fribblr hasn't answered since the update started. Your boards, notes and files are on disk, untouched." : `It went back to ${esc(view.display)}, which is running now. Your boards, notes and files are fine.`}</p>
  <p class="update-reason"><b>Reason:</b> ${esc(notice.reason || 'The update stopped.')}</p>
  <div class="update-row">${lost ? '' : '<button class="tk-btn tk-primary" type="button" data-update="retry">Try again</button>'}<button class="tk-btn ${lost ? 'tk-primary' : 'tk-tonal'}" type="button" data-update="agent">${ICON.copy}<span>Copy details for your agent</span></button></div><p class="update-status" role="status"></p></div>`, `fribblr didn't update to ${notice.display}`);
  const status = pop.querySelector('.update-status');
  // Try again repeats the same request; a major one carries the yes already given.
  pop.querySelector('[data-update=retry]')?.addEventListener('click', event => install(notice, {status, button: event.currentTarget, consent: notice.major}));
  pop.querySelector('[data-update=agent]').onclick = () => copy(request({...notice, kind: 'failed'}), status, 'Details copied. Paste them into your agent conversation.');
}
async function later(status) {
  try { await preference({action: 'later'}); closePopover({focus: false}); }
  catch (error) { status.textContent = error.message; }
}

// ---- The major update asks first ---------------------------------------------
function consent(notice) {
  closePopover();
  document.querySelector('.update-dialog')?.closest('ui-dialog')?.remove();
  const root = document.createElement('ui-dialog');
  root.innerHTML = '<ui-dialog-backdrop hidden></ui-dialog-backdrop><ui-dialog-content class="update-dialog" hidden></ui-dialog-content>';
  const dialog = root.querySelector('ui-dialog-content');
  // Focus starts on Later (autofocus), so Enter never approves by accident; Escape and a press outside mean Later too, without asking again.
  dialog.innerHTML = `<ui-dialog-close><button class="close" type="button" aria-label="Close">×</button></ui-dialog-close><p class="eyebrow">Major update · ${esc(view.project)}</p><ui-dialog-title as-child><h2>Update to fribblr ${esc(notice.display)}</h2></ui-dialog-title>
  <p class="dialog-copy">fribblr ${esc(notice.display)} is a major update, so fribblr asks before installing it. You have ${esc(view.display)}. Some things may look or work differently afterwards.</p>
  <ul class="update-facts">
  <li>${ICON.check}<span>Your boards, notes and files stay exactly as they are.</span></li>
  <li>${ICON.check}<span>fribblr keeps a copy of ${esc(view.display)} and goes back to it if ${esc(notice.display)} doesn't start.</span></li>
  <li>${ICON.check}<span>fribblr restarts for a few seconds. Open boards wait, then offer Refresh.</span></li>
  <li>${ICON.check}<span>Only ${esc(view.project)} is updated. Other projects keep their own fribblr.</span></li></ul>
  ${notesLink(`What's new in ${esc(notice.display)}`).replace('class="update-notes"', 'class="update-link"')}
  <div class="dialog-bottom"><span>Later asks again tomorrow.</span><div class="dialog-buttons"><button class="tk-btn tk-tonal" type="button" data-update="later" autofocus>Later</button><button class="tk-btn tk-primary" type="button" data-update="yes">Update to ${esc(notice.display)}</button></div></div>
  <p class="update-status" role="status"></p>
  <div class="update-alt"><span>Or have your agent do it</span><button class="tk-btn tk-sm" type="button" data-update="agent">${ICON.copy}<span>Copy the request</span></button></div>`;
  document.body.append(root);
  const status = dialog.querySelector('.update-status');
  dialog.close = () => root.api.close();
  root.addEventListener('openchangecomplete', event => { if (!event.detail.value) root.remove(); });
  dialog.querySelector('[data-update=later]').onclick = async () => { try { await preference({action: 'later'}); dialog.close(); } catch (error) { status.textContent = error.message; } };
  dialog.querySelector('[data-update=yes]').onclick = event => install(notice, {status, button: event.currentTarget, consent: true, dialog});
  dialog.querySelector('[data-update=agent]').onclick = () => copy(request(notice), status, 'Request copied, with your yes. Paste it into your agent conversation.');
  root.api.open();
}

// ---- Installing: editing waits, then Refresh ---------------------------------
async function install(notice, {status, button, consent: yes = false, dialog} = {}) {
  if (button) button.disabled = true;
  try {
    const result = await post('/api/update/install', {version: notice.version, ...(notice.major && yes ? {consent: 'major'} : {})});
    dialog?.close(); closePopover();
    localFailure = null;
    startWaiting(result.install);
  } catch (error) {
    if (status) status.textContent = error.message;
    if (button) button.disabled = false;
  }
}
function startWaiting(install) {
  phase = 'updating'; target = install.display; giveUpAt = Date.now() + GIVE_UP_MS;
  holdWrites();
  document.body.classList.add('tinka-updating');
  render(); clearTimeout(pollTimer); pollTimer = setTimeout(poll, POLL_MS);
}
function stopWaiting() {
  clearTimeout(pollTimer); pollTimer = null;
  document.body.classList.remove('tinka-updating');
  releaseWrites();
}
async function poll() {
  let next = null;
  try { next = await getView(); } catch {}
  if (next && next.install?.state !== 'running') {
    view = next; stopWaiting();
    if (next.version !== pageVersion) { phase = 'ready'; target = next.display; }
    else {
      phase = 'idle';
      if (next.install?.state === 'failed') localFailure = {kind: 'failed', version: next.install.to, display: next.install.display, major: next.install.major, reason: next.install.reason};
    }
    render(); return;
  }
  if (Date.now() > giveUpAt) {
    stopWaiting(); phase = 'idle';
    localFailure = {kind: 'failed', lost: true, version: target, display: target, major: false, reason: "fribblr didn't come back within five minutes."};
    render(); return;
  }
  pollTimer = setTimeout(poll, POLL_MS);
}

// ---- Rendering -----------------------------------------------------------------
function chipHtml(state) {
  if (state.kind === 'busy') return `<span class="update-pulse" aria-hidden="true"></span><span>Updating to ${esc(state.display)}…<span class="update-long"> changes wait</span></span>`;
  if (state.kind === 'failed') return `<span>Update didn't finish</span>`;
  return `${state.major ? '' : ICON.up}<span>fribblr ${esc(state.display)}<span class="update-long"> available</span></span>`;
}
function open(state, anchor) {
  if (state.kind === 'failed') return failedPopover(anchor, state);
  if (state.kind === 'review') return reviewPopover(anchor, state);
  if (state.major) return consent(state);
  return compatiblePopover(anchor, state);
}
function render() {
  const state = current();
  document.querySelectorAll('.update-chip, .update-sep, .update-refresh').forEach(element => element.remove());
  const host = surface === 'board' ? line : $('.masthead .live');
  host?.classList.toggle('update-busy', state?.kind === 'busy');
  if (state?.kind === 'ready') {
    const refresh = $('#live-refresh');
    if (surface === 'board' && refresh) {
      // The board's own Refresh saves the view and any notes before reloading.
      refresh.querySelector('.refresh-detail').textContent = `fribblr ${target} is ready · `;
      refresh.setAttribute('aria-label', `fribblr ${target} is ready · Refresh`);
      refresh.hidden = false;
    } else if (host) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'update-refresh';
      button.innerHTML = `<span class="refresh-detail">fribblr ${esc(target)} is ready · </span>Refresh`;
      button.onclick = () => location.reload();
      host.append(button);
    }
  } else if (state && host) {
    const kind = state.kind === 'busy' ? 'busy' : state.kind === 'failed' ? 'failed' : state.kind === 'review' ? 'review' : state.major ? 'major' : 'minor';
    if (surface === 'board') host.insertAdjacentHTML('beforeend', '<span class="update-sep" aria-hidden="true"></span>');
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'update-chip'; chip.dataset.kind = kind;
    chip.innerHTML = chipHtml(state);
    if (kind === 'busy') { chip.setAttribute('aria-disabled', 'true'); chip.setAttribute('aria-live', 'polite'); }
    else { chip.setAttribute('aria-haspopup', 'dialog'); chip.setAttribute('aria-expanded', 'false'); chip.onclick = () => open(state, chip); }
    host.append(chip);
  }
  renderAbout();
}
// The board Inspector's small Tinka section: the version and the update policy.
function aboutStatus() {
  const have = `<b>${esc(view.display)}</b>`;
  if (view.checkout) return `${have} · installed from a checkout${view.checkout.commit ? ` (${esc(view.checkout.commit)})` : ''}`;
  if (!view.installed) return `${have} · running from source`;
  if (phase === 'updating') return `${have} · updating to ${esc(target)}…`;
  if (phase === 'ready') return `${have} · ${esc(target)} is ready: Refresh to use it`;
  const notice = view.notice, latest = view.latest;
  if (notice?.kind === 'deferred') return `${have} · ${esc(notice.display)} installs next time fribblr starts`;
  if (notice?.kind === 'failed' || localFailure) return `${have} · the update to ${esc((localFailure || notice).display)} didn't finish`;
  if (notice?.kind === 'review') return `${have} · ${esc(notice.display)} needs a review`;
  if (notice) return `${have} · ${esc(notice.display)} available`;
  if (latest && view.policy === 'off') return `${have} · ${esc(latest.display)} available; updates are off`;
  if (view.policy === 'off') return `${have} · updates are off`;
  return `${have} · ${view.checkFailed ? 'could not check for updates' : 'up to date'}`;
}
function renderAbout() {
  const inspector = surface === 'board' ? $('#board-info') : null;
  if (!inspector || !view) return;
  let section = inspector.querySelector('.update-about');
  if (!section) { section = document.createElement('section'); section.className = 'update-about'; section.setAttribute('aria-labelledby', 'update-about-title'); inspector.append(section); }
  const actionable = view.installed && phase === 'idle' && (localFailure || view.notice && view.notice.kind !== 'deferred');
  const updated = view.install?.state === 'updated' && phase === 'idle' && Date.now() - view.install.startedAt < 24 * 60 * 60 * 1000;
  section.innerHTML = `<h3 id="update-about-title">fribblr <span>this project</span></h3>
  <div class="update-about-row"><span class="update-about-status">${aboutStatus()}</span>${view.installed && phase === 'idle' ? `<button class="tk-btn tk-sm" type="button" data-update="${actionable ? 'open' : 'check'}">${actionable ? 'Update…' : 'Check now'}</button>` : ''}</div>
  ${view.installed ? `<div class="update-about-row"><span>Updates</span>${segmentedHTML({label: 'fribblr updates for this project', value: view.policy, items: [['notify', 'Ask first'], ['auto', 'Automatic'], ['off', 'Off']].map(([value, label]) => ({value, label, disabled: phase !== 'idle', attrs: {'data-policy': value}}))})}</div>
  <small>Automatic installs compatible updates as fribblr starts. Major updates always ask.</small>` : view.checkout ? `<small>Updates come from the checkout at ${esc(view.checkout.path)}: bring it up to date, then run its scripts/install.mjs for this project again.</small>` : '<small>A source checkout updates through Git, not from here.</small>'}
  ${updated && view.pin ? `<small>Updated from ${esc(view.install.from)} on this Mac. Commit the changed fribblr/project.json with your project.</small>` : ''}
  <small class="update-about-message" role="status">${esc(aboutMessage)}</small>`;
  section.querySelector('[data-update=check]')?.addEventListener('click', async event => {
    event.currentTarget.disabled = true; aboutMessage = 'Checking…'; renderAbout();
    try { await preference({action: 'check'}); aboutMessage = view.checkFailed ? 'fribblr could not reach its releases just now.' : view.latest ? `fribblr ${view.latest.display} is available.` : `Checked just now · ${view.display} is the latest.`; }
    catch (error) { aboutMessage = error.message; }
    renderAbout();
  });
  section.querySelector('[data-update=open]')?.addEventListener('click', event => {
    const state = localFailure || view.notice;
    open({...state, kind: state.kind === 'deferred' ? 'compatible' : state.kind}, document.querySelector('.update-chip') || event.currentTarget);
  });
  const policySeg = section.querySelector('ui-segmented-control');
  if (policySeg) onSegmented(policySeg, async policy => {
    if (policy === view.policy) return;
    try { await preference({action: 'policy', policy}); aboutMessage = {notify: 'fribblr asks before installing updates.', auto: 'Compatible updates install as fribblr starts. Major updates still ask.', off: 'fribblr no longer checks for updates.'}[policy]; }
    catch (error) { aboutMessage = error.message; }
    renderAbout();
    focusSegmented(section.querySelector('ui-segmented-control'));
  });
}

async function refreshView() {
  if (phase !== 'idle') return;
  try {
    const next = await getView();
    view = next;
    if (next.install?.state === 'running') return startWaiting(next.install);
    if (next.version !== pageVersion) { phase = 'ready'; target = next.display; }
    render();
  } catch {}
}
async function start() {
  if (!surface || new URLSearchParams(location.search).has('overview')) return;
  try { config = await (await fetch('/api/config', {cache: 'no-store'})).json(); pageVersion = config.version; view = await getView(); }
  catch { return; }
  if (view.install?.state === 'running') startWaiting(view.install);
  else render();
  // Returning to the tab picks up an update made meanwhile, by an agent or another tab.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshView(); });
}
start();
