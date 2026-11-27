// The Appearance controls: Mode (System, Light, Dark) and Background (Blue, White), kept for this browser.
// appearance-boot.js reads both and sets data-appearance and data-ground on <html> before the first paint; this module
// writes the choice, re-applies it, and keeps every copy of the controls in step (Home's menu, the board's and an opened
// Tinka's Inspector). Background is a light-mode choice: dark has one ground, so the row is disabled while the page is dark.
import './appearance-boot.js';
import {sharedMenu, menuRadioGroup, menuSeparator} from './popups.js';
import { segmentedHTML, setSegmented, onSegmented, focusSegmented } from './ui-segmented.js';
const MODES = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];
const GROUNDS = [['desk', 'Blue'], ['white', 'White']];
const KEY = { mode: 'tinka/appearance', ground: 'tinka/ground' };
const LISTS = { mode: MODES, ground: GROUNDS };
const DEFAULT = { mode: 'light', ground: 'desk' };   // Tinka 1.3: light unless the user chooses otherwise
const read = kind => { try { const value = localStorage.getItem(KEY[kind]); if (LISTS[kind].some(([choice]) => choice === value)) return value; } catch {} return DEFAULT[kind]; };

function sync() {
  const mode = read('mode'), ground = read('ground'), dark = document.documentElement.dataset.appearance === 'dark';
  document.querySelectorAll('[data-appearance-seg]').forEach(seg => setSegmented(seg, mode));
  document.querySelectorAll('[data-ground-seg]').forEach(seg => { setSegmented(seg, ground); seg.disabled = dark; });
  // The hint (shared tooltip, tips.js) explains the disabled row only in dark mode; an empty hint shows nothing. The row is a
  // tooltip zone, so it is served by the delegate rather than wrapped (a wrapper would bind the first key inside it).
  document.querySelectorAll('.appearance-ground').forEach(row => { row.dataset.tip = dark ? 'Dark mode has one background' : ''; });
  // Home's Appearance menu: two radio groups follow the same choice. The Background items are disabled (still focusable,
  // as disabled menu items are) while the page is dark.
  document.querySelectorAll('ui-menu-radio-group[name="appearance-mode"]').forEach(group => { if (group.value !== mode) group.value = mode; });
  document.querySelectorAll('ui-menu-radio-group[name="appearance-ground"]').forEach(group => {
    if (group.value !== ground) group.value = ground;
    group.dataset.tip = dark ? 'Dark mode has one background' : '';
    group.querySelectorAll('ui-menu-radio-item').forEach(item => item.toggleAttribute('disabled', dark));
  });
}
function choose(kind, value) {
  if (!LISTS[kind].some(([choice]) => choice === value)) return;
  try { localStorage.setItem(KEY[kind], value); } catch {}
  window.tinkaAppearance();
  sync();
}
new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-appearance', 'data-ground'] });
addEventListener('storage', event => { if (event.key === KEY.ground) sync(); });

const segment = (label, list, attr, value) => segmentedHTML({ label, attrs: { [attr]: '' }, value, items: list.map(([id, name]) => ({ value: id, label: name, attrs: { [attr.replace('-seg', '-set')]: id } })) });
const rows = () => `<div class="appearance-rows">`
  + `<div class="appearance-choice"><div class="appearance-choice-label" aria-hidden="true">Mode</div>${segment('Appearance mode', MODES, 'data-appearance-seg', read('mode'))}</div>`
  + `<div class="appearance-choice appearance-ground" data-tip-zone data-tip=""><div class="appearance-choice-label" aria-hidden="true">Background</div>${segment('Background', GROUNDS, 'data-ground-seg', read('ground'))}</div>`
  + `</div>`;
const ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path class="appearance-icon-fill" d="M10 3.5a6.5 6.5 0 0 1 0 13z"/></svg>';
let menus = 0;

// Inspectors (board, opened Tinka) take the two labelled rows in place. Home's masthead takes a menu ({control:'menu'}):
// one quiet Appearance button that opens the same rows, so a rarely changed setting is not always on screen.
export function mountAppearance(host, { control = 'segmented' } = {}) {
  if (!host) return;
  const wrap = document.createElement('div');
  // valuechange does not bubble: listen on each control once its rows exist.
  const wire = () => {
    wrap.querySelectorAll('[data-appearance-seg]').forEach(seg => onSegmented(seg, value => choose('mode', value)));
    wrap.querySelectorAll('[data-ground-seg]').forEach(seg => onSegmented(seg, value => choose('ground', value)));
  };
  if (control !== 'menu') {
    wrap.className = 'appearance-control appearance-segmented';
    wrap.innerHTML = rows();
    wire();
    host.append(wrap);
    sync();
    return;
  }
  // Home: a UI SDK menu (popups.js) of two radio groups. Radio items stay open as they change, so Mode and Background
  // can both be set in one visit; arrows, Home/End and typeahead move through them, Escape returns to the button.
  const id = `appearance-menu-${++menus}`;
  wrap.className = 'appearance-control appearance-menu';
  wrap.innerHTML = `<ui-menu-trigger for="${id}"><button type="button" class="tk-btn appearance-trigger" aria-label="Appearance">${ICON}<span>Appearance</span></button></ui-menu-trigger>`;
  const {root, content} = sharedMenu({id, label: 'Appearance', className: 'appearance-menu-content'});
  content.setAttribute('align', 'end');
  content.setAttribute('side-offset', '8');
  content.setAttribute('collision-padding', '8');
  content.innerHTML = menuRadioGroup('appearance-mode', 'Mode', MODES, read('mode')) + menuSeparator + menuRadioGroup('appearance-ground', 'Background', GROUNDS, read('ground'));
  content.addEventListener('valuechange', event => {
    const group = event.target.closest('ui-menu-radio-group');
    if (group?.getAttribute('name') === 'appearance-mode') choose('mode', event.detail.value);
    else if (group?.getAttribute('name') === 'appearance-ground') choose('ground', event.detail.value);
  }, true);
  root.addEventListener('openchange', event => { if (event.detail.value) sync(); });
  host.append(wrap);
  sync();
}
