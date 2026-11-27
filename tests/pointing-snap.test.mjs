// Pointing mode's snap sources (public/pointing-snap-dom.js, public/pointing-snap-pixels.js): the parts that run in
// Node. Names, roles, kinds and selectors on a tiny fake DOM; the gesture mask; region growing, the watershed and
// the confidence on synthetic pictures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {accessibleName, roleOf, kindOf, uniqueSelector, readablePath, meaningfulAt, countMatches, gestureMask, labelOf} from '../public/pointing-snap-dom.js';
import {fieldFromRGBA, wandField, outlineField, confidence, PixelPicture, proposeClick, proposeOutline, proposeSwath, traceOutline, fillHoles, keepComponents, rectMask, fillPolygonMask, simplifyClosed, pointInPolygon} from '../public/pointing-snap-pixels.js';

// ---------------------------------------------------------------- a tiny DOM

class El {
  constructor(tag, attrs = {}, kids = []) {
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.localName = tag; this.parentElement = null; this.childNodes = []; this.ownerDocument = null;
    this._a = new Map(Object.entries(attrs));
    for (const k of kids) this.append(k);
  }
  append(k) { const n = typeof k === 'string' ? {nodeType: 3, nodeValue: k, textContent: k, parentElement: this} : k; if (n.nodeType === 1) n.parentElement = this; this.childNodes.push(n); }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get attributes() { return [...this._a].map(([name, value]) => ({name, value})); }
  getAttribute(n) { return this._a.has(n) ? this._a.get(n) : null; }
  hasAttribute(n) { return this._a.has(n); }
  get className() { return this.getAttribute('class') || ''; }
  get textContent() { return this.childNodes.map(n => n.nodeType === 3 ? n.nodeValue : n.textContent).join(''); }
  contains(o) { for (let p = o; p; p = p.parentElement) if (p === this) return true; return false; }
}
const h = (tag, attrs, ...kids) => new El(tag, attrs || {}, kids.flat());
function doc(body) {
  const html = h('html', {}, h('body', {}, body));
  const d = {documentElement: html, getElementById: id => find(html, e => e.getAttribute('id') === id)};
  const own = e => { e.ownerDocument = d; e.children.forEach(own); }; own(html);
  return d;
}
const find = (root, pred) => { if (pred(root)) return root; for (const c of root.children) { const f = find(c, pred); if (f) return f; } return null; };
const q = (d, pred) => find(d.documentElement, pred);
const byId = (d, id) => d.getElementById(id);

// ---------------------------------------------------------------- accessible names

test('names: aria-labelledby, aria-label, label[for], wrapping label, placeholder, alt, svg title', () => {
  const d = doc([
    h('h2', {id: 'ttl'}, 'Billing ', h('span', {}, 'details')),
    h('section', {id: 'sec', 'aria-labelledby': 'ttl'}),
    h('button', {id: 'x', 'aria-label': 'Close dialog'}, '×'),
    h('label', {for: 'em'}, 'Email address'), h('input', {id: 'em', type: 'email', placeholder: 'you@example.com'}),
    h('label', {}, 'Remember me ', h('input', {id: 'rm', type: 'checkbox'})),
    h('input', {id: 'ph', placeholder: 'Search boards'}),
    h('input', {id: 'sub', type: 'submit'}),
    h('img', {id: 'logo', alt: 'fribblr logo'}),
    h('svg', {id: 'ic'}, h('title', {}, 'Settings'), h('path', {})),
    h('a', {id: 'lk', href: '/docs'}, h('img', {alt: 'Docs'}), ' and guides'),
  ]);
  assert.equal(accessibleName(byId(d, 'sec')), 'Billing details');
  assert.equal(accessibleName(byId(d, 'x')), 'Close dialog');
  assert.equal(accessibleName(byId(d, 'em')), 'Email address');
  assert.equal(accessibleName(byId(d, 'rm')), 'Remember me');
  assert.equal(accessibleName(byId(d, 'ph')), 'Search boards');
  assert.equal(accessibleName(byId(d, 'sub')), 'Submit');
  assert.equal(accessibleName(byId(d, 'logo')), 'fribblr logo');
  assert.equal(accessibleName(byId(d, 'ic')), 'Settings');
  assert.equal(accessibleName(byId(d, 'lk')), 'Docs and guides');
});

test('names: hidden words are not read; a section is named by the heading that opens it, not a later one', () => {
  const d = doc([
    h('button', {id: 'b'}, 'Save', h('span', {'aria-hidden': 'true'}, ' ⌘S')),
    h('section', {id: 's1'}, h('h2', {}, 'Pricing'), h('p', {}, 'Plans')),
    h('section', {id: 's2'}, h('div', {}, h('div', {}, h('div', {}, h('p', {}, 'one'), h('p', {}, 'two')))), h('h3', {}, 'Late heading')),
  ]);
  assert.equal(accessibleName(byId(d, 'b')), 'Save');
  assert.equal(accessibleName(byId(d, 's1')), 'Pricing');
  assert.equal(accessibleName(byId(d, 's2')), '');
});

// ---------------------------------------------------------------- roles, kinds, the element a click means

test('roles: implicit roles for the common elements', () => {
  const d = doc([h('a', {id: 'a', href: '#x'}, 'x'), h('a', {id: 'na'}, 'no href'), h('input', {id: 'c', type: 'checkbox'}), h('input', {id: 'r', type: 'range'}), h('select', {id: 's'}), h('img', {id: 'deco', alt: ''}), h('nav', {id: 'n'}), h('section', {id: 'plain'}), h('section', {id: 'named', 'aria-label': 'Hero'}), h('h3', {id: 'h'}, 'T')]);
  const r = id => roleOf(byId(d, id));
  assert.deepEqual([r('a'), r('na'), r('c'), r('r'), r('s'), r('deco'), r('n'), r('plain'), r('named'), r('h')], ['link', null, 'checkbox', 'slider', 'combobox', 'presentation', 'navigation', null, 'region', 'heading']);
});

test('kinds: controls, media, headings, text, groups; wrappers and inline formatting have none', () => {
  const d = doc([h('div', {id: 'wrap'}, h('div', {id: 'inner'}, h('p', {id: 'p'}, 'Hello ', h('b', {id: 'b'}, 'world')))), h('div', {id: 'words'}, 'Plain words in a div'), h('ul', {id: 'ul'}, h('li', {id: 'li'}, 'One')), h('button', {id: 'btn'}, 'Go'), h('img', {id: 'img', alt: 'x'}), h('h1', {id: 'h1'}, 'Title'), h('div', {id: 'lab', 'aria-label': 'Toolbar'})]);
  const k = id => kindOf(byId(d, id));
  assert.deepEqual([k('wrap'), k('inner'), k('p'), k('b'), k('words'), k('ul'), k('li'), k('btn'), k('img'), k('h1'), k('lab')], [null, null, 'text', null, 'text', 'group', 'text', 'control', 'media', 'heading', 'labelled']);
});

test('a click on the words inside a button or link means the button or link; on bold text, its paragraph', () => {
  const d = doc([h('a', {id: 'card', href: '/p'}, h('div', {}, h('h3', {id: 'ttl'}, h('span', {id: 'sp'}, 'Plan B')))), h('p', {id: 'p'}, 'Some ', h('strong', {id: 'st'}, 'bold'), ' text'), h('div', {id: 'outer'}, h('div', {id: 'empty'}))]);
  assert.equal(meaningfulAt(byId(d, 'sp')), byId(d, 'card'));
  assert.equal(meaningfulAt(byId(d, 'st')), byId(d, 'p'));
  assert.equal(meaningfulAt(byId(d, 'empty')), null);
  // a control too big to be "the thing" is skipped for the next named element
  assert.equal(meaningfulAt(byId(d, 'sp'), e => e !== byId(d, 'card')), byId(d, 'ttl'));
});

// ---------------------------------------------------------------- selectors

const unique = (d, el) => { const sel = uniqueSelector(el); return sel; };
test('selectors: id first, then data-*, then a name-carrying attribute, then the shortest unique nth-of-type path', () => {
  const d = doc([
    h('main', {}, h('form', {id: 'login'}, h('input', {name: 'user'}), h('input', {name: 'pass', type: 'password'}), h('button', {id: 'go'}, 'Sign in'), h('button', {}, 'Cancel'))),
    h('div', {'data-testid': 'hero'}, h('p', {}, 'a'), h('p', {}, 'b')),
    h('div', {'data-testid': 'dup'}), h('div', {'data-testid': 'dup', 'data-key': 'k2'}),
    h('a', {href: '/pricing'}, 'Pricing'), h('a', {href: '/pricing'}, 'Pricing again'),
    h('section', {}, h('div', {}, h('span', {}, 'x'))), h('section', {}, h('div', {}, h('span', {}, 'y'))),
  ]);
  assert.equal(unique(d, byId(d, 'go')), '#go');
  assert.equal(unique(d, q(d, e => e.getAttribute('data-testid') === 'hero')), '[data-testid="hero"]');
  assert.equal(unique(d, q(d, e => e.getAttribute('data-key') === 'k2')), '[data-key="k2"]');
  assert.equal(unique(d, q(d, e => e.getAttribute('name') === 'pass')), 'input[name="pass"]');
  const cancel = q(d, e => e.localName === 'button' && e.textContent === 'Cancel');
  assert.equal(unique(d, cancel), 'button:nth-of-type(2)');
  // two identical links: neither href nor tag alone is unique, so a path
  const again = q(d, e => e.textContent === 'Pricing again');
  const sel = unique(d, again);
  assert.ok(!sel.includes('href'), sel);
  const all = []; const walk = e => { all.push(e); e.children.forEach(walk); }; walk(d.documentElement);
  // every selector built matches exactly its element under the matcher
  for (const el of all.filter(e => e.localName !== 'html' && e.localName !== 'body')) {
    const s = uniqueSelector(el);
    const steps = s.split(' > ').map(parseStep);
    assert.equal(countMatches(all, steps), 1, `${s} should match once`);
  }
});
// The matcher's step shape, parsed back from the text (only the forms uniqueSelector writes).
function parseStep(t) {
  const st = {}; let m;
  if ((m = t.match(/^[a-z0-9]+/))) st.tag = m[0];
  if ((m = t.match(/#([^\[:\s]+)/))) st.id = m[1];
  st.attrs = [...t.matchAll(/\[([a-z-]+)="((?:[^"\\]|\\.)*)"\]/g)].map(x => [x[1], x[2].replace(/\\(.)/g, '$1')]);
  if ((m = t.match(/:nth-of-type\((\d+)\)/))) st.nth = Number(m[1]);
  return st;
}

test('readable path keeps landmarks and ids, ≤ 5 steps', () => {
  const d = doc([h('main', {}, h('div', {}, h('form', {id: 'login'}, h('div', {}, h('button', {id: 'b', class: 'primary big'}, 'Go')))))]);
  assert.equal(readablePath(byId(d, 'b')), 'main > form#login > button#b');
  const d2 = doc([h('main', {}, h('div', {}, h('p', {class: 'lede'}, 'x')))]);
  assert.equal(readablePath(q(d2, e => e.localName === 'p')), 'main > p.lede');
});

test('labels read like a person would say them', () => {
  assert.equal(labelOf({tag: 'button', role: 'button', name: 'Sign in'}, 'control'), 'button "Sign in"');
  assert.equal(labelOf({tag: 'input', role: 'textbox', name: 'Email'}, 'control'), 'field "Email"');
  assert.equal(labelOf({tag: 'div', text: 'Primary action'}, 'text'), 'text "Primary action"');
  assert.equal(labelOf({tag: 'nav', role: 'navigation'}, 'group'), 'navigation');
});

// ---------------------------------------------------------------- the gesture mask

test('gesture mask: share of a box inside a rect, a lasso and a swath', () => {
  const r = gestureMask({kind: 'rect', x: 0, y: 0, w: 100, h: 100});
  assert.ok(Math.abs(r.cover({x: 50, y: 50, w: 100, h: 100}) - .25) < .02);
  assert.ok(Math.abs(r.fill({x: 0, y: 0, w: 50, h: 100}) - .5) < .02);
  const diamond = gestureMask({kind: 'path', points: [[50, 0], [100, 50], [50, 100], [0, 50]]});
  assert.ok(Math.abs(diamond.cover({x: 0, y: 0, w: 100, h: 100}) - .5) < .03);
  assert.ok(diamond.cover({x: 40, y: 40, w: 20, h: 20}) > .97);
  const sw = gestureMask({kind: 'swath', width: 20, points: [[0, 50], [200, 50]]});
  assert.ok(sw.cover({x: 20, y: 45, w: 100, h: 10}) > .97);
  assert.ok(sw.cover({x: 20, y: 0, w: 100, h: 30}) < .05);
});

// ---------------------------------------------------------------- pictures

// A synthetic picture: background colour, shapes drawn on it, optional noise.
function picture(w, h, bg, shapes = [], noise = 0, seed = 1) {
  const d = new Uint8ClampedArray(w * h * 4);
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647 - .5;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = bg;
    for (const sh of shapes) if (sh.inside(x, y)) c = sh.c;
    const i = (y * w + x) * 4; for (let k = 0; k < 3; k++) d[i + k] = c[k] + rnd() * noise; d[i + 3] = 255;
  }
  return d;
}
const disc = (cx, cy, r, c) => ({c, inside: (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r});
const box = (x0, y0, x1, y1, c) => ({c, inside: (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1});

test('wand: a click inside a clear disc grows to the disc and stops at its edge', () => {
  const W = 200, H = 150, d = picture(W, H, [235, 235, 230], [disc(100, 75, 40, [200, 30, 40])], 10);
  const r = wandField(Object.assign(fieldFromRGBA(d, W, H), {full: true}), 100, 75);
  assert.ok(r, 'a region');
  const want = Math.PI * 40 * 40;
  assert.ok(Math.abs(r.area - want) / want < .12, `area ${r.area} ≈ ${want.toFixed(0)}`);
  assert.equal(r.mask[75 * W + 100], 1); assert.equal(r.mask[5 * W + 5], 0);
});

test('wand: a disc on a slow ramp of the same hue does not leak along the ramp', () => {
  const W = 200, H = 120, d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, v = 60 + x * .9; d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255; if ((x - 60) ** 2 + (y - 60) ** 2 < 25 * 25) { d[i] = 40; d[i + 1] = 90; d[i + 2] = 220; } }
  const r = wandField(Object.assign(fieldFromRGBA(d, W, H), {full: true}), 60, 60);
  const want = Math.PI * 25 * 25;
  assert.ok(Math.abs(r.area - want) / want < .15, `area ${r.area}`);
});

test('click proposal: a button in a screenshot-like picture snaps to its rectangle, in image px', () => {
  // 2400 px wide "screenshot": level 0 is 1600 wide, so coordinates map back ×1.5
  const W = 1200, H = 600, d = picture(W, H, [244, 245, 247], [box(500, 260, 700, 320, [20, 90, 200]), box(540, 282, 660, 298, [255, 255, 255])], 2);
  const pic = new PixelPicture(d, W, H, 2400, 1200);
  const a = proposeClick(pic, 1150, 600);
  assert.ok(a, 'snapped');
  assert.equal(a.source, 'pixels');
  assert.equal(a.shape.kind, 'rect', 'a filled box is reported as a rect');
  const s = a.shape;
  assert.ok(Math.abs(s.x - 1000) < 8 && Math.abs(s.y - 520) < 8 && Math.abs(s.w - 400) < 12 && Math.abs(s.h - 120) < 12, JSON.stringify(s));
  assert.ok(a.score >= .8);
});

test('click proposal: a click on the plain background, or on a featureless gradient, falls back (null)', () => {
  const W = 320, H = 240;
  const pic = new PixelPicture(picture(W, H, [235, 235, 230], [disc(160, 120, 50, [200, 30, 40])], 6), W, H);
  assert.equal(proposeClick(pic, 10, 10), null, 'background');
  const g = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; g[i] = 40 + x * .6; g[i + 1] = 90 + y * .4; g[i + 2] = 160 - x * .3; g[i + 3] = 255; }
  assert.equal(proposeClick(new PixelPicture(g, W, H), 160, 120), null, 'gradient');
});

test('outline proposal: a loose marquee round a disc snaps to the disc; on noise it falls back', () => {
  const W = 300, H = 220;
  const pic = new PixelPicture(picture(W, H, [225, 228, 232], [disc(150, 110, 50, [190, 40, 30])], 12), W, H);
  const a = proposeOutline(pic, {kind: 'rect', x: 80, y: 40, w: 150, h: 140});
  assert.ok(a, 'snapped');
  const b = a.box;
  assert.ok(Math.abs(b.x - 100) < 6 && Math.abs(b.y - 60) < 6 && Math.abs(b.w - 100) < 10 && Math.abs(b.h - 100) < 10, JSON.stringify(b));
  assert.ok(a.shape.kind === 'path' && a.shape.points.length <= 200);
  // pure noise: nothing to snap to
  const n = new PixelPicture(picture(W, H, [128, 128, 128], [], 120, 7), W, H);
  assert.equal(proposeOutline(n, {kind: 'rect', x: 80, y: 40, w: 150, h: 140}), null);
});

test('outline proposal: a lasso round one of two touching objects of different colour keeps that one', () => {
  const W = 320, H = 200;
  const pic = new PixelPicture(picture(W, H, [240, 240, 240], [box(60, 50, 160, 150, [30, 120, 60]), box(160, 50, 260, 150, [40, 60, 200])], 6), W, H);
  const pts = []; for (let i = 0; i < 40; i++) { const t = i / 40 * Math.PI * 2; pts.push([110 + Math.cos(t) * 70, 100 + Math.sin(t) * 70]); }
  const a = proposeOutline(pic, {kind: 'path', points: pts});
  assert.ok(a, 'snapped');
  assert.ok(a.box.x > 50 && a.box.x + a.box.w < 172, JSON.stringify(a.box));
});

test('swath proposal: a stroke waved over a disc picks the disc', () => {
  const W = 300, H = 220;
  const pic = new PixelPicture(picture(W, H, [235, 235, 230], [disc(150, 110, 60, [30, 60, 190])], 8), W, H);
  const pts = []; for (let i = 0; i <= 20; i++) pts.push([110 + i * 4, 110 + Math.sin(i / 3) * 10]);
  const a = proposeSwath(pic, {width: 16, points: pts});
  assert.ok(a && Math.abs(a.box.w - 120) < 14, JSON.stringify(a?.box));
});

test('confidence: weak edges, shared colours or an outline on her own line score low', () => {
  assert.ok(confidence({contrast: 4, separation: .9, hug: 0}) > .9);
  assert.ok(confidence({contrast: 1, separation: .9, hug: 0}) < .6);
  assert.ok(confidence({contrast: 4, separation: .3, hug: 0}) < .5);
  assert.ok(confidence({contrast: 4, separation: .9, hug: .8}) < .5);
});

test('mask helpers: holes fill, components keep, outline traces, polygons simplify', () => {
  const W = 10, H = 10, m = rectMask(W, H, 2, 2, 6, 6);
  m[5 * W + 5] = 0; fillHoles(m, W, H); assert.equal(m[5 * W + 5], 1);
  m[0] = 1; keepComponents(m, W, H); assert.equal(m[0], 0);
  const out = traceOutline(m, W, H);
  assert.deepEqual(out.map(p => p.join(',')).sort(), ['2,2', '2,8', '8,2', '8,8']);
  const tri = fillPolygonMask(20, 20, [[0, 0], [20, 0], [0, 20]]); assert.equal(tri[1 * 20 + 1], 1); assert.equal(tri[18 * 20 + 18], 0);
  const wiggly = []; for (let i = 0; i < 100; i++) { const t = i / 100 * Math.PI * 2; wiggly.push([Math.cos(t) * 50 + (i % 2) * .2, Math.sin(t) * 50]); }
  assert.ok(simplifyClosed(wiggly, 1).length < 40);
  assert.ok(pointInPolygon(0, 0, wiggly) && !pointInPolygon(60, 0, wiggly));
});
