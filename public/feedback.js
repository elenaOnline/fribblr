import {escape as esc,toast} from './workspace.js';
import {pointAnchorAt,resolveCommentPoint} from './feedback-geometry.js';
import {bindForm,restoreFocus,commitShortcutLabel,commitShortcutCap} from './interaction.js';
import {setTip} from './tips.js';
import {sharedMenu,sharedPopover,openMenu,menuItem,menuCheckbox,menuSeparator,inPopup,menuOpen,tabOutOfPanel,placeInBoardOrder} from './popups.js';
import {choiceHTML,setChoice,onChoose} from './ui-toolbar.js';
export function voteTotals(votes={}){const result={yes:0,no:0,abstain:0};for(const vote of Object.values(votes||{}))if(Object.hasOwn(result,vote.value))result[vote.value]++;return result;}
// Vote appears on a tile's hover bar (and in an opened Tinka's Inspector) only once
// someone has voted on the item; until then it is in Details… and the More menu.
export function hasVotes(votes){const t=voteTotals(votes);return t.yes+t.no+t.abstain>0;}
const capital=s=>s[0].toUpperCase()+s.slice(1);
// Local identity is self-reported. Drafts, conversations and ballots are separate.
export class FeedbackController {
  constructor({client,getBoard,getOrigin=()=>({x:0,y:0}),screenToCanvas,refresh=async()=>{},getMode=()=> 'canvas',onPointMode=()=>{},onCommitted=()=>{}}){
    Object.assign(this,{client,getBoard,getOrigin,screenToCanvas,refresh,getMode,onPointMode,onCommitted});
    this.threads=[];this.visible=false;this.pinsVisible=true;this.onlyUnresolved=false;this.itemId=null;this.request=0;this.mode='board';this.voting=new Set();this.annotationActions=new Map();this.drafts=new Map();
    this.actorKey=`tinka/${client.config.workspaceId}/feedback-actor`;this.draftStore=`tinka/${client.config.workspaceId}/conversation-drafts`;
    try{this.actor=JSON.parse(localStorage.getItem(this.actorKey));}catch{}
    if(!this.actor||!/^human-[a-z0-9-]+$/i.test(this.actor.id)||typeof this.actor.label!=='string'||this.actor.label.length>120)this.actor={id:`human-${crypto.randomUUID()}`,label:'You',kind:'human'};
    this.actor.kind='human';this.saveActor();
    try{for(const d of JSON.parse(sessionStorage.getItem(this.draftStore)||'[]'))if(d&&typeof d.key==='string'&&typeof d.body==='string'&&d.body.length<=20000){d.pending=false;this.drafts.set(d.key,d);}}catch{}
  }
  saveActor(){try{localStorage.setItem(this.actorKey,JSON.stringify(this.actor));}catch{}}
  mount({toolbar,world,viewport}){
    this.world=world;this.viewport=viewport;
    if(!document.querySelector('link[data-feedback-css]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/app/feedback.css';link.dataset.feedbackCss='';document.head.append(link);}
    this.toggle=document.createElement('button');this.toggle.type='button';this.toggle.dataset.feedbackToggle='';this.toggle.textContent='Comments';this.toggle.setAttribute('aria-expanded','false');this.toggle.onclick=()=>this.open({returnFocus:this.toggle});toolbar.append(this.toggle);
    this.layer=document.createElement('div');this.layer.className='feedback-pins';this.layer.setAttribute('aria-label','Comment points');
    this.panel=document.createElement('aside');this.panel.className='feedback-panel';this.panel.hidden=true;this.panel.setAttribute('aria-label','Comments');
    this.panel.innerHTML=`<header class="feedback-head"><div><strong>Comments</strong><p class="feedback-scope"></p></div><button type="button" data-feedback-settings aria-label="Conversation options" aria-haspopup="menu" aria-expanded="false">⋯</button><button type="button" data-feedback-close aria-label="Close comments">×</button></header><div class="feedback-history"><p class="feedback-status" role="status"></p><div class="feedback-list"></div><button type="button" data-feedback-more hidden>Load more comments</button></div><form class="feedback-composer"><div class="feedback-compose-context" hidden></div><label class="sr-only" for="feedback-message">Comment</label><textarea id="feedback-message" name="body" rows="2" maxlength="20000" required placeholder="Write a comment…"></textarea><p class="feedback-post-status" role="status"></p><footer><button type="button" class="feedback-posting-as" data-feedback-identity aria-haspopup="dialog" aria-expanded="false"></button><span class="feedback-shortcut"><kbd class="tk-kbd" aria-hidden="true">${esc(commitShortcutCap())}</kbd></span><button type="submit" data-feedback-post>Post</button></footer></form>`;
    document.body.append(this.panel);this.textarea=this.panel.querySelector('textarea');this.form=this.panel.querySelector('form');this.mountPopups();
    this.textarea.addEventListener('input',()=>{this.saveDraft();this.postStatus('');});
    this.formBinding=bindForm(this.form,{submit:()=>this.postDraft(),onError:()=>{},onPendingChange:pending=>{this.textarea.readOnly=pending;}});
    this.panel.querySelector('[data-feedback-close]').onclick=()=>this.close();
    const settings=this.panel.querySelector('[data-feedback-settings]'),identity=this.panel.querySelector('[data-feedback-identity]');
    settings.onclick=event=>this.optionsUI.root.api?.isOpen()?this.optionsUI.root.api.close():this.openOptions(event);
    settings.addEventListener('keydown',event=>{if((event.key==='ArrowDown'||event.key==='ArrowUp')&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey){event.preventDefault();event.stopPropagation();this.openOptions(event);}});
    identity.onclick=()=>this.nameUI.root.api?.isOpen()?this.nameUI.root.api.close():this.openName(identity);
    this.panel.querySelector('[data-feedback-more]').onclick=()=>this.reload({more:true}).catch(error=>this.failure(error));
    this.panel.addEventListener('click',e=>{
      const reply=e.target.closest('[data-feedback-reply]'),resolve=e.target.closest('[data-feedback-resolve]'),scope=e.target.closest('[data-feedback-item-scope]');
      if(scope)this.open({itemId:scope.dataset.feedbackItemScope,mode:this.mode,host:this.panel.parentElement,returnFocus:this.returnFocus});
      if(reply)this.reply(reply.dataset.feedbackReply);
      if(resolve)this.resolve(resolve.dataset.feedbackResolve,resolve.dataset.resolved!=='true');
      if(e.target.closest('[data-feedback-context-clear]')){this.saveDraft();this.selectDraft({itemId:this.itemId,fresh:true});this.textarea.focus();}
    });
    this.pointHandler=e=>{
      if(!this.pointMode||!this.viewport.contains(e.target)||e.button!==0)return;
      e.preventDefault();e.stopImmediatePropagation();
      const point=this.screenToCanvas({x:e.clientX,y:e.clientY}),placement=e.target.closest('[data-placement]')?.dataset.placement,decoration=e.target.closest('[data-decoration]')?.dataset.decoration;
      const itemId=placement?this.getBoard().placements.find(p=>p.id===placement)?.itemId:undefined;
      const anchor=pointAnchorAt(point,this.getBoard(),placement?{placementId:placement}:decoration?{decorationId:decoration}:{});
      this.pointClick={until:Date.now()+700,x:e.clientX,y:e.clientY};this.endPoint();this.compose({itemId,anchor});
    };
    this.clickHandler=e=>{if(this.pointClick&&Date.now()<this.pointClick.until&&Math.hypot(e.clientX-this.pointClick.x,e.clientY-this.pointClick.y)<6&&this.viewport.contains(e.target)){e.preventDefault();e.stopImmediatePropagation();this.pointClick=null;}};
    // A press outside the board's panel closes it (the ballot and the panel's own menu and name field are popups: the
    // SDK closes them on an outside press, and a press inside them is not outside the panel). With a menu open, the
    // press only closes the menu (menu.md: modal="pointer", "an outside press only closes the menu"): the SDK swallows
    // it, and so does the panel.
    this.outsideHandler=e=>{
      if(menuOpen())return;
      if(this.visible&&this.mode==='board'&&!this.pointMode&&!this.panel.contains(e.target)&&!e.target.closest('[data-item-feedback],[data-feedback-toggle],.feedback-pin,.feedback-options-menu,.feedback-name,.feedback-ballot'))this.close({restoreFocus:false});
    };
    // On a board the panel sits right after the board (placeInBoardOrder), so Tab goes on through the page and off it.
    // Inside the reader, at the end of its area: Tab past its last control continues from what opened it, and
    // Shift+Tab from its first goes back there, as the SDK's non-modal dialogs do (popups.js).
    this.panel.addEventListener('keydown',e=>{if(e.key==='Tab'&&this.visible&&this.mode==='reader')tabOutOfPanel(e,this.panel,this.tabAnchor(),null);});
    this.keyHandler=e=>{if(e.key==='Escape')this.consumeEscape(e);};this.repositionHandler=()=>this.sizePanel();
    window.addEventListener('click',this.clickHandler,true);window.addEventListener('pointerdown',this.pointHandler,true);window.addEventListener('pointerdown',this.outsideHandler,true);window.addEventListener('keydown',this.keyHandler,true);window.addEventListener('resize',this.repositionHandler);window.visualViewport?.addEventListener('resize',this.repositionHandler);this.sync();
  }
  status(message){this.panel.querySelector('.feedback-status').textContent=message;}
  postStatus(message,error=false){const el=this.panel.querySelector('.feedback-post-status');el.textContent=message;el.setAttribute('role',error?'alert':'status');}
  failure(error){this.status(error.message);}
  // ---- The panel's popups (ui-sdk.md § Comments panel) ----
  // ⋯ "Conversation options" is a Menu (two checkbox items that stay open as they toggle, then actions); the name the
  // panel posts as is a field, so it is a Popover, opened from "As You" (or the menu's "Your name…"). The Vote ballot is a
  // Popover holding one choice: a single-choice toggle group (one Tab stop, arrows move without voting, Space or Enter
  // votes), since every vote is saved to the board at once and moving focus must not cast one.
  // Their roots live beside the panel's host (the page, or the modal reader dialog), never inside the panel.
  popupHost(anchor=this.panel){return anchor?.closest?.('dialog[open]')||document.body;}
  host(root,anchor){const where=this.popupHost(anchor);if(root.parentElement!==where)where.append(root);}
  mountPopups(){
    const options=this.optionsUI=sharedMenu({id:'feedback-options-menu',label:'Conversation options',className:'feedback-options-menu'});
    for(const [name,value] of [['align','end'],['side-offset','4'],['collision-padding','8']])options.content.setAttribute(name,value);
    options.content.addEventListener('checkedchange',e=>{
      const option=e.target.closest('[value]')?.getAttribute('value');e.target.closest('[value]')?.setAttribute('checked',String(e.detail.value));
      if(option==='pins'){this.pinsVisible=e.detail.value;this.syncPins();document.dispatchEvent(new CustomEvent('tinka:show-points',{detail:{visible:e.detail.value}}));}
      if(option==='unresolved'){this.onlyUnresolved=e.detail.value;this.reload().catch(error=>this.failure(error));}
    },true);
    // An action runs once the menu has closed and handed focus back, so the focus it moves (the composer, the name
    // field) stays where it put it.
    options.root.addEventListener('action',e=>{this.afterOptions=e.detail.value;});
    options.root.addEventListener('openchange',e=>{if(!e.detail.value)this.panel.querySelector('[data-feedback-settings]').setAttribute('aria-expanded','false');});
    options.root.addEventListener('openchangecomplete',e=>{
      if(e.detail.value)return;const action=this.afterOptions;this.afterOptions=null;if(!action)return;
      requestAnimationFrame(()=>{
        if(action==='point')this.beginPoint();
        else if(action==='board')this.open({mode:this.mode,host:this.panel.parentElement,returnFocus:this.returnFocus});
        else if(action==='name')this.openName(this.panel.querySelector('[data-feedback-settings]'));
      });
    });
    // The board's comment layer (comment-pins.js) says whether its points show (⇧C toggles them too).
    this.pointsShown=e=>{this.pinsVisible=!!e.detail?.visible;};document.addEventListener('tinka:points-shown',this.pointsShown);
    const name=this.nameUI=sharedPopover({id:'feedback-name-popover',label:'Your name',className:'feedback-settings feedback-name'});
    name.content.innerHTML=`<label>Your name<input maxlength="120" aria-label="Your comment name" data-feedback-name></label><p>Your name is saved in this browser.</p>`;
    name.content.setAttribute('collision-padding','8');name.content.setAttribute('side-offset','6');
    name.content.tabTrigger=()=>this.nameOpener;
    const field=name.content.querySelector('input'),save=()=>{this.actor.label=field.value.trim()||'You';field.value=this.actor.label;this.saveActor();this.renderScope();};
    field.addEventListener('change',save);
    field.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();save();name.root.api.close();}});
    name.root.addEventListener('openchange',e=>{
      // Its opener counts as part of it, as a popover's own trigger does: a press there is not a click-away and focus there
      // is not focus leaving (the opener's click toggles it shut; Shift+Tab from the field lands there).
      if(!e.detail.value&&['outside-press','focus-out'].includes(e.detail.reason)&&e.detail.event?.target instanceof Node&&this.nameOpener?.contains(e.detail.event.target)){e.preventDefault();return;}
      if(!e.detail.value){save();this.nameOpener?.setAttribute('aria-expanded','false');}
    });
  }
  openOptions(event){
    const {root,content}=this.optionsUI,button=this.panel.querySelector('[data-feedback-settings]');
    if(root.api?.isOpen())return;this.host(root);
    const point=this.mode!=='reader'&&this.getMode()==='canvas',board=!!this.itemId&&this.mode!=='reader';
    content.innerHTML=menuCheckbox('unresolved','Unresolved only',{checked:this.onlyUnresolved})+menuCheckbox('pins','Show points',{checked:this.pinsVisible})+menuSeparator
      +(point?menuItem('point','Add point'):'')+(board?menuItem('board','Board discussion'):'')+menuItem('name','Your name…');
    button.setAttribute('aria-expanded','true');
    openMenu(root,{anchor:button,event,returnTo:'.feedback-panel [data-feedback-settings]'});
  }
  openName(opener){
    const {root,content}=this.nameUI;if(root.api?.isOpen())return;this.host(root,opener);
    this.nameOpener=opener;opener.setAttribute('aria-expanded','true');
    // Beside "As You" (at the composer's foot) it opens above; from ⋯ (at the top) below.
    const below=!opener.matches('[data-feedback-identity]');content.setAttribute('side',below?'bottom':'top');content.setAttribute('align',below?'end':'start');
    content.querySelector('input').value=this.actor.label;
    if(document.activeElement!==opener)opener.focus({preventScroll:true});
    root.api.open({anchor:opener});
  }
  showSettings(show){if(!show){if(this.optionsUI?.root.api?.isOpen())this.optionsUI.root.api.close();if(this.nameUI?.root.api?.isOpen())this.nameUI.root.api.close();}else this.openOptions();}
  scopeKey(itemId=this.itemId){return `${this.getBoard().id}/${itemId||'board'}`;}
  persistDrafts(){const saved=[...this.drafts.values()].filter(d=>d.body||d.anchor||d.replyTo).sort((a,b)=>a.updatedAt-b.updatedAt).slice(-20);try{sessionStorage.setItem(this.draftStore,JSON.stringify(saved.map(({pending,...d})=>d)));}catch{}}
  saveDraft(){if(!this.draft)return;if(this.draft.body!==this.textarea.value)this.draft.attempt=null;this.draft.body=this.textarea.value;this.draft.updatedAt=Date.now();this.drafts.set(this.draft.key,this.draft);this.persistDrafts();}
  selectDraft({itemId=this.itemId,anchor,replyTo,fresh=false}={}){
    const scope=this.scopeKey(itemId),explicit=anchor||replyTo||fresh;
    let d=!explicit?[...this.drafts.values()].filter(d=>d.scope===scope).sort((a,b)=>b.updatedAt-a.updatedAt)[0]:null;
    const key=`${scope}/${replyTo||'new'}/${anchor?JSON.stringify(anchor):''}`;
    d ||=this.drafts.get(key)||{key,scope,boardId:this.getBoard().id,itemId,anchor,replyTo,body:'',updatedAt:Date.now()};
    this.draft=d;this.textarea.value=d.body;this.postStatus('');this.renderComposer();
  }
  renderComposer(){
    const d=this.draft,context=this.panel.querySelector('.feedback-compose-context');this.panel.dataset.anchored=String(d?.anchor?.kind==='text');context.hidden=!d?.anchor&&!d?.replyTo;
    if(!context.hidden){const thread=this.threads.find(t=>t.id===d.replyTo);context.innerHTML=`<div>${d.replyTo?`Replying to ${esc(thread?.author.label||'this conversation')}`:d.anchor.kind==='text'?'Selected passage':'Canvas point'}<button type="button" data-feedback-context-clear aria-label="${d.replyTo?'Cancel reply':'Remove comment context'}">×</button></div>${d.anchor?.kind==='text'?`<blockquote>${esc(d.anchor.quote)}</blockquote>`:''}`;}
    this.textarea.placeholder=d?.replyTo?'Write a reply…':'Write a comment…';this.panel.querySelector('[data-feedback-post]').textContent=d?.replyTo?'Reply':'Post';this.queueSizing();
  }
  sizePanel(){
    if(!this.panel)return;const v=window.visualViewport,height=v?.height||innerHeight,scale=this.panel.offsetWidth?this.panel.getBoundingClientRect().width/this.panel.offsetWidth:1;
    this.panel.dataset.short=String(!this.nextCursor&&(this.panel.querySelector('.feedback-list')?.scrollHeight||0)<260);this.panel.style.setProperty('--feedback-available-height',`${height/scale}px`);if(this.mode==='board')this.panel.style.maxWidth=`${(v?.width||innerWidth)/scale-24}px`;else this.panel.style.removeProperty('max-width');this.panel.dataset.edge=this.selectionRect&&(this.selectionRect.top+this.selectionRect.bottom)/2>(v?.offsetTop||0)+height/2?'top':'bottom';
    let offset=0;
    if(this.visible&&this.mode==='reader'&&innerWidth>600&&this.selectionRect&&this.panel.dataset.short==='true'){
      const host=this.panel.parentElement.getBoundingClientRect(),box=this.panel.getBoundingClientRect(),field=this.textarea.getBoundingClientRect(),anchorY=this.selectionRect.top-host.top;
      this.panel.style.setProperty('--feedback-anchor-y',`${anchorY/scale}px`);offset=Math.max(0,Math.min(host.height-box.height,anchorY-(field.top-box.top)));
    }
    this.panel.style.setProperty('--feedback-reader-offset',`${offset/scale}px`);
  }
  queueSizing(){cancelAnimationFrame(this.sizingFrame);this.sizingFrame=requestAnimationFrame(()=>this.sizePanel());}
  async open({itemId=null,threadId=null,anchor,host,mode='board',returnFocus,selectionRect,selectionId}={}){
    this.saveDraft();this.closeVote({restoreFocus:false});this.endPoint();const changedScope=this.itemId!==itemId||this.loadedScope!==this.scopeKey(itemId);
    this.mode=mode;this.itemId=itemId;this.returnFocus=returnFocus||(!this.panel.contains(document.activeElement)?document.activeElement:this.returnFocus);
    if(host)host.append(this.panel);else placeInBoardOrder(this.panel);this.panel.dataset.mode=mode;this.selectionRect=selectionRect;this.selectionId=selectionId;this.panel.hidden=false;this.visible=true;this.toggle.setAttribute('aria-expanded','true');this.showSettings(false);this.sizePanel();this.selectDraft({itemId,anchor});this.renderScope();
    if(changedScope){this.threads=[];this.nextCursor=null;this.renderList();this.syncPins();}this.status('Loading comments…');if(!threadId)this.textarea.focus({preventScroll:true});
    try{await this.reload();if(threadId)this.focusThread(threadId);}catch(error){this.failure(error);}
  }
  updateReaderContext({selectionId,selectionRect}={}){if(this.visible&&this.mode==='reader'&&selectionId===this.selectionId){this.selectionRect=selectionRect;this.sizePanel();}}
  close({restoreFocus:restore=true}={}){this.saveDraft();this.visible=false;this.panel.hidden=true;this.toggle.setAttribute('aria-expanded','false');this.showSettings(false);this.endPoint();if(restore)restoreFocus(this.returnFocus);this.reload().catch(()=>{});}
  consumeEscape(e){
    if(e.key!=='Escape'||e.defaultPrevented||e.isComposing||e.keyCode===229)return false;
    // An open popup (the options menu, the name field, the ballot, a tooltip) takes its own Escape first.
    if(e.target&&inPopup(e))return false;let handled=true;
    if(this.ballot)this.closeVote();else if(this.pointMode)this.endPoint();else if(this.visible)this.close();else handled=false;
    if(handled){e.preventDefault();e.stopImmediatePropagation?.();}return handled;
  }
  renderScope(){this.panel.querySelector('.feedback-scope').textContent=this.getBoard().items?.[this.itemId]?.title||this.getBoard().title||'This board';this.panel.querySelector('[data-feedback-identity]').textContent=`As ${this.actor.label}`;}
  beginPoint(){if(this.getMode()!=='canvas'||this.mode==='reader')return;this.saveDraft();this.pointMode=true;this.panel.hidden=true;this.viewport.classList.add('feedback-point-mode');this.onPointMode(true);toast('Click the canvas to place a comment. Escape cancels.');}
  endPoint(){this.pointMode=false;this.viewport?.classList.remove('feedback-point-mode');this.onPointMode(false);if(this.visible)this.panel.hidden=false;}
  compose({itemId=null,anchor,...options}={}){return this.open({itemId,anchor,...options});}
  commentOnItem(itemId,options={}){return this.open({itemId,...options});}
  commentOnText(itemId,anchor,options={}){return this.open({itemId,anchor:{...anchor,kind:'text'},...options});}
  reply(threadId){this.saveDraft();this.selectDraft({itemId:this.itemId,replyTo:threadId});this.textarea.focus({preventScroll:true});}
  async postDraft(){
    this.saveDraft();const d=this.draft;if(!d?.body.trim()||d.pending)return;d.pending=true;
    const type=d.replyTo?'replyComment':'addComment';d.attempt ||={operationId:crypto.randomUUID(),payload:d.replyTo?{threadId:d.replyTo,author:{...this.actor},body:d.body}:{boardId:d.boardId,...(d.itemId?{itemId:d.itemId}:{}),...(d.anchor?{anchor:d.anchor}:{}),author:{...this.actor},body:d.body}};this.postStatus('Posting…');
    try{
      const result=await this.client.write(type,d.attempt.payload,{operationId:d.attempt.operationId});this.drafts.delete(d.key);this.persistDrafts();
      if(this.draft===d){this.draft=null;this.selectDraft({itemId:this.itemId,fresh:true});this.postStatus('Posted');this.textarea.focus({preventScroll:true});}
      try{await this.refresh();await this.reload();await this.onCommitted({boardId:d.boardId,itemId:d.itemId,threadId:result.threadId||d.replyTo,kind:'comment'});}catch{this.postStatus('Posted. Refresh comments to see the latest conversation.');}
    }catch(error){if(this.draft===d)this.postStatus(error.message,true);throw error;}finally{d.pending=false;}
  }
  async resolve(threadId,resolved){try{await this.client.write('resolveComment',{threadId,resolved});await this.refresh();await this.reload();await this.onCommitted({boardId:this.getBoard().id,itemId:this.itemId,threadId,kind:'comment'});}catch(error){this.failure(error);}}
  async reload({more=false}={}){
    const request=++this.request,boardId=this.getBoard().id,itemId=this.visible?this.itemId:null,params=new URLSearchParams({boardId,includeBodies:'true',limit:'50'});
    if(itemId)params.set('itemId',itemId);if(this.onlyUnresolved)params.set('resolved','false');if(more&&this.nextCursor)params.set('cursor',this.nextCursor);
    const result=await this.client.get(`/api/feedback?${params}`);if(request!==this.request||boardId!==this.getBoard().id)return;this.client.revision=Math.max(this.client.revision,result.revision);this.threads=more?[...this.threads,...result.threads]:result.threads;this.nextCursor=result.nextCursor;this.loadedScope=`${boardId}/${itemId||'board'}`;this.status('');this.renderList();this.syncPins();
  }
  anchorLabel(t){return({point:t.anchor.relative?'Follows target':'Canvas point',matched:'Located',uncertain:'Source or context changed · review quote',stale:'Quote unlocated or ambiguous',detached:t.anchor.kind==='point'?'Target unavailable · original point':'Target unavailable',unverified:'Source unavailable or unsupported'})[t.anchorStatus]||'Source not checked';}
  renderList(){
    const list=this.panel.querySelector('.feedback-list'),history=this.panel.querySelector('.feedback-history'),scroll=history.scrollTop,active=document.activeElement,id=active?.closest('[data-feedback-thread]')?.dataset.feedbackThread,action=active?.dataset.feedbackReply?'data-feedback-reply':active?.dataset.feedbackResolve?'data-feedback-resolve':null;
    const html=this.threads.length?this.threads.map((t,i)=>`<article tabindex="-1" data-feedback-thread="${esc(t.id)}" class="feedback-thread ${t.resolved?'resolved':''}"><header><strong>${esc(t.author.label)}</strong><small>${new Date(t.createdAt).toLocaleDateString()}</small></header>${!this.itemId&&t.itemId?`<button type="button" class="feedback-context" data-feedback-item-scope="${esc(t.itemId)}">${esc(this.getBoard().items?.[t.itemId]?.title||'Item unavailable')}</button>`:''}${t.anchor?`<div class="feedback-anchor">${t.anchor.kind==='point'?`Point ${i+1}`:'Selected text'} · ${esc(this.anchorLabel(t))}${t.anchor.kind==='text'?`<q>${esc(t.anchor.quote)}</q>`:''}</div>`:''}<p class="feedback-body">${esc(t.body||t.excerpt)}</p>${(t.replies||[]).map(r=>`<div class="feedback-reply"><strong>${esc(r.author.label)}</strong><p class="feedback-body">${esc(r.body)}</p></div>`).join('')}<footer><button type="button" data-feedback-reply="${esc(t.id)}">Reply</button><button type="button" data-feedback-resolve="${esc(t.id)}" data-resolved="${t.resolved}">${t.resolved?'Reopen':'Resolve'}</button>${t.resolved?'<span>Resolved</span>':''}</footer></article>`).join(''):`<p class="feedback-empty">${this.onlyUnresolved?'No unresolved comments.':`Start the conversation about ${esc(this.getBoard().items?.[this.itemId]?.title||'this board')}.`}</p>`;
    this.panel.dataset.empty=String(this.threads.length===0);this.panel.dataset.short=String(!this.nextCursor&&list.scrollHeight<260);if(list.innerHTML!==html)list.innerHTML=html;this.queueSizing();this.panel.querySelector('[data-feedback-more]').hidden=!this.nextCursor;history.scrollTop=scroll;if(id&&action)list.querySelector(`[${action}="${CSS.escape(id)}"]`)?.focus({preventScroll:true});
  }
  // Where Tab out of the panel continues: its opener, else the item's Comments button or card, else the canvas.
  tabAnchor(){
    const shown=el=>el?.isConnected&&el.getClientRects().length&&!this.panel.contains(el)?el:null;
    const card=this.itemId?document.querySelector(`#world [data-item-feedback="${CSS.escape(this.itemId)}"]`):null;
    return shown(this.returnFocus)||shown(card)||shown(card?.closest('.workspace-card'))||shown(this.toggle)||document.getElementById('viewport');
  }
  focusThread(id){const el=[...this.panel.querySelectorAll('[data-feedback-thread]')].find(e=>e.dataset.feedbackThread===id);el?.focus({preventScroll:true});el?.scrollIntoView({block:'nearest'});}
  showsVote(itemId){return hasVotes(this.getBoard().items?.[itemId]?.review?.votes)||!!(this.ballot&&this.ballotId===itemId);}
  voteState(itemId){const votes=this.getBoard().items?.[itemId]?.review?.votes;return{mine:votes?.[this.actor.id]?.value||null,totals:voteTotals(votes),pending:this.voting.has(itemId)};}
  ballotPopup(){
    if(this.ballotUI)return this.ballotUI;
    const ui=this.ballotUI=sharedPopover({id:'feedback-ballot-popover',className:'feedback-ballot'});
    const {root,content}=ui;content.setAttribute('initial-focus','none');content.setAttribute('final-focus','none');
    for(const [name,value] of [['side','bottom'],['align','start'],['side-offset','8'],['collision-padding','8']])content.setAttribute(name,value);
    content.tabTrigger=()=>this.ballotAnchor?.isConnected?this.ballotAnchor:null;
    content.addEventListener('click',e=>{if(e.target.closest('[data-ballot-close]'))this.closeVote();if(e.target.closest('[data-feedback-vote=clear]'))this.vote(this.ballotId,null).catch(()=>{});});
    root.addEventListener('openchange',e=>{
      if(e.detail.value)return;
      // The Vote button that opened it counts as part of it: a press there toggles it shut through that button's own click.
      if(['outside-press','focus-out'].includes(e.detail.reason)&&e.detail.event?.target instanceof Node&&this.ballotAnchor?.contains?.(e.detail.event.target)){e.preventDefault();return;}
      const restore=['escape-key','close-press'].includes(e.detail.reason)||(e.detail.reason==='imperative'&&this.ballotRestore);
      this.ballotClosed(restore);
    });
    // Focus starts on the user's vote, else on Yes (the group's one Tab stop).
    root.addEventListener('openchangecomplete',e=>{if(e.detail.value&&this.ballot&&!this.ballot.contains(document.activeElement))this.focusBallot();});
    return ui;
  }
  focusBallot(){const group=this.ballot?.querySelector('.feedback-ballot-choices');if(!group)return;const run=()=>(group.querySelector('button[aria-pressed=true]')||group.querySelector('button'))?.focus({preventScroll:true});if(group.querySelector('ui-toggle[data-slot]'))run();else queueMicrotask(run);}
  openVote({itemId,anchor,host,returnFocus}={}){
    // Vote pressed again while its ballot is open closes it.
    if(this.ballot&&this.ballotId===itemId&&this.ballotAnchor===anchor){this.closeVote();return;}
    this.closeVote({restoreFocus:false});if(this.visible)this.close({restoreFocus:false});if(!this.getBoard().items?.[itemId])return;
    const ui=this.ballotPopup();this.host(ui.root,host||anchor);
    this.ballotId=itemId;this.ballotAnchor=anchor;anchor?.setAttribute('aria-expanded','true');this.ballotReturn=returnFocus||anchor;this.ballotRestore=true;this.ballotMessage='';
    this.ballot=ui.content;this.ballot.setAttribute('aria-label',`Vote on ${this.getBoard().items[itemId].title}`);this.ballot.innerHTML='';this.renderBallot();
    const selector=`[data-item-vote="${CSS.escape(itemId)}"]`;
    ui.root.api.open({anchor:{getBoundingClientRect:()=>((anchor?.isConnected&&anchor.getClientRects().length?anchor:null)||document.querySelector(selector)||anchor||document.body).getBoundingClientRect()}});
    this.focusBallot();
  }
  // Built once per opening, then updated in place (counts, the user's vote, pending, status), so focus stays on the choice.
  renderBallot(){
    if(!this.ballot)return;const{mine,totals,pending}=this.voteState(this.ballotId),item=this.getBoard().items?.[this.ballotId];
    if(!this.ballot.querySelector('.feedback-ballot-choices')){
      this.ballot.innerHTML=`<header><strong>Vote</strong><button type="button" data-ballot-close aria-label="Close vote">×</button></header><p class="feedback-ballot-title"></p>${choiceHTML({label:'Your vote',className:'feedback-ballot-choices',value:mine||undefined,items:['yes','no','abstain'].map(v=>({value:v,html:`${capital(v)}<span data-vote-count></span>`,attrs:{'data-feedback-vote':v}}))})}<footer><span data-ballot-as></span><button type="button" data-feedback-vote="clear">Clear vote</button></footer><p class="feedback-ballot-status" role="status"></p>`;
      onChoose(this.ballot.querySelector('.feedback-ballot-choices'),value=>{if(value)this.vote(this.ballotId,value).catch(()=>{});else this.renderBallot();});
    }
    this.ballot.querySelector('.feedback-ballot-title').textContent=item?.title||'Item';
    const group=this.ballot.querySelector('.feedback-ballot-choices');setChoice(group,mine);
    for(const v of ['yes','no','abstain']){const b=group.querySelector(`[data-feedback-vote="${v}"]`);b.querySelector('[data-vote-count]').textContent=String(totals[v]);b.setAttribute('aria-label',`${capital(v)}, ${totals[v]} ${totals[v]===1?'vote':'votes'}`);}
    group.setAttribute('aria-busy',String(pending));
    const clear=this.ballot.querySelector('[data-feedback-vote=clear]'),had=clear===document.activeElement;clear.disabled=!mine||pending;
    // Clear vote goes inert once there is nothing to clear: focus moves to the choice rather than to the page.
    if(clear.disabled&&had)this.focusBallot();
    this.ballot.querySelector('[data-ballot-as]').textContent=`As ${this.actor.label}`;
    const status=this.ballot.querySelector('.feedback-ballot-status');if(status.textContent!==(this.ballotMessage||''))status.textContent=this.ballotMessage||'';
  }
  positionBallot(){this.ballotUI?.root.api?.reposition?.();}
  closeVote({restoreFocus:restore=true}={}){if(!this.ballot)return;this.ballotRestore=restore;if(this.ballotUI.root.api?.isOpen())this.ballotUI.root.api.close();else this.ballotClosed(restore);}
  ballotClosed(restore){
    if(!this.ballot)return;this.ballot=null;this.ballotAnchor?.setAttribute('aria-expanded','false');this.ballotMessage='';this.wantVote=undefined;this.syncVoteTriggers();
    if(restore&&(!document.activeElement||document.activeElement===document.body||this.ballotUI.content.contains(document.activeElement)))restoreFocus(this.ballotReturn);
  }
  async vote(itemId,value){
    // A choice made while the last one saves waits for it; the latest choice wins.
    if(this.voting.has(itemId)){this.wantVote=value;this.renderBallot();return;}
    if(this.voteState(itemId).mine===value){this.renderBallot();return;}
    this.voting.add(itemId);this.wantVote=undefined;this.ballotMessage='Saving vote…';this.renderBallot();this.syncVoteTriggers();
    try{await this.client.write('vote',{itemId,actor:{...this.actor},value});await this.refresh();this.ballotMessage='Vote saved';}catch(error){this.ballotMessage=error.message;throw error;}finally{this.voting.delete(itemId);this.renderBallot();this.syncVoteTriggers();this.onVotesChanged?.();}
    if(this.wantVote!==undefined&&this.ballot&&this.ballotId===itemId){const next=this.wantVote;this.wantVote=undefined;return this.vote(itemId,next);}
  }
  syncVoteTriggers(){
    for(const b of document.querySelectorAll('[data-item-vote]')){const itemId=b.dataset.itemVote,item=this.getBoard().items?.[itemId];if(!item)continue;const{mine,totals,pending}=this.voteState(itemId),label=`Vote on ${item.title}${mine?`; your vote: ${mine}`:''}. Yes ${totals.yes}, No ${totals.no}, Abstain ${totals.abstain}`;b.setAttribute('aria-pressed',String(Boolean(mine)));b.setAttribute('aria-label',label);setTip(b,label);b.dataset.voteValue=mine||'';b.disabled=pending;if(b.classList.contains('workspace-vote-trigger'))b.hidden=!this.showsVote(itemId);const text=b.querySelector('[data-vote-summary]');if(text)text.textContent=mine?capital(mine):'Vote';}
  }
  async annotationAction(type,itemId,detail,options={}){
    const key=JSON.stringify({type,itemId,...detail});let action=this.annotationActions.get(key);if(action?.pending)return;
    action ||= {operationId:crypto.randomUUID(),payload:{itemId,...detail,...(type==='addHighlight'?{author:{...this.actor}}:{})}};action.pending=true;this.annotationActions.set(key,action);
    try{const result=await this.client.write(type,action.payload,{operationId:action.operationId});this.annotationActions.delete(key);await Promise.resolve(this.onCommitted({boardId:this.getBoard().id,itemId,kind:'highlight',...result})).catch(()=>{});options.onSuccess?.(result);return result;}catch(error){options.onError?.(error);throw error;}finally{action.pending=false;}
  }
  highlightOnText(itemId,anchor,options={}){return this.annotationAction('addHighlight',itemId,{anchor},options);}
  removeHighlight(itemId,highlightId,options={}){return this.annotationAction('removeHighlight',itemId,{highlightId},options);}
  syncPins(overrides){
    if(!this.layer||!this.world)return;
    // The Comment tool's pin layer (.comment-pins, from the board) replaces these numbered pins.
    if(document.querySelector('.comment-pins')){this.layer.hidden=true;this.layer.replaceChildren();return;}
    this.layer.hidden=!this.pinsVisible||this.getMode()!=='canvas';if(this.layer.parentNode!==this.world)this.world.append(this.layer);const origin=this.getOrigin()||{x:0,y:0};
    this.layer.innerHTML=this.threads.map((t,i)=>{if(t.anchor?.kind!=='point')return '';const p=resolveCommentPoint(t.anchor,this.getBoard(),overrides);return`<button type="button" class="feedback-pin ${t.resolved?'resolved':''} ${p.detached?'detached':''}" data-feedback-pin="${esc(t.id)}" style="left:${p.x+origin.x}px;top:${p.y+origin.y}px" aria-label="Comment ${i+1}${p.detached?' · target unavailable; original point':''}: ${esc((t.body||t.excerpt||'').slice(0,80))}">${i+1}</button>`;}).join('');
    for(const pin of this.layer.querySelectorAll('[data-feedback-pin]'))pin.onclick=e=>{e.stopPropagation();this.open({itemId:this.itemId,threadId:pin.dataset.feedbackPin,returnFocus:pin});};
  }
  sync(overrides){this.syncPins(overrides);this.syncVoteTriggers();if(this.visible)this.renderScope();}
  destroy(){cancelAnimationFrame(this.sizingFrame);this.formBinding?.destroy();window.removeEventListener('click',this.clickHandler,true);window.removeEventListener('pointerdown',this.pointHandler,true);window.removeEventListener('pointerdown',this.outsideHandler,true);window.removeEventListener('keydown',this.keyHandler,true);window.removeEventListener('resize',this.repositionHandler);window.visualViewport?.removeEventListener('resize',this.repositionHandler);this.closeVote({restoreFocus:false});document.removeEventListener('tinka:points-shown',this.pointsShown);this.optionsUI?.root.remove();this.nameUI?.root.remove();this.ballotUI?.root.remove();this.panel?.remove();this.layer?.remove();this.toggle?.remove();}
}
