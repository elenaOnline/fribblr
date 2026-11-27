// Pointing inside the opened item (pointing-mode.js; team/pointing/CONTRACT.md § Round 2, `place`).
//
// The opened item (the reader, canvas.js) is a place of its own: the composer, the tools, chips and the message are
// the board's, but a gesture lands in the item's own content, in that content's own coordinates, so "this button" means
// the same place whatever the reader's zoom or the page's scroll:
//   - an HTML page (same origin): CSS px of the page at the width it is shown, document coordinates (scroll included);
//   - a Markdown document: CSS px of the document column, its scroll included;
//   - an image: px of the image file;
//   - anything else (a PDF, a video, audio, a page from another origin, a note): CSS px of the item's window.
// `view()` gives the same affine the board gives (client = left + x * zoom), so the mode's drawing, hit tests and snap
// sources work unchanged; marks are drawn in a layer inside the reader's window that follows its zoom and pan (it is in
// the reader's plane) and the content's scroll (its transform is set again when the content scrolls).
// Each mark records `place: {kind: 'item', itemId, boardId, placementId?, version?, view}` with what she was looking at.
import {resolveFrame} from './pointing-snap-dom.js';
import {documentTextMap} from './markdown-document.js';
import {wheelZoomFactor, wheelSource} from './canvas-zoom.js';
import {kindOf} from './kinds.js';

const round = (v, d = 1) => { const k = 10 ** d; return Math.round(v * k) / k; };
const SCROLLS = /^(auto|scroll|overlay)$/;
const MEDIA = /^\/app\/media\.html$/;

// Client coordinates inside `win` -> the top page's client coordinates: {k, x, y} (top = x + k * inner), through every
// frame on the way and its CSS scale (the reader's zoom). Null when a frame on the way cannot be read.
export function toTop(win) {
  let k = 1, x = 0, y = 0;
  try {
    for (let w = win; w && w !== window; w = w.parent) {
      const el = w.frameElement; if (!el) return null;
      const r = el.getBoundingClientRect(), s = el.offsetWidth ? r.width / el.offsetWidth : 1;
      x = r.left + s * ((el.clientLeft || 0) + x); y = r.top + s * ((el.clientTop || 0) + y); k *= s;
    }
  } catch { return null; }
  return {k, x, y};
}

// What the reader shows, as a place to point at: {kind: 'page' | 'document' | 'image' | 'window', doc, win, …}.
// `page`: an HTML page or Tinka's own item page (a note); `document`: a Markdown document (its column scrolls);
// `image`: a picture; `window`: a PDF, a video, audio, a page from another origin (coordinates of the item's window).
export function readerContent(frame, item) {
  let outer = null, url = null;
  try { outer = frame?.contentDocument; url = outer && new URL(outer.URL); } catch { outer = null; }
  const itemKind = item ? kindOf(item) : null;
  const windowed = (why, media = null) => ({kind: 'window', why, media, doc: null, win: null});
  if (!outer || !url || url.protocol === 'about:') return windowed('loading');
  let doc = outer, win = frame.contentWindow, path = url.pathname, params = url.searchParams;
  if (path === '/app/item.html') {
    const inner = outer.querySelector('#item-content > iframe.item-full-frame');
    if (inner) {
      let d = null, u = null;
      try { d = inner.contentDocument; u = d && new URL(d.URL); } catch { d = null; }
      if (!d || !u || u.protocol === 'about:') return windowed(d === null && inner.src ? 'other origin' : 'loading');
      if (u.origin !== location.origin) return windowed('other origin');
      doc = d; win = inner.contentWindow; path = u.pathname; params = u.searchParams;
    } else if (!outer.querySelector('.item-representation')) return windowed('loading');
  } else if (url.origin !== location.origin) return windowed('other origin');
  if (MEDIA.test(path)) {
    const kind = params.get('kind');
    if (kind === 'image') { const img = doc.querySelector('.image-stage img'); return img?.naturalWidth ? {kind: 'image', doc, win, img} : windowed(img ? 'loading' : 'image'); }
    if (kind === 'markdown') { const scroller = doc.getElementById('media-content'), article = doc.querySelector('.markdown'); return scroller && article ? {kind: 'document', doc, win, scroller, article} : windowed('loading'); }
    if (kind === 'video' || kind === 'audio') { const media = doc.querySelector(kind); return windowed(media ? kind : 'loading', media); }
    if (kind === 'pdf') return windowed('pdf');
    if (kind === 'html') return windowed('other origin');
    return windowed(kind || 'media');
  }
  // A page (an HTML item, the Drawxide whiteboard), or Tinka's own item page for a note or a title.
  const text = doc.querySelector('.item-representation .item-text');
  return {kind: 'page', doc, win, ...(text ? {article: text} : {}), itemKind};
}

export class ReaderPlace {
  /** `info` is canvas.js's `hooks.reader()`: {dialog, stage, plane, window, frame, canvas, item, placement, title, version}. */
  constructor(mode, info) {
    this.mode = mode; this.info = info;
    this.sheet = document.createElement('canvas');
    this.sheet.className = 'pointing-sheet pointing-reader-sheet'; this.sheet.setAttribute('aria-hidden', 'true');
    this.sheet.dataset.tool = mode.tool;
    // In the reader's main column, under its zoom pill (z-index 6) and update notice, over the stage.
    info.stage.parentElement.append(this.sheet);
    this.ctx = this.sheet.getContext('2d');
    this.layer = document.createElement('div');
    this.layer.className = 'pointing-marks pointing-reader-marks'; this.layer.setAttribute('aria-hidden', 'true');
    info.window.append(this.layer);
    this.onScroll = () => { if (!this.scrollFrame) this.scrollFrame = requestAnimationFrame(() => { this.scrollFrame = 0; this.syncLayer(); this.mode.hoverList = null; this.mode.schedule(); }); };
    this.sheet.addEventListener('wheel', e => this.wheel(e), {passive: false});
    this.sheet.addEventListener('pointerleave', () => { if (mode.gesture) return; mode.pointer = null; mode.hover = null; mode.hoverSnap = null; mode.schedule(); });
    this.resize = new ResizeObserver(() => { if (mode.active && mode.reader === this) { mode.sizeSheet(); this.syncLayer(); } });
    this.resize.observe(info.stage); this.resize.observe(info.window);
    // The reader's zoom (--canvas-zoom on the stage): glitter is drawn again at the new zoom once it settles.
    this.zoomWatch = new MutationObserver(() => {
      const z = info.stage.style.getPropertyValue('--canvas-zoom'); if (z === this.seenZoom) return; this.seenZoom = z;
      clearTimeout(this.zoomTimer); this.zoomTimer = setTimeout(() => { if (this.layer.querySelector('.pointing-swath')) mode.renderMarks(); }, 160);
    });
    this.zoomWatch.observe(info.stage, {attributes: true, attributeFilter: ['style']});
    this.refresh(info);
  }
  /** The item and version shown, as a key: marks made here are drawn here. */
  get key() { return placeKey(this.placeId()); }
  placeId() { const i = this.info; return {itemId: i.item?.id || i.key, version: i.version?.id || null}; }
  // The reader opened another item or version, or reloaded: read the content again.
  refresh(info = this.info) {
    this.info = info;
    this.unwatch();
    this.content = null;
    this.watch();
  }
  current() {
    const c = this.content;
    if (c && (c.kind === 'window' ? c.why !== 'loading' : c.doc?.defaultView && (c.kind !== 'image' || c.img.isConnected))) return c;
    const was = c?.kind;
    this.content = readerContent(this.info.frame, this.info.item);
    if (this.content.kind !== 'window' || this.content.why !== 'loading') {
      this.watch();
      // It finished loading (or changed): the marks are drawn again in its units, and the sources get ready for it.
      if (was !== this.content.kind || c?.doc !== this.content.doc) requestAnimationFrame(() => { if (this.mode.reader !== this) return; this.layerKey = ''; this.syncLayer(); this.mode.renderMarks(); this.mode.prepareFor(this.candidates()[0]); });
    }
    return this.content;
  }
  // The content's scroll moves the marks with it.
  watch() {
    const c = this.content; if (!c || this.watched === c) return;
    this.unwatch();
    this.watched = c;
    const target = c.kind === 'document' ? c.scroller : c.win;
    try { target?.addEventListener('scroll', this.onScroll, {passive: true}); this.watchedTarget = target; } catch {}
    try { c.win?.addEventListener('resize', this.onScroll); } catch {}
  }
  unwatch() {
    try { this.watchedTarget?.removeEventListener('scroll', this.onScroll); this.watched?.win?.removeEventListener('resize', this.onScroll); } catch {}
    this.watched = null; this.watchedTarget = null;
  }
  destroy() { this.unwatch(); this.resize.disconnect(); this.zoomWatch.disconnect(); this.sheet.remove(); this.layer.remove(); }

  // ---- coordinates ----
  readerZoom() { const w = this.info.window, r = w.getBoundingClientRect(); return w.offsetWidth ? r.width / w.offsetWidth : 1; }
  scroll(c = this.current()) {
    if (c.kind === 'document') return {x: c.scroller.scrollLeft, y: c.scroller.scrollTop};
    if (c.kind === 'page') return {x: c.win.scrollX || 0, y: c.win.scrollY || 0};
    return {x: 0, y: 0};
  }
  // The picture's pixels inside its <img> (object-fit), in the image page's client coordinates.
  picture(img) {
    const r = img.getBoundingClientRect(), nw = img.naturalWidth, nh = img.naturalHeight;
    const fit = img.ownerDocument.defaultView.getComputedStyle(img).objectFit || 'fill';
    let w = r.width, h = r.height;
    if (fit === 'contain' || fit === 'scale-down' || fit === 'cover') { const k0 = (fit === 'cover' ? Math.max : Math.min)(r.width / nw, r.height / nh), k = fit === 'scale-down' ? Math.min(1, k0) : k0; w = nw * k; h = nh * k; }
    else if (fit === 'none') { w = nw; h = nh; }
    return {x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, w, h, nw, nh};
  }
  /** Content <-> client, as the board's view: client = left + (x + ox) * zoom. */
  view() {
    const c = this.current();
    if (c.kind === 'window') { const r = this.info.window.getBoundingClientRect(), k = this.readerZoom(); return {left: r.left, top: r.top, zoom: k, ox: 0, oy: 0}; }
    const t = toTop(c.win); if (!t) return {left: 0, top: 0, zoom: 1, ox: 0, oy: 0};
    if (c.kind === 'image') { const p = this.picture(c.img), s = p.w / p.nw; return {left: t.x + t.k * p.x, top: t.y + t.k * p.y, zoom: t.k * s, ox: 0, oy: 0}; }
    const s = this.scroll(c);
    return {left: t.x - t.k * s.x, top: t.y - t.k * s.y, zoom: t.k, ox: 0, oy: 0};
  }
  // How big the content is, in its own units.
  extent(c = this.current()) {
    if (c.kind === 'image') return {w: c.img.naturalWidth, h: c.img.naturalHeight};
    if (c.kind === 'document') return {w: c.scroller.scrollWidth, h: c.scroller.scrollHeight};
    if (c.kind === 'page') { const e = c.doc.scrollingElement || c.doc.documentElement; return {w: Math.max(e.scrollWidth, c.win.innerWidth), h: Math.max(e.scrollHeight, c.win.innerHeight)}; }
    return {w: this.info.window.offsetWidth, h: this.info.window.offsetHeight};
  }
  unit(c = this.current()) { return c.kind === 'image' ? 'image px' : c.kind === 'window' ? 'window px' : 'page px'; }
  // What `content.of` says: the coordinates and, where something cannot be read, so (≤ 80 characters).
  of(c = this.current()) {
    const w = this.info.window;
    if (c.kind === 'image') return `image ${c.img.naturalWidth} × ${c.img.naturalHeight} px`;
    if (c.kind === 'document') return `document ${Math.round(c.win.innerWidth)} px wide`;
    if (c.kind === 'page') return `page ${Math.round(c.win.innerWidth)} px wide`;
    const size = `${w.offsetWidth} × ${w.offsetHeight} px`;
    // A video or audio item: where it was playing (the record's place has no field for it).
    const at = c.media && Number.isFinite(c.media.currentTime) ? ` at ${round(c.media.currentTime, 1)} s` : '';
    return {pdf: `PDF window ${size}; its page is not readable`, video: `video window ${size}${at}`, audio: `audio window ${size}${at}`,
      'other origin': `window ${size}; another origin's page is not readable`}[c.why] || `item window ${size}`;
  }
  // The visible part of the content, as a client box: the window, inside the stage.
  shownBox() {
    const a = this.info.window.getBoundingClientRect(), b = this.info.stage.getBoundingClientRect();
    const x = Math.max(a.left, b.left), y = Math.max(a.top, b.top);
    return {x, y, w: Math.max(0, Math.min(a.right, b.right) - x), h: Math.max(0, Math.min(a.bottom, b.bottom) - y)};
  }

  // ---- what can be pointed at: the item itself ----
  candidates() {
    const i = this.info, e = this.extent();
    return [{key: `item:${i.item?.id || i.key}`, kind: 'placement', reader: true, id: i.placement?.id || null, placement: i.placement || null,
      item: i.item || null, el: i.frame, x: 0, y: 0, w: e.w, h: e.h}];
  }
  thingAt(x, y, list) {
    const b = this.shownBox();
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h ? list[0] || null : null;
  }
  // A target in the item: its placement on the board, the part in content units (`box`), and what the sources named.
  target({candidate: c, whole = false, box = null, element, elements, text}, boardId) {
    if (!c.id) return null;
    const content = box ? {x: round(Math.max(0, box.x)), y: round(Math.max(0, box.y)), w: round(Math.max(0, box.w)), h: round(Math.max(0, box.h)), unit: 'px', of: this.of()} : null;
    const title = String(c.item?.title || this.info.title || 'Untitled').replace(/\s+/g, ' ').trim().slice(0, 120);
    return {kind: 'placement', id: c.id, boardId, ...(c.item?.id ? {itemId: c.item.id} : {}), itemKind: c.item ? kindOf(c.item) : 'html', title, whole: !!whole,
      ...(content && !whole ? {content} : {}), ...(element ? {element} : {}), ...(elements?.length >= 2 ? {elements: elements.slice(0, 12)} : {}), ...(text ? {text} : {})};
  }
  /** The mark's `place`: which item, which version, and what she was looking at. */
  // `view`: the reader's zoom, the content's scroll, and her frame (the item's window) as it was on screen, in CSS px
  // (its layout size is width / zoom); `unit` names the coordinates of this mark's shapes.
  record(boardId) {
    const i = this.info, c = this.current(), s = this.scroll(c), w = i.window, z = this.readerZoom();
    return {kind: 'item', itemId: i.item?.id || i.key, boardId, ...(i.placement?.id ? {placementId: i.placement.id} : {}), ...(i.version?.id ? {version: i.version.id} : {}),
      view: {zoom: round(z, 3), scrollX: round(s.x), scrollY: round(s.y), width: Math.max(1, Math.round(w.offsetWidth * z)), height: Math.max(1, Math.round(w.offsetHeight * z)), unit: this.unit(c)}};
  }
  /** How the chips and hints name this place: the item's title (and version). */
  name() { const i = this.info; return `${String(i.item?.title || i.title || 'the item').replace(/\s+/g, ' ').trim()}${i.version?.name ? ` · ${i.version.name}` : ''}`; }

  // ---- a text range in a document or a note (CONTRACT `text`), from what the gesture holds ----
  // `inside(x, y)` in content units; `element` when the snap named a block (its whole text). The same model as the
  // document's own text comments (markdown-document.js documentTextMap): {quote, prefix, suffix, start, end}.
  textRange(opts) {
    const c = this.current(); if (!c.article || !c.win) return null;
    const v = this.view(), t = toTop(c.win); if (!t) return null;
    return textRangeIn(c.article, (x, y) => [(t.x + t.k * x - v.left) / v.zoom, (t.y + t.k * y - v.top) / v.zoom], opts);
  }

  // ---- input the reader would have had: the wheel scrolls the content, else pans; ⌘/Ctrl or a pinch zooms ----
  wheel(e) {
    if (!this.mode.active || this.mode.reader !== this) return;
    e.preventDefault();
    const cv = this.info.canvas;
    if (e.ctrlKey || e.metaKey) { cv.zoomAtClient(wheelZoomFactor(e), e.clientX, e.clientY, {source: wheelSource(e)}); this.mode.hoverList = null; this.mode.schedule(); return; }
    const {dx, dy} = cv.wheelDelta(e);
    const left = this.scrollBy(e.clientX, e.clientY, dx, dy);
    if (left.dx || left.dy) cv.panBy(-left.dx, -left.dy);
    this.mode.schedule();
  }
  // The content's own scroll put back (leaving the mode).
  scrollTo({x, y}) {
    const c = this.current();
    try {
      if (c.kind === 'document') { c.scroller.scrollLeft = x; c.scroller.scrollTop = y; }
      else if (c.kind === 'page') c.win.scrollTo(x, y);
    } catch {}
  }
  // Scroll what is under the point (a scroll box in the page, the document's column, the page itself) by (dx, dy) client
  // px; returns what could not be scrolled.
  scrollBy(x, y, dx, dy) {
    const c = this.current(); if (c.kind === 'window' || c.kind === 'image') return {dx, dy};
    const t = toTop(c.win); if (!t) return {dx, dy};
    const ix = (x - t.x) / t.k, iy = (y - t.y) / t.k, kx = dx / t.k, ky = dy / t.k;
    let el = null; try { el = c.doc.elementFromPoint(ix, iy); } catch {}
    const tryScroll = (node, ax, ay) => {
      const bx = node.scrollLeft, by = node.scrollTop;
      node.scrollLeft = bx + ax; node.scrollTop = by + ay;
      return [node.scrollLeft - bx, node.scrollTop - by];
    };
    let restX = kx, restY = ky;
    const style = n => c.win.getComputedStyle(n);
    for (let n = el; n && n !== c.doc.documentElement && n !== c.doc.body && (restX || restY); n = n.parentElement) {
      const s = style(n);
      if (!(SCROLLS.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1) && !(SCROLLS.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1)) continue;
      const [ax, ay] = tryScroll(n, restX, restY); restX -= ax; restY -= ay;
    }
    if (restX || restY) {
      const root = c.doc.scrollingElement || c.doc.documentElement;
      const [ax, ay] = tryScroll(root, restX, restY); restX -= ax; restY -= ay;
    }
    return {dx: Math.abs(restX) < .5 ? 0 : restX * t.k, dy: Math.abs(restY) < .5 ? 0 : restY * t.k};
  }

  // ---- the marks' layer: inside the reader's window, content units ----
  // window px = a + s * content; set again when the content scrolls or reflows. Badges keep their size on screen
  // through --pointing-k (pointing.css): the layer is scaled by s inside the plane, scaled by the reader's zoom.
  syncLayer() {
    const v = this.view(), r = this.info.window.getBoundingClientRect(), z = this.readerZoom();
    const s = v.zoom / z, a = (v.left - r.left) / z, b = (v.top - r.top) / z;
    const key = `${a.toFixed(2)}|${b.toFixed(2)}|${s.toFixed(5)}`;
    if (key === this.layerKey) return;
    this.layerKey = key;
    this.layer.style.transform = `translate(${a}px, ${b}px) scale(${s})`;
    this.layer.style.setProperty('--pointing-k', String(s));
  }
}

/** A place's key: 'item:<itemId>:<version>' for a mark made inside an item, 'board' otherwise. */
export const placeKey = place => place?.itemId ? `item:${place.itemId}:${place.version || ''}` : 'board';

// A text range in `article` (a document's column, a note's text) from a gesture: `toUnits(x, y)` maps the article's
// page client px to the gesture's units; `element` (a block the DOM source named) gives its whole text; else the
// characters inside the gesture: for a box (`rect`) those at least a third inside it, else those whose middle (or a
// quarter above or below it) `inside(x, y)` holds; `bounds` skips text nodes far from it. Null when it holds no words.
export function textRangeIn(article, toUnits, {inside, bounds, rect = null, element = null}) {
  const doc = article.ownerDocument, range = doc.createRange();
  let start = null, end = null;
  if (element) {
    const el = findElement(doc, element);
    if (!el || !article.contains(el) && el !== article && !el.contains(article)) return null;
    range.selectNodeContents(el.contains(article) ? article : el);
  } else {
    if (!rect && !inside) return null;
    const walker = doc.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect(), [x0, y0] = toUnits(r.left, r.top), [x1, y1] = toUnits(r.right, r.bottom);
      if (x1 < bounds.x || y1 < bounds.y || x0 > bounds.x + bounds.w || y0 > bounds.y + bounds.h) continue;
      for (let i = 0; i < n.nodeValue.length; i++) {
        if (/\s/.test(n.nodeValue[i])) continue;
        range.setStart(n, i); range.setEnd(n, i + 1);
        const b = range.getBoundingClientRect(); if (!b.width && !b.height) continue;
        const [ax, ay] = toUnits(b.left, b.top), [bx, by] = toUnits(b.right, b.bottom), cx = (ax + bx) / 2;
        if (rect) {
          const ix = Math.max(0, Math.min(bx, rect.x + rect.w) - Math.max(ax, rect.x)), iy = Math.max(0, Math.min(by, rect.y + rect.h) - Math.max(ay, rect.y));
          if (!(ix * iy >= (bx - ax) * (by - ay) / 3)) continue;
        } else if (!inside(cx, (ay + by) / 2) && !inside(cx, ay + (by - ay) / 4) && !inside(cx, by - (by - ay) / 4)) continue;
        if (!start) start = [n, i];
        end = [n, i + 1];
      }
    }
    if (!start) return null;
    // A word cut by her gesture's edge counts whole (as a text selection by words does).
    const word = /[\p{L}\p{N}_'’-]/u;
    while (start[1] > 0 && word.test(start[0].nodeValue[start[1] - 1]) && word.test(start[0].nodeValue[start[1]])) start[1]--;
    while (end[1] < end[0].nodeValue.length && word.test(end[0].nodeValue[end[1]]) && word.test(end[0].nodeValue[end[1] - 1])) end[1]++;
    range.setStart(...start); range.setEnd(...end);
  }
  return textAnchor(article, range);
}
// The element a DOM snap named, found again in its page: by selector, else by id.
function findElement(doc, element) {
  try { const all = doc.querySelectorAll(element.selector); if (all.length === 1) return all[0]; } catch {}
  return element.id ? doc.getElementById(element.id) : null;
}
// A DOM range in a document as its text comments anchor one (markdown-document.js selectionTextAnchor): the quote in
// the document's text model, 96 characters either side, and its offsets in that model.
export function textAnchor(article, range) {
  const before = article.ownerDocument.createRange(); before.selectNodeContents(article);
  try { before.setEnd(range.startContainer, range.startOffset); } catch { return null; }
  const raw = article.textContent;
  let rawStart = before.toString().length, rawEnd = rawStart + range.toString().length;
  while (rawStart < rawEnd && /\s/u.test(raw[rawStart])) rawStart++;
  while (rawEnd > rawStart && /\s/u.test(raw[rawEnd - 1])) rawEnd--;
  const {text, starts, ends} = documentTextMap(raw), start = starts.findIndex(offset => offset >= rawStart);
  if (start < 0) return null;
  let end = start; while (end < ends.length && ends[end] <= rawEnd) end++;
  const quote = text.slice(start, end); if (!quote.trim() || quote.length > 20000) return null;
  const prefix = text.slice(Math.max(0, start - 96), start), suffix = text.slice(end, end + 96);
  return {quote, ...(prefix ? {prefix} : {}), ...(suffix ? {suffix} : {}), start, end};
}
// Exported for the board's document cards (their page is a frame too).
export {resolveFrame};
