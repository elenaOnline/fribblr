import './vendor/ui-sdk/web/popover.js';
import {bindForm, commitShortcutLabel, restoreFocus, setCommitHint} from './interaction.js';

// Menus and note editors live in viewport space, independent of canvas zoom.
export function positionTilePopover(element, anchor, point) {
  // Establish the final layout context before measuring. A newly appended menu
  // is otherwise a full-width flex child, then shrinks once it becomes fixed.
  Object.assign(element.style, {position:'fixed',left:'0px',top:'0px'});
  const {width,height}=element.getBoundingClientRect(), box=anchor?.getBoundingClientRect();
  const margin=8,gap=6;
  let x=point?point.x:(box?.right??margin)-width;
  let y=point?point.y:(box?.bottom??margin)+gap;
  if(point && x+width>innerWidth-margin)x=point.x-width;
  if(y+height>innerHeight-margin)y=(point?point.y:box?.top??margin)-height-(point?0:gap);
  x=Math.max(margin,Math.min(innerWidth-width-margin,x));
  y=Math.max(margin,Math.min(innerHeight-height-margin,y));
  Object.assign(element.style,{left:`${x}px`,top:`${y}px`});
}

export function bindTileMenu(menu, {close, returnFocus, anchor}) {
  const origin=anchor?.getBoundingClientRect();
  const moved=event=>{
    if(menu.contains(event.target))return;
    const current=anchor?.getBoundingClientRect();
    // A queued scroll notification from revealing the invoker can arrive after
    // opening. Close only for a new gesture or an actually moved anchor.
    if(event.type==='wheel'||!origin||!anchor?.isConnected||Math.abs(current.x-origin.x)>.5||Math.abs(current.y-origin.y)>.5)close();
  };
  document.addEventListener('wheel',moved,{capture:true,passive:true});
  document.addEventListener('scroll',moved,true);
  window.addEventListener('resize',close);

  menu.addEventListener('keydown', event => {
    const entries = [...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const index = entries.indexOf(document.activeElement);
    if (event.key === 'Escape') {event.preventDefault(); event.stopImmediatePropagation(); close(); restoreFocus(returnFocus);}
    else if (event.key === 'Tab') {close();restoreFocus(returnFocus);}
    else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length-1 : (index+(event.key === 'ArrowDown' ? 1 : -1)+entries.length)%entries.length;
      entries[next]?.focus({preventScroll:true});
    }
  });
  menu.querySelector('[role="menuitem"]:not(:disabled)')?.focus({preventScroll:true});
  return {destroy(){document.removeEventListener('wheel',moved,true);document.removeEventListener('scroll',moved,true);window.removeEventListener('resize',close);}};
}

// The tile notes editor: a UI SDK ui-popover (non-modal), anchored to the control that opened it, in the body so card
// handlers never hear it. Enter-free: Cmd/Ctrl+Enter saves (bindForm); Escape or any other way out keeps the draft and
// returns focus; Cancel discards the draft. Saving holds the popover open.
export class TileNotes {
  constructor({read, save, discard = async()=>{}, draftKey}) {this.read=read;this.save=save;this.discard=discard;this.draftKey=draftKey;this.drafts=new Map();}
  // Everything that ends an open editor: draft kept or dropped, listeners and form binding released. Safe to run twice.
  teardown({cancel=false}={}) {
    if (!this.element) return false;
    const {key}=this;
    if (cancel) {this.drafts.delete(key);try{localStorage.removeItem(this.draftKey(key));}catch{}}
    else this.remember();
    this.binding.destroy();this.element=null;this.anchorMark?.removeAttribute('data-note-anchor');
    window.removeEventListener('resize',this.reposition);
    document.removeEventListener('wheel',this.viewMoved,true);document.removeEventListener('scroll',this.viewMoved,true);
    return true;
  }
  close({cancel=false, focus=false}={}) {
    if (!this.element || this.binding.pending) return false;
    this.teardown({cancel});
    this.root.api.close();
    if(focus)restoreFocus(this.invoker);
    return true;
  }
  async cancel({focus=true}={}) {
    if(!this.element || this.binding.pending)return;
    const key=this.key;
    this.close({cancel:true,focus});
    const refresh=Promise.resolve().then(()=>this.discard(key)).catch(()=>{});
    this.cancelPromise=refresh;
    await refresh;
    if(this.cancelPromise===refresh)this.cancelPromise=null;
  }
  remember() {
    const value=this.field.value;
    if(value===this.read(this.key)){this.drafts.delete(this.key);try{localStorage.removeItem(this.draftKey(this.key));}catch{}}
    else {this.drafts.set(this.key,value);try{localStorage.setItem(this.draftKey(this.key),value);}catch{}}
  }
  async open({key,title,anchor}) {
    if(this.cancelPromise)await this.cancelPromise;
    if(this.element && !this.close())return;
    // A popover still animating out never sits beside the new one.
    this.root?.remove();
    this.key=key;
    const attribute=anchor?.matches('[data-item-controls]')?'data-item-controls':anchor?.matches('[data-legacy-menu]')?'data-legacy-menu':'data-tile-notes';
    const controlId=anchor?.getAttribute(attribute);
    this.invoker=()=>controlId?document.querySelector(`[${attribute}="${CSS.escape(controlId)}"]`)||anchor:anchor;
    const root=document.createElement('ui-popover');
    root.innerHTML='<ui-popover-content class="tile-notes" side="bottom" align="end" side-offset="6" collision-padding="8" initial-focus="textarea" hidden><form><header><strong>Notes</strong><ui-popover-close><button type="button" data-note-close aria-label="Close notes">×</button></ui-popover-close></header><textarea name="note" data-tile-note aria-label="Note"></textarea><div class="tile-note-actions"><small></small><button type="button" data-note-cancel>Cancel</button><button type="submit" class="tk-btn tk-primary">Save note</button></div><p data-form-status role="status"></p></form></ui-popover-content>';
    const content=root.querySelector('ui-popover-content'),form=content.querySelector('form');
    content.setAttribute('aria-label',`Notes on ${title}`);
    const mark=this.invoker();
    if(mark){mark.setAttribute('data-note-anchor','');content.setAttribute('anchor','[data-note-anchor]');this.anchorMark=mark;}
    const field=form.querySelector('textarea');field.setAttribute('aria-label',`Notes on ${title}`);field.setAttribute('aria-keyshortcuts','Meta+Enter Control+Enter');
    let draft=this.drafts.get(key);try{draft??=localStorage.getItem(this.draftKey(key))??undefined;}catch{}
    field.value=draft??this.read(key);this.field=field;this.element=content;this.root=root;
    setCommitHint(form.querySelector('small'), 'save');
    let saved=false;
    this.binding=bindForm(form,{submit:async()=>{await this.save(key,field.value);},onSuccess:()=>{saved=true;},onError:error=>{this.remember();const status=form.querySelector('[data-form-status]');status.textContent=error.message||'Note not saved. Try again.';status.setAttribute('role','alert');},onPendingChange:pending=>{field.readOnly=pending;form.querySelectorAll('[data-note-close],[data-note-cancel]').forEach(b=>b.disabled=pending);if(!pending&&saved)this.close({cancel:true,focus:true});}});
    form.querySelector('[data-note-cancel]').onclick=()=>this.cancel({focus:true});
    field.oninput=()=>this.remember();
    // Ways out the popover owns (Escape, a press outside, Tab out, the close key): the draft is kept; a save in flight refuses them.
    root.addEventListener('openchange',event=>{
      if(event.detail.value)return;
      if(this.binding?.pending){event.preventDefault();return;}
      if(this.root===root&&this.element===content){this.teardown();if(['escape-key','close-press'].includes(event.detail.reason))this.returnFocus=true;}
    });
    root.addEventListener('openchangecomplete',event=>{
      if(event.detail.value)return;
      root.remove();
      if(this.root===root&&this.returnFocus){this.returnFocus=false;restoreFocus(this.invoker);}
    });
    let origin;
    this.reposition=()=>{origin=this.invoker()?.getBoundingClientRect();};
    this.viewMoved=event=>{
      if(content.contains(event.target))return;
      const control=this.invoker(),current=control?.getBoundingClientRect();
      if(event.type==='wheel'||!origin||!control?.isConnected||Math.abs(current.x-origin.x)>.5||Math.abs(current.y-origin.y)>.5)this.close();
    };
    document.body.append(root);this.reposition();window.addEventListener('resize',this.reposition);
    document.addEventListener('wheel',this.viewMoved,{capture:true,passive:true});document.addEventListener('scroll',this.viewMoved,true);
    root.api.open();
  }
}
