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
// Zooming out stops at a floor, and going on zooming out from the floor leaves for the place above (ui-sdk.md § Zoom
// floor): an opened Tinka's floor is its fitted view and leaving goes to its board; a board's floor is the zoom at which
// all of it fits (boardZoomFloor) and leaving goes to its parent board, or Home.
//
// The way out is shown as it builds: `progress` (0 to 1) drives the leave band at the screen's edge (leave-band.js), and
// at 1 she leaves. A pinch or trackpad scroll fills it smoothly: a zoom-out a third smaller than the floor (LEAVE_FILL)
// fills it, and zooming back in empties it again before anything zooms in. A step (a −, the − button, a mouse-wheel
// notch) fills half: the first step at the floor shows the band, the second leaves. A wheel or pinch gesture is its
// events with no gap of GESTURE_GAP ms (Chrome reports a trackpad pinch as wheel events with no begin or end); one that
// reaches the floor from above stops there and shows nothing, and a mouse-wheel spin likewise. When a gesture ends (the
// fingers lift, or no event for GESTURE_GAP) a pinch's fill drops at once; a shown step stays until the next step or any
// other input (reset). A held key (repeat) never fills or leaves. Expand (`locked`) shows nothing and never leaves.
export const LEAVE_FILL = Math.log(1.5);
export const LEAVE_STEPS = 2;
export const GESTURE_GAP = 300;
// One zoom step of the opened item's keys and button, kept for callers that size steps by it.
export const LEAVE_RATIO = 1 / 1.25;
// A Control-wheel event: a mouse-wheel notch (lines, or a big pixel step) counts as a step; a trackpad pinch sends small
// pixel steps (deltaY = −100·ln(scale) per frame) and fills smoothly.
export const wheelSource = event => event.deltaMode === 1 || event.deltaMode === 2 || Math.abs(event.deltaY) >= 50 ? 'notch' : 'wheel';
const now_ = () => globalThis.performance?.now?.() ?? Date.now();
export function zoomOutGate({ onProgress = () => {}, schedule = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id) } = {}) {
  let g = null, steps = 0, fill = 0, timer = 0, shown = 0;
  const continuous = source => source === 'wheel' || source === 'pinch';
  const progress = () => Math.min(1, steps / LEAVE_STEPS + fill / LEAVE_FILL);
  const emit = () => { const p = progress(); if (p !== shown) { shown = p; onProgress(p); } };
  const stopTimer = () => { if (timer) cancel(timer); timer = 0; };
  // The end of a wheel gesture is only the absence of events: the fill drops when GESTURE_GAP passes with none.
  const endLater = () => { stopTimer(); timer = schedule(() => { timer = 0; api.end(); }, GESTURE_GAP); };
  const begin = (source, now) => {
    const fresh = !g || (g.source !== source && g.source !== '*') || (source !== 'step' && now - g.last > GESTURE_GAP);
    if (fresh) { fill = 0; g = { source, fromAbove: false }; }
    g.source = source; g.last = now;
    if (continuous(source)) endLater();
  };
  const api = {
    get progress() { return progress(); },
    // Any other input (a pan, a click, another key, leaving the window): the band goes.
    reset() { stopTimer(); g = null; steps = 0; fill = 0; emit(); },
    // The gesture is over (fingers lifted, or no event for GESTURE_GAP): a pinch's fill drops at once; a shown step stays.
    end() { stopTimer(); if (g && continuous(g.source)) g = null; fill = 0; emit(); },
    // The input that was just applied brought the view down to the floor.
    reachedFloor() { if (g) g.fromAbove = true; },
    // She has just arrived here by zooming out of the place below: a wheel or pinch gesture still running carries on as
    // one that reached the floor from above, so it stops here instead of leaving this place too.
    hold(now = now_()) { stopTimer(); g = { source: '*', fromAbove: true, last: now }; steps = 0; fill = 0; emit(); },
    // A zoom-out by `factor` (< 1). `above`: the view is above the floor before it. Returns 'zoom' (apply it, down to the
    // floor at most), 'held' (at the floor: nothing zooms; the band may have grown) or 'leave'.
    out(factor, { above, source = 'step', repeat = false, locked = false, now = now_() }) {
      begin(source, now);
      if (above) { if (steps || fill) { steps = 0; fill = 0; emit(); } return 'zoom'; }
      if (locked || repeat || (g.fromAbove && source !== 'step')) return 'held';
      if (continuous(source)) fill += Math.log(1 / factor); else steps += 1;
      if (progress() >= 1 - 1e-9) { stopTimer(); g = null; steps = 0; fill = 0; emit(); return 'leave'; }
      emit();
      return 'held';
    },
    // A zoom-in by `factor` (>= 1): first empties the band (a pinch reversing makes it recede; a step clears it), then
    // returns what is left to zoom in by (1: nothing zooms).
    back(factor, { source = 'step', now = now_() } = {}) {
      if (!steps && !fill) { if (!g || g.source !== '*') g = null; return factor; }
      if (!continuous(source)) { steps = 0; fill = 0; emit(); return 1; }
      begin(source, now);
      const d = Math.log(factor);
      if (fill >= d) { fill -= d; emit(); return 1; }
      const rest = d - fill; fill = 0; steps = 0; emit();
      return Math.exp(rest);
    },
  };
  return api;
}
// A board's floor: the zoom at which all of its content fits the area (fitZoom, uncapped), never above 100%, so a small
// board can still be seen at 100% and an empty one (fitZoom null) stops at 100%.
export const boardZoomFloor = fitZoom => clampZoom(Math.min(1, Number.isFinite(fitZoom) && fitZoom > 0 ? fitZoom : 1));
