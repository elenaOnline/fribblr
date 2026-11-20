// Headless checks for the board fixes found by round 2's review (team/ux/r2/review/REVIEW.md), on UI SDK's norms
// (public/ui-sdk.md § Board canvas, § Popups):
// - focus follows a press: a press on any board item (card, Text block, shape, arrow, sticker, container member) makes
//   it the focused item, so Option-arrow moves what was pressed, never an item focused earlier;
// - with nothing selected, board commands (⌘I, ⌘D, E) act on the focused item, as its menu advertises;
// - what the app creates and selects (⌘D, ⌘C ⌘V, an Option-drag copy) takes focus, so Option-arrow moves the copy;
// - C, then Enter on the focused item, places a comment there; Escape disarms;
// - Tab past the drawn-object bar or any of its panels goes on to the board's focused item, never to <body>;
// - the bar's panels start on their checked option, or on their first control (never on ×), with no tooltip there, so
//   one Escape closes them;
// - in a popover, arrows don't walk between controls (Tab does), and a slider's arrows stay the slider's;
// - the reader's path menu marks the current place with aria-current, not with the highlight's look.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from '../cli.mjs';
import {loadConfig} from '../lib/config.mjs';
import {applyOperation} from '../lib/workspace.mjs';
import {listen,closeAppServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=await mkdtemp(path.join(os.tmpdir(),'tinka-board-fixes-'));
const evidence=process.env.TINKA_EVIDENCE_DIR||await mkdtemp(path.join(os.tmpdir(),'tinka-board-fixes-evidence-'));await mkdir(evidence,{recursive:true});
let server,browser,checks=0;const errors=[];
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
try{
 const file=path.join(root,'config.json');await main(['init','--config',file,'--boards',path.join(root,'boards'),'--label','Fixes studio']);const config=await loadConfig(file);
 const op=async(type,fields)=>(await applyOperation(config,{type,...fields})).result;
 await op('createBoard',{id:'fixes',title:'Fixes'});
 const add=async(title,x,y)=>(await op('createItem',{boardId:'fixes',item:{title,content:{kind:'note',text:`${title}.`}},placement:{x,y,width:240,height:160}})).placementIds[0];
 const c={};
 c.a=await add('Card A',0,0);c.b=await add('Card B',300,0);c.m=await add('Member card',0,640);
 const assets=path.join(config.boardsRoot,'assets');await mkdir(assets);await writeFile(path.join(assets,'doc.md'),'# A document\n\nSome text.\n');
 await op('updateWorkspace',{patch:{resourceRoots:{assets:{path:'../assets'}}}});
 c.doc=(await op('createItem',{boardId:'fixes',item:{title:'A document',content:{kind:'markdown',resource:{rootId:'assets',path:'doc.md'}}},placement:{x:900,y:0,width:320,height:240,presentation:{mode:'card'}}})).placementIds[0];
 const text=(id,body,x,y)=>({id,type:'text',x,y,width:220,height:60,text:body,color:'#456139'});
 for(const decoration of [
   text('words','Some words',0,240),
   {id:'shape',type:'region',shape:'diamond',x:300,y:240,width:200,height:120,text:'A shape',color:'palette:gold'},
   {id:'arrow',type:'line',x:600,y:40,width:240,height:120,color:'palette:blue',text:'',endArrow:true,from:{x:600,y:40},to:{x:840,y:160}},
   {id:'rocket',type:'text',text:'🚀',sticker:true,x:600,y:260,width:112,height:112,color:'palette:neutral'},
   text('one','One',0,0),text('two','Two',0,0),
   {id:'box',type:'region',x:0,y:420,width:560,height:420,text:'Box',color:'#dbe5d3',container:{layout:'vertical',children:['one','two',{placementId:c.m}]}},
 ]) await op('createDecoration',{boardId:'fixes',decoration});

 server=await listen(config,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,args:['--mute-audio'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'light',reducedMotion:'reduce'});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const mod=process.platform==='darwin'?'Meta':'Control';
 const open=async(board='fixes')=>{await page.goto(`${base}/boards/${board}/`,{waitUntil:'load'});await page.locator('.workspace-card').first().waitFor();await page.waitForTimeout(400);await page.locator('#fit').click();await page.waitForTimeout(300);};
 await open();
 const focused=()=>page.evaluate(()=>{const a=document.activeElement;return a?.dataset?.placement?`card:${a.getAttribute('aria-label')}`:a?.dataset?.decoration?`drawn:${a.dataset.decoration}`:a===document.body?'BODY':a?.id||a?.getAttribute?.('aria-label')||a?.tagName;});
 const snapshot=async()=>(await fetch(`${base}/api/boards/fixes`)).json();
 const placement=async id=>(await snapshot()).placements.find(p=>p.id===id);
 const decoration=async id=>(await snapshot()).decorations.find(d=>d.id===id);
 const until=async(fn,ms=3000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,40));}return fn();};
 const idle=()=>page.waitForFunction(()=>document.getElementById('workspace-paste')?.disabled===false&&!document.querySelector('.whiteboard-bar-status'));
 // A point on an item that hits the item itself (not a button or field inside it).
 const pointOn=sel=>page.evaluate(sel=>{
   const e=document.querySelector(sel);if(!e)return null;
   const hit=e.querySelector('.whiteboard-line-hit');
   if(hit){const m=hit.getScreenCTM(),q=hit.getPointAtLength(hit.getTotalLength()*.35);return {x:q.x*m.a+m.e,y:q.y*m.d+m.f};}
   const r=e.getBoundingClientRect();
   for(let fy=.5;fy>.02;fy-=.08)for(const fx of [.5,.3,.7,.15,.85]){
     const x=r.left+r.width*fx,y=r.top+r.height*fy,t=document.elementFromPoint(x,y);
     if(t&&e.contains(t)&&!t.closest('button,a,input,[role=button],[contenteditable],iframe')&&t.closest('[data-decoration],[data-placement]')===e)return {x,y};
   }
   return null;
 },sel);
 const pressOn=async sel=>{const p=await pointOn(sel);ok(p,`${sel} has a point to press`);await page.mouse.click(p.x,p.y);await page.waitForTimeout(200);};
 const clear=async()=>{for(let i=0;i<3;i++){await page.keyboard.press('Escape');await page.waitForTimeout(60);}};

 // ---- 1. Focus follows a press, for every kind of board item. ----
 const where=async ref=>{const v=ref.startsWith('placement')?await placement(ref):await decoration(ref);return v.type==='line'?v.from.x:v.x;};
 for(const [label,sel,ref] of [
   ['a Text block','#world [data-decoration="words"]','words'],
   ['a shape','#world [data-decoration="shape"]','shape'],
   ['an arrow','#world [data-decoration="arrow"]','arrow'],
   ['a sticker','#world [data-decoration="rocket"]','rocket'],
   ['a card',`#world [data-placement="${c.a}"]`,c.a],
   ['a drawn container member','#world [data-decoration="two"]','two'],
   ['a card container member',`#world [data-placement="${c.m}"]`,c.m],
 ]){
   await clear();await idle();
   await page.locator(`#world [data-placement="${c.b}"]`).focus();
   await pressOn(sel);
   eq(await focused(),ref.startsWith('placement')?`card:${(await page.locator(sel).getAttribute('aria-label'))}`:`drawn:${ref}`,`A press on ${label} focuses it`);
   if(ref==='two'||ref===c.m)continue; // Option-arrow on a member reorders (canvas-keyboard-browser covers it)
   const b0=await placement(c.b),x0=await where(ref);
   await page.keyboard.press('Alt+ArrowRight');
   ok(await until(async()=>(await where(ref))===x0+1),`Option-→ after a press moves ${label}, what was pressed`);
   eq((await placement(c.b)).x,b0.x,`and not the card focused earlier (${label})`);
   await idle();
 }
 // A press on the empty canvas takes focus off the items.
 await page.locator(`#world [data-placement="${c.b}"]`).focus();
 {const r=await page.locator('#viewport').boundingBox();await page.mouse.click(r.x+r.width-80,r.y+r.height/2);await page.waitForTimeout(200);}
 eq(await focused(),'viewport','A press on the empty canvas takes focus to the canvas');

 // ---- 2. With nothing selected, board commands act on the focused item; with a selection, on the selection. ----
 await clear();await idle();
 const cardCount=async()=>(await snapshot()).placements.filter(p=>!p.removedAt&&!p.deletedAt).length;
 const selectedCards=()=>page.evaluate(()=>[...document.querySelectorAll('#world .workspace-card.selected')].map(c=>c.getAttribute('aria-label')).sort());
 const focusCard=async id=>{await page.locator(`#world .workspace-card[data-placement="${id}"]`).focus();await page.waitForTimeout(80);};
 await focusCard(c.b);eq(await selectedCards(),[],'Card B has focus and nothing is selected');
 await page.keyboard.press(`${mod}+i`);
 ok(await until(async()=>(await page.locator('#workspace-item-controls').getAttribute('aria-label'))==='Details of Card B'),'⌘I opens the focused card\'s Details, as its menu advertises');
 eq(await page.locator('#board-info[data-open]').count(),0,'and not the board Inspector');
 // 8. Every row of the item Inspector keeps the panel's inset: the sections sit in its body, none after it.
 eq(await page.evaluate(()=>{const panel=document.getElementById('workspace-item-controls'),body=panel.querySelector('.calm-side-body'),left=el=>Math.round(el.getBoundingClientRect().left);
   const rows=[...panel.querySelectorAll('.inspector-sec,.inspector-paper,.inspector-props dt,.inspector-acts .tk-mi')];
   return {outside:rows.filter(el=>!body.contains(el)).length,insets:[...new Set(rows.map(left))].length};}),{outside:0,insets:1},'The item Inspector\'s rows (Paper color, Details, actions) share one inset inside its body');
 await page.keyboard.press('Escape');
 ok(await until(async()=>(await focused())==='card:Card B'),`Escape from those Details returns focus to the card: ${await focused()}`);
 {const n=await cardCount();await focusCard(c.b);await page.keyboard.press(`${mod}+d`);
  ok(await until(async()=>(await cardCount())===n+1),'⌘D duplicates the focused card');
  // 9. What the app creates and selects takes focus: Option-arrow then moves the copy, never the original.
  const copy=await until(()=>page.evaluate(b=>{const a=document.activeElement;return a?.dataset?.placement&&a.dataset.placement!==b&&a.classList.contains('selected')?a.dataset.placement:null;},c.b));
  ok(copy,`After ⌘D the selected copy has focus: ${await focused()}`);
  const b0=await placement(c.b),k0=await placement(copy);await idle();
  await page.keyboard.press('Alt+ArrowRight');
  ok(await until(async()=>(await placement(copy)).x===k0.x+1),'Option-→ after ⌘D moves the copy');
  eq((await placement(c.b)).x,b0.x,'and not the original');}
 await clear();await idle();
 // Copy and paste, and an Option-drag copy, of drawn elements: the new one is selected and focused.
 const fresh=async(before)=>until(()=>page.evaluate(before=>{const a=document.activeElement,id=a?.dataset?.decoration;return id&&!before.includes(id)&&a.classList.contains('selected')?id:null;},before));
 {const before=(await snapshot()).decorations.map(d=>d.id);await pressOn('#world [data-decoration="words"]');
  await page.keyboard.press(`${mod}+c`);await page.waitForTimeout(150);await page.keyboard.press(`${mod}+v`);
  const pasted=await fresh(before);ok(pasted,`After ⌘C ⌘V the pasted Text block has focus: ${await focused()}`);
  const w0=await decoration('words'),p0=await decoration(pasted);await idle();
  await page.keyboard.press('Alt+ArrowRight');
  ok(await until(async()=>(await decoration(pasted)).x===p0.x+1),'Option-→ after a paste moves the pasted block');
  eq((await decoration('words')).x,w0.x,'and not the one copied');}
 await clear();await idle();
 {const before=(await snapshot()).decorations.map(d=>d.id),start=await pointOn('#world [data-decoration="shape"]');
  await page.mouse.move(start.x,start.y);await page.keyboard.down('Alt');await page.mouse.down();
  for(let i=1;i<=8;i++){await page.mouse.move(start.x+i*12,start.y+i*10);await page.waitForTimeout(25);}
  await page.mouse.up();await page.keyboard.up('Alt');
  const dropped=await fresh(before);ok(dropped,`After an Option-drag copy the copy has focus: ${await focused()}`);
  const s0=await decoration('shape'),d0=await decoration(dropped);await idle();
  await page.keyboard.press('Alt+ArrowRight');
  ok(await until(async()=>(await decoration(dropped)).x===d0.x+1),'Option-→ after an Option-drag copy moves the copy');
  eq((await decoration('shape')).x,s0.x,'and not the original');}
 // Put the board back for the checks below: two undos per copy (its move, then the copy).
 for(let i=0;i<6;i++){await idle();await page.keyboard.press(`${mod}+z`);await page.waitForTimeout(250);}
 await idle();
 await clear();await idle();
 {await focusCard(c.a);
  const sent=page.waitForRequest(r=>r.url().endsWith('/api/operations')&&r.postDataJSON()?.type==='restackOccurrences',{timeout:3000});
  await page.keyboard.press(']');
  eq(await sent.then(r=>r.postDataJSON().placementIds).catch(()=>null),[c.a],'] brings the focused card to the front');
  ok(await until(async()=>(await focused())==='card:Card A'),'Focus stays on it');}
 await clear();await idle();
 await focusCard(c.doc);await page.keyboard.press('e');
 ok(await until(()=>page.evaluate(()=>!!document.activeElement?.contentDocument?.activeElement?.isContentEditable)),'E edits the focused document');
 await page.keyboard.press('Escape');await page.waitForTimeout(400);await clear();await idle();
 // With a selection, the commands act on the selection, not on the focused card.
 await focusCard(c.a);await page.keyboard.press('Space');await focusCard(c.b);
 await page.keyboard.press(`${mod}+i`);
 ok(await until(async()=>(await page.locator('#workspace-item-controls').getAttribute('aria-label'))==='Details of Card A'),'With a selection, ⌘I opens the selected card\'s Details');
 await page.keyboard.press('Escape');await clear();await idle();
 // Delete never removes an item that only has focus; it says how instead.
 {const n=await cardCount();await focusCard(c.b);await page.keyboard.press('Delete');await page.waitForTimeout(300);
  eq(await page.locator('ui-alert-dialog-content[data-open]').count(),0,'Delete on an unselected focused card asks nothing');
  eq(await cardCount(),n,'and removes nothing');
  ok((await page.locator('[aria-live]').allTextContents()).join(' ').includes('Nothing is selected. Press Space to select Card B, then Delete.'),'It says how to remove it');}
 await clear();

 // ---- 3. C arms Comment; Enter on the focused item (or the focused canvas) places the pin there. ----
 const threadCard=()=>page.locator('.ct-card[data-open]');
 const armed=()=>page.evaluate(()=>document.getElementById('viewport').classList.contains('comment-armed'));
 for(const [label,sel,target] of [['a card',`#world .workspace-card[data-placement="${c.b}"]`,'Card B'],['an arrow','#world [data-decoration="arrow"]','Arrow'],['a Text block','#world [data-decoration="words"]','Text · Some words']]){
   await page.locator(sel).focus();await page.keyboard.press('c');ok(await until(armed),`C arms the Comment tool (${label})`);
   ok(await until(async()=>(await page.locator('.comment-target-tag').textContent().catch(()=>''))===`On ${target}`),`The focused ${label} is marked as the target`);
   await page.keyboard.press('Enter');
   ok(await until(async()=>await threadCard().count()===1),`Enter on ${label} opens a new comment on it`);
   ok((await threadCard().textContent()).includes(`On ${target}`),`The new comment is on ${label}`);
   eq(await page.locator('#reader-dialog[open]').count(),0,'Enter does not open the item while Comment is armed');
   ok(await until(()=>page.evaluate(()=>!!document.activeElement?.closest('.ct-card'))),'Focus is in the comment');
   ok(!(await armed()),'Placing disarms the tool');
   await page.keyboard.press('Escape');ok(await until(async()=>await threadCard().count()===0),'Escape closes the new comment');
   ok(await until(async()=>(await focused())===(sel.includes('placement')?`card:${target}`:`drawn:${sel.match(/"(.+)"/)[1]}`)),`Focus returns to ${label}: ${await focused()}`);
 }
 // On the focused canvas, Enter places it on the board.
 await page.locator('#viewport').focus();await page.keyboard.press('c');await until(armed);await page.keyboard.press('Enter');
 ok(await until(async()=>await threadCard().count()===1),'Enter on the focused canvas opens a new comment on the board');
 await page.keyboard.press('Escape');ok(await until(async()=>await threadCard().count()===0),'Escape closes it');
 // Escape disarms without placing anything.
 await page.locator(`#world .workspace-card[data-placement="${c.a}"]`).focus();await page.keyboard.press('c');await until(armed);
 await page.keyboard.press('Escape');ok(await until(async()=>!(await armed())),'Escape disarms the Comment tool');
 eq(await focused(),'card:Card A','Focus stays on the card');
 await page.keyboard.press('Enter');await page.locator('#reader-dialog[open]').waitFor();ok(true,'Disarmed, Enter opens the card again');
 await page.keyboard.press('Escape');await page.locator('#reader-dialog').waitFor({state:'hidden'});await clear();

 // ---- 4. Tab past the drawn-object bar, or out of any of its panels, goes back to the object it edits. ----
 const select=async id=>{await clear();await idle();await page.locator(`#world [data-decoration="${id}"]`).focus();await page.keyboard.press('Space');await page.locator('.whiteboard-toolbar:not([hidden])').waitFor();await page.waitForTimeout(150);};
 const barStop=()=>page.evaluate(()=>{const b=document.querySelector('.whiteboard-toolbar:not([hidden])');const stop=[...b.querySelectorAll('button')].find(x=>x.tabIndex===0)||b.querySelector('button');stop.focus();return stop.getAttribute('aria-label');});
 const inPanel=()=>page.evaluate(()=>!!document.activeElement?.closest('.whiteboard-menu,ui-popover-content'));
 const panelStarts={};
 for(const id of ['words','arrow','shape']){
   await select(id);await barStop();await page.keyboard.press('Tab');
   eq(await focused(),`drawn:${id}`,`Tab past the bar goes back to the object it edits (${id}), not to <body>`);
   const triggers=await page.evaluate(()=>[...document.querySelectorAll('.whiteboard-toolbar:not([hidden]) [aria-haspopup="dialog"]')].map(b=>[b.dataset.whiteboardAction,b.getAttribute('aria-label')]));
   ok(triggers.length,`The bar for ${id} has panels`);
   for(const [action,label] of triggers){
     if(!(await page.locator('.whiteboard-toolbar:not([hidden])').count()))await select(id);
     await page.locator(`.whiteboard-toolbar:not([hidden]) [data-whiteboard-action="${action}"]`).focus();await page.keyboard.press('Enter');
     ok(await until(inPanel),`${label} opens with focus inside it`);
     panelStarts[`${id}:${label}`]=await page.evaluate(()=>{const a=document.activeElement;return a.getAttribute('aria-label')||a.textContent.trim();});
     // 5. One rule for where a panel starts: its first control, a group of choices entered on its chosen option; a
     // colour palette on its chosen swatch, never on the panel's ×.
     await page.waitForTimeout(80);
     eq(await page.evaluate(()=>{
       const a=document.activeElement;
       if(a.matches('[data-format-close],[aria-label^="Close"]'))return 'starts on its close button';
       const group=a.closest('ui-radio-group,ui-toggle-group,ui-segmented-control');
       const chosen=group?.querySelector('[data-checked],[aria-pressed="true"],[aria-checked="true"]');
       return chosen&&chosen!==a&&!a.contains(chosen)?`starts on ${a.getAttribute('aria-label')}, not on the chosen ${chosen.getAttribute('aria-label')}`:'ok';
     }),'ok',`${label} (${id}) starts on its first control, a group on its chosen option`);
     // 10. Focus the panel placed on its start opens no tooltip, so one Escape closes the panel (as on main) and focus
     // goes back to its button without a hint popping there either.
     await page.waitForTimeout(120);
     eq(await page.locator('ui-tooltip-content[data-open]').count(),0,`${label} (${id}) opened by keyboard shows no tooltip on its starting control`);
     await page.keyboard.press('Escape');
     ok(await until(async()=>!(await inPanel())&&await page.evaluate(a=>document.activeElement?.dataset?.whiteboardAction===a,action)),`One Escape closes ${label} (${id}) and returns to its button`);
     await page.waitForTimeout(120);
     eq(await page.locator('ui-tooltip-content[data-open]').count(),0,`and no tooltip opens on ${label} as focus comes back`);
     await page.keyboard.press('Enter');ok(await until(inPanel),`${label} opens again`);
     let n=0;while(n++<40&&await inPanel()){await page.keyboard.press('Tab');await page.waitForTimeout(40);}
     eq(await focused(),`drawn:${id}`,`Tab out of the last control of ${label} (${id}) goes back to the object`);
     eq(await page.locator('.whiteboard-menu:not([hidden]),ui-popover-content[data-open]').count(),0,`and ${label} closes`);
   }
 }
 // While a text is being edited, Tab goes to the bar and Tab past the bar goes back to the text.
 await select('words');await page.keyboard.press('F2');await page.locator('#world [data-decoration="words"] .whiteboard-editor').waitFor();
 await page.keyboard.press('Tab');ok(await until(()=>page.evaluate(()=>!!document.activeElement?.closest('.whiteboard-toolbar'))),'Tab from the editor goes to the bar');
 await page.keyboard.press('Tab');ok(await until(()=>page.evaluate(()=>!!document.activeElement?.closest('.whiteboard-editor'))),'Tab past the bar goes back to the editor');
 await page.keyboard.press('Escape');await clear();

 // ---- 6. A popover is not a menu: arrows don't walk between its controls (Tab does); a slider's arrows are its own. ----
 for(const [where,toggle,slider,label]of[['board','#zoom-menu-toggle','#zoom-slider','Board zoom'],['reader','#reader-zoom-toggle','#reader-zoom-slider','Tinka zoom']]){
   if(where==='reader'){await clear();await page.locator(`#world .workspace-card[data-placement="${c.a}"]`).focus();await page.keyboard.press('Enter');await page.locator('#reader-dialog[open]').waitFor();await page.waitForTimeout(500);}
   const zoomText=()=>page.locator(toggle).textContent().then(t=>t.trim());
   await page.locator(toggle).focus();await page.keyboard.press('ArrowDown');
   ok(await until(()=>page.evaluate(sel=>!!document.activeElement?.closest('ui-popover-content'),toggle)),`↓ on % opens the ${where} popover, focus inside`);
   const first=await page.evaluate(()=>document.activeElement.textContent.trim()),z0=await zoomText();
   for(let i=0;i<4;i++){await page.keyboard.press('ArrowDown');await page.waitForTimeout(40);}
   eq(await page.evaluate(()=>document.activeElement.textContent.trim()),first,`In the ${where} % popover, ↓ does not walk from its first control`);
   eq(await zoomText(),z0,`and the ${where} zoom is unchanged`);
   await page.keyboard.press('Tab');ok((await page.evaluate(()=>document.activeElement.textContent.trim()))!==first,`Tab moves on through the ${where} popover`);
   await page.locator(slider).focus();await page.keyboard.press('ArrowUp');
   ok(await until(async()=>(await zoomText())!==z0),`On the ${where} slider (${label}), the arrows change the zoom: the slider owns them`);
   eq(await page.evaluate(()=>document.activeElement?.id),slider.slice(1),'and focus stays on the slider');
   await page.keyboard.press('Escape');
   if(where==='reader'){await page.keyboard.press('Escape');await page.locator('#reader-dialog').waitFor({state:'hidden'});}
 }
 await clear();

 // ---- 7. The reader's path menu marks where you are with aria-current, never with the highlight's fill. ----
 await clear();await page.locator(`#world .workspace-card[data-placement="${c.a}"]`).focus();await page.keyboard.press('Enter');await page.locator('#reader-dialog[open]').waitFor();await page.waitForTimeout(400);
 await page.locator('#reader-path').focus();await page.keyboard.press('Enter');await page.locator('#reader-path-pop .reader-path-row').first().waitFor();await page.waitForTimeout(200);
 const pathRows=()=>page.evaluate(()=>[...document.querySelectorAll('#reader-path-pop .reader-path-row')].map(r=>({current:r.getAttribute('aria-current')==='true',highlighted:r.hasAttribute('data-highlighted'),filled:getComputedStyle(r).backgroundColor!=='rgba(0, 0, 0, 0)',mark:getComputedStyle(r).backgroundImage!=='none'})));
 for(const step of ['open','on the current row']){
   const rows=await pathRows();
   ok(rows.filter(r=>r.current).length>=1,`The current place carries aria-current (${step})`);
   eq(rows.filter(r=>r.filled).length,1,`Exactly one row is filled: the highlighted one (${step})`);
   ok(rows.every(r=>r.filled===r.highlighted),`Only the highlight fills a row (${step})`);
   ok(rows.every(r=>r.mark===r.current),`The current place has its own mark (${step})`);
   if(step==='open')for(let i=0;i<8&&!(await pathRows()).some(r=>r.current&&r.highlighted);i++)await page.keyboard.press('ArrowDown');
 }
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.locator('#reader-dialog').waitFor({state:'hidden'});

 // The starts, by name: the chosen swatch, the pressed arrowhead, the chosen shape.
 eq(panelStarts['arrow:Stroke color'],'Blue','The stroke palette starts on the chosen swatch');
 eq(panelStarts['shape:Fill color'],'Gold','The fill palette starts on the chosen swatch');
 eq(panelStarts['arrow:Line options'],'Arrowhead at end','Line options start on the pressed arrowhead');
 ok(Object.values(panelStarts).every(name=>!/^Close/.test(name)),`No panel starts on ×: ${JSON.stringify(panelStarts)}`);

 assert.deepEqual(errors,[]);checks++;
 console.log(`Board fixes browser checks passed: ${checks} assertions. Evidence: ${evidence}`);
}finally{await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true});}
