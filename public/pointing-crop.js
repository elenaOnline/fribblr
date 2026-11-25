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

// `region`: fractions 0..1 of the card's own box (contract `targets[].region`),
// or omitted for the whole card. Returns the part of the image inside it.
export function imageCrop(card, region = {x: 0, y: 0, w: 1, h: 1}) {
  const img = card?.querySelector?.('.workspace-card-preview img');
  if (!img || !img.complete || !(img.naturalWidth > 0)) return null;
  const box = card.getBoundingClientRect(), shown = img.getBoundingClientRect();
  const nw = img.naturalWidth, nh = img.naturalHeight;
  // Where the picture's pixels actually are inside the <img> box (object-fit).
  const fit = getComputedStyle(img).objectFit || 'fill';
  let cw = shown.width, ch = shown.height;
  if (fit === 'contain' || fit === 'scale-down' || fit === 'cover') {
    const s = (fit === 'cover' ? Math.max : Math.min)(shown.width / nw, shown.height / nh);
    const k = fit === 'scale-down' ? Math.min(1, s) : s;
    cw = nw * k; ch = nh * k;
  } else if (fit === 'none') { cw = nw; ch = nh; }
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
  const vector = /\.svgz?(?:$|[?#])|^data:image\/svg/i.test(img.currentSrc || img.src);
  const onScreen = Math.max((x1 - x0), (y1 - y0)) * (devicePixelRatio || 1);
  let k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  if (vector) k = Math.min(MAX_SIDE / Math.max(sw, sh), Math.max(1, 2 * onScreen / Math.max(sw, sh)));
  else if (Math.max(sw, sh) < MIN_SIDE) k = Math.min(8, MIN_SIDE / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * k)); canvas.height = Math.max(1, Math.round(sh * k));
  const g = canvas.getContext('2d');
  if (!vector && k > 1) g.imageSmoothingEnabled = false;
  g.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  try {
    return {dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height,
      from: `image file${vector ? ' (vector, drawn at ' + k.toFixed(1) + '×)' : ''}, natural pixels ${Math.round(sx)},${Math.round(sy)} ${Math.round(sw)}×${Math.round(sh)} of ${nw}×${nh}${!vector && k !== 1 ? `, ${k < 1 ? 'scaled down' : 'enlarged with hard edges'} to ${canvas.width}×${canvas.height}` : ''}`};
  } catch { return null; } // a cross-origin image taints the canvas
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
