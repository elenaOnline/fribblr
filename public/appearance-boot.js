// This browser's look, put on <html> before the first paint so no page shows the wrong one first:
//   data-appearance  light | dark      from Mode (tinka/appearance: system, light, dark)
//   data-ground      desk | white      from Background (tinka/ground: desk, white); light only, dark has one ground
// Loaded as a plain script at the top of <head> on Home and boards; appearance.js imports it too and builds the controls.
(() => {
  if (window.tinkaAppearance) { window.tinkaAppearance(); return; }
  const root = document.documentElement, system = matchMedia('(prefers-color-scheme: dark)');
  const read = (key, allowed) => { try { const value = localStorage.getItem(key); return allowed.includes(value) ? value : allowed[0]; } catch { return allowed[0]; } };
  // Light unless she chose otherwise (Tinka 1.3). An overview capture (?overview&appearance=light|dark) asks for one
  // look for that page only, without saving it.
  const params = new URLSearchParams(location.search);
  const forced = params.has('overview') ? params.get('appearance') : null;
  const apply = () => {
    const mode = forced === 'light' || forced === 'dark' ? forced : read('tinka/appearance', ['light', 'system', 'dark']);
    const appearance = mode === 'system' ? (system.matches ? 'dark' : 'light') : mode;
    root.dataset.appearance = appearance;
    root.dataset.ground = appearance === 'light' ? read('tinka/ground', ['desk', 'white']) : 'desk';
  };
  window.tinkaAppearance = apply;
  apply();
  system.addEventListener('change', apply);
  // Another tab or window changed it: follow.
  addEventListener('storage', event => { if (event.key === null || event.key === 'tinka/appearance' || event.key === 'tinka/ground') apply(); });
})();
