// The emoji sticker picker on UI SDK (how and why: ui-sdk.md § Sticker picker).
//
// - The popup is a ui-popover opened from code against its opener (the Edit tools' Sticker key, the Add menu's Sticker
//   row): the SDK places it beside the opener, flipping and shifting so it stays inside the window, joins the Escape
//   stack, closes on an outside press or when focus leaves, and puts focus back on the opener.
// - The search field is a combobox over a grid: the caret stays in the field while the arrows move one highlight
//   through the grid in two dimensions (aria-activedescendant), Enter places the highlighted sticker, Escape empties
//   the query and then closes (combobox.md, command.md). Matching ignores case and accents (emoji-search.js).
// - The grid is one Tab stop that keeps the same highlight (focus stays on the grid; Listbox's virtual-focus model in
//   two dimensions, with createGridFocus's keys: arrows, Home/End for the row, Ctrl/⌘+Home/End for the corners,
//   PageUp/PageDown). Only the rows in view are rendered (createVirtualizer), so the whole catalogue scrolls as one list.
// - Categories are a ui-toggle-group (one Tab stop, arrows move focus, Space/Enter chooses); skin tone is a
//   ui-segmented-control (a radio group), remembered between visits (createPreference).
import './vendor/ui-sdk/web/popover.js';
import './vendor/ui-sdk/web/toggle.js';
import { announce, createLocalStorage, createPreference, createVirtualizer } from './vendor/ui-sdk/web/core.js';
import { segmentedHTML, onSegmented } from './ui-segmented.js';
import './tips.js';
import { EMOJI_STICKER_MIME, emojiSticker, favoriteEmoji } from './emoji-stickers.js';
import { makeEmojiSearch, skinTones, skinToneNames } from './emoji-search.js';

const categoryIcons = {
  Favorites: '☆', 'Smileys & Emotion': '😀', 'People & Body': '👋', Component: '🧩',
  'Animals & Nature': '🐾', 'Food & Drink': '🍎', 'Travel & Places': '🚗',
  Activities: '⚽', Objects: '💡', Symbols: '🔣', Flags: '🏳️',
};
// Grid geometry, kept in step with emoji-picker.css: cells at least 42 px wide, 44 px tall, 2 px apart.
const CELL_MIN = 42, CELL_GAP = 2, ROW = 46, PAD = 2;
let catalogue, uid = 0, popups = 0;

const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

function loadCatalogue() {
  return catalogue ??= import('./emoji-repertoire.js').then(({ emojiEntries, emojiGroups }) => ({
    groups: emojiGroups,
    find: makeEmojiSearch(emojiEntries, emojiGroups),
  })).catch(error => {
    catalogue = undefined;
    throw error;
  });
}

// The skin tone she chose last, kept between visits and shared by every board.
let skinTone;
function skinTonePreference() {
  return skinTone ??= createPreference({ values: skinTones, defaultValue: 'default', attribute: 'data-emoji-skin-tone', storage: createLocalStorage('tinka/emoji-skin-tone') });
}

let stylesheet;
function loadStyles() {
  return stylesheet ??= new Promise(resolve => {
    let link = document.querySelector('link[data-emoji-styles]');
    if (link?.sheet) return resolve();
    if (!link) {
      link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/app/emoji-picker.css' });
      link.dataset.emojiStyles = '';
      document.head.append(link);
    }
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
  });
}

// Opens the picker against `anchor` (an element). `choose(emoji)` places a sticker and resolves true, or false/throws
// to keep the picker open with the reason; `onClosed()` runs once it has closed. Returns {anchor, close(), root}.
export function openEmojiPicker({ anchor, choose, onClosed }) {
  const root = document.createElement('ui-popover');
  const contentId = `sticker-picker-${++popups}`;
  root.innerHTML = `<ui-popover-content id="${contentId}" class="tk-menu workspace-sticker-picker" data-height="float" aria-label="Emoji stickers" side="bottom" align="center" side-offset="6" collision-padding="8" initial-focus=".emoji-picker-search"></ui-popover-content>`;
  document.body.append(root);
  const content = root.querySelector('ui-popover-content');
  let closed = false;
  const controls = mountEmojiPicker(content, {
    choose,
    close: () => root.api?.close(),
  });
  const expanded = value => {
    if (!(anchor instanceof Element)) return;
    if (value) { anchor.setAttribute('aria-expanded', 'true'); anchor.setAttribute('aria-controls', contentId); }
    else { anchor.setAttribute('aria-expanded', 'false'); anchor.removeAttribute('aria-controls'); }
  };
  root.addEventListener('openchange', event => {
    const { value, reason, event: cause } = event.detail;
    if (value) return;
    // Escape empties the query before it closes (combobox.md § Keyboard; command.md).
    if (reason === 'escape-key' && controls.clearQuery()) { event.preventDefault(); return; }
    // The opener counts as part of the picker, as a popover's own trigger does: a press on it is not a press outside and
    // focus on it is not focus leaving. Its click toggles the picker closed.
    if ((reason === 'outside-press' || reason === 'focus-out') && cause?.target instanceof Node &&
      anchor instanceof Element && anchor.contains(cause.target)) event.preventDefault();
  });
  // Tab order runs as if the picker sat right after its opener (popover.md § Keyboard): Shift+Tab from the field goes
  // back to the opener (the picker stays open; the opener closes it), Tab from the grid goes on to what follows the
  // opener, and the picker closes as focus leaves.
  content.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || !(anchor instanceof Element) || !anchor.isConnected) return;
    const first = content.querySelector('.emoji-picker-search'), last = content.querySelector('.emoji-picker-results');
    if (event.shiftKey && event.target === first) { event.preventDefault(); anchor.focus({ preventScroll: true }); }
    else if (!event.shiftKey && event.target === last) anchor.focus({ preventScroll: true });
  }, true);
  root.addEventListener('openchangecomplete', event => {
    if (event.detail.value || closed) return;
    closed = true;
    expanded(false);
    controls.destroy();
    root.remove();
    onClosed?.();
  });
  const handle = {
    anchor, root,
    close({ focus = true } = {}) {
      if (closed) return;
      if (!focus && root.contains(document.activeElement)) anchor?.focus?.({ preventScroll: true });
      root.api?.close();
    },
  };
  (async () => {
    await Promise.all([customElements.whenDefined('ui-popover'), loadStyles()]);
    if (closed || !root.isConnected) return;
    // A popup opened from code returns focus to what had it before (popups.md § Focus): the opener.
    if (anchor instanceof Element && document.activeElement !== anchor) anchor.focus({ preventScroll: true });
    expanded(true);
    root.api.open({ anchor });
  })();
  return handle;
}

export function mountEmojiPicker(host, { choose, close }) {
  const doc = host.ownerDocument;
  const id = `emoji-picker-${++uid}`;
  const tone = skinTonePreference();
  const toneIndex = () => Math.max(0, skinTones.indexOf(tone.get().value));
  const picker = doc.createElement('div');
  picker.className = 'emoji-picker';
  picker.dataset.tipZone = ''; // hints on the shared tooltip's delegate (tips.js), no wrapper per key
  picker.innerHTML = `
    <input type="search" class="tk-field emoji-picker-search" placeholder="Search emoji" aria-label="Search emoji"
      role="combobox" aria-autocomplete="list" aria-expanded="true" aria-haspopup="grid" aria-controls="${id}-grid"
      autocomplete="off" spellcheck="false" maxlength="120" enterkeyhint="done">
    <ui-toggle-group class="emoji-picker-categories" aria-label="Emoji categories" deselectable="false" default-value="-1"></ui-toggle-group>
    <div class="emoji-picker-view">
      <span class="emoji-picker-title" id="${id}-title">Favorites</span>
      ${segmentedHTML({ label: 'Skin tone', className: 'emoji-picker-tones', value: tone.get().value,
        items: skinTones.map((value, index) => ({ value, ariaLabel: skinToneNames[index], tip: skinToneNames[index],
          html: `<span aria-hidden="true">✋${index ? String.fromCodePoint(0x1F3FA + index) : ''}</span>` })) })}
    </div>
    <div class="emoji-picker-results" id="${id}-grid" role="grid" tabindex="0" aria-labelledby="${id}-title" aria-colcount="7" aria-rowcount="0">
      <div class="emoji-picker-space" role="none"></div>
    </div>
    <div class="emoji-picker-foot">
      <span class="emoji-picker-name" aria-hidden="true"></span>
      <span class="emoji-picker-status" role="status"></span>
    </div>`;
  host.replaceChildren(picker);
  const $ = selector => picker.querySelector(selector);
  const search = $('.emoji-picker-search'), categories = $('.emoji-picker-categories'), title = $('.emoji-picker-title');
  const tones = $('.emoji-picker-tones'), results = $('.emoji-picker-results'), space = $('.emoji-picker-space');
  const name = $('.emoji-picker-name'), status = $('.emoji-picker-status');

  let entries = favoriteEmoji;
  let group = -1;          // -1: Favorites
  let active = -1;         // index of the highlighted sticker in `entries`, -1 for none
  let cols = 7;
  let groups = [];
  let find;
  let loadFailed = false;
  let pending = false;
  let destroyed = false;
  let version = 0;         // bumps whenever `entries` or `cols` change, so rendered rows are rebuilt
  const rendered = new Map();   // row index -> row element, for the current version
  let renderedVersion = -1;
  let lit = null;          // the cell that shows the highlight

  const rowCount = () => Math.ceil(entries.length / cols);
  const virtual = createVirtualizer({
    count: rowCount,
    estimate: () => ROW,
    overscan: 3,
    keep: () => active >= 0 ? [Math.floor(active / cols)] : [],
  });

  const cellId = index => `${id}-cell-${index}`;
  function rowHTML(row) {
    let cells = '';
    for (let index = row * cols, end = Math.min(entries.length, index + cols); index < end; index++) {
      const [emoji, label] = entries[index];
      cells += `<div role="gridcell" class="emoji-picker-option" id="${cellId(index)}" data-index="${index}" data-emoji="${esc(emoji)}" aria-label="${esc(label)}" draggable="true">${esc(emoji)}</div>`;
    }
    return cells;
  }
  function renderRows() {
    if (destroyed) return;
    if (renderedVersion !== version) {
      rendered.forEach(row => row.remove());
      rendered.clear();
      renderedVersion = version;
    }
    space.style.height = `${virtual.size()}px`;
    const wanted = new Set();
    for (const item of virtual.items()) {
      if (item.index >= rowCount()) continue;
      wanted.add(item.index);
      let row = rendered.get(item.index);
      if (!row) {
        row = doc.createElement('div');
        row.className = 'emoji-picker-row';
        row.setAttribute('role', 'row');
        row.setAttribute('aria-rowindex', String(item.index + 1));
        row.innerHTML = rowHTML(item.index);
        rendered.set(item.index, row);
        space.append(row);
      }
      row.style.transform = `translateY(${item.start}px)`;
    }
    for (const [index, row] of rendered) if (!wanted.has(index)) { row.remove(); rendered.delete(index); }
    paintHighlight();
  }
  const unsubscribe = virtual.subscribe(renderRows);
  const disconnect = virtual.connect(results);

  // The highlight: data-highlighted on the cell, aria-activedescendant on the field and the grid, the name below.
  function paintHighlight() {
    const cell = active >= 0 ? doc.getElementById(cellId(active)) : null;
    if (lit && lit !== cell) lit.removeAttribute('data-highlighted');
    if (cell) cell.setAttribute('data-highlighted', '');
    lit = cell;
    for (const owner of [search, results]) {
      if (cell) owner.setAttribute('aria-activedescendant', cell.id);
      else owner.removeAttribute('aria-activedescendant');
    }
    const entry = entries[active];
    name.textContent = entry ? `${entry[0]}  ${entry[1]}` : (find || !search.value.trim()) && entries.length ? `${entries.length.toLocaleString()} emoji` : '';
  }
  function highlight(index, { reveal = true } = {}) {
    active = index >= 0 && index < entries.length ? index : -1;
    if (active >= 0 && reveal) virtual.scrollToIndex(Math.floor(active / cols), { align: 'auto' });
    renderRows();
  }

  function measureCols() {
    const width = results.clientWidth - PAD * 2;
    const next = width > 0 ? Math.max(1, Math.floor((width + CELL_GAP) / (CELL_MIN + CELL_GAP))) : cols;
    if (next === cols) return false;
    cols = next;
    results.style.setProperty('--emoji-cols', String(cols));
    results.setAttribute('aria-colcount', String(cols));
    return true;
  }
  const resize = new ResizeObserver(() => {
    if (!measureCols()) return;
    version++;
    results.setAttribute('aria-rowcount', String(rowCount()));
    virtual.refresh();
    renderRows();
  });
  resize.observe(results);

  function setStatus(text) {
    if (status.textContent !== text) status.textContent = text;
  }
  function renderResults({ keepActive = false } = {}) {
    const query = search.value;
    const searching = Boolean(query.trim());
    title.textContent = searching ? 'Search results' : (group === -1 ? 'Favorites' : groups[group]);
    if (find) ({ entries } = find(query, group, toneIndex()));
    else {
      const pasted = emojiSticker(query);
      entries = pasted ? [[pasted, 'Pasted emoji']] : (searching ? [] : favoriteEmoji);
    }
    if (!pending) {
      setStatus(loadFailed ? 'The emoji catalog didn’t load. Reopen Sticker to try again.'
        : find && !entries.length ? 'No matching emoji'
          : !find && searching && !entries.length ? 'Loading emoji…' : '');
    }
    version++;
    results.setAttribute('aria-rowcount', String(rowCount()));
    // Typing highlights the best match, so Enter places it (combobox.md § Auto Highlight); a new view starts at the top.
    let next = keepActive ? Math.min(active, entries.length - 1) : searching && entries.length ? 0 : -1;
    // The grid, while it has focus, always shows where its keys are.
    if (next < 0 && entries.length && doc.activeElement === results) next = 0;
    if (!keepActive) results.scrollTop = 0;
    virtual.refresh();
    highlight(next, { reveal: keepActive });
  }

  function renderCategories() {
    const order = groups.map((_, index) => index);
    const component = groups.indexOf('Component');
    if (component >= 0) order.push(...order.splice(component, 1));
    categories.innerHTML = [-1, ...order].map(index => {
      const label = index === -1 ? 'Favorites' : groups[index];
      const aria = label === 'Component' ? 'Emoji components' : label;
      return `<ui-toggle value="${index}"><button type="button" class="emoji-picker-category" aria-label="${esc(aria)}" data-tip="${esc(aria)}">${categoryIcons[label] || esc(label[0])}</button></ui-toggle>`;
    }).join('');
    syncCategories();
  }
  // The pressed category follows the view; none is pressed while a search shows its results.
  function syncCategories() {
    const value = search.value.trim() ? [] : [String(group)];
    if (categories.api) { if (String(categories.value) !== String(value)) categories.value = value; }
    else categories.setAttribute('default-value', value.join(','));
  }

  async function add(emoji) {
    if (pending || !emoji) return;
    pending = true;
    results.setAttribute('aria-disabled', 'true');
    setStatus('Adding sticker…');
    try {
      if (await choose(emoji) === false) throw new Error('Try again.');
    } catch (error) {
      if (destroyed) return;
      pending = false;
      results.removeAttribute('aria-disabled');
      setStatus(`Couldn’t add sticker. ${error?.message || 'Try again.'}`);
      return;
    }
    if (!destroyed) close();
  }

  // Where an arrow, Home/End or PageUp/PageDown takes the highlight, or undefined to leave the key alone.
  function target(event, inGrid) {
    const { key } = event;
    const last = entries.length - 1;
    if (last < 0) return undefined;
    const page = Math.max(1, Math.floor(results.clientHeight / ROW));
    if (active < 0) {
      // Nothing highlighted yet: Down (or, in the grid, any move) starts at the first sticker.
      if (key === 'ArrowDown' || (inGrid && ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(key))) return 0;
      return undefined;
    }
    const row = Math.floor(active / cols), rowStart = row * cols;
    switch (key) {
      case 'ArrowRight': return Math.min(last, active + 1);
      case 'ArrowLeft': return Math.max(0, active - 1);
      case 'ArrowDown': return rowStart + cols > last ? active : Math.min(last, active + cols);
      // Up from the first row hands the field back its arrows (the highlight leaves the grid); the grid itself stops there.
      case 'ArrowUp': return row === 0 ? (inGrid ? active : -1) : active - cols;
      case 'PageDown': return Math.min(last, active + page * cols);
      case 'PageUp': return Math.max(active % cols, active - page * cols);
      case 'Home': return inGrid ? ((event.ctrlKey || event.metaKey) ? 0 : rowStart) : undefined;
      case 'End': return inGrid ? ((event.ctrlKey || event.metaKey) ? last : Math.min(last, rowStart + cols - 1)) : undefined;
      default: return undefined;
    }
  }

  // The count is announced once typing pauses (combobox.md § Async Search); messages announce themselves (role=status).
  let counted = 0;
  search.addEventListener('input', () => {
    renderResults(); syncCategories();
    clearTimeout(counted);
    counted = setTimeout(() => { if (!destroyed && !status.textContent && search.value.trim()) announce(`${entries.length.toLocaleString()} emoji`); }, 700);
  });
  categories.addEventListener('valuechange', event => {
    const value = event.detail.value?.[0];
    if (value == null) return;
    group = Number(value);
    search.value = '';
    renderResults();
  });
  onSegmented(tones, value => {
    tone.set(value);
    renderResults({ keepActive: true });
  });

  results.addEventListener('focus', () => { if (active < 0 && entries.length) highlight(0); });
  results.addEventListener('pointermove', event => {
    const cell = event.target.closest?.('.emoji-picker-option');
    if (cell && Number(cell.dataset.index) !== active) highlight(Number(cell.dataset.index), { reveal: false });
  });
  results.addEventListener('click', event => {
    const cell = event.target.closest('.emoji-picker-option');
    if (cell) add(cell.dataset.emoji);
  });
  results.addEventListener('dragstart', event => {
    const cell = event.target.closest('.emoji-picker-option');
    if (!cell || !event.dataTransfer) return;
    if (pending) { event.preventDefault(); return; }
    event.dataTransfer.setData(EMOJI_STICKER_MIME, cell.dataset.emoji);
    event.dataTransfer.effectAllowed = 'copy';
  });
  picker.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) event.stopPropagation();
  }, { passive: true });

  picker.addEventListener('keydown', event => {
    // Escape goes on to the popover, whose openchange empties the query first (openEmojiPicker).
    if (event.key === 'Escape') return;
    // The board's own keys never see what is typed here.
    event.stopPropagation();
    if (event.isComposing) return;
    const inField = event.target === search, inGrid = event.target === results;
    if (!inField && !inGrid) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.repeat) return;
      const index = active >= 0 ? active : inField && search.value.trim() ? 0 : -1;
      if (entries[index]) add(entries[index][0]);
      return;
    }
    if (inGrid && event.key === ' ') {
      event.preventDefault();
      if (!event.repeat && entries[active]) add(entries[active][0]);
      return;
    }
    if (event.altKey || ((event.ctrlKey || event.metaKey) && !['Home', 'End'].includes(event.key))) return;
    // Typing on the grid searches: the character goes to the field (the grid's typeahead is the search).
    if (inGrid && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      search.focus({ preventScroll: true });
      search.setRangeText(event.key, search.selectionStart ?? search.value.length, search.selectionEnd ?? search.value.length, 'end');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const next = target(event, inGrid);
    if (next === undefined) return;
    event.preventDefault();
    highlight(next);
  });

  renderResults();
  loadCatalogue().then(data => {
    if (destroyed) return;
    ({ groups, find } = data);
    renderCategories();
    // The tone and any query typed while loading apply now.
    renderResults({ keepActive: !search.value.trim() });
  }, () => {
    if (destroyed) return;
    loadFailed = true;
    setStatus('The emoji catalog didn’t load. Reopen Sticker to try again.');
  });
  return {
    focus() { search.focus({ preventScroll: true }); },
    // Empties the query; false when it was already empty (so Escape may close).
    clearQuery() {
      if (!search.value) return false;
      search.value = '';
      renderResults();
      syncCategories();
      if (!picker.contains(doc.activeElement)) search.focus({ preventScroll: true });
      return true;
    },
    destroy() {
      destroyed = true;
      clearTimeout(counted);
      unsubscribe(); disconnect(); resize.disconnect();
      picker.remove();
    },
  };
}
