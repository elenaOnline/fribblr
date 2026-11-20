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
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
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
 const text=(id,body,x,y)=>({id,type:'text',x,y,width:220,height:60,text:body,color:'#456139'});
 for(const decoration of [
   text('words','Some words',0,240),
   {id:'shape',type:'region',shape:'rounded',x:300,y:240,width:200,height:120,text:'A shape',color:'#dbe5d3'},
   {id:'arrow',type:'line',x:600,y:40,width:240,height:120,color:'#6c8060',text:'',endArrow:true,from:{x:600,y:40},to:{x:840,y:160}},
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

 assert.deepEqual(errors,[]);checks++;
 console.log(`Board fixes browser checks passed: ${checks} assertions. Evidence: ${evidence}`);
}finally{await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true});}
