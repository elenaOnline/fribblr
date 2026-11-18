// The Appearance controls: Mode (System, Light, Dark) and Background (Blue, White), kept for this browser.
// appearance-boot.js reads both and sets data-appearance and data-ground on <html> before the first paint; this module
// writes the choice, re-applies it, and keeps every copy of the controls in step (Home's menu, the board's and an opened
// Tinka's Inspector). Background is a light-mode choice: dark has one ground, so the row is disabled while the page is dark.
import './appearance-boot.js';
const MODES = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];
const GROUNDS = [['desk', 'Blue'], ['white', 'White']];
const KEY = { mode: 'tinka/appearance', ground: 'tinka/ground' };
const LISTS = { mode: MODES, ground: GROUNDS };
const read = kind => { try { const value = localStorage.getItem(KEY[kind]); if (LISTS[kind].some(([choice]) => choice === value)) return value; } catch {} return LISTS[kind][0][0]; };

function sync() {
  const mode = read('mode'), ground = read('ground'), dark = document.documentElement.dataset.appearance === 'dark';
  document.querySelectorAll('[data-appearance-set]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.appearanceSet === mode)));
  document.querySelectorAll('[data-ground-set]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.groundSet === ground)); button.disabled = dark; });
  document.querySelectorAll('.appearance-ground').forEach(row => { row.title = dark ? 'Dark mode has one background' : ''; });
}
function choose(kind, value) {
  if (!LISTS[kind].some(([choice]) => choice === value)) return;
  try { localStorage.setItem(KEY[kind], value); } catch {}
  window.tinkaAppearance();
  sync();
}
new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-appearance', 'data-ground'] });
addEventListener('storage', event => { if (event.key === KEY.ground) sync(); });

const segment = (label, list, attr) => `<div class="tk-seg" role="group" aria-label="${label}">${list.map(([value, name]) => `<button type="button" ${attr}="${value}">${name}</button>`).join('')}</div>`;
const rows = () => `<div class="appearance-rows">`
  + `<div class="appearance-choice"><div class="appearance-choice-label" aria-hidden="true">Mode</div>${segment('Appearance mode', MODES, 'data-appearance-set')}</div>`
  + `<div class="appearance-choice appearance-ground"><div class="appearance-choice-label" aria-hidden="true">Background</div>${segment('Background', GROUNDS, 'data-ground-set')}</div>`
  + `</div>`;
const ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path class="appearance-icon-fill" d="M10 3.5a6.5 6.5 0 0 1 0 13z"/></svg>';
let menus = 0;

// Inspectors (board, opened Tinka) take the two labelled rows in place. Home's masthead takes a menu ({control:'menu'}):
// one quiet Appearance button that opens the same rows, so a rarely changed setting is not always on screen.
export function mountAppearance(host, { control = 'segmented' } = {}) {
  if (!host) return;
  const wrap = document.createElement('div');
  wrap.addEventListener('click', event => {
    const button = event.target.closest('[data-appearance-set],[data-ground-set]');
    if (button) button.dataset.appearanceSet ? choose('mode', button.dataset.appearanceSet) : choose('ground', button.dataset.groundSet);
  });
  if (control !== 'menu') {
    wrap.className = 'appearance-control appearance-segmented';
    wrap.innerHTML = rows();
    host.append(wrap);
    sync();
    return;
  }
  const id = `appearance-menu-${++menus}`;
  wrap.className = 'appearance-control appearance-menu';
  wrap.innerHTML = `<button type="button" class="tk-btn appearance-trigger" aria-expanded="false" aria-controls="${id}" aria-label="Appearance">${ICON}<span>Appearance</span></button>`
    + `<div class="appearance-pop" id="${id}" hidden>${rows()}</div>`;
  const trigger = wrap.querySelector('.appearance-trigger'), pop = wrap.querySelector('.appearance-pop');
  const show = (open, { focus = false } = {}) => {
    pop.hidden = !open; trigger.setAttribute('aria-expanded', String(open));
    if (open && focus) pop.querySelector('[aria-pressed="true"]')?.focus();
    if (!open && focus) trigger.focus();
  };
  trigger.addEventListener('click', event => show(pop.hidden, { focus: event.detail === 0 }));
  wrap.addEventListener('keydown', event => { if (event.key === 'Escape' && !pop.hidden) { event.stopPropagation(); show(false, { focus: true }); } });
  wrap.addEventListener('focusout', event => { if (!pop.hidden && event.relatedTarget && !wrap.contains(event.relatedTarget)) show(false); });
  document.addEventListener('pointerdown', event => { if (!pop.hidden && !wrap.contains(event.target)) show(false); }, { capture: true });
  host.append(wrap);
  sync();
}
