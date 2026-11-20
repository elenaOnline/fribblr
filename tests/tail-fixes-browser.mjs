// Headless checks for the tidy-up after the fourth independent check (team/ux/r2/review4/CHECK.md), on UI SDK's norms
// (public/ui-sdk.md): focus never drops to <body>.
// - Escape while connecting from the keyboard goes back to the connection point it started from; Escape on a point with
//   nothing pending goes back to its object.
// - Delete on a focused drawn object (a Text block, a shape, an arrow; or ⌘D then Delete on the copy) moves focus to the
//   nearest item, as deleting a card does.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from '../cli.mjs';
import {loadConfig} from '../lib/config.mjs';
import {applyOperation} from '../lib/workspace.mjs';
import {listen,closeAppServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=await mkdtemp(path.join(os.tmpdir(),'tinka-tail-fixes-'));
let server,browser,checks=0;const errors=[];
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
try{
 const file=path.join(root,'config.json');await main(['init','--config',file,'--boards',path.join(root,'boards'),'--label','Tail fixes studio']);const config=await loadConfig(file);
 const op=async(type,fields)=>(await applyOperation(config,{type,...fields})).result;
 await op('createBoard',{id:'tail',title:'Tail'});
 const add=async(title,x,y)=>(await op('createItem',{boardId:'tail',item:{title,content:{kind:'note',text:`${title}.`}},placement:{x,y,width:240,height:160}})).placementIds[0];
 const c={};
 c.a=await add('Card A',0,0);c.b=await add('Card B',300,0);
 for(const decoration of [
   {id:'words',type:'text',x:0,y:240,width:220,height:60,text:'Some words',color:'#456139'},
   {id:'shape',type:'region',shape:'diamond',x:300,y:240,width:200,height:120,text:'A shape',color:'palette:gold'},
   {id:'arrow',type:'line',x:600,y:240,width:240,height:120,color:'palette:blue',text:'',endArrow:true,from:{x:600,y:240},to:{x:840,y:360}},
 ]) await op('createDecoration',{boardId:'tail',decoration});

 server=await listen(config,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,args:['--mute-audio'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'light',reducedMotion:'reduce'});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const open=async(board='tail')=>{await page.goto(`${base}/boards/${board}/`,{waitUntil:'load'});await page.locator('.workspace-card').first().waitFor();await page.waitForTimeout(400);await page.locator('#fit').click();await page.waitForTimeout(300);};
 const focused=()=>page.evaluate(()=>{const a=document.activeElement;return a?.dataset?.placement?`card:${a.getAttribute('aria-label')}`:a?.dataset?.decoration?`drawn:${a.dataset.decoration}`:a?.dataset?.port?`port:${a.getAttribute('aria-label')}`:a===document.body?'BODY':a?.id||a?.getAttribute?.('aria-label')||a?.tagName;});
 const until=async(fn,ms=3000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,40));}return fn();};
 const select=async id=>{await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.locator(`#world [data-decoration="${id}"]`).focus();await page.keyboard.press('Space');await page.waitForTimeout(300);};
 await open();

 // ---- 1. Escape while connecting goes back to the point the connection started from. ----
 {await select('words');
  await page.locator('.whiteboard-ports [data-port][tabindex="0"]').focus();await page.keyboard.press('ArrowRight');
  eq(await focused(),'port:Connect Some words right','→ goes to the right-hand point');
  await page.keyboard.press('Enter');
  ok(await until(()=>page.evaluate(()=>document.querySelectorAll('.whiteboard-ports [data-port]').length>4)),'Enter begins a connection: the destinations show');
  await page.keyboard.press('ArrowRight');await page.waitForTimeout(200);
  ok((await focused())!=='port:Connect Some words right','→ moves on to another object\'s point');
  await page.keyboard.press('Escape');
  eq(await focused(),'port:Connect Some words right','Escape cancels the connection and focus goes back to the point it started from');
  await page.waitForTimeout(800);
  eq(await focused(),'port:Connect Some words right','and stays there');
  eq(await page.locator('.whiteboard-ports [data-port]').count(),4,'Only the object\'s own points are left');
  eq(await page.locator('.whiteboard-connect-hint:not([hidden])').count(),0,'The destination hint has gone');
  await page.keyboard.press('Escape');
  eq(await focused(),'drawn:words','Escape on a point with nothing pending goes back to its object');
  eq(await page.evaluate(()=>document.querySelector('#world [data-decoration="words"]').classList.contains('selected')||document.querySelector('#world [data-decoration="words"]').getAttribute('aria-selected')==='true'),true,'which stays selected');
 }

 // ---- 2. Delete on a focused drawn object moves focus to the nearest item, as for a card. ----
 {const count=()=>page.locator('#world [data-decoration]').count();
  for(const id of ['words','shape','arrow']){
   await page.keyboard.press('Escape');await page.keyboard.press('Escape');
   const before=await count();
   await page.locator(`#world [data-decoration="${id}"]`).focus();await page.keyboard.press(process.platform==='darwin'?'Meta+d':'Control+d');
   ok(await until(async()=>(await count())===before+1&&(await focused()).startsWith('drawn:')&&(await focused())!==`drawn:${id}`),`⌘D on ${id} makes a copy, which takes focus: ${await focused()}`);
   await page.keyboard.press('Delete');
   ok(await until(async()=>(await count())===before),`Delete removes the copy of ${id}`);
   eq(await until(async()=>(await focused())===`drawn:${id}`&&focused()),`drawn:${id}`,`Focus goes to the nearest item, the original ${id} under the copy`);
  }
  // Select and Delete an original: focus goes to the nearest item that is left, never <body>.
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await page.locator('#world [data-decoration="shape"]').focus();await page.keyboard.press('Space');await page.waitForTimeout(300);
  await page.keyboard.press('Delete');
  ok(await until(async()=>!(await page.locator('#world [data-decoration="shape"]').count())),'Delete removes the selected shape');
  const after=await until(async()=>{const f=await focused();return f!=='BODY'&&f!=='drawn:shape'&&f;});
  ok(/^(drawn|card):/.test(after),`Focus goes to a neighbour, not <body>: ${after}`);
  await page.waitForTimeout(800);
  eq(await focused(),after,'and stays there');
  await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');
  ok(await until(async()=>await page.locator('#world [data-decoration="shape"]').count()===1),'⌘Z puts the shape back');
 }

 assert.deepEqual(errors,[]);checks++;
 console.log(`Tail fixes browser checks passed: ${checks} assertions.`);
}finally{await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true});}
