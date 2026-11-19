// Hover and focus hints on UI SDK's Tooltip (public/tips.js): the norms of tooltip.md with a real pointer and
// keyboard. The first tooltip waits 600 ms of rest; sliding to the next trigger opens it at once and only one is ever
// open; keyboard focus opens it at once and a click does not; a press hides it until the pointer leaves; Escape
// closes only the tooltip (not the Inspector around it); the pointer can move into it; a tap never shows one. Menu
// and popover triggers keep opening on a press and on ↓. Converted chrome carries no native title; cards keep theirs.
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
const root=await mkdtemp(path.join(os.tmpdir(),'tinka-tooltips-browser-'));
const evidence=process.env.TINKA_EVIDENCE_DIR||await mkdtemp(path.join(os.tmpdir(),'tinka-tooltips-evidence-'));await mkdir(evidence,{recursive:true});
let server,browser;const errors=[],checks=[];
const check=(cond,message,detail)=>{assert.ok(cond,detail===undefined?message:`${message}: ${typeof detail==='string'?detail:JSON.stringify(detail)}`);checks.push(message);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try {
  const file=path.join(root,'config.json');await main(['init','--config',file,'--boards',path.join(root,'boards'),'--label','Tooltips']);const config=await loadConfig(file);
  const op=async(type,fields)=>(await applyOperation(config,{type,...fields})).result;
  await op('createBoard',{id:'tips',title:'Tooltips'});
  for(let i=0;i<3;i++)await op('createItem',{boardId:'tips',item:{id:`note-${i}`,title:`Note ${i}`,content:{kind:'note',text:'A note.'}},placement:{x:i*360,y:0,width:320,height:240,presentation:{mode:'card'}}});
  server=await listen(config,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,args:['--mute-audio'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1280,height:800},colorScheme:'light',hasTouch:true});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/boards/tips/');await page.locator('#world .workspace-card').first().waitFor();await page.locator('#workspace-add').waitFor();await sleep(400);

  const tip=()=>page.evaluate(()=>{const open=[...document.querySelectorAll('ui-tooltip-content[data-open]')],c=open[0];
    return {n:open.length,text:c?.querySelector('.tk-tip-text')?.textContent||'',keys:c?.querySelector('.tk-tip-keys')?.textContent||'',box:c?c.getBoundingClientRect().toJSON():null,role:c?.getAttribute('role')||''};});
  const at=async selector=>{const b=await page.locator(selector).first().boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};};
  const rest=async()=>{await page.mouse.move(640,400);await sleep(900);};
  const focusedId=()=>page.evaluate(()=>document.activeElement?.id||'');

  // Converted chrome has no native title left; every hinted control is a trigger of the shared tooltip.
  const chrome=await page.evaluate(()=>({titles:[...document.querySelectorAll('[title]')].filter(e=>!e.closest('#world')&&e.tagName!=='IFRAME'&&e.getClientRects().length).map(e=>e.id||e.className),
    unwrapped:[...document.querySelectorAll('[data-tip]')].filter(e=>!e.closest('ui-tooltip-trigger')).map(e=>e.id||e.className),
    worldTriggers:document.querySelectorAll('#world ui-tooltip-trigger').length,cardTitles:document.querySelectorAll('#world .workspace-card [title]').length}));
  check(chrome.titles.length===0,'visible chrome carries no native title',chrome.titles);
  check(chrome.unwrapped.length===0,'every hinted control sits in a tooltip trigger',chrome.unwrapped);
  check(chrome.worldTriggers===0&&chrome.cardTitles>0,'cards keep their native titles (no triggers on the canvas)',chrome);

  // Delay: nothing before 600 ms of rest, then the hint with its shortcut, above the trigger.
  await rest();let p=await at('#fit');await page.mouse.move(p.x,p.y);
  await sleep(300);check((await tip()).n===0,'no tooltip before the delay');
  await sleep(500);let t=await tip();
  check(t.n===1&&t.text==='Fit every item in view'&&t.role==='tooltip','the tooltip opens after resting on Fit',t);
  check(/F/.test(t.keys)&&/⇧1|Shift\+1/.test(t.keys),'the shortcut shows in the tooltip',t.keys);
  check(t.box.bottom<=p.y,'it opens above its trigger',t.box);
  check(await page.locator('#fit').getAttribute('aria-describedby')===await page.locator('#tk-tip ui-tooltip-content').getAttribute('id'),'the open tooltip describes its trigger');
  await page.screenshot({path:path.join(evidence,'tooltip-fit.png')});

  // The pointer can move into it.
  await page.mouse.move(t.box.x+t.box.width/2,t.box.y+t.box.height/2,{steps:5});await sleep(150);
  check((await tip()).n===1,'the pointer can move into the tooltip');

  // Instant hand-over, one open at a time.
  p=await at('#fit');await page.mouse.move(p.x,p.y);await sleep(80);
  p=await at('#zoom-plus');await page.mouse.move(p.x,p.y,{steps:4});await sleep(60);t=await tip();
  check(t.n===1&&t.text==='Zoom in','sliding to the next trigger opens it at once',t);
  p=await at('#zoom-minus');await page.mouse.move(p.x,p.y,{steps:4});await sleep(60);t=await tip();
  check(t.n===1&&t.text==='Zoom out','only one tooltip is ever open',t);

  // A press hides it until the pointer leaves.
  await page.mouse.down();await page.mouse.up();await sleep(120);check((await tip()).n===0,'pressing the trigger hides the tooltip');
  await sleep(900);check((await tip()).n===0,'it stays hidden while the pointer rests there');

  // A click that focuses does not open it; keyboard focus does, at once; Escape closes it and keeps focus.
  await rest();await page.locator('#zoom-plus').click();await sleep(150);check((await tip()).n===0,'a click that focuses the trigger does not open it');
  // (The pill is a toolbar, one Tab stop: out and back in lands on Zoom in again; ← moves along it.)
  await rest();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');await sleep(40);t=await tip();
  check(t.n===1&&t.text==='Zoom in'&&await focusedId()==='zoom-plus','keyboard focus opens the tooltip at once',t);
  await page.keyboard.press('ArrowLeft');await sleep(40);t=await tip();
  check(t.n===1&&t.text==='Zoom and pattern'&&await focusedId()==='zoom-menu-toggle','arrowing along the toolbar moves the tooltip with focus',t);
  await page.keyboard.press('Escape');await sleep(80);
  check((await tip()).n===0&&await focusedId()==='zoom-menu-toggle'&&!(await page.locator('#zoom-menu').evaluate(m=>m.hasAttribute('data-open'))),'Escape closes the tooltip and focus stays');

  // Escape inside the board Inspector closes the tooltip first, the panel with the next Escape.
  await page.locator('#board-info-toggle').click();await page.locator('#board-info:not([hidden])').waitFor();await sleep(200);
  await page.evaluate(()=>document.getElementById('workspace-add').focus());await page.keyboard.press('Tab');await sleep(60);t=await tip();
  check(await focusedId()==='board-info-close'&&t.n===1&&t.text==='Close inspector','Tab into the Inspector shows the close key\'s tooltip',t);
  await page.keyboard.press('Escape');await sleep(120);
  check((await tip()).n===0&&await page.locator('#board-info').evaluate(e=>!e.hidden),'Escape closes only the tooltip, not the Inspector around it');
  await page.keyboard.press('Escape');await sleep(200);
  check(await page.locator('#board-info').evaluate(e=>e.hidden),'the next Escape closes the Inspector');

  // A menu trigger keeps its menu: hover shows the tooltip, a press opens the menu, ↓ opens it from the keyboard.
  await rest();p=await at('#workspace-add');await page.mouse.move(p.x,p.y);await sleep(750);
  check((await tip()).text==='Add text, shapes, arrows, items and boards','Add has its tooltip');
  await page.mouse.down();await page.mouse.up();await sleep(250);
  check(await page.locator('#workspace-add-menu ui-menu-content').evaluate(m=>m.hasAttribute('data-open'))&&(await tip()).n===0,'a press opens the Add menu, not the tooltip');
  await page.keyboard.press('Escape');await sleep(200);check(await focusedId()==='workspace-add','Escape returns to Add');
  await page.keyboard.press('ArrowDown');await sleep(250);
  check(await page.locator('#workspace-add-menu ui-menu-content').evaluate(m=>m.hasAttribute('data-open')),'↓ on Add still opens the menu');
  await page.keyboard.press('Escape');await sleep(200);
  // The zoom % popover trigger, inside the pill toolbar.
  await rest();p=await at('#zoom-menu-toggle');await page.mouse.move(p.x,p.y);await sleep(750);
  check((await tip()).text==='Zoom and pattern','the zoom % has its tooltip');
  await page.mouse.down();await page.mouse.up();await sleep(250);
  check(await page.locator('#zoom-menu').evaluate(m=>m.hasAttribute('data-open'))&&(await tip()).n===0,'a press opens the zoom popover, not the tooltip');
  await page.keyboard.press('Escape');await sleep(200);

  // Touch never shows a plain tooltip.
  await rest();p=await at('#zoom-minus');await page.touchscreen.tap(p.x,p.y);await sleep(900);
  check((await tip()).n===0,'a tap shows no tooltip');

  // The opened Tinka has its own tooltip inside its dialog (the rest of the page is inert while it is open).
  await page.locator('#world .workspace-card').first().locator('[data-open]').first().click();await page.locator('#reader-dialog[open]').waitFor();await sleep(600);
  await page.mouse.move(5,5);await sleep(200);await rest();p=await at('#reader-star');await page.mouse.move(p.x,p.y);await sleep(800);
  t=await page.evaluate(()=>{const c=document.querySelector('ui-tooltip-content[data-open]');return {host:c?.closest('ui-tooltip')?.id,inDialog:!!c?.closest('#reader-dialog'),text:c?.textContent};});
  check(t.inDialog&&/Favorite/.test(t.text),'the reader\'s tooltip lives in the reader dialog',t);
  await page.keyboard.press('Escape');await sleep(150);
  check(await page.locator('#reader-dialog').evaluate(d=>d.open),'Escape over the reader closes the tooltip first');

  // Home: the exact date of a board, on the same tooltip.
  await page.goto(base+'/');await page.locator('.board-card time[data-rel]').first().waitFor();await sleep(300);
  await page.mouse.move(5,5);await sleep(900);p=await at('.board-card time[data-rel]');await page.mouse.move(p.x,p.y);await sleep(800);
  t=await tip();check(t.n===1&&/\d{4}/.test(t.text),'Home: a relative date shows its exact time',t);
  check(await page.locator('.board-card time[data-rel]').first().getAttribute('title')===null,'Home: dates carry no native title');

  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:checks.length,evidence}));
} finally {await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
