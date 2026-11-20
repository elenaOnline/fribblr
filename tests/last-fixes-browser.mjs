// Headless checks for the last fixes before ui-sdk goes to main (team/ux/r2/review3/REVIEW.md), on UI SDK's norms
// (public/ui-sdk.md):
// - a popup closed by a press on the empty canvas leaves focus on the canvas, a press on nothing focusable returns it to
//   the trigger, and a press on the canvas from a field outside the board focuses the canvas;
// - a press on a drawn-object bar button or a tools-rail button closes its tooltip, and it stays closed over the panel
//   or picker the press opened until the pointer leaves the button;
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
const root=await mkdtemp(path.join(os.tmpdir(),'tinka-last-fixes-'));
let server,browser,checks=0;const errors=[];
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
try{
 const file=path.join(root,'config.json');await main(['init','--config',file,'--boards',path.join(root,'boards'),'--label','Last fixes studio']);const config=await loadConfig(file);
 const op=async(type,fields)=>(await applyOperation(config,{type,...fields})).result;
 await op('createBoard',{id:'fixes',title:'Fixes'});
 const add=async(title,x,y)=>(await op('createItem',{boardId:'fixes',item:{title,content:{kind:'note',text:`${title}.`}},placement:{x,y,width:240,height:160}})).placementIds[0];
 const c={};
 c.a=await add('Card A',0,0);c.b=await add('Card B',300,0);c.c=await add('Card C',600,0);c.d=await add('Card D',900,0);
 for(const decoration of [
   {id:'words',type:'text',x:0,y:240,width:220,height:60,text:'Some words',color:'#456139'},
   {id:'shape',type:'region',shape:'diamond',x:300,y:240,width:200,height:120,text:'A shape',color:'palette:gold'},
   {id:'arrow',type:'line',x:600,y:240,width:240,height:120,color:'palette:blue',text:'',endArrow:true,from:{x:600,y:240},to:{x:840,y:360}},
 ]) await op('createDecoration',{boardId:'fixes',decoration});

 server=await listen(config,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,args:['--mute-audio'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'light',reducedMotion:'reduce'});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const open=async(board='fixes')=>{await page.goto(`${base}/boards/${board}/`,{waitUntil:'load'});await page.locator('.workspace-card').first().waitFor();await page.waitForTimeout(400);await page.locator('#fit').click();await page.waitForTimeout(300);};
 const focused=()=>page.evaluate(()=>{const a=document.activeElement;return a?.dataset?.placement?`card:${a.getAttribute('aria-label')}`:a?.dataset?.decoration?`drawn:${a.dataset.decoration}`:a===document.body?'BODY':a?.id||a?.getAttribute?.('aria-label')||a?.tagName;});
 const until=async(fn,ms=3000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,40));}return fn();};
 // A point on the empty canvas (the world itself under the pointer), and one on the top bar that hits no control.
 const emptyPoint=()=>page.evaluate(()=>{for(let y=200;y<800;y+=23)for(let x=100;x<1300;x+=37){const e=document.elementFromPoint(x,y);if(e?.id==='world')return {x,y};}return null;});
 const barPoint=()=>page.evaluate(()=>{const h=document.querySelector('.canvas-header'),r=h.getBoundingClientRect();for(let x=r.left+2;x<r.right;x+=6){const e=document.elementFromPoint(x,r.top+r.height/2);if(e&&!e.closest('button,a,input,[tabindex]'))return {x,y:r.top+r.height/2};}return null;});
 // A point on an item that hits the item itself (not a button or field inside it).
 const pressAt=async sel=>{const p=await page.evaluate(sel=>{const e=document.querySelector(sel);if(!e)return null;const r=e.getBoundingClientRect();
   for(let fy=.5;fy>.02;fy-=.08)for(const fx of [.5,.3,.7]){const x=r.left+r.width*fx,y=r.top+r.height*fy,t=document.elementFromPoint(x,y);if(t&&e.contains(t)&&!t.closest('button,a,input,[contenteditable]'))return {x,y};}return null;},sel);
  ok(p,`${sel} has a point to press`);await page.mouse.click(p.x,p.y);await page.waitForTimeout(300);};
 const clickOn=async sel=>{const b=await page.locator(sel).boundingBox();await page.mouse.click(b.x+b.width/2,b.y+b.height/2);await page.waitForTimeout(300);};
 await open();

 // ---- 1. A popup closed by a press away: focus goes where the press would have put it. ----
 {const empty=await emptyPoint(),bar=await barPoint();ok(empty&&bar,'Points on the empty canvas and the bare top bar');
  for(const [name,trigger,content] of [['Add','#workspace-add','#workspace-add-menu-content'],['the % popover','#zoom-menu-toggle','ui-popover-content[data-open]']]){
   await clickOn(trigger);
   ok(await until(()=>page.evaluate(sel=>!!document.querySelector(sel)?.matches('[data-open]'),content)),`${name} opens on a click`);
   await page.mouse.click(empty.x,empty.y);
   ok(await until(async()=>(await focused())==='viewport'),`A click on empty canvas closes ${name} and focuses the canvas, not <body>: ${await focused()}`);
   await page.waitForTimeout(700);eq(await focused(),'viewport',`and focus stays on the canvas (${name})`);
   await clickOn(trigger);await page.mouse.click(bar.x,bar.y);
   ok(await until(()=>page.evaluate(sel=>document.activeElement===document.querySelector(sel),trigger)),`A click on the bare top bar closes ${name} and returns focus to its trigger: ${await focused()}`);
  }
  // From a field outside the board (Find), a press on the empty canvas focuses the canvas, as a press on any other
  // focusable place takes focus.
  await page.locator('#workspace-search').first().focus();
  await page.mouse.click(empty.x,empty.y);
  ok(await until(async()=>(await focused())==='viewport'),`A click on empty canvas from a field outside the board focuses the canvas: ${await focused()}`);
 }

 // ---- 2. A press closes the tooltip of the bar or rail button it lands on, and the panel opening keeps it closed. ----
 {const tipShown=()=>page.evaluate(()=>[...document.querySelectorAll('ui-tooltip-content[data-open]')].filter(e=>e.getClientRects().length).map(e=>e.textContent.trim()).join('|'));
  const hoverPress=async(sel,name)=>{
   const b=await page.locator(sel).boundingBox(),x=b.x+b.width/2,y=b.y+b.height/2;
   await page.mouse.move(x,y-70,{steps:2});await page.waitForTimeout(500);await page.mouse.move(x,y,{steps:3});
   ok(await until(async()=>(await tipShown()).includes(name),2000),`${name}: its tooltip shows on a resting pointer`);
   await page.mouse.down();await page.waitForTimeout(60);
   eq(await tipShown(),'',`${name}: a press closes its tooltip`);
   await page.mouse.up();await page.waitForTimeout(150);await page.mouse.move(x+2,y+1);await page.waitForTimeout(900);
   eq(await tipShown(),'',`${name}: no tooltip over what the press opened while the pointer stays on the button`);
  };
  await page.keyboard.press('Escape');await pressAt('#world [data-decoration="shape"]');
  for(const name of ['Fill color','Shape options']){
   await hoverPress(`.whiteboard-toolbar button[aria-label="${name}"]`,name);
   ok(await page.evaluate(()=>!document.querySelector('.whiteboard-menu').hidden),`${name} opened its panel`);
   await page.keyboard.press('Escape');await page.waitForTimeout(200);
  }
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await hoverPress('button[data-edit-tool][aria-label^="Sticker"]','Sticker');
  ok(await until(()=>page.evaluate(()=>!!document.querySelector('.emoji-picker-search')?.getClientRects().length)),'Sticker opened its picker');
  await page.keyboard.press('Escape');await page.waitForTimeout(200);
  // Leaving the button and coming back shows its tooltip again.
  {const b=await page.locator('button[data-edit-tool][aria-label^="Sticker"]').boundingBox();await page.mouse.move(b.x+b.width/2,b.y-70,{steps:2});await page.waitForTimeout(500);await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:3});
   ok(await until(async()=>(await tipShown()).includes('Sticker'),2000),'Back on the button after leaving it, its tooltip shows again');}
  await page.mouse.move(5,450);
 }

 assert.deepEqual(errors,[]);checks++;
 console.log(`Last fixes browser checks passed: ${checks} assertions.`);
}finally{await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true});}
