// "Back to Tinka" on a standalone page. Tinka's server adds this one script to
// a project HTML file only when a browser opens it as the page itself (see
// lib/return-mark.mjs). It draws a small mark at the bottom left that returns
// to the opened Tinka. It touches nothing else on the page: one custom element
// with a closed shadow root, no globals, no page CSS in or out.
(() => {
  if (window.top !== window) return; // inside Tinka, or inside the author's own frame
  if (document.querySelector('meta[name="fribblr-return" i][content="off" i], meta[name="tinka-return" i][content="off" i]')) return;
  if ([new URLSearchParams(location.search).get('fribblr'), new URLSearchParams(location.search).get('tinka')].includes('off')) return;
  const HIDDEN = 'tinka/return-hidden';
  try { if (sessionStorage.getItem(HIDDEN)) return; } catch {}
  if (document.querySelector('tinka-return')) return;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const MARK = '<svg viewBox="0 0 48 48" aria-hidden="true"><path class="ma" d="M7 8h15v15H7zm19 0h15v15H26zM7 27h15v15H7z"/><path class="mb" d="m33.5 25 10 10-10 10-10-10z"/></svg>';
  const DOTS = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="5" cy="10" r="1.4"/><circle cx="10" cy="10" r="1.4"/><circle cx="15" cy="10" r="1.4"/></svg>';
  const CSS = `
    :host { all: initial; position: fixed; left: 16px; bottom: 16px; z-index: 2147483000; display: block; color-scheme: light;
      /* This runs inside the page of a served item, where the app's tokens.css is not loaded: the theme's values (tokens.css)
         are repeated here, light then dark. */
      --bg: rgba(242,242,242,.9); --menu: #F2F2F2; --ink: #000000; --ink3: #595959; --line: #C8C8C8; --hover: rgba(0,0,0,.05); --blue: #005E8B; --soft: #D3DFE5; --cast: 0 4px 14px rgba(0,0,0,.16);
      font: 400 13.5px/1.3 "IBM Plex Sans", -apple-system, system-ui, sans-serif; color: var(--ink); }
    :host([data-dark]) { color-scheme: dark; --bg: rgba(34,41,46,.9); --menu: #22292E; --ink: #E9EDF0; --ink3: #A7B1B8; --line: #465058; --hover: rgba(255,255,255,.08); --blue: #4BA3D6; --soft: #2F4250; --cast: 0 4px 14px rgba(0,0,0,.45); }
    @media print { :host { display: none !important; } }
    * { box-sizing: border-box; corner-shape: squircle; }
    a, button { font: inherit; color: inherit; -webkit-tap-highlight-color: transparent; }
    svg { display: block; } .ma { fill: var(--ink); } .mb { fill: var(--blue); }
    .wrap { display: flex; align-items: center; gap: 4px; }
    .chip { display: flex; align-items: center; height: 36px; padding: 0 9px; border-radius: 16px; background: var(--bg);
      box-shadow: 0 0 0 1px var(--line), var(--cast); cursor: pointer; text-decoration: none; opacity: .72; transition: opacity .16s, padding .16s; }
    .chip .m { width: 18px; height: 18px; flex: none; }
    .chip .t { display: grid; max-width: 0; margin-left: 0; overflow: hidden; white-space: nowrap; transition: max-width .2s cubic-bezier(.2,.7,.2,1), margin .2s; }
    .chip .t b { font-weight: 600; } .chip .t small { overflow: hidden; text-overflow: ellipsis; color: var(--ink3); font-size: 11px; font-weight: 400; }
    .more { display: none; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 12px; background: var(--bg); box-shadow: 0 0 0 1px var(--line), var(--cast); color: var(--ink3); cursor: pointer; }
    .more svg { fill: currentColor; }
    .open .chip { opacity: 1; padding: 0 14px 0 10px; }
    .open .chip .t { max-width: min(300px, calc(100vw - 120px)); margin-left: 10px; }
    .open .more { display: inline-flex; }
    .chip:focus-visible, .more:focus-visible, .row:focus-visible, .foot button:focus-visible, .foot a:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
    .card { position: absolute; left: 0; bottom: 44px; width: 288px; max-width: calc(100vw - 32px); max-height: min(420px, calc(100vh - 80px)); overflow: auto; padding: 6px; border-radius: 18px; background: var(--menu); color: var(--ink);
      box-shadow: 0 0 0 1px var(--line), var(--cast); }
    .card[hidden] { display: none; }
    .lab { padding: 8px 10px 4px; font-size: 12px; font-weight: 400; color: var(--ink3); }
    .row { display: grid; grid-template-columns: 1fr auto; gap: 0 8px; align-items: center; width: 100%; padding: 7px 10px; border-radius: 9px; text-decoration: none; cursor: pointer; }
    .row:hover { background: var(--hover); }
    .row span, .row small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row small { grid-column: 1; color: var(--ink3); font-size: 11px; font-weight: 400; }
    .row em { grid-row: 1 / span 2; grid-column: 2; font-style: normal; font-size: 11px; color: var(--ink); background: var(--soft); border-radius: 6px; padding: 2px 7px; }
    .sep { height: 1px; background: var(--line); margin: 6px 4px; }
    .foot { display: flex; gap: 4px; padding: 2px; }
    .foot button, .foot a { flex: 1; display: inline-flex; align-items: center; justify-content: center; height: 30px; padding: 0 6px; border: 0; border-radius: 9px; background: var(--hover); cursor: pointer; font-size: 12px; text-decoration: none; white-space: nowrap; }
    .foot button:hover, .foot a:hover { background: var(--line); }
    .toast { position: absolute; left: 0; bottom: 44px; padding: 8px 12px; border-radius: 12px; background: var(--ink); color: var(--menu); font-size: 12px; white-space: nowrap; }
    .toast[hidden] { display: none; }
    @media (prefers-reduced-motion: reduce) { .chip, .chip .t { transition: none; } }`;

  const host = document.createElement('tinka-return');
  const root = host.attachShadow({ mode: 'closed' });
  let data = { places: [], file: '' }, best = null, closeTimer = 0;

  const appearance = () => {
    let value = 'light';
    try { value = localStorage.getItem('tinka/appearance') || 'light'; } catch {}
    const dark = value === 'dark' || (value === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    host.toggleAttribute('data-dark', dark);
  };
  const recent = () => {
    try { const list = JSON.parse(localStorage.getItem(`tinka/${data.workspace}/recent-tinkas`) || '[]'); return Array.isArray(list) ? list : []; } catch { return []; }
  };
  const name = place => `${place.number ? `${place.number} · ` : ''}${place.title || 'Untitled'}`;
  // Where to go: the Tinka last opened in this browser, else the only place, else ask.
  const choose = () => {
    const seen = recent();
    let found = null, at = -1;
    for (const place of data.places) {
      const hit = seen.find(entry => entry && entry.board === place.boardId && entry.key === place.key);
      if (hit && Number(hit.at) > at) { found = place; at = Number(hit.at); }
    }
    return found || (data.places.length === 1 ? data.places[0] : null);
  };

  function render() {
    best = choose();
    const many = data.places.length > 1;
    const label = best ? `<b>Back to fribblr</b><small>${esc(name(best))} · ${esc(best.boardTitle)}</small>`
      : many ? `<b>Back to fribblr</b><small>On ${data.places.length} boards · choose one</small>`
      : '<b>Open fribblr</b><small>This project\'s boards</small>';
    const aria = best ? `Back to fribblr: ${name(best)} on ${best.boardTitle}` : many ? `Back to fribblr: choose one of ${data.places.length} boards` : 'Open fribblr';
    const rows = many ? `<div class="lab">On ${data.places.length} boards</div>${data.places.map((place, i) => `<a class="row" role="menuitem" href="${esc(place.href)}" data-place="${i}"><span>${esc(place.boardTitle)}</span><small>${esc(name(place))}</small>${place === best ? '<em>last opened</em>' : ''}</a>`).join('')}<div class="sep"></div>` : '';
    root.innerHTML = `<style>${CSS}</style><div class="wrap"><a class="chip" href="${esc(best?.href || (many ? '#' : '/'))}" aria-label="${esc(aria)}" title="${esc(aria)}"><span class="m">${MARK}</span><span class="t">${label}</span></a><button class="more" type="button" aria-label="More: other boards, copy path, hide" aria-haspopup="menu" aria-expanded="false">${DOTS}</button></div>
      <div class="card" role="menu" aria-label="Back to fribblr" hidden>${rows}<div class="foot">${data.file ? '<button type="button" role="menuitem" data-copy>Copy path</button>' : ''}<a href="/" role="menuitem">fribblr home</a><button type="button" role="menuitem" data-hide>Hide</button></div></div>
      <div class="toast" role="status" hidden></div>`;
    const wrap = root.querySelector('.wrap'), card = root.querySelector('.card'), more = root.querySelector('.more'), chip = root.querySelector('.chip');
    const open = () => { clearTimeout(closeTimer); wrap.classList.add('open'); };
    const shut = () => { clearTimeout(closeTimer); closeTimer = setTimeout(() => { if (card.hidden && !wrap.matches(':focus-within')) wrap.classList.remove('open'); }, 260); };
    const menu = show => { card.hidden = !show; more.setAttribute('aria-expanded', String(show)); if (show) open(); else shut(); };
    for (const el of [wrap, card]) { el.addEventListener('pointerenter', open); el.addEventListener('pointerleave', shut); }
    wrap.addEventListener('focusin', open); wrap.addEventListener('focusout', shut);
    more.addEventListener('click', () => menu(card.hidden));
    chip.addEventListener('click', event => { if (!best && many) { event.preventDefault(); menu(true); card.querySelector('.row')?.focus(); } });
    root.addEventListener('keydown', event => { if (event.key === 'Escape') { menu(false); wrap.classList.remove('open'); chip.focus(); } });
    root.querySelector('[data-copy]')?.addEventListener('click', () => copy(data.file));
    root.querySelector('[data-hide]').addEventListener('click', () => { try { sessionStorage.setItem(HIDDEN, '1'); } catch {} observer.disconnect(); host.remove(); });
    closeMenu = () => { if (!card.hidden) menu(false); };
  }
  let closeMenu = () => {};
  document.addEventListener('pointerdown', event => { if (!event.composedPath().includes(host)) closeMenu(); }, { capture: true });
  function say(text) {
    const toast = root.querySelector('.toast'), card = root.querySelector('.card');
    card.hidden = true; toast.textContent = text; toast.hidden = false;
    clearTimeout(say.timer); say.timer = setTimeout(() => { toast.hidden = true; }, 2200);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); say('Copied the file path'); return; } catch {}
    const area = document.createElement('textarea'); area.value = text; area.style.cssText = 'position:fixed;opacity:0'; root.append(area); area.select();
    let done = false; try { done = document.execCommand('copy'); } catch {}
    area.remove(); say(done ? 'Copied the file path' : text);
  }
  // Single-page apps can replace the body; put the mark back when that happens.
  const observer = new MutationObserver(() => { if (!host.isConnected && document.body) { document.body.append(host); watchBody(); } });
  let watchedBody = null;
  function watchBody() { if (document.body && document.body !== watchedBody) { watchedBody = document.body; observer.observe(watchedBody, { childList: true }); } }

  appearance();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', appearance);
  render();
  (document.body || document.documentElement).append(host);
  observer.observe(document.documentElement, { childList: true }); watchBody();
  fetch(`/api/resource-places?url=${encodeURIComponent(location.pathname)}`, { cache: 'no-store', credentials: 'same-origin' })
    .then(response => response.ok ? response.json() : null)
    .then(value => { if (value && Array.isArray(value.places)) { data = value; render(); } })
    .catch(() => {});
})();
