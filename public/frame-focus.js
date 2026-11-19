// Side-by-side page support (public/compare.html, UI SDK experiment). Only acts when this page is inside a frame.
// A press anywhere gives this frame the keys, as a press in a window makes it the active window. Without it a press on
// the board's ground leaves the keys in the other frame, because the board cancels the press's default.
if (window.top !== window) addEventListener('pointerdown', () => { if (!document.hasFocus()) window.focus(); }, true);
