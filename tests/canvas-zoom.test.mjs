import test from 'node:test';
import assert from 'node:assert/strict';
import {MIN_ZOOM,MAX_ZOOM,FIT_MAX_ZOOM,clampZoom,sliderFromZoom,zoomFromSlider,stepSliderZoom,wheelZoomFactor,SLIDER_STEPS} from '../public/canvas-zoom.js';

test('keyboard zoom skips duplicate logarithmic ticks and stops at the limits',()=>{
  for(const [base,previous,next] of [[1,.99,1.01],[2,1.95,2.05]]){
    assert.equal(stepSliderZoom(sliderFromZoom(base),-1),previous);
    assert.equal(stepSliderZoom(sliderFromZoom(base),1),next);
  }
  assert.equal(stepSliderZoom(0,-1),MIN_ZOOM);
  assert.equal(stepSliderZoom(SLIDER_STEPS,1),MAX_ZOOM);
});

test('canvas zoom range reaches well past the old 125% ceiling and below 5%', () => {
  assert.equal(MAX_ZOOM, 10);assert.equal(MIN_ZOOM, .02);assert.equal(FIT_MAX_ZOOM, 1.25);
  assert.equal(clampZoom(50), 10);assert.equal(clampZoom(.001), .02);assert.equal(clampZoom(4), 4);
});

test('the logarithmic slider round-trips whole percents and spans the full range', () => {
  assert.equal(sliderFromZoom(MIN_ZOOM), 0);assert.equal(sliderFromZoom(MAX_ZOOM), SLIDER_STEPS);
  assert.equal(zoomFromSlider(0), MIN_ZOOM);assert.equal(zoomFromSlider(SLIDER_STEPS), MAX_ZOOM);
  for (const percent of [2, 5, 10, 25, 40, 50, 75, 80, 100, 125, 150, 200, 400, 800, 1000]) assert.equal(zoomFromSlider(sliderFromZoom(percent / 100)), percent / 100, `${percent}%`);
  // 100% sits near the middle of the track rather than at its far end.
  assert.ok(sliderFromZoom(1) > SLIDER_STEPS * .55 && sliderFromZoom(1) < SLIDER_STEPS * .75);
});

test('Control-wheel follows a Chromium trackpad pinch 1:1 and caps a mouse notch', () => {
  // Chromium encodes a pinch of scale s as Control-wheel deltaY = -100·ln(s).
  for (const scale of [1.02, 1.1, .95]) assert.ok(Math.abs(wheelZoomFactor({deltaMode:0, deltaY:-100 * Math.log(scale)}) - scale) < 1e-9);
  assert.ok(Math.abs(wheelZoomFactor({deltaMode:0, deltaY:-100}) - Math.exp(.3)) < 1e-9);
  assert.ok(Math.abs(wheelZoomFactor({deltaMode:0, deltaY:120}) - Math.exp(-.3)) < 1e-9);
  assert.ok(Math.abs(wheelZoomFactor({deltaMode:1, deltaY:-3}) - Math.exp(.3)) < 1e-9);
});

import {zoomOutGate,boardZoomFloor,wheelSource,LEAVE_FILL,LEAVE_STEPS,LEAVE_EVENT_MAX,GESTURE_GAP} from '../public/canvas-zoom.js';
// A gate recording the band's progress. It has no clock of its own: nothing changes on silence.
function gateWith() {
  const shown = [];
  const gate = zoomOutGate({onProgress: p => shown.push(+p.toFixed(3))});
  return {gate, shown};
}
test('the zoom-out gate fills the leave band from the floor: a pinch a third smaller leaves, reversing empties it, lifting drops it', () => {
  const {gate, shown} = gateWith();let t = 0;
  const pinch = f => gate.out(f, {above: false, source: 'pinch', now: t += 16});
  assert.equal(pinch(.95), 'held');assert.ok(Math.abs(gate.progress - Math.log(1 / .95) / LEAVE_FILL) < 1e-9, 'progress is how far past the floor, over a third');
  assert.equal(pinch(.95), 'held');const p2 = gate.progress;
  assert.equal(gate.back(1 / .95, {source: 'pinch', now: t += 16}), 1, 'reversing first empties the band, nothing zooms in');
  assert.ok(gate.progress < p2, 'the band recedes');
  assert.ok(Math.abs(gate.back(1 / .9025, {source: 'pinch', now: t += 16}) - 1 / .95) < 1e-9, 'past empty, the rest zooms in');
  assert.equal(gate.progress, 0);
  pinch(.95);const held = gate.progress;
  t += 5000;assert.equal(gate.progress, held, 'silence changes nothing: Chrome sends no pinch end, the band stays still');
  pinch(.95);assert.ok(Math.abs(gate.progress - Math.log(1 / .95) / LEAVE_FILL) < 1e-9, 'a new pinch after the pause starts from its own progress');
  gate.end();assert.equal(gate.progress, 0, 'fingers lifting (touch, Safari) drop it at once');
  let v;for (let i = 0; i < 20 && (v = pinch(.95)) === 'held'; i++);
  assert.equal(v, 'leave', 'going on to a third smaller leaves');assert.equal(gate.progress, 0, 'leaving clears the band');
  assert.ok(Math.log(1 / .95) * 7 < LEAVE_FILL && Math.log(1 / .95) * 8 >= LEAVE_FILL);
  assert.ok(shown.every(p => p >= 0 && p <= 1));
  // However brisk: a 30 px Chrome pinch event (×0.74) fills a fifth at most, so the band shows for five events first.
  const brisk = gateWith();let n = 0;
  while (brisk.gate.out(.74, {above: false, source: 'wheel', now: t += 16}) === 'held') n++;
  assert.equal(n, 4, 'four events show the band (0.2 to 0.8), the fifth leaves');
  assert.deepEqual(brisk.shown.slice(0, 4), [.2, .4, .6, .8]);
});
test('the zoom-out gate: steps fill half, a gesture that reaches the floor stops there, a held key never leaves', () => {
  let {gate} = gateWith(), t = 0;
  assert.equal(LEAVE_STEPS, 2);
  assert.equal(gate.out(.8, {above: true}), 'zoom');gate.reachedFloor();
  assert.equal(gate.out(.8, {above: false}), 'held', 'a press at the floor shows the band');assert.equal(gate.progress, .5);
  assert.equal(gate.out(.8, {above: false}), 'leave', 'the next press leaves');
  assert.equal(gate.out(.8, {above: false}), 'held');assert.equal(gate.out(.8, {above: false, repeat: true}), 'held', 'repeats never leave');
  assert.equal(gate.progress, .5, 'and do not fill');
  assert.equal(gate.back(1.25), 1, '+ clears a shown band without zooming');assert.equal(gate.progress, 0);
  gate.out(.8, {above: false});gate.reset();assert.equal(gate.progress, 0, 'any other input clears it');
  // A mouse-wheel spin: the notch that reaches the floor and the rest of the spin stop; after a pause, a notch shows the
  // band and the next leaves, whenever it comes.
  assert.equal(gate.out(.74, {above: true, source: 'notch', now: t += 30}), 'zoom');gate.reachedFloor();
  assert.equal(gate.out(.74, {above: false, source: 'notch', now: t += 30}), 'held');assert.equal(gate.progress, 0, 'the spin shows nothing');
  assert.equal(gate.out(.74, {above: false, source: 'notch', now: t += GESTURE_GAP + 1}), 'held');assert.equal(gate.progress, .5);
  t += 5000;assert.equal(gate.progress, .5, 'a shown step stays, still');
  assert.equal(gate.out(.74, {above: false, source: 'notch', now: t += 2000}), 'leave');
  assert.equal(gate.out(.5, {above: false, locked: true}), 'held', 'Expand: the floor is a wall');assert.equal(gate.progress, 0, '…and shows nothing');
  ({gate} = gateWith());gate.hold(t);
  assert.equal(gate.out(.9, {above: false, source: 'wheel', now: t += 30}), 'held');assert.equal(gate.progress, 0, 'arriving mid-gesture: it stops here and shows nothing');
  assert.equal(gate.out(.9, {above: false, source: 'wheel', now: t += GESTURE_GAP + 1}), 'held');assert.ok(gate.progress > 0, 'a new gesture fills the band');
  assert.equal(wheelSource({deltaMode: 0, deltaY: 100}), 'notch');assert.equal(wheelSource({deltaMode: 1, deltaY: 3}), 'notch');assert.equal(wheelSource({deltaMode: 0, deltaY: 4}), 'wheel');
});
test('a board\'s floor is where all of it fits, never above 100%; an empty board stops at 100%', () => {
  assert.equal(boardZoomFloor(.4), .4);
  assert.equal(boardZoomFloor(3), 1);
  assert.equal(boardZoomFloor(null), 1);
  assert.equal(boardZoomFloor(.001), MIN_ZOOM);
});
