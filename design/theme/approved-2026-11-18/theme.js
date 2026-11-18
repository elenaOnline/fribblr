// Round 3: the markup the theme needs. Mockup code, not app code. Two parts:
// 1. kinds (from round 2 Unified's additions.js), 2. printed shortcuts (from round 2 Alabaster + Modus's theme.js).
// The app does not expose an item's kind in the DOM, so this reads the board API and marks each card with
// data-kind (the stored kind) and data-family (page, doc, pic, plain, board), draws the kind legend in the foot of a
// board, and a kinds line on each Home card. It never writes to the board.
(() => {
  const FAMILY = { html: 'page', url: 'page', app: 'page', markdown: 'doc', pdf: 'doc', image: 'pic', video: 'pic', audio: 'pic', note: 'plain', idea: 'plain', board: 'board' };
  const ORDER = ['page', 'doc', 'pic', 'plain', 'board'];
  const NAME = { page: 'Pages', doc: 'Documents', pic: 'Pictures', plain: 'Notes', board: 'Boards' };
  const ONE = { page: 'page', doc: 'document', pic: 'picture', plain: 'note', board: 'board' };
  const kindOf = (b, p) => {
    const it = (b.items || {})[p.itemId] || {};
    if (Object.values(b.childBoards || {}).some(c => c.ownerItemId === p.itemId)) return 'board';
    return it.content?.kind || 'idea';
  };
  const fam = k => FAMILY[k] || 'plain';
  const count = b => { const n = {}; for (const p of b.placements || []) { const f = fam(kindOf(b, p)); n[f] = (n[f] || 0) + 1; } return n; };

  const boardMatch = location.pathname.match(/^\/boards\/([^/]+)/);
  if (boardMatch) {
    fetch(`/api/boards/${boardMatch[1]}`).then(r => r.json()).then(b => {
      const kinds = {};
      for (const p of b.placements || []) kinds[p.id] = kindOf(b, p);
      const world = document.getElementById('world');
      const mark = () => {
        for (const c of document.querySelectorAll('#world .workspace-card[data-placement]')) {
          const k = kinds[c.dataset.placement];
          if (k && c.dataset.kind !== k) { c.dataset.kind = k; c.dataset.family = fam(k); }
        }
        const title = document.querySelector('.reader-title-row');
        const m = location.hash.match(/#items\/([^/?]+)/);
        if (title) {
          if (m && kinds[m[1]]) { title.dataset.kind = kinds[m[1]]; title.dataset.family = fam(kinds[m[1]]); }
          else { delete title.dataset.kind; delete title.dataset.family; }
        }
      };
      mark();
      new MutationObserver(mark).observe(document.body, { childList: true, subtree: true });
      addEventListener('hashchange', mark);

      const n = count(b);
      const foot = document.querySelector('.canvas-footer');
      if (!foot || !world) return;
      const leg = document.createElement('div');
      leg.className = 'fr-legend'; leg.setAttribute('role', 'group'); leg.setAttribute('aria-label', 'Kinds on this board');
      leg.innerHTML = ORDER.filter(f => n[f]).map(f =>
        `<button type="button" data-family="${f}" aria-pressed="false" title="Show only the ${NAME[f].toLowerCase()} on this board"><i></i><span>${NAME[f]}</span><b>${n[f]}</b></button>`).join('');
      foot.insertBefore(leg, foot.firstChild);
      document.body.classList.add('fr-has-legend');
      let kept = null;
      const light = f => {
        world.classList.toggle('fr-lit', !!f);
        for (const c of world.querySelectorAll('.workspace-card')) c.classList.toggle('fr-on', !!f && c.dataset.family === f);
      };
      leg.addEventListener('pointerover', e => { const btn = e.target.closest('button'); if (btn) light(btn.dataset.family); });
      leg.addEventListener('pointerleave', () => light(kept));
      leg.addEventListener('click', e => {
        const btn = e.target.closest('button'); if (!btn) return;
        kept = kept === btn.dataset.family ? null : btn.dataset.family;
        for (const x of leg.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x.dataset.family === kept));
        light(kept);
      });
    }).catch(() => {});
    return;
  }

  // Home: a kinds line under each board's description.
  if (location.pathname === '/') {
    const cache = {};
    const put = (card, html) => {
      const info = card.querySelector('.board-info'); if (!info || info.querySelector('.fr-strip') || !html) return;
      const el = document.createElement('div'); el.className = 'fr-strip'; el.innerHTML = html;
      info.insertBefore(el, info.querySelector('.card-bottom'));
    };
    const strip = () => {
      for (const card of document.querySelectorAll('.board-card')) {
        if (card.querySelector('.fr-strip')) continue;
        const a = card.querySelector('a.board-link[href*="/boards/"]'); if (!a) continue;
        const id = a.getAttribute('href').match(/\/boards\/([^/]+)/)[1];
        if (typeof cache[id] === 'string') { put(card, cache[id]); continue; }
        if (cache[id]) continue;
        cache[id] = fetch(`/api/boards/${id}`).then(r => r.json()).then(b => {
          const n = count(b);
          cache[id] = ORDER.filter(f => n[f]).map(f => `<span data-family="${f}"><i></i>${n[f]} ${n[f] === 1 ? ONE[f] : NAME[f].toLowerCase()}</span>`).join('');
          strip();
        }).catch(() => {});
      }
    };
    strip();
    new MutationObserver(strip).observe(document.body, { childList: true, subtree: true });
  }
})();

// Prints a command's shortcut on its key, as Powerset's keys do ("Tab stop ⇥", "Save to inbox ⌘↩").
// Reads the shortcut the app already states in the button's title, e.g. "Fit every item in view (F or ⇧1)" -> F.
// Only labelled keys (not icon-only ones). Hidden at phone widths and on touch by theme.css.
(() => {
  const SKIP = '.tk-icon, .zoom-percent, .chrome-search, .tk-seg > button';
  function shortcut(btn) {
    const m = /\(([^()]+)\)\s*$/.exec(btn.title || '');
    if (!m) return null;
    const first = m[1].split(/\s+or\s+|,\s*/)[0].trim();
    return first.length <= 4 ? first : null;
  }
  function print(root) {
    for (const btn of root.querySelectorAll('button.tk-btn')) {
      if (btn.matches(SKIP) || btn.querySelector('kbd, .f-key')) continue;
      const key = shortcut(btn);
      if (!key) continue;
      const k = document.createElement('kbd');
      k.className = 'f-key'; k.setAttribute('aria-hidden', 'true'); k.textContent = key;
      btn.append(k);
    }
  }
  let queued = false;
  const run = () => { queued = false; print(document); };
  const start = () => {
    run();
    new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } })
      .observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
