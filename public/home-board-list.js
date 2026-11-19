// Home's board grid as a UI SDK collection: one Tab stop, arrows that follow the visual grid, typeahead by title,
// and file-manager selection (Space, ⇧/⌘/Ctrl-click, ⇧+arrows, ⌘A). Built from UI SDK Core behaviours
// (createRovingFocus, createSelection, createTypeahead, createFocusRecovery) in one primitive, rendered with
// createParts as two thin custom elements around the markup Home already draws (see ui-sdk.md, "Collections"):
//
//   <fr-board-list aria-label="Boards">            role=listbox, aria-multiselectable; display: contents
//     <fr-board value="item-id">                     display: contents; binds the card's own link
//       <article class="board-card" role="none"> … <a class="board-link">   role=option, aria-selected, roving tabindex
//
// The board's link stays the focused element, so the focus ring, Enter (opens the board) and a plain click (opens
// it too) are the browser's own. Selection is controlled: Home owns the selected set and writes it back to
// `list.value`; every change asks first through a cancelable `valuechange` event on the list.
import {
  definePrimitive, createParts, createChange, createRovingFocus, createSelection, createTypeahead,
  createFocusRecovery, isTypeaheadKey, matchesShortcut,
} from './vendor/ui-sdk/web/core.js';

const titleOf = el => (el.querySelector('h3')?.textContent || el.textContent || '').trim();

// How many items share the first visual row. Read on a key press only, so nothing runs while scrolling or resizing.
function columns(items) {
  const top = items[0]?.el.getBoundingClientRect().top;
  let n = 0;
  for (const item of items) { if (Math.abs(item.el.getBoundingClientRect().top - top) > 2) break; n++; }
  return Math.max(1, n);
}

// Arrow keys follow the grid as the window lays it out: Left/Right step through reading order (wrapping from a
// row's end to the next row), Up/Down move one column straight up or down; Down from a column with nothing below
// it lands on the last board, as Finder's icon view does. Home/End, with or without Ctrl/⌘, go to the first and
// last board. No wrap past either end. Other Alt/Ctrl/⌘ combinations are left to other shortcuts.
function gridMove(event, { from, items, rtl }) {
  const index = items.findIndex(item => item.key === from.key);
  if (index < 0 || event.altKey) return undefined;
  if (event.key === 'Home') return items[0]?.key;
  if (event.key === 'End') return items.at(-1)?.key;
  if (event.ctrlKey || event.metaKey) return undefined;
  const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[event.key];
  if (step) return items[index + step]?.key;
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return undefined;
  const cols = columns(items), down = event.key === 'ArrowDown';
  const target = index + (down ? cols : -cols);
  if (down && target >= items.length) return Math.floor(index / cols) < Math.floor((items.length - 1) / cols) ? items.at(-1).key : undefined;
  return items[target]?.key;
}

export const boardList = definePrimitive({
  name: 'board-list',
  options: { value: 'value', onValueChange: 'callback', selectable: 'value' },
  controlled: ['value'],
  state: options => ({ value: options.value ?? [], focused: null }),
  sync: options => (options.value === undefined ? {} : { value: options.value }),
  api: context => {
    const change = createChange(context);
    const roving = createRovingFocus(context, {
      slot: 'board',
      key: 'focused',
      move: gridMove,
      // Before focus has been in the grid, Tab lands on the first selected board, else the first board.
      preferred: item => context.store.get().value.includes(item.key),
    });
    const selectable = key => context.options().selectable?.(key) ?? true;
    const selection = createSelection(context, {
      key: 'value',
      set: (value, details) => change('value', value, details),
      order: () => roving.items().map(item => item.key),
      multiple: () => true,
      selectable,
    });
    const typeahead = createTypeahead();
    // A removed board hands focus to the board that took its place, or the last one.
    let lastIndex = 0;
    const recovery = createFocusRecovery({ fallback: () => { const items = roving.items(); return (items[lastIndex] ?? items.at(-1))?.el; } });
    const itemOf = el => roving.items().find(item => item.el === el);
    const press = { reason: 'item-press' };
    return {
      roving,
      selection,
      recovery,
      noteFocus(el) { const i = roving.items().findIndex(item => item.el === el); if (i >= 0) lastIndex = i; },
      keydown(event) {
        if (event.defaultPrevented || event.isComposing) return;
        const item = itemOf(event.target);
        if (!item) return;
        if (matchesShortcut(event, 'mod+a')) {
          event.preventDefault();
          selection.toggleAll({ reason: 'list-navigation', event });
          return;
        }
        if (event.key === ' ' && !event.altKey && !event.ctrlKey && !event.metaKey && !typeahead.active()) {
          event.preventDefault(); // a link would scroll the page
          if (event.shiftKey) selection.extend(item.key, { from: item.key, reason: 'list-navigation', event });
          else selection.toggle(item.key, { reason: 'list-navigation', event });
          return;
        }
        const moved = roving.keydown(event, item.el);
        if (moved) {
          if (moved.shift) selection.extend(moved.key, { from: moved.from, reason: 'list-navigation', event });
          else selection.setAnchor(moved.key);
          return;
        }
        // "/" stays Home's shortcut to the find field.
        if (event.key === '/' || !isTypeaheadKey(event)) return;
        if (event.key === ' ') event.preventDefault();
        const items = roving.items();
        const index = typeahead(event.key, items.map(i => titleOf(i.el)), items.indexOf(item));
        if (index !== -1) { roving.focus(items[index].key); selection.setAnchor(items[index].key); }
      },
      // A press on a board with a modifier, or on its select circle: ⇧ selects the range from the anchor,
      // ⌘/Ctrl (and the circle) toggle one board. Focus follows the press, as in a list.
      press(key, event, { range = false } = {}) {
        // With no anchor yet (nothing chosen since the selection was cleared or drawn), a range starts at this board.
        if (range) selection.extend(key, { ...press, event, from: selection.anchor() ?? key });
        else selection.toggle(key, { ...press, event });
        // Focus without scrolling: the board is under the pointer already. The roving stop follows focus.
        roving.items().find(item => item.key === key)?.el.focus({ preventScroll: true });
      },
      selectAll(event) { selection.toggleAll({ reason: 'list-navigation', event }); },
      focus() { const items = roving.items(); (items.find(i => i.el.tabIndex === 0) ?? items[0])?.el.focus(); },
    };
  },
  slots: slot => ({
    root: slot({
      role: 'listbox',
      keys: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', ' ', 'typeahead'],
      attrs: () => ({ 'aria-multiselectable': 'true' }),
      on: { keydown: (event, { api }) => api.keydown(event) },
    }),
    board: slot({
      props: { value: 'string' },
      role: 'option',
      focus: 'roving',
      press: { none: 'The board is a link: a click opens it. Selection comes from modified presses and Space, which the list handles.' },
      attrs: (state, part) => ({
        'aria-selected': String(state.value.includes(part.key)),
        tabindex: part.api.roving.tabIndex(state, part),
      }),
      bind: (el, part) => {
        const unbindFocus = part.api.roving.bind(el, part);
        const unbindRecovery = part.api.recovery.bind(el, part);
        const note = () => part.api.noteFocus(el);
        el.addEventListener('focus', note);
        return () => { unbindFocus(); unbindRecovery(); el.removeEventListener('focus', note); };
      },
    }),
  }),
});

createParts(boardList, {
  root: { tag: 'fr-board-list', display: 'contents', api: ['press', 'selectAll', 'focus'] },
  board: { tag: 'fr-board', display: 'contents', target: el => el.querySelector('.board-link') },
});
