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

import {zoomOutGate,boardZoomFloor,LEAVE_RATIO,GESTURE_GAP} from '../public/canvas-zoom.js';
test('the zoom-out gate: a gesture that reaches the floor stops, a fresh one a fifth below leaves, a held key never leaves', () => {
  let gate = zoomOutGate(), t = 0;
  assert.equal(gate.out(.74, {above: true, source: 'wheel', now: t += 30}), 'zoom'); gate.reachedFloor();
  assert.equal(gate.out(.74, {above: false, source: 'wheel', now: t += 30}), 'held', 'the same gesture stops at the floor');
  assert.equal(gate.out(.74, {above: false, source: 'wheel', now: t += GESTURE_GAP + 1}), 'leave', 'after the pause, one notch leaves');
  gate = zoomOutGate();
  for (let i = 0; i < 2; i++) assert.equal(gate.out(.92, {above: false, source: 'pinch', now: t += 16}), 'held', 'a slight pinch at the floor stays');
  assert.equal(gate.out(.92, {above: false, source: 'pinch', now: t += 16}), 'leave', 'pinch steps adding up to a fifth leave');
  assert.ok(.92 ** 3 <= LEAVE_RATIO && .92 ** 2 > LEAVE_RATIO);
  gate = zoomOutGate();
  assert.equal(gate.out(.8, {above: false, repeat: true}), 'held', 'a held key never leaves');
  assert.equal(gate.out(.8, {above: false}), 'leave', 'a press at the floor leaves');
  assert.equal(gate.out(.5, {above: false, locked: true}), 'held', 'Expand: the floor is a wall');
  gate = zoomOutGate(); gate.hold(t);
  assert.equal(gate.out(.74, {above: false, source: 'wheel', now: t += 30}), 'held', 'arriving mid-gesture: it carries on as one that reached the floor');
  assert.equal(gate.out(.74, {above: false, source: 'wheel', now: t += GESTURE_GAP + 1}), 'leave', '…and a new gesture leaves');
});
test('a board\'s floor is where all of it fits, never above 100%; an empty board stops at 100%', () => {
  assert.equal(boardZoomFloor(.4), .4);
  assert.equal(boardZoomFloor(3), 1);
  assert.equal(boardZoomFloor(null), 1);
  assert.equal(boardZoomFloor(.001), MIN_ZOOM);
});
