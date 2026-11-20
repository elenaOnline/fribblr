import {tip, tipOuter} from './tips.js';
import {escape as esc} from './workspace.js';
import {navigationGraph} from './navigator-graph.js';
import './vendor/ui-sdk/web/dialog.js';
import './vendor/ui-sdk/web/command.js';
import './vendor/ui-sdk/web/tree.js';
import './vendor/ui-sdk/web/select.js';
// Left is where: a non-modal Navigator beside the work. Click-away closes it; Keep open docks it.
// UI SDK behaviour (ui-sdk.md § Navigator): the panel is a non-modal Dialog, the search field and its results a
// Command (the caret never leaves the field), Recent boards are the Command's suggestions while the field is empty,
// Boards and On this board are Trees (one Tab stop each), and the scope is a Select.
const boardURL = (id, from) => `/boards/${encodeURIComponent(id)}/${from ? `?from=${encodeURIComponent(from)}` : ''}`;
const svg = body => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON = {
  sidebar:'<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>',
  search:'<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  pin:'<path d="M9 4h6l-1 5 3.5 3.5h-11L10 9z"/><path d="M12 12.5V20"/>',
  x:'<path d="M6 6l12 12M18 6 6 18"/>',
  right:'<path d="m9.5 6 6 6-6 6"/>', check:'<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  board:'<rect x="3.5" y="7.5" width="13" height="12" rx="2"/><path d="M7.5 4.5h11a2 2 0 0 1 2 2v10"/>',
  shared:'<path d="M9 7h8v8M17 7 7 17"/>',
  image:'<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 2.5-2 4.5 3.5"/>',
  doc:'<path d="M6.5 3.5h11a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"/><path d="M8.5 8h7M8.5 11.5h7M8.5 15h4.5"/>',
  code:'<path d="m8.5 7.5-5 4.5 5 4.5M15.5 7.5l5 4.5-5 4.5"/>',
  note:'<path d="M6 3.5h8.5l4 4V20a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z"/><path d="M14 3.5V8h4.5M8.5 12h7M8.5 15.5h5"/>',
  tree:'<rect x="3.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="10" width="7" height="5" rx="1.5"/><rect x="13.5" y="16" width="7" height="5" rx="1.5"/><path d="M7 8.5v10h6.5M7 12.5h6.5"/>',
  canvas:'<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><rect x="7" y="7" width="5" height="4.5" rx="1"/><rect x="13" y="12.5" width="4.5" height="4.5" rx="1"/><path d="M7 15.5h3.5"/>',
};
const kindIcon = kind => ICON[{board:'board',image:'image',svg:'image',video:'image',audio:'image',html:'code',prototype:'code',web:'code',url:'code',link:'code',note:'note',text:'note',sticky:'note'}[String(kind||'').toLowerCase()]||'doc'];
const validId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id);
const isMac = /Mac|iPhone|iPad/.test(globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || '');
const SHORTCUT = isMac ? '⌘K' : 'Ctrl K';
const DOCK_WIDTH = 340, OUTLINE_LIMIT = 300, BOARD_LIMIT = 1000, DEBOUNCE = 150;
const SCOPES = {project:'Whole project', board:'This board', descendants:'This board and descendants'};
const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const narrow = () => globalThis.matchMedia?.('(max-width: 719px)').matches ?? false;
const read = (store, key, fallback) => { try { return JSON.parse(store.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
const write = (store, key, value) => { try { value == null ? store.removeItem(key) : store.setItem(key, JSON.stringify(value)); } catch {} };
const chevron = () => `<ui-tree-item-indicator class="navigator-disc">${svg(ICON.right)}</ui-tree-item-indicator>`;
// Matching ignores case and accents, as the SDK's lists do: fold each character, keep where it came from.
function fold(text) {
  let out = ''; const at = [];
  for (let i = 0; i < text.length;) {
    const ch = String.fromCodePoint(text.codePointAt(i));
    for (const c of ch.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase()) { out += c; at.push(i); }
    i += ch.length;
  }
  at.push(text.length);
  return {out, at};
}

export class ProjectNavigator {
  constructor(config, {boardId=null, beforeNavigate=async()=>{}, reveal=null, outline=null, selection=null}={}) {
    this.config=config; this.boardId=boardId; this.beforeNavigate=beforeNavigate; this.reveal=reveal; this.outline=outline;
    // The board's placement selection lights matching "On this board" rows; tinka:selection keeps it live.
    this.selectionSource=typeof selection==='function'?selection:null; this.selected=new Set(); this.selectedKey='';
    this.expanded=new Set(); this.collapsedRegions=new Set(); this.generation=0; this.isOpen=false;
    const prefix=`tinka/${config.workspaceId}`;
    this.storageKey=`${prefix}/navigator`; this.recentKey=`${prefix}/recent-boards`; this.dockKey=`${prefix}/navigator-docked`; this.sectionsKey=`${prefix}/navigator-sections`;
    this.saved=read(sessionStorage,this.storageKey,{}); if(typeof this.saved!=='object')this.saved={};
    this.scope=boardId && ['board','descendants'].includes(this.saved.scope) ? this.saved.scope : 'project';
    this.q=typeof this.saved.query==='string'?this.saved.query:'';
    this.docked=read(localStorage,this.dockKey,false)===true;
    const sections=read(localStorage,this.sectionsKey,{});
    this.collapsed=new Set(['boards','outline'].filter(id=>sections&&typeof sections==='object'&&sections[id]===true));
    const recent=read(localStorage,this.recentKey,[]);
    this.recent=(Array.isArray(recent)?recent:[]).filter(validId).filter(id=>id!==boardId).slice(0,12);
    if(validId(boardId)) write(localStorage,this.recentKey,[boardId,...this.recent].slice(0,12));
  }
  mount(anchor) {
    const button=this.button=document.createElement('button');
    button.id='project-navigator-toggle'; button.type='button'; button.className='project-navigator-toggle tk-btn tk-icon';
    button.innerHTML=svg(ICON.sidebar); button.setAttribute('aria-label','Navigator'); button.setAttribute('aria-keyshortcuts','Meta+K Control+K'); button.dataset.tip='Navigator';
    button.setAttribute('aria-controls','project-navigator'); button.setAttribute('aria-expanded','false'); button.setAttribute('aria-haspopup','dialog');
    tipOuter(anchor).before(button);
    tip(button);
    button.onclick=()=>this.isOpen?this.close():this.open({opener:button});
    const scopes=Object.entries(SCOPES).filter(([value])=>this.boardId||value==='project');
    const dialog=this.dialog=document.createElement('ui-dialog');
    dialog.id='navigator-dialog'; dialog.setAttribute('modal','false'); dialog.setAttribute('close-on-outside-press','');
    dialog.innerHTML=`<ui-dialog-content id="project-navigator" class="project-navigator" inline hidden initial-focus="#navigator-query" data-tip-zone>
      <header class="navigator-head"><div class="navigator-heading"><ui-dialog-title id="navigator-title" class="tk-eyebrow">Navigator</ui-dialog-title><p class="navigator-project">${esc(this.config.projectLabel)}</p></div>
      <button type="button" class="tk-btn tk-sm tk-icon navigator-pin" data-nav-pin aria-pressed="false" aria-label="Keep open" data-tip="Keep open beside the board">${svg(ICON.pin)}</button>
      <ui-dialog-close><button type="button" class="tk-btn tk-sm tk-icon" data-nav-close aria-label="Close navigator" data-tip="Close navigator" aria-keyshortcuts="Escape">${svg(ICON.x)}</button></ui-dialog-close></header>
      <ui-command class="navigator-command" filter="false"${this.q?` default-query="${esc(this.q)}"`:''}>
      <div class="navigator-find"><label class="navigator-search">${svg(ICON.search)}<ui-command-input><input id="navigator-query" class="tk-field" type="text" maxlength="2000" placeholder="Find a board or item" aria-label="Find a board or item by name or description" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" value="${esc(this.q)}"></ui-command-input><kbd class="tk-kbd" aria-hidden="true">${SHORTCUT}</kbd></label>
      <div class="navigator-scope"${this.boardId?'':' hidden'}><ui-select id="navigator-scope-select" default-value="${this.scope}">
        <ui-select-label class="navigator-scope-label">Search in</ui-select-label>
        <ui-select-trigger><button type="button" id="navigator-scope" class="navigator-scope-trigger"><ui-select-value></ui-select-value></button></ui-select-trigger>
        <ui-select-content class="tk-menu navigator-scope-list" side="bottom" align="start" side-offset="4">${scopes.map(([value,label])=>`<ui-select-item class="tk-mi" value="${value}" label="${label}"><span class="navigator-check" aria-hidden="true">${svg(ICON.check)}</span><span>${label}</span></ui-select-item>`).join('')}</ui-select-content>
      </ui-select></div></div>
      <p class="navigator-status" role="status" aria-live="polite"></p>
      <div class="navigator-content" id="navigator-content"><ui-command-list class="navigator-list"></ui-command-list><div class="navigator-note"></div><div class="navigator-browse"></div></div>
      </ui-command>
      <footer class="navigator-foot" aria-hidden="true"><kbd class="tk-kbd">↑</kbd><kbd class="tk-kbd">↓</kbd> move <span>·</span> <kbd class="tk-kbd">↵</kbd> open <span>·</span> <kbd class="tk-kbd">esc</kbd> <span data-nav-esc>close</span></footer>
    </ui-dialog-content>`;
    document.body.append(dialog);
    const panel=this.panel=dialog.querySelector('#project-navigator');
    this.command=panel.querySelector('ui-command'); this.query=panel.querySelector('#navigator-query');
    this.scopeSelect=panel.querySelector('ui-select');
    this.content=panel.querySelector('.navigator-content'); this.list=panel.querySelector('.navigator-list');
    this.note=panel.querySelector('.navigator-note'); this.browse=panel.querySelector('.navigator-browse');
    this.status=panel.querySelector('[role=status]'); this.escHint=panel.querySelector('[data-nav-esc]');
    this.pin=panel.querySelector('[data-nav-pin]');
    this.pin.onclick=()=>this.setDocked(!this.docked);
    // Our status line announces counts; the Command's own count announcement would say it twice.
    this.command.announcement=()=>null;
    // The panel: a non-modal dialog. Escape (focus inside) and an outside press close it unless it is docked.
    dialog.addEventListener('openchange',event=>{
      const {value,reason,event:cause}=event.detail||{};
      if(value)return;
      // Pressing a toggle or a Find button while open is theirs to handle, not a click-away.
      if(reason==='outside-press'&&cause?.target&&this.openers().some(el=>el.contains(cause.target))){event.preventDefault();return;}
      // The SDK keeps a closing popup until its animations end; the slide-in has no exit, so closing is immediate.
      for(const animation of this.panel.getAnimations?.()||[])animation.finish();
      this.closed(reason);
    });
    dialog.addEventListener('dismissattempt',event=>{
      // Docked, Escape leaves the panel for its toggle and keeps it open.
      if(event.detail?.reason==='escape-key'&&this.panel.contains(document.activeElement))(this.hostButton||this.button).focus({preventScroll:true});
    });
    // Search: typing filters (after a short pause, at the server); Escape empties the field first.
    this.command.addEventListener('querychange',event=>this.onQuery(String(event.detail?.value??''),event.detail?.reason));
    // The highlight scrolls into view (the SDK's); a result's title and description come with its first place.
    this.command.addEventListener('valuechange',()=>requestAnimationFrame(()=>{
      const item=this.list.querySelector('[data-highlighted]'),group=item?.closest('.navigator-result');
      if(!group||group.querySelector('[data-slot="command-item"]')!==item)return;
      const box=this.content.getBoundingClientRect(),rect=group.getBoundingClientRect();
      if(rect.top<box.top&&rect.height<box.height)this.content.scrollBy({top:rect.top-box.top});
    }));
    this.command.addEventListener('action',event=>{
      const value=event.detail?.value;
      if(value==='nav:more')this.search({more:true});
      else if(value==='nav:retry')this.graph?this.search():this.open({focus:false});
    });
    // Enter runs the highlighted result; while a search is still on its way, it runs the first fresh result instead.
    panel.querySelector('.navigator-find').addEventListener('keydown',event=>{
      if(event.key!=='Enter'||event.isComposing||!this.q.trim()||!this.searchPending())return;
      event.preventDefault();event.stopImmediatePropagation();this.runWhenReady=true;this.search();
    },true);
    this.scopeSelect.addEventListener('valuechange',event=>{
      const value=event.detail?.value;
      if(!SCOPES[value]){event.preventDefault();return;}
      this.scope=value;this.persist();this.search();
    });
    // Links (Recent, results, boards) navigate through follow(), so feedback is saved first; modified clicks stay the browser's.
    panel.addEventListener('click',event=>{
      const link=event.target.closest('a[data-nav-board]');
      if(!link||!panel.contains(link)||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      if(event.target.closest('ui-tree-item-indicator'))return;
      event.preventDefault();this.follow(link).catch(error=>{this.status.textContent=error.message;});
    });
    // The trees own their keys (arrows, typeahead, Home/End); the Command around them must not hear them.
    this.browse.addEventListener('keydown',event=>{if(event.key!=='Escape')event.stopPropagation();});
    document.addEventListener('keydown',event=>{
      if(!(event.metaKey||event.ctrlKey)||event.altKey||event.shiftKey||event.key?.toLowerCase()!=='k')return;
      const active=document.activeElement;
      if(active&&!panel.contains(active)&&active.closest?.('input,textarea,select,[contenteditable]:not([contenteditable=false])'))return;
      if(this.modalOpen())return;
      event.preventDefault();event.stopImmediatePropagation();this.focusSearch();
    },true);
    document.addEventListener('tinka:navigator-open',event=>{if(!this.modalOpen())this.focusSearch({opener:event.detail?.opener});});
    document.addEventListener('tinka:selection',event=>{
      const detail=event.detail||{};
      if(!this.boardId||(detail.boardId!=null&&detail.boardId!==this.boardId))return;
      this.selected=new Set((Array.isArray(detail.placementIds)?detail.placementIds:[]).filter(id=>typeof id==='string'));
      this.syncSelection({scroll:true});
    });
    this.media=globalThis.matchMedia?.('(max-width: 719px)');
    this.media?.addEventListener?.('change',()=>this.applyDock());
    this.applyDock();
    if(this.docked&&!narrow())this.open({focus:false});
    return this;
  }
  // An open Tinka is a modal page of its own; the Navigator then lives inside it
  // (see host) and counts only other modal dialogs as blocking.
  modalOpen(){try{return [...document.querySelectorAll('dialog:modal,ui-dialog-content[data-open][aria-modal=true]:not(.quick-jot),ui-alert-dialog-content[data-open]')].some(dialog=>!dialog.contains(this.panel));}catch{return false;}}
  toggles(){return [this.button,this.hostButton].filter(Boolean);}
  // Everything that opens the Navigator: its toggles and the Find buttons in the board and reader headers.
  openers(){return [...this.toggles(),...document.querySelectorAll('#chrome-search,#reader-search')];}
  // Move the panel into an open Tinka (container) with its own toggle, or back to the page (null).
  // While hosted it floats rather than docks; a docked Navigator returns when the Tinka closes.
  host(container,button=null){
    if(!this.panel||(this.hostEl||null)===(container||null))return;
    if(container&&this.isOpen)this.hide({restoreFocus:false});
    this.hostEl=container||null;this.hostButton=container?button:null;
    this.hostButton?.setAttribute('aria-haspopup','dialog');
    (container||document.body).append(this.dialog);
    for(const toggle of this.toggles())toggle.setAttribute('aria-expanded',String(this.isOpen));
    this.applyDock();
    if(!container&&this.dockedNow()&&!this.isOpen)this.open({focus:false});
  }
  dockedNow(){return this.docked&&!narrow()&&!this.hostEl;}
  persist(){write(sessionStorage,this.storageKey,{query:this.q,scope:this.scope});}
  setDocked(value){
    this.docked=!!value; write(localStorage,this.dockKey,this.docked||null);
    if(this.docked&&!this.isOpen)this.open({focus:false});
    this.applyDock();
  }
  applyDock(){
    if(!this.panel)return;
    const docked=this.isOpen&&this.dockedNow(),was=document.body.classList.contains('navigator-docked');
    this.pin.setAttribute('aria-pressed',String(this.docked));
    // Docked, it is part of the layout: Escape and click-away no longer close it (the toggle and Close still do).
    if(this.dockedNow())this.dialog.setAttribute('dismissible','false');else this.dialog.removeAttribute('dismissible');
    this.panel.classList.toggle('is-docked',docked);
    document.body.classList.toggle('navigator-docked',docked);
    if(docked)document.body.style.setProperty('--navigator-dock-width',`${DOCK_WIDTH}px`);else document.body.style.removeProperty('--navigator-dock-width');
    if(was!==docked)globalThis.dispatchEvent?.(new Event('resize'));
  }
  focusSearch({opener}={}){if(!this.isOpen)return this.open({opener});this.query.focus({preventScroll:true});this.query.select();}
  // hide() keeps the Keep open preference; close() is the explicit choice to put the Navigator away.
  // Focus goes back to whatever opened it (the SDK's rule), or stays put (restoreFocus:false).
  hide({restoreFocus=true}={}){
    if(!this.isOpen)return;
    if(!restoreFocus)this.panel.setAttribute('final-focus','none');
    this.dialog.api?.close?.();
    if(this.isOpen){this.dialog.open=false;this.closed('imperative');}
  }
  // After the dialog closed, however it closed.
  closed(reason){
    if(!this.isOpen)return;
    clearTimeout(this.timer);this.timer=null;this.abort?.abort();this.generation++;this.isOpen=false;this.runWhenReady=false;
    if(reason==='close-press'&&this.docked){this.docked=false;write(localStorage,this.dockKey,null);}
    for(const toggle of this.toggles())toggle.setAttribute('aria-expanded','false');
    this.applyDock();
  }
  close(){if(this.docked){this.docked=false;write(localStorage,this.dockKey,null);}this.hide();this.applyDock();}
  dismiss(){if(!this.dockedNow())this.hide();}
  async open({focus=true,opener=null}={}){
    if(!this.isOpen){
      this.isOpen=true;
      // A button that opened it gets focus back, whatever the browser did with focus on click.
      this.opener=opener?.id?opener:null;
      if(this.opener)this.panel.setAttribute('final-focus',`#${CSS.escape(this.opener.id)}`);else this.panel.removeAttribute('final-focus');
      this.panel.setAttribute('initial-focus',focus?'#navigator-query':'none');
      this.dialog.api?.open?.();
      if(!this.dialog.open)this.dialog.open=true;
      this.applyDock();
    }else if(focus){this.query.focus({preventScroll:true});this.query.select();}
    for(const toggle of this.toggles())toggle.setAttribute('aria-expanded','true');
    this.revealOnRender=true;
    this.status.textContent='Loading project boards…';
    try{
      const [snapshot,catalog]=await Promise.all([this.get('/api/workspace?view=graph&covers=0'),this.get('/api/boards')]);
      if(!this.isOpen)return;
      this.graph=navigationGraph(snapshot,(catalog.boards||[]).filter(board=>!(snapshot.boards||[]).some(candidate=>candidate.id===board.id)));
      this.enabled=snapshot.enabled;
      const from=new URLSearchParams(location.search).get('from');
      this.currentPath=(this.graph.parents.get(this.boardId)||[]).includes(from)?[...(this.graph.paths.get(from)||[from]),this.boardId]:this.graph.paths.get(this.boardId);
      for(const id of this.currentPath||[])this.expanded.add(id);
      await this.search();
    }catch(error){
      if(!this.isOpen)return;
      this.status.textContent='Project boards could not be loaded.';this.browse.innerHTML='';this.panel.classList.remove('is-searching');
      this.note.innerHTML=`<p class="navigator-empty">${esc(error.message)}</p>`;
      this.list.innerHTML='<ui-command-item value="nav:retry" class="tk-btn tk-tonal navigator-more" data-nav-retry>Retry</ui-command-item>';
    }
  }
  async get(url,signal){
    const response=await fetch(url,{cache:'no-store',signal});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`);
    return data;
  }
  // Re-render the empty-query view, for example after the board's outline changed.
  // Re-render only when the outline actually changed, and never under focus, so
  // live board updates don't churn the panel while someone is using it.
  refresh(){
    if(!this.isOpen||!this.graph||this.q.trim())return;
    let signature='';try{signature=JSON.stringify(this.outline?.()||[]);}catch{}
    if(signature===this.outlineSignature)return;
    if(this.panel?.contains(document.activeElement))return;
    this.renderBrowse();
  }
  path(id){return ((id===this.boardId&&this.currentPath)||this.graph.paths.get(id)||[id]).map(id=>this.graph.boards.get(id)?.title||id).join(' / ');}
  // Marks every place the search text occurs, ignoring case and accents.
  hl(text){
    text=String(text??'');const query=this.renderedQuery||'';
    const needle=fold(query).out;if(!needle)return esc(text);
    const {out,at}=fold(text);let html='',last=0;
    for(let i=out.indexOf(needle);i>=0;i=out.indexOf(needle,i+needle.length)){
      const start=at[i],end=at[i+needle.length];if(start<last)continue;
      html+=`${esc(text.slice(last,start))}<mark>${esc(text.slice(start,end))}</mark>`;last=end;
    }
    return html+esc(text.slice(last));
  }
  onQuery(value,reason){
    this.q=value;this.persist();
    clearTimeout(this.timer);this.timer=null;this.abort?.abort();this.generation++;
    this.escHint.textContent=value?'clear':'close';
    if(!this.graph)return;
    if(!value.trim()||reason!=='input-change'){this.search();return;}
    this.status.textContent='Searching…';this.command.setAttribute('status','loading');
    this.timer=setTimeout(()=>this.search(),DEBOUNCE);
  }
  searchPending(){return !!this.timer||!!this.inFlight||this.renderedQuery!==this.q.trim();}
  currentSelection(){
    if(!this.selectionSource)return this.selected;
    try{const ids=this.selectionSource();return new Set((Array.isArray(ids)||ids instanceof Set?[...ids]:[]).filter(id=>typeof id==='string'));}catch{return this.selected;}
  }
  // Light the outline rows for the board's selection, live; the first lit row scrolls into view within the panel only.
  syncSelection({scroll=false,force=false,refreshed=false}={}){
    const tree=this.outlineTree;
    if(!tree||!tree.isConnected)return;
    const rows=[...tree.querySelectorAll('ui-tree-item[data-nav-outline]')];
    if(!rows.length)return;
    const shown=new Set(rows.map(row=>row.dataset.navOutline));
    if(scroll&&!refreshed&&this.isOpen&&!this.q.trim()&&!this.browse.contains(document.activeElement)&&[...this.selected].some(id=>!shown.has(id))){
      let known=[];try{known=(this.outline?.()||[]).map(entry=>entry?.placementId);}catch{}
      if([...this.selected].some(id=>known.includes(id)&&!shown.has(id))){this.renderBrowse({selection:false});return this.syncSelection({scroll,force:true,refreshed:true});}
    }
    const lit=rows.filter(row=>this.selected.has(row.dataset.navOutline));
    tree.value=lit.map(row=>row.getAttribute('value'));
    const count=lit.length,first=lit[0]?.querySelector(':scope > ui-tree-item-label');
    const badge=tree.querySelector('[data-nav-selected]');
    if(badge){badge.hidden=!count;badge.textContent=count?`${count} selected`:'';}
    const key=first?`${lit[0].dataset.navOutline}|${count}`:'';
    if(!scroll||!first||(!force&&key===this.selectedKey)){this.selectedKey=key;return;}
    this.selectedKey=key;
    if(first.offsetParent===null)return;
    const box=this.content.getBoundingClientRect(),rect=first.getBoundingClientRect();
    const head=tree.querySelector('.navigator-section-toggle');
    const top=box.top+(head?.offsetHeight||0)+4,bottom=box.bottom-4;
    const delta=rect.top<top?rect.top-top:rect.bottom>bottom?Math.min(rect.bottom-bottom,rect.top-top):0;
    if(delta)this.content.scrollBy({top:delta,behavior:reducedMotion()?'auto':'smooth'});
  }
  // Recent boards: the Command's suggestions while the field is empty (↑↓ move, ↵ opens, the caret stays put).
  recentMarkup(){
    const ids=this.recent.filter(id=>id!==this.boardId&&this.graph.boards.has(id)).slice(0,5);
    if(!ids.length)return '';
    return `<ui-command-group class="navigator-recent-group"><ui-command-group-label class="tk-eyebrow">Recent</ui-command-group-label><div class="navigator-recent">${ids.map(id=>{const board=this.graph.boards.get(id);return `<ui-command-item value="recent:${esc(id)}" label="${esc(board.title||id)}" as-child><a class="navigator-chip" href="${boardURL(id)}" data-nav-board="${esc(id)}" data-tip="${esc(this.path(id))}"><span class="navigator-chip-window" aria-hidden="true"></span><span>${esc(board.title||id)}</span></a></ui-command-item>`;}).join('')}</div></ui-command-group>`;
  }
  // A section band is the root row of its tree: chevron, icon, label and count; → / ← open and close it.
  sectionLabel(id,label,icon,count,extra=''){
    return `<ui-tree-item-label class="navigator-section-toggle" data-nav-section="${id}">${chevron()}${svg(ICON[icon])}<span class="navigator-section-label">${label}</span>${extra}<span class="navigator-count">${count}</span></ui-tree-item-label>`;
  }
  // Every board, nested as the project nests them; a board reached a second time is a shared reference (a leaf).
  boardNodes(){
    const graph=this.graph,visited=new Set();let count=0,truncated=false;
    const walk=(id,parent)=>{
      if(count>=BOARD_LIMIT){truncated=true;return null;}
      count++;const repeated=visited.has(id);visited.add(id);
      const node={id,parent,repeated,children:[]};
      if(!repeated)for(const child of graph.children.get(id)||[]){const next=walk(child,id);if(!next)break;node.children.push(next);}
      return node;
    };
    const roots=[];for(const id of graph.roots){const node=walk(id,null);if(!node)break;roots.push(node);}
    return {roots,truncated,count};
  }
  boardsMarkup(){
    const {roots,truncated,count}=this.boardNodes(),expanded=[];
    if(!this.collapsed.has('boards'))expanded.push('sec:boards');
    const item=node=>{
      const board=this.graph.boards.get(node.id),shared=(this.graph.parents.get(node.id)||[]).length>1,value=node.repeated?`s:${node.parent}>${node.id}`:`b:${node.id}`;
      if(node.children.length&&this.expanded.has(node.id))expanded.push(value);
      const hint=node.repeated?'Shared reference':shared?'Multiple parents':board.legacy?'Legacy board':'';
      const lead=node.children.length?chevron():`<span class="navigator-branch" aria-hidden="true">${node.repeated?svg(ICON.shared):''}</span>`;
      return `<ui-tree-item value="${esc(value)}" label="${esc(board.title)}"><ui-tree-item-label as-child><a class="navigator-row" href="${boardURL(node.id,node.parent)}" data-nav-board="${esc(node.id)}" data-tip="${esc(board.title)}" data-tip-truncated=".navigator-name">${lead}<span class="navigator-name">${esc(board.title)}</span>${hint?`<small>${hint}</small>`:''}</a></ui-tree-item-label>${node.children.length?`<ui-tree-group>${node.children.map(item).join('')}</ui-tree-group>`:''}</ui-tree-item>`;
    };
    const rows=roots.map(item).join('');
    const current=this.boardId&&this.graph.boards.has(this.boardId)?`b:${this.boardId}`:'';
    const location=this.boardId?`<p class="navigator-location" data-tip="${esc(this.path(this.boardId))}" data-tip-truncated="bdi"><span class="sr-only">You are here: </span><bdi>${esc(this.path(this.boardId))}</bdi></p>`:'';
    // The location line sits under the band, outside the rows (it is not a tree item), and folds away with the section.
    const tree=`<ui-tree class="navigator-tree navigator-group is-boards" aria-label="Project boards" mode="none" expand-on-press="false"${current?` current="${esc(current)}"`:''} default-expanded="${esc(expanded.join(','))}"><ui-tree-item value="sec:boards" class="navigator-section" label="Boards">${this.sectionLabel('boards','Boards','tree',this.graph.boards.size)}${location}<ui-tree-group>${rows}</ui-tree-group></ui-tree-item></ui-tree>`;
    return `${tree}${truncated?'<p class="navigator-empty">More boards are available. Search by name to find them.</p>':''}${!count?'<p class="navigator-empty">No boards yet.</p>':''}`;
  }
  outlineMarkup(){
    if(!this.boardId||typeof this.outline!=='function')return '';
    let entries=[];try{entries=(this.outline()||[]).filter(entry=>entry&&entry.placementId);}catch{entries=[];}
    const groups=new Map();
    for(const entry of entries.slice(0,OUTLINE_LIMIT)){const region=typeof entry.region==='string'&&entry.region.trim()?entry.region.trim():'';if(!groups.has(region))groups.set(region,[]);groups.get(region).push(entry);}
    const ordered=[...groups].sort(([a],[b])=>(a==='')-(b===''));
    const expanded=this.collapsed.has('outline')?[]:['sec:outline'];
    const row=entry=>`<ui-tree-item value="p:${esc(entry.placementId)}" label="${esc(entry.title||'Untitled')}" data-nav-outline="${esc(entry.placementId)}"><ui-tree-item-label class="navigator-outline-row${entry.kind==='board'||entry.kind==='Board'?' is-place':''}">${svg(kindIcon(entry.kind))}<span>${esc(entry.title||'Untitled')}</span></ui-tree-item-label></ui-tree-item>`;
    const body=ordered.map(([region,list],index)=>{
      if(!region)return list.map(row).join('');
      if(!this.collapsedRegions.has(region))expanded.push(`r:${index}`);
      return `<ui-tree-item value="r:${index}" label="${esc(region)}" data-nav-region="${esc(region)}"><ui-tree-item-label class="navigator-region">${chevron()}<span class="navigator-region-name">${esc(region)}</span><span class="navigator-count">${list.length}</span></ui-tree-item-label><ui-tree-group>${list.map(row).join('')}</ui-tree-group></ui-tree-item>`;
    }).join('');
    const selected='<span class="navigator-selected-count" data-nav-selected hidden></span>';
    const more=entries.length>OUTLINE_LIMIT?'<p class="navigator-empty">More items are on this board. Search to find them.</p>':'';
    if(!entries.length)return `<ui-tree class="navigator-outline navigator-group is-outline" aria-label="On this board" mode="none" expand-on-press="false"><ui-tree-item value="sec:outline" class="navigator-section" label="On this board">${this.sectionLabel('outline','On this board','canvas',0)}</ui-tree-item></ui-tree><p class="navigator-empty">Nothing is on this board yet.</p>`;
    // mode=multiple: the rows the board has selected show as selected (aria-selected); choosing a row selects it on the board.
    return `<ui-tree class="navigator-outline navigator-group is-outline" aria-label="On this board" mode="multiple" expand-on-press="false" default-expanded="${esc(expanded.join(','))}"><ui-tree-item value="sec:outline" class="navigator-section" label="On this board">${this.sectionLabel('outline','On this board','canvas',entries.length,selected)}<ui-tree-group>${body}</ui-tree-group></ui-tree-item></ui-tree>${more}`;
  }
  // The empty-field view: Recent suggestions in the Command list, then the Boards and On this board trees.
  renderBrowse({selection=true}={}){
    try{this.outlineSignature=JSON.stringify(this.outline?.()||[]);}catch{}
    this.renderedQuery='';this.cursor=null;this.results=[];
    this.command.setAttribute('status','idle');
    this.status.textContent=`${this.graph.boards.size} ${this.graph.boards.size===1?'board':'boards'} in this project`;
    if(this.panel.classList.contains('is-searching'))this.content.scrollTop=0;
    this.panel.classList.remove('is-searching');
    this.list.innerHTML=this.recentMarkup();this.note.innerHTML='';
    this.browse.innerHTML=this.boardsMarkup()+this.outlineMarkup();
    this.boardsTree=this.browse.querySelector('ui-tree.is-boards');this.outlineTree=this.browse.querySelector('ui-tree.is-outline');
    for(const tree of [this.boardsTree,this.outlineTree].filter(Boolean))this.wireTree(tree);
    if(selection)this.selected=this.currentSelection();
    const reveal=this.revealOnRender;this.revealOnRender=false;
    this.syncSelection({scroll:reveal,force:reveal});
  }
  wireTree(tree){
    // Bands and regions open and close on press; board links navigate (click delegation); outline rows jump to the card.
    tree.addEventListener('action',event=>{
      const value=String(event.detail?.value||'');
      if(value.startsWith('sec:')||value.startsWith('r:')){tree.api?.toggle?.(value);return;}
      if(value.startsWith('p:'))this.jump(value.slice(2));
    });
    // The outline mirrors the board's selection; a press asks the board (via jump) instead of selecting here.
    tree.addEventListener('valuechange',event=>event.preventDefault());
    tree.addEventListener('expandedchange',event=>{
      const open=new Set(Array.isArray(event.detail?.value)?event.detail.value:[]);
      const section=tree.classList.contains('is-boards')?'boards':'outline';
      const was=this.collapsed.has(section);
      if(open.has(`sec:${section}`))this.collapsed.delete(section);else this.collapsed.add(section);
      if(was!==this.collapsed.has(section))write(localStorage,this.sectionsKey,this.collapsed.size?Object.fromEntries([...this.collapsed].map(key=>[key,true])):null);
      if(section==='boards'){
        for(const item of tree.querySelectorAll('ui-tree-item[data-branch]')){const value=item.getAttribute('value');if(value?.startsWith('b:')){const id=value.slice(2);if(open.has(value))this.expanded.add(id);else this.expanded.delete(id);}}
      }else{
        for(const item of tree.querySelectorAll('ui-tree-item[data-nav-region]')){const region=item.dataset.navRegion;if(open.has(item.getAttribute('value')))this.collapsedRegions.delete(region);else this.collapsedRegions.add(region);}
        if(was&&!this.collapsed.has('outline'))requestAnimationFrame(()=>this.syncSelection({scroll:true,force:true}));
      }
    });
  }
  async search({more=false}={}){
    if(!this.graph)return;
    clearTimeout(this.timer);this.timer=null;this.abort?.abort();
    const token=++this.generation,query=this.q.trim();
    if(!query){this.inFlight=false;this.renderBrowse();this.runWhenReady=false;return;}
    // The previous results stay while the next ones load, so nothing jumps under the pointer.
    this.status.textContent='Searching…';this.command.setAttribute('status','loading');
    if(!more){this.results=[];this.cursor=null;}
    const params=new URLSearchParams({query,kind:'all',sort:'title',direction:'asc',limit:'40'});
    if(this.boardId&&this.scope!=='project'){params.set('withinBoardId',this.boardId);params.set('recursive',String(this.scope==='descendants'));}
    if(more&&this.cursor)params.set('cursor',this.cursor);
    const abort=this.abort=new AbortController();this.inFlight=true;
    try{
      const data=this.enabled?await this.get(`/api/search?${params}`,abort.signal):{results:[],nextCursor:null};
      if(token!==this.generation||!this.isOpen)return;
      this.inFlight=false;
      const before=this.results.length;
      this.results.push(...data.results);this.cursor=data.nextCursor;
      const folded=fold(query).out;
      const legacy=[...this.graph.boards.values()].filter(board=>board.legacy&&fold(board.title||'').out.includes(folded)&&(this.scope==='project'||board.id===this.boardId));
      const boardMatches=new Set(this.results.filter(row=>row.type==='board').map(row=>row.id));
      const results=[...this.results.filter(row=>!(row.type==='item'&&row.kind==='board'&&boardMatches.has(row.childBoardId))),...legacy.map(board=>({...board,type:'board',legacy:true}))];
      this.status.textContent=`${results.length}${this.cursor?'+':''} ${results.length===1?'match':'matches'} · ${SCOPES[this.scope]}`;
      this.renderedQuery=query;
      if(!more||!this.panel.classList.contains('is-searching'))this.content.scrollTop=0;
      this.panel.classList.add('is-searching');this.browse.innerHTML='';this.boardsTree=this.outlineTree=null;
      this.list.innerHTML=results.map((row,index)=>this.resultMarkup(row,index)).join('')+(this.cursor?'<ui-command-item value="nav:more" class="tk-btn tk-tonal navigator-more" data-nav-more>Load more results</ui-command-item>':'');
      this.note.innerHTML=(!results.length?`<p class="navigator-empty">No matches for “${esc(query)}”. ${this.scope!=='project'?'Try Whole project or a different name.':'Try a different name or description.'}</p>`:'')+(!this.enabled?'<p class="navigator-empty">Search includes legacy board names. Open a board to explore its experiments.</p>':'');
      this.command.setAttribute('status','idle');
      // After Load more, the highlight lands on the first new result.
      if(more){const fresh=this.list.querySelectorAll('ui-command-item')[this.firstItemIndex(before)];const value=fresh?.getAttribute('value');if(value)requestAnimationFrame(()=>this.command.api?.setValue?.(value));}
      if(this.runWhenReady){this.runWhenReady=false;if(this.list.querySelector('ui-command-item'))requestAnimationFrame(()=>this.command.api?.run?.());}
    }catch(error){
      if(token!==this.generation||error?.name==='AbortError')return;
      this.inFlight=false;this.runWhenReady=false;
      this.status.textContent='Search could not finish.';this.command.setAttribute('status','error');
      this.panel.classList.add('is-searching');this.browse.innerHTML='';this.renderedQuery=query;
      this.note.innerHTML=`<p class="navigator-empty">${esc(error.message)}</p>`;
      this.list.innerHTML='<ui-command-item value="nav:retry" class="tk-btn tk-tonal navigator-more" data-nav-retry>Retry search</ui-command-item>';
    }
  }
  // Index, among all rendered commands, of the first command of result number `resultIndex`.
  firstItemIndex(resultIndex){
    const groups=[...this.list.querySelectorAll('ui-command-group')];
    let index=0;for(let i=0;i<resultIndex&&i<groups.length;i++)index+=groups[i].querySelectorAll('ui-command-item').length;
    return index;
  }
  // One result: its title, kind and description name the group; each place it can be opened is a command.
  resultMarkup(row,index){
    const board=row.type==='board', locations=(row.locations||[]).filter(location=>!location.archived);
    const inScope=location=>this.scope==='project'||location.boardId===this.boardId||this.graph.paths.get(location.boardId)?.includes(this.boardId);
    const ordered=[...locations.filter(inScope),...locations.filter(location=>!inScope(location))];
    const seen=new Set(),links=ordered.filter(location=>{if(seen.has(location.boardId))return false;seen.add(location.boardId);return true;});
    const where=id=>`${svg(ICON.board)}<span>${esc(this.path(id))}</span>`;
    const key=`${row.type}:${row.id}`;
    const command=(value,label,link)=>`<ui-command-item value="${esc(value)}" label="${esc(label)}" as-child>${link}</ui-command-item>`;
    const locationMarkup=board?command(`${key}@${row.id}`,this.path(row.id),`<a href="${boardURL(row.id)}" data-nav-board="${esc(row.id)}">${where(row.id)}</a>`)
      :links.map(location=>command(`${key}@${location.boardId}`,this.path(location.boardId),`<a href="${boardURL(location.boardId)}?reveal=${encodeURIComponent(location.placementId)}" data-nav-board="${esc(location.boardId)}" data-nav-placement="${esc(location.placementId)}">${where(location.boardId)}</a>`)).join('');
    const fallback=command(`${key}@open`,row.childBoardId?'Open board':'Open item',`<a href="${row.childBoardId?boardURL(row.childBoardId):`/app/item.html?item=${encodeURIComponent(row.id)}`}" ${row.childBoardId?`data-nav-board="${esc(row.childBoardId)}"`:''}>${row.childBoardId?'Open board':'Open item (not placed on an active board)'}</a>`);
    const kind=board?'board':row.kind||'idea',count=board?1:links.length||1;
    return `<ui-command-group class="navigator-result${board?' is-place':''}${count===1?' is-single':''}" data-nav-result="${index}"><ui-command-group-label class="navigator-result-label"><span class="navigator-result-head">${svg(kindIcon(kind))}<span class="navigator-result-title">${this.hl(row.title)}</span><span class="navigator-result-kind">${esc(board?'Board':row.kind||'Idea')}</span></span>${row.description?`<span class="navigator-result-description">${this.hl(row.description)}</span>`:''}</ui-command-group-label><div class="navigator-result-locations">${locationMarkup||fallback}</div>${row.locationCount>locations.length?`<small>${row.locationCount} saved locations; active locations shown when available.</small>`:''}${row.legacy?'<small>Legacy board · search covers its name</small>':''}</ui-command-group>`;
  }
  async jump(placementId){
    if(!this.reveal)return;
    this.dismiss();
    try{await this.reveal(placementId);}catch(error){this.status.textContent=error.message;}
  }
  async follow(link){
    await this.beforeNavigate();
    if(link.dataset.navBoard===this.boardId){this.dismiss();if(link.dataset.navPlacement&&this.reveal)await this.reveal(link.dataset.navPlacement);return;}
    if(!this.dockedNow())this.hide({restoreFocus:false});
    location.assign(link.href);
  }
}
