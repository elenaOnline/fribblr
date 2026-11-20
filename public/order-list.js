// A reorderable list (the board's Comparison order) as a UI SDK collection: one Tab stop, ↑/↓ move focus, and Core's
// createReorder for the reordering itself (core.md § Reordering, "Sort a List"; SPEC B5 § 3.2):
//
//   Space or Enter picks the focused row up, ↑/↓ move it, Home/End to either end, Space or Enter drops it, Escape puts it
//   back, Tab cancels and moves on. A pointer drags a row (3 px threshold); Escape during the drag puts it back.
//   ⌥↑/↓ (Alt) moves the focused row one place at once, with Shift to the first or last place: the board's own reorder
//   chord for a container's members, so the same kind of list answers the same keys everywhere in the app.
//
// Built like Home's board grid (home-board-list.js; ui-sdk.md § Collections): one primitive from Core helpers,
// rendered by createParts as thin custom elements around our own markup.
//
//   <fr-order-list aria-label="…">                 role=listbox, aria-roledescription
//     <fr-order-item value="key">                  display: contents; binds the row
//       <div class="workspace-order-row">           role=option, roving tabindex, aria-selected while picked up
//
// The order is controlled: the dialog sets `list.value` and takes each committed order from `valuechange` (non-bubbling,
// on the list), writing it back. `subscribe` hands every change (moves of a row still held included) to the code that
// draws the rows.
import {definePrimitive, createParts, createChange, createRovingFocus, createReorder} from './vendor/ui-sdk/web/core.js';

const MOVE = {ArrowUp: -1, ArrowDown: 1};

export const orderList = definePrimitive({
  name: 'order-list',
  options: {value: 'value', onValueChange: 'callback', label: 'value'},
  controlled: ['value'],
  state: options => ({value: options.value ?? [], moving: null, focused: null}),
  sync: options => (options.value === undefined ? {} : {value: options.value}),
  api: context => {
    const change = createChange(context);
    const roving = createRovingFocus(context, {slot: 'item', key: 'focused', orientation: () => 'vertical'});
    const reorder = createReorder(context, {
      slot: 'item', key: 'value', draft: 'moving',
      set: (value, details) => change('value', value, details),
      label: key => context.options().label?.(key),
      // The list scrolls inside its dialog: a dragged copy rides above the page (so the scroller never clips it) and a
      // drag near the list's top or bottom edge scrolls it; the row itself shows where it will drop.
      preview: true,
    });
    const itemOf = el => roving.items().find(item => item.el === el);
    return {
      roving,
      reorder,
      keydown(event) {
        const item = itemOf(event.target);
        if (!item || event.isComposing) return;
        if (reorder.keydown(event, item.key)) return;
        // ⌥↑/↓ (Shift: to an end) moves at once: one committed change, announced as a drop.
        if (event.altKey && !event.ctrlKey && !event.metaKey && MOVE[event.key]) {
          event.preventDefault();
          const order = context.store.get().value, at = order.indexOf(item.key);
          const to = event.shiftKey ? (MOVE[event.key] < 0 ? 0 : order.length - 1) : at + MOVE[event.key];
          if (at < 0 || to < 0 || to >= order.length || to === at) return;
          reorder.move(item.key, to);
          queueMicrotask(() => roving.items().find(entry => entry.key === item.key)?.el.focus({preventScroll: false}));
          return;
        }
        if (event.altKey) return;
        roving.keydown(event, item.el);
      },
      order: () => reorder.order(context.store.get()),
      held: key => reorder.moving(context.store.get(), key),
      subscribe: fn => context.store.subscribe(() => fn(reorder.order(context.store.get()))),
      focus() { const items = roving.items(); (items.find(item => item.el.tabIndex === 0) ?? items[0])?.el.focus(); },
    };
  },
  slots: slot => ({
    root: slot({
      role: 'listbox',
      keys: ['ArrowUp', 'ArrowDown', 'Home', 'End', ' ', 'Enter', 'Escape'],
      attrs: () => ({'aria-roledescription': 'reorderable list', 'aria-orientation': 'vertical'}),
      on: {keydown: (event, {api}) => api.keydown(event)},
    }),
    item: slot({
      props: {value: 'string'},
      role: 'option',
      focus: 'roving',
      press: {none: 'A press starts a drag (createReorder); keys pick up and drop.'},
      attrs: (state, part) => {
        const held = part.api.reorder.moving(state, part.key);
        return {
          'aria-roledescription': 'reorderable item',
          'aria-selected': String(held),
          'data-grabbed': held ? '' : null,
          tabindex: part.api.roving.tabIndex(state, part),
        };
      },
      on: {pointerdown: (event, {api, key}) => { if (event.button === 0) api.reorder.pointerdown(event, key); }},
      bind: (el, part) => {
        const cleanups = [part.api.roving.bind(el, part), part.api.reorder.bind(el, part)];
        return () => cleanups.forEach(cleanup => cleanup());
      },
    }),
  }),
});

createParts(orderList, {
  root: {tag: 'fr-order-list', api: ['order', 'held', 'subscribe', 'focus']},
  item: {tag: 'fr-order-item', display: 'contents', target: el => el.firstElementChild},
});
