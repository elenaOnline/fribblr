// Pointing mode's input guard (pointing-mode.js). Loaded by board.html before canvas.js, so its window-capture
// listeners are the first on the page: while the mode is on, a press, move or key the mode owns goes to the mode
// alone, before the board's own capture handlers (press focus, Whiteboard, the marquee, outside-press closing of
// panels, the Escape ladder) can see it. Off, it does nothing but one property read per event.
export const pointingGuard = {handler: null};
const TYPES = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'keydown'];
if (typeof window !== 'undefined') for (const type of TYPES) window.addEventListener(type, event => {
  const handler = pointingGuard.handler;
  if (handler && handler(event) === true) event.stopImmediatePropagation();
}, {capture: true});
