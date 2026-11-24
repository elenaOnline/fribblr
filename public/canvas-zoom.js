// Board Canvas zoom range and the zoom slider's scale. No DOM, so tests can share it.
export const MIN_ZOOM = .02;
export const MAX_ZOOM = 10;
// Fit board / Fit selection frame work; they never magnify past this, so a small
// board is not blown up (board overview relies on it too).
export const FIT_MAX_ZOOM = 1.25;
export const clampZoom = value => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
// The slider is logarithmic so 2%–1000% stays precise everywhere: each of its
// SLIDER_STEPS is the same zoom ratio (about 0.6%).
export const SLIDER_STEPS = 1000;
const span = Math.log(MAX_ZOOM / MIN_ZOOM);
export const sliderFromZoom = value => Math.round(SLIDER_STEPS * Math.log(clampZoom(value) / MIN_ZOOM) / span);
// Slider positions land on readable percents (tenths below 10%, fives from 150%),
// so 100 is exactly 1 and every whole percent up to 149% can be reached.
export function zoomFromSlider(position) {
  const percent = 100 * MIN_ZOOM * Math.exp(span * Math.max(0, Math.min(SLIDER_STEPS, Number(position) || 0)) / SLIDER_STEPS);
  const unit = percent < 10 ? .1 : percent < 150 ? 1 : 5;
  return clampZoom(Math.round(Math.round(percent / unit) * unit * 10) / 1000);
}
// Adjacent logarithmic stops can round to the same percentage. Keyboard steps
// skip those repeats so the control always moves until it reaches a limit.
export function stepSliderZoom(position, direction) {
  const start=zoomFromSlider(position);
  if(direction!==1&&direction!==-1)return start;
  for(let tick=Number(position)+direction;tick>=0&&tick<=SLIDER_STEPS;tick+=direction){
    const zoom=zoomFromSlider(tick);
    if(zoom!==start)return zoom;
  }
  return start;
}
// A Control/⌘-wheel step as a zoom ratio. Chromium and Edge report a trackpad
// pinch as Control-wheel with deltaY = -100·ln(scale), so this follows the fingers
// exactly; a mouse wheel notch is capped at the same 1.35× step as before.
export function wheelZoomFactor(event) {
  const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 100 : event.deltaY;
  return Math.exp(-Math.max(-30, Math.min(30, delta)) / 100);
}
// A board counts as large, so its map opens by itself on desktop widths, when
// fitting all of it would need less than this zoom.
export const LARGE_BOARD_ZOOM = .4;
// Two views match when pan and zoom agree to within rounding.
export const sameView = (a, b) => !!a && !!b && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.zoom - b.zoom) < 1e-4;
// Zooming out stops at a floor, and a fresh zoom-out from the floor leaves for the place above (ui-sdk.md § Zoom floor):
// an opened Tinka's floor is its fitted view and leaving goes to its board; a board's floor is the zoom at which all of it
// fits (boardZoomFloor) and leaving goes to its parent board, or Home. One step below the floor leaves: one − press
// (1.25×), one wheel notch, or wheel / pinch steps that add up to a fifth. A wheel or pinch gesture is its zoom-out events
// with no gap of GESTURE_GAP ms; one that reaches the floor from above stops there, and only a new gesture started at
// the floor can leave. A held key (repeat) never leaves.
export const LEAVE_RATIO = 1 / 1.25;
export const GESTURE_GAP = 300;
export function zoomOutGate() {
  let g = null;
  return {
    reset() { g = null; },
    // The input that was just applied brought the view down to the floor.
    reachedFloor() { if (g) g.fromAbove = true; },
    // She has just arrived here by zooming out of the place below: a wheel or pinch gesture still running carries on as
    // one that reached the floor from above, so it stops here instead of leaving this place too.
    hold(now = globalThis.performance?.now?.() ?? Date.now()) { g = { source: '*', ratio: 1, fromAbove: true, last: now }; },
    // A zoom-out by `factor` (< 1). `above`: the view is above the floor before it. `locked`: the floor never leaves
    // (Expand). Returns 'zoom' (apply it, down to the floor at most), 'held' (at the floor, nothing moves) or 'leave'.
    out(factor, { above, source = 'step', repeat = false, locked = false, now = globalThis.performance?.now?.() ?? Date.now() }) {
      const gesture = source !== 'step';
      if (!g || !gesture || (g.source !== source && g.source !== '*') || now - g.last > GESTURE_GAP) g = { source, ratio: 1, fromAbove: false };
      g.source = source;
      g.last = now;
      if (above) return 'zoom';
      if (locked || repeat || g.fromAbove) return 'held';
      g.ratio *= factor;
      if (gesture && g.ratio > LEAVE_RATIO * (1 + 1e-6)) return 'held';
      g = null;
      return 'leave';
    },
  };
}
// A board's floor: the zoom at which all of its content fits the area (fitZoom, uncapped), never above 100%, so a small
// board can still be seen at 100% and an empty one (fitZoom null) stops at 100%.
export const boardZoomFloor = fitZoom => clampZoom(Math.min(1, Number.isFinite(fitZoom) && fitZoom > 0 ? fitZoom : 1));
