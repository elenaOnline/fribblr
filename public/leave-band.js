// The leave band: a flat band in the blue mark at the screen's edge that shows a zoom-out building towards leaving, at
// an opened Tinka's floor (back to its board) or a board's floor (up to its parent, or Home). The owner (2026-11-24): "a thin
// accent color band around the edge of the screen that expands and increases opacity until the threshold is reached, at
// which point the zoom behavior takes over."
//
// It shows the zoom-out gate's progress (canvas-zoom.js zoomOutGate) and nothing else: 0 hides it, 1 is the moment of
// leaving. Width and opacity are a function of how far the current gesture is past the floor; there is no transition,
// timer or easing of its own, so it moves only when the user's input moves it. Composite-only: four edge strips at the full
// width, scaled by `transform`, under one `opacity`; nothing is laid out per frame. It never takes a pointer event and
// is hidden from assistive technology (the gate's first step is announced instead, canvas.js).
export const LEAVE_BAND = { minWidth: 2, maxWidth: 12, minOpacity: .3, maxOpacity: .9 };
export class LeaveBand {
  constructor(host) {
    this.el = document.createElement('div');
    this.el.className = 'leave-band';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = '<i data-edge="top"></i><i data-edge="right"></i><i data-edge="bottom"></i><i data-edge="left"></i>';
    this.strips = [...this.el.children];
    this.progress = 0;
    host.append(this.el);
  }
  set(progress) {
    const p = Math.max(0, Math.min(1, Number(progress) || 0));
    if (p === this.progress) return;
    this.progress = p;
    const { minWidth, maxWidth, minOpacity, maxOpacity } = LEAVE_BAND;
    this.el.style.opacity = p > 0 ? String(minOpacity + (maxOpacity - minOpacity) * p) : '0';
    if (!p) return;
    const scale = (minWidth + (maxWidth - minWidth) * p) / maxWidth;
    for (const strip of this.strips) strip.style.transform = strip.dataset.edge === 'top' || strip.dataset.edge === 'bottom' ? `scaleY(${scale})` : `scaleX(${scale})`;
  }
}
