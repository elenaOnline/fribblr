// Headless checks for the board fixes found by round 2's review (team/ux/r2/review/REVIEW.md), on UI SDK's norms
// (public/ui-sdk.md § Board canvas, § Popups):
// - focus follows a press: a press on any board item (card, Text block, shape, arrow, sticker, container member) makes
//   it the focused item, so Option-arrow moves what was pressed, never an item focused earlier;
// - with nothing selected, board commands (⌘I, ⌘D, E) act on the focused item, as its menu advertises;
// - C, then Enter on the focused item, places a comment there; Escape disarms;
// - Tab past the drawn-object bar or any of its panels goes on to the board's focused item, never to <body>;
// - the bar's panels start on their checked option, or on their first control (never on ×);
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
 await page.keyboard.press('Escape');
 ok(await until(async()=>(await focused())==='card:Card B'),`Escape from those Details returns focus to the card: ${await focused()}`);
 {const n=await cardCount();await focusCard(c.b);await page.keyboard.press(`${mod}+d`);
  ok(await until(async()=>(await cardCount())===n+1),'⌘D duplicates the focused card');}
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

 // The starts, by name: the chosen swatch, the pressed arrowhead, the chosen shape.
 eq(panelStarts['arrow:Stroke color'],'Blue','The stroke palette starts on the chosen swatch');
 eq(panelStarts['shape:Fill color'],'Gold','The fill palette starts on the chosen swatch');
 eq(panelStarts['arrow:Line options'],'Arrowhead at end','Line options start on the pressed arrowhead');
 ok(Object.values(panelStarts).every(name=>!/^Close/.test(name)),`No panel starts on ×: ${JSON.stringify(panelStarts)}`);

 assert.deepEqual(errors,[]);checks++;
 console.log(`Board fixes browser checks passed: ${checks} assertions. Evidence: ${evidence}`);
}finally{await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true});}
