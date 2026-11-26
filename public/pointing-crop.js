// Client-side crops for pointing marks (team/pointing/CONTRACT.md § Crops,
// team/pointing/spike/CROP.md). Two honest sources of real pixels in the page:
//
// 1. imageCrop(card, region): an image card's own file, drawn to a canvas at the
//    image's natural resolution. Exact pixels, sharper than the screen. Only for
//    same-origin images (an item's file under /resources/); a remote preview
//    taints the canvas and gives null.
// 2. TabCapture: the browser's capture of this tab (getDisplayMedia with
//    preferCurrentTab). One permission prompt when started, a sharing indicator
//    while running, and the exact pixels she sees, grabbed at the moment a
//    gesture completes. Chromium only in practice (see CROP.md).
//
// Both return {dataUrl, width, height, from} or null; the caller sends null as
// crop: null with a cropNote, never a substitute picture.

const MAX_SIDE = 2000, MIN_SIDE = 256;

const MAX_BYTES = 2 * 1024 * 1024; // the contract's limit for a client crop

// `region`: fractions 0..1 of the card's own box (contract `targets[].region`),
// or omitted for the whole card. Returns the part of the image inside it.
// `source`: the same picture at a higher resolution (the item's file when the
// card shows a smaller preview); the card's <img> still gives the layout.
// `overlay(ctx, toCrop)`: drawn over the picture (the wand's glitter, so the crop shows the area she pointed at);
// toCrop(clientX, clientY) gives that screen point's place in the crop's pixels.
export function imageCrop(card, region = {x: 0, y: 0, w: 1, h: 1}, {source = null, overlay = null} = {}) {
  const img = card?.querySelector?.('.workspace-card-preview img');
  if (!img || !img.complete || !(img.naturalWidth > 0)) return null;
  const box = card.getBoundingClientRect(), shown = img.getBoundingClientRect();
  const pic = source?.naturalWidth > 0 ? source : img;
  const nw = pic.naturalWidth, nh = pic.naturalHeight;
  // Where the picture's pixels actually are inside the <img> box (object-fit).
  const fit = getComputedStyle(img).objectFit || 'fill';
  let cw = shown.width, ch = shown.height;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (fit === 'contain' || fit === 'scale-down' || fit === 'cover') {
    const s = (fit === 'cover' ? Math.max : Math.min)(shown.width / iw, shown.height / ih);
    const k = fit === 'scale-down' ? Math.min(1, s) : s;
    cw = iw * k; ch = ih * k;
  } else if (fit === 'none') { cw = iw; ch = ih; }
  const content = {x: shown.left + (shown.width - cw) / 2, y: shown.top + (shown.height - ch) / 2, w: cw, h: ch};
  const want = {x: box.left + region.x * box.width, y: box.top + region.y * box.height, w: region.w * box.width, h: region.h * box.height};
  // Only what is both pointed at and visible on the card (cover clips to the img box).
  const vis = {x: Math.max(content.x, shown.left), y: Math.max(content.y, shown.top)};
  vis.r = Math.min(content.x + content.w, shown.right); vis.b = Math.min(content.y + content.h, shown.bottom);
  const x0 = Math.max(want.x, vis.x), y0 = Math.max(want.y, vis.y);
  const x1 = Math.min(want.x + want.w, vis.r), y1 = Math.min(want.y + want.h, vis.b);
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  const sx = (x0 - content.x) * nw / content.w, sy = (y0 - content.y) * nh / content.h;
  const sw = (x1 - x0) * nw / content.w, sh = (y1 - y0) * nh / content.h;
  // A vector image has no natural pixels worth keeping: draw it at twice its
  // on-screen size (the canvas re-rasterises the SVG). A tiny raster image is
  // enlarged with hard edges to MIN_SIDE so it stays readable; `from` says so.
  const vector = /\.svgz?(?:$|[?#])|^data:image\/svg/i.test(pic.currentSrc || pic.src);
  const onScreen = Math.max((x1 - x0), (y1 - y0)) * (devicePixelRatio || 1);
  let k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  if (vector) k = Math.min(MAX_SIDE / Math.max(sw, sh), Math.max(1, 2 * onScreen / Math.max(sw, sh)));
  else if (Math.max(sw, sh) < MIN_SIDE) k = Math.min(8, MIN_SIDE / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * k)); canvas.height = Math.max(1, Math.round(sh * k));
  const g = canvas.getContext('2d');
  if (!vector && k > 1) g.imageSmoothingEnabled = false;
  g.drawImage(pic, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const kx = canvas.width / sw, ky = canvas.height / sh;
  if (overlay) { try { overlay(g, (x, y) => [((x - content.x) * nw / content.w - sx) * kx, ((y - content.y) * nh / content.h - sy) * ky]); } catch {} }
  try {
    // PNG keeps every pixel; a photo too big for the contract's 2 MB goes as JPEG instead.
    let dataUrl = canvas.toDataURL('image/png');
    for (const q of [0.92, 0.85, 0.75]) { if (dataUrl.length * 0.75 <= MAX_BYTES) break; dataUrl = canvas.toDataURL('image/jpeg', q); }
    if (dataUrl.length * 0.75 > MAX_BYTES) return null;
    return {dataUrl, width: canvas.width, height: canvas.height,
      from: `image file${vector ? ' (vector, drawn at ' + k.toFixed(1) + '×)' : ''}, natural pixels ${Math.round(sx)},${Math.round(sy)} ${Math.round(sw)}×${Math.round(sh)} of ${nw}×${nh}${!vector && k !== 1 ? `, ${k < 1 ? 'scaled down' : 'enlarged with hard edges'} to ${canvas.width}×${canvas.height}` : ''}`};
  } catch { return null; } // a cross-origin image taints the canvas
}

// An image card cropped from the item's own file at full resolution (`fileUrl`, same origin) when the card shows a
// smaller preview of the same picture; the card's picture otherwise. Async: the file may need loading.
export async function imageCropFull(card, region, fileUrl, overlay = null) {
  const img = card?.querySelector?.('.workspace-card-preview img');
  if (!img) return null;
  if (!img.complete) { try { await img.decode(); } catch { return null; } }
  let source = null;
  if (fileUrl && new URL(fileUrl, location.href).href !== img.currentSrc) {
    source = new Image(); source.src = fileUrl;
    try { await source.decode(); } catch { source = null; }
    // Only the same picture: a preview with another shape is not this file.
    if (source && Math.abs(source.naturalWidth / source.naturalHeight - img.naturalWidth / img.naturalHeight) > 0.02 * (img.naturalWidth / img.naturalHeight)) source = null;
  }
  if (!card.isConnected) return null;
  return imageCrop(card, region, {source, overlay});
}

// A mark made inside an opened image (pointing-reader.js): the picture's own file, cut round `shape` (the snapped
// outline, else her gesture; image px of the file) with a margin of a quarter of its size, at the file's resolution,
// with the outline drawn on it in her red (`red`), the spot she clicked as a dot (`gesture` a point), or the wand's
// area as glitter (`swath(ctx, toCrop, k)`). Same origin only; a vector picture is drawn at 2×.
export async function imageFileCrop(fileUrl, shape, {gesture = null, swath = null, red = '#B33830'} = {}) {
  const img = new Image(); img.src = fileUrl;
  try { await img.decode(); } catch { return null; }
  const nw = img.naturalWidth, nh = img.naturalHeight; if (!(nw > 0 && nh > 0)) return null;
  const pts = shape.kind === 'rect' ? [[shape.x, shape.y], [shape.x + shape.w, shape.y + shape.h]] : shape.kind === 'point' ? [[shape.x, shape.y]]
    : shape.kind === 'swath' ? shape.points.flatMap(([x, y]) => [[x - shape.width / 2, y - shape.width / 2], [x + shape.width / 2, y + shape.width / 2]]) : shape.points;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const pad = Math.max(24, 0.25 * Math.max(x1 - x0, y1 - y0, shape.kind === 'point' ? 192 : 0));
  const sx = Math.max(0, Math.floor(x0 - pad)), sy = Math.max(0, Math.floor(y0 - pad));
  const sw = Math.min(nw, Math.ceil(x1 + pad)) - sx, sh = Math.min(nh, Math.ceil(y1 + pad)) - sy;
  if (sw < 1 || sh < 1) return null;
  const vector = /\.svgz?(?:$|[?#])|^data:image\/svg/i.test(fileUrl);
  let k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  if (vector) k = Math.min(2, MAX_SIDE / Math.max(sw, sh));
  else if (Math.max(sw, sh) < MIN_SIDE) k = Math.min(8, MIN_SIDE / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * k)); canvas.height = Math.max(1, Math.round(sh * k));
  const g = canvas.getContext('2d');
  if (!vector && k > 1) g.imageSmoothingEnabled = false;
  g.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const toCrop = (x, y) => [(x - sx) * k, (y - sy) * k], line = Math.max(2, Math.round(Math.max(canvas.width, canvas.height) / 400));
  g.strokeStyle = red; g.fillStyle = red; g.lineWidth = line; g.lineJoin = 'round';
  if (swath) { try { swath(g, toCrop, k); } catch {} }
  else if (shape.kind === 'rect') { const [a, b] = toCrop(shape.x, shape.y); g.strokeRect(a - line / 2, b - line / 2, shape.w * k + line, shape.h * k + line); }
  else if (shape.kind === 'path') { g.beginPath(); shape.points.forEach(([x, y], i) => { const [a, b] = toCrop(x, y); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.closePath(); g.stroke(); }
  const dot = gesture?.kind === 'point' ? gesture : shape.kind === 'point' ? shape : null;
  if (dot) { const [a, b] = toCrop(dot.x, dot.y); g.beginPath(); g.arc(a, b, 2.5 * line, 0, Math.PI * 2); g.fill(); }
  try {
    let dataUrl = canvas.toDataURL('image/png');
    for (const q of [0.92, 0.85, 0.75]) { if (dataUrl.length * 0.75 <= MAX_BYTES) break; dataUrl = canvas.toDataURL('image/jpeg', q); }
    if (dataUrl.length * 0.75 > MAX_BYTES) return null;
    return {dataUrl, width: canvas.width, height: canvas.height,
      from: `natural pixels ${sx},${sy} ${sw}×${sh} of ${nw}×${nh}${k !== 1 ? `, ${k < 1 ? 'scaled down' : vector ? 'drawn' : 'enlarged with hard edges'} to ${canvas.width}×${canvas.height}` : ''}; her mark drawn in red`};
  } catch { return null; }
}

// One capture of this tab for the length of the mode. start() must run inside
// the user's gesture that enters the mode (getDisplayMedia needs transient
// activation). grab(rect) returns the pixels of `rect` (CSS px of this page's
// viewport) from the newest frame.
export class TabCapture {
  constructor() { this.stream = null; this.video = null; this.onended = null; }
  static supported() { return !!navigator.mediaDevices?.getDisplayMedia; }
  get live() { return !!this.stream?.getVideoTracks().some(t => t.readyState === 'live'); }
  async start() {
    if (this.live) return true;
    const controller = typeof CaptureController === 'function' ? new CaptureController() : null;
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      // Without a size, Chromium fits frames to the screen's size (800×600 in a
      // headless browser); ask for the tab's own device pixels.
      video: {displaySurface: 'browser', frameRate: {ideal: 15, max: 30},
        width: {ideal: Math.round(Math.max(screen.width, innerWidth) * devicePixelRatio)}, height: {ideal: Math.round(Math.max(screen.height, innerHeight) * devicePixelRatio)}},
      audio: false,
      preferCurrentTab: true,        // Chromium: offer only this tab, no picker list
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
      monitorTypeSurfaces: 'exclude',
      ...(controller ? {controller} : {}),
    });
    try { controller?.setFocusBehavior?.('no-focus-change'); } catch {}
    const track = this.stream.getVideoTracks()[0];
    track.addEventListener('ended', () => { this.stream = null; this.onended?.(); });
    // Only this tab: if she picked a window or screen (Safari, Firefox), the
    // frame is not the page and a crop by page coordinates would be wrong.
    const surface = track.getSettings().displaySurface;
    if (surface && surface !== 'browser') { this.stop(); throw new Error(`Captured a ${surface}, not this tab.`); }
    this.video = Object.assign(document.createElement('video'), {muted: true, playsInline: true});
    this.video.srcObject = this.stream;
    await this.video.play();
    for (let i = 0; i < 40 && !this.video.videoWidth; i++) await new Promise(r => setTimeout(r, 50));
    return true;
  }
  // Waits for a frame newer than now, so an overlay hidden just before is gone.
  // Tab capture sends frames only when the page repaints, so a still page may
  // send none: wait at most `ms`, then use the newest frame there is (it is
  // still what the tab shows, since nothing has repainted).
  fresh(ms = 250) {
    const v = this.video;
    const late = new Promise(r => setTimeout(r, ms));
    if (!v?.requestVideoFrameCallback) return late;
    return Promise.race([new Promise(r => v.requestVideoFrameCallback(() => r())), late]);
  }
  async grab(rect, {fresh = true, maxSide = MAX_SIDE} = {}) {
    if (!this.live || !this.video) return null;
    if (fresh) await this.fresh();
    const v = this.video, fw = v.videoWidth, fh = v.videoHeight;
    if (!fw || !fh) return null;
    // The frame is the tab's viewport, scaled uniformly (device pixels, or less
    // when the browser fits it to a size limit). If its shape is not the
    // viewport's, the frame is of something else (an emulated or resized
    // window): refuse rather than crop the wrong place.
    const kx = fw / innerWidth, ky = kx;
    if (Math.abs(fh - innerHeight * kx) > Math.max(4, 2 * kx)) return null;
    const sx = Math.max(0, rect.x * kx), sy = Math.max(0, rect.y * ky);
    const sw = Math.min(fw - sx, rect.w * kx), sh = Math.min(fh - sy, rect.h * ky);
    if (sw < 1 || sh < 1) return null;
    const k = Math.min(1, maxSide / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw * k); canvas.height = Math.round(sh * k);
    canvas.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return {dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height,
      from: `tab capture, ${fw}×${fh} frame at ${(kx).toFixed(2)} px per CSS px`};
  }
  stop() { for (const t of this.stream?.getTracks() || []) t.stop(); this.stream = null; if (this.video) this.video.srcObject = null; }
}
