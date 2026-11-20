// Hover and focus hints on UI SDK's Tooltip (public/tips.js): the norms of tooltip.md with a real pointer and
// keyboard, for the wrapped chrome and for the delegated tooltip that serves the board's cards, segmented items, menus
// and the other tooltip zones. The first tooltip waits 600 ms of rest; sliding to the next opens it at once and only
// one is ever open; keyboard focus opens it at once and a click does not; a press hides it until the pointer leaves;
// Escape closes only the tooltip (not the Inspector, the selection or the reader around it); the pointer can move into
// it; a tap never shows one; a drag opens none. Menu and popover triggers keep opening on a press and on ↓. No native
// title is left on a control, and the board's cards get no trigger element per control.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from '../cli.mjs';
import {loadConfig} from '../lib/config.mjs';
import {applyOperation} from '../lib/workspace.mjs';
import {listen,closeAppServer} from '../server.mjs';
import {openItemDetails} from './tile-test-helpers.mjs';
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
  await op('createBoard',{id:'long',title:'A board whose title is far too long to fit on its card on Home, so it is cut off with an ellipsis there'});
  for(let i=0;i<3;i++)await op('createItem',{boardId:'tips',item:{id:`note-${i}`,title:`Note ${i}`,content:{kind:'note',text:'A note.'}},placement:{x:i*360,y:0,width:320,height:240,presentation:{mode:'card'}}});
  server=await listen(config,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,args:['--mute-audio'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1280,height:800},colorScheme:'light',hasTouch:true});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/boards/tips/');await page.locator('#world .workspace-card').first().waitFor();await page.locator('#workspace-add').waitFor();await sleep(400);

  const tip=()=>page.evaluate(()=>{const open=[...document.querySelectorAll('ui-tooltip-content[data-open]')],c=open[0];
    return {n:open.length,text:c?.querySelector('.tk-tip-text')?.textContent||'',keys:c?.querySelector('.tk-tip-keys')?.textContent||'',box:c?c.getBoundingClientRect().toJSON():null,role:c?.getAttribute('role')||'',instant:!!c?.hasAttribute('data-instant'),id:c?.id||''};});
  const at=async locator=>{const b=await (typeof locator==='string'?page.locator(locator).first():locator).boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};};
  const rest=async()=>{await page.mouse.move(640,500);await sleep(900);};
  const focusedId=()=>page.evaluate(()=>document.activeElement?.id||'');
  const card=page.locator('#world .workspace-card').nth(1);
  const hoverCard=async()=>{const b=await card.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await sleep(150);};

  // No native title is left on a control; wrapped chrome sits in triggers; the board's cards have no triggers at all.
  const census=await page.evaluate(()=>({titles:[...document.querySelectorAll('[title]')].filter(e=>e.tagName!=='IFRAME').map(e=>e.id||e.className||e.tagName),
    worldTriggers:document.querySelectorAll('#world ui-tooltip-trigger').length,cardTips:document.querySelectorAll('#world .workspace-card [data-tip]').length,
    unwrappedChrome:[...document.querySelectorAll('[data-tip]')].filter(e=>!e.closest('[data-tip-zone], ui-segmented-control, ui-tooltip-trigger, [role=menu], [hidden]')&&e.getClientRects().length).map(e=>e.id||e.className)}));
  check(census.titles.length===0,'no native title on the page (iframes keep theirs as their names)',census.titles);
  check(census.worldTriggers===0&&census.cardTips>=12,'card controls carry data-tip and the canvas holds no trigger elements',census);
  check(census.unwrappedChrome.length===0,'every visible hinted chrome control sits in a tooltip trigger',census.unwrappedChrome);

  // Wrapped chrome. Delay: nothing before 600 ms of rest, then the hint with its shortcut, above the trigger.
  await rest();let p=await at('#fit');await page.mouse.move(p.x,p.y);
  await sleep(300);check((await tip()).n===0,'no tooltip before the delay');
  await sleep(500);let t=await tip();
  check(t.n===1&&t.text==='Fit every item in view'&&t.role==='tooltip','the tooltip opens after resting on Fit',t);
  check(/F/.test(t.keys)&&/⇧1|Shift\+1/.test(t.keys),'the shortcut shows in the tooltip',t.keys);
  check(t.box.bottom<=p.y,'it opens above its trigger',t.box);
  check(await page.locator('#fit').getAttribute('aria-describedby')===t.id,'the open tooltip describes its trigger');
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
  await rest();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');await sleep(40);t=await tip();
  check(t.n===1&&t.text==='Zoom in'&&await focusedId()==='zoom-plus','keyboard focus opens the tooltip at once',t);
  await page.keyboard.press('ArrowLeft');await sleep(40);t=await tip();
  check(t.n===1&&t.text==='Zoom and pattern'&&await focusedId()==='zoom-menu-toggle','arrowing along the toolbar moves the tooltip with focus',t);
  await page.keyboard.press('Escape');await sleep(80);
  check((await tip()).n===0&&await focusedId()==='zoom-menu-toggle','Escape closes the tooltip and focus stays');

  // A menu trigger keeps its menu: hover shows the tooltip, a press opens the menu, ↓ opens it from the keyboard.
  await rest();p=await at('#workspace-add');await page.mouse.move(p.x,p.y);await sleep(750);
  check((await tip()).text==='Add text, shapes, arrows, items and boards','Add has its tooltip');
  await page.mouse.down();await page.mouse.up();await sleep(250);
  const addOpen=()=>page.evaluate(()=>!!document.querySelector('#workspace-add-menu ui-menu-content[data-open], #workspace-add-menu [data-slot=menu-content][data-open]'));
  check(await addOpen()&&(await tip()).n===0,'a press opens the Add menu, not the tooltip');
  await page.keyboard.press('Escape');await sleep(200);check(await focusedId()==='workspace-add','Escape returns to Add');
  await page.keyboard.press('ArrowDown');await sleep(250);check(await addOpen(),'↓ on Add still opens the menu');
  await page.keyboard.press('Escape');await sleep(200);
  // The zoom % popover trigger, inside the pill toolbar.
  await rest();p=await at('#zoom-menu-toggle');await page.mouse.move(p.x,p.y);await sleep(750);
  check((await tip()).text==='Zoom and pattern','the zoom % has its tooltip');
  await page.mouse.down();await page.mouse.up();await sleep(250);
  check(await page.evaluate(()=>!!document.querySelector('#zoom-popover ui-popover-content[data-open]'))&&(await tip()).n===0,'a press opens the zoom popover, not the tooltip');
  await page.keyboard.press('Escape');await sleep(200);

  // Cards, through the delegate: the same delay, describedby only while open, instant along the card, a press closes.
  await rest();await hoverCard();const more=card.locator('.workspace-tile-more');p=await at(more);await page.mouse.move(p.x,p.y,{steps:3});
  await sleep(300);check((await tip()).n===0,'card: no tooltip before the delay');
  await sleep(450);t=await tip();
  check(t.n===1&&t.text==='Item actions'&&t.box.bottom<=p.y,'card: the ⋯ hint opens above it after 600 ms',t);
  check(await more.getAttribute('aria-describedby')===t.id,'card: the open tooltip describes the control that opened it');
  await page.screenshot({path:path.join(evidence,'tooltip-card.png')});
  await page.mouse.move(t.box.x+t.box.width/2,t.box.y+t.box.height/2,{steps:4});await sleep(120);
  check((await tip()).text==='Item actions','card: the pointer can move into the tooltip');
  const dot=card.locator('.workspace-select-dot');p=await at(dot);await page.mouse.move(p.x,p.y,{steps:3});await sleep(60);t=await tip();
  check(t.n===1&&/^Select/.test(t.text)&&t.instant,'card: sliding to the select circle hands over at once (data-instant)',t);
  check(await more.getAttribute('aria-describedby')===null,'card: the control it left is no longer described');
  await page.mouse.down();await page.mouse.up();await sleep(150);check((await tip()).n===0,'card: a press closes it');
  await sleep(800);check((await tip()).n===0,'card: it stays closed while the pointer rests on the control');
  await page.keyboard.press('Escape');await sleep(100);
  // Hand-over from the chrome to a card control and back, with one tooltip.
  await rest();p=await at('#zoom-plus');await page.mouse.move(p.x,p.y);await sleep(750);check((await tip()).text==='Zoom in','chrome tooltip open');
  await hoverCard();p=await at(more);await page.mouse.move(p.x,p.y,{steps:2});await sleep(80);t=await tip();
  check(t.n===1&&t.text==='Item actions','card: arriving from an open chrome tooltip opens at once',t);
  // Escape closes only the tooltip: the card's selection stays.
  await page.keyboard.press('Escape');await sleep(100);check((await tip()).n===0,'card: Escape closes the tooltip');
  // Keyboard: Tab from a card into its controls opens their hints at once; leaving closes; a click opens nothing.
  await rest();await page.evaluate(()=>document.querySelectorAll('#world .workspace-card')[1].focus());await page.keyboard.press('Tab');await sleep(60);t=await tip();
  const focusedTip=await page.evaluate(()=>document.activeElement?.dataset?.tip||'');
  check(t.n===1&&focusedTip&&t.text===focusedTip,'card: keyboard focus on a card control opens its hint at once',{t,focusedTip});
  await page.keyboard.press('Escape');await sleep(80);
  check((await tip()).n===0&&await page.evaluate(()=>!!document.activeElement?.dataset?.tip),'card: Escape closes the hint and focus stays');
  await rest();await hoverCard();await more.click();await sleep(200);await page.keyboard.press('Escape');await sleep(200);
  await page.mouse.move(640,500);await sleep(900);
  await hoverCard();await page.mouse.move((await at(dot)).x,(await at(dot)).y);await page.mouse.down();await page.mouse.up();await sleep(150);
  check((await tip()).n===0,'card: a click that focuses a control opens nothing');
  // A drag (a button held) opens nothing on what passes under it; a tap opens nothing.
  await rest();const empty={x:60,y:560};await page.mouse.move(empty.x,empty.y);await page.mouse.down();
  p=await at(more);await page.mouse.move(p.x,p.y,{steps:6});await sleep(900);check((await tip()).n===0,'card: a marquee passing over a control opens nothing');
  await page.keyboard.press('Escape');await page.mouse.up();await sleep(150);
  await rest();await hoverCard();p=await at(dot);await page.touchscreen.tap(p.x,p.y);await sleep(900);check((await tip()).n===0,'card: a tap opens nothing');
  // Touch never shows a plain tooltip. (Kept after the hover checks on the page's tooltip: after a tap, the SDK ignores
  // the next mouse hover on a wrapped trigger until the pointer leaves one; ui-sdk.md § Tooltips, SDK notes.)
  await rest();p=await at('#zoom-minus');await page.touchscreen.tap(p.x,p.y);await sleep(900);
  check((await tip()).n===0,'a tap shows no tooltip');
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');await sleep(150);

  // Escape inside the board Inspector closes the tooltip first, the panel with the next Escape.
  await rest();await page.locator('#board-info-toggle').click();await page.locator('#board-info:not([hidden])').waitFor();await sleep(200);
  await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');await sleep(60);
  if(await focusedId()!=='board-info-close'){await page.evaluate(()=>document.getElementById('board-info-close').focus());await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');await sleep(60);}
  t=await tip();
  check(await focusedId()==='board-info-close'&&t.n===1&&t.text==='Close inspector','keyboard focus on the Inspector\'s close key shows its tooltip',t);
  await page.keyboard.press('Escape');await sleep(120);
  check((await tip()).n===0&&await page.locator('#board-info').evaluate(e=>!e.hidden),'Escape closes only the tooltip, not the Inspector around it');
  await page.keyboard.press('Escape');await sleep(250);
  check(await page.locator('#board-info').evaluate(e=>e.hidden),'the next Escape closes the Inspector');

  // Segmented items: no trigger wrapper anywhere; an item's hint follows the pointer and arrow keys.
  await rest();await hoverCard();await openItemDetails(card.locator('[data-item-controls]'));await page.locator('#workspace-item-controls .workspace-appearance-buttons').waitFor();await sleep(250);
  check(await page.evaluate(()=>document.querySelectorAll('.tk-seg > ui-tooltip-trigger, ui-segmented-control ui-tooltip-trigger').length)===0,'segmented items sit directly in their control (no trigger wrapper)');
  await page.mouse.move(640,700);await sleep(900);
  const compact=page.locator('#workspace-item-controls [data-presentation="card"]');p=await at(compact);await page.mouse.move(p.x,p.y,{steps:3});await sleep(750);t=await tip();
  check(t.n===1&&t.text==='Compact card','a segmented item shows its hint on hover',t);
  const segFace=await compact.evaluate(e=>({h:getComputedStyle(e).height,parentSeg:e.parentElement.classList.contains('tk-seg')}));
  check(segFace.parentSeg&&segFace.h==='28px','the theme\'s segmented rules reach the item',segFace);
  await page.mouse.move(640,700);await sleep(900);
  await compact.focus();await page.keyboard.press('ArrowRight');await sleep(80);t=await tip();
  const segFocus=await page.evaluate(()=>document.activeElement?.dataset?.tip||'');
  check(t.n===1&&t.text===segFocus&&segFocus==='Icon','arrowing along a segmented control moves the hint with focus',{t,segFocus});
  await page.keyboard.press('ArrowLeft');await sleep(80);
  await page.keyboard.press('Escape');await sleep(120);
  check((await tip()).n===0&&await page.locator('#workspace-item-controls').isVisible(),'Escape on a segmented item closes only its hint');
  await page.keyboard.press('Escape');await sleep(250);

  // A menu row's hint shows on hover, never while arrowing through the menu.
  await rest();await page.mouse.click(1240,700);await page.keyboard.press(process.platform==='darwin'?'Meta+a':'Control+a');await sleep(200);
  await page.locator('#workspace-selection [data-arrange-open]').click();const tidy=page.locator('.arrange-menu [data-arrange="tidy"]');await tidy.waitFor();
  await page.keyboard.press('t');await sleep(700);check((await tip()).n===0,'arrowing to a menu row opens no hint');
  p=await at(tidy);await page.mouse.move(p.x+30,p.y-60);await page.mouse.move(p.x,p.y,{steps:3});await sleep(750);t=await tip();
  check(t.n===1&&/Tidy the selection/.test(t.text),'a menu row shows its hint on hover',t);
  await page.keyboard.press('Escape');await sleep(120);
  t=await tip();check(t.n===0&&await tidy.isVisible(),'Escape over a menu closes the hint first',{t,vis:await tidy.isVisible()});
  await page.keyboard.press('Escape');await sleep(200);await page.keyboard.press('Escape');await sleep(150);

  // The opened Tinka has its own tooltip inside its dialog (the rest of the page is inert while it is open).
  await card.locator('[data-open]').first().click();await page.locator('#reader-dialog[open]').waitFor();await sleep(600);
  await page.mouse.move(5,5);await sleep(200);await rest();p=await at('#reader-star');await page.mouse.move(p.x,p.y);await sleep(800);
  t=await page.evaluate(()=>{const c=document.querySelector('ui-tooltip-content[data-open]');return {host:c?.closest('ui-tooltip')?.id,inDialog:!!c?.closest('#reader-dialog'),text:c?.textContent};});
  check(t.inDialog&&/Favorite/.test(t.text),'the reader\'s tooltip lives in the reader dialog',t);
  await page.keyboard.press('Escape');await sleep(150);
  check(await page.locator('#reader-dialog').evaluate(d=>d.open),'Escape over the reader closes the tooltip first');
  p=await at('#reader-next');await page.mouse.move(p.x,p.y,{steps:3});await sleep(800);t=await tip();
  check(/Next/.test(t.text)&&/[⌥]→|Ctrl\+→/.test(t.keys)&&/\]/.test(t.keys),'the reader\'s Next names this platform\'s keys',t);
  // The window sizes are segmented items in the % popover, with their hints.
  await rest();await page.locator('#reader-zoom-toggle').click();await sleep(300);
  const compactSize=page.locator('.reader-sizes [data-size="compact"]');
  check(await compactSize.evaluate(e=>e.parentElement.classList.contains('tk-seg')),'the reader\'s window sizes sit directly in their control');
  p=await at(compactSize);await page.mouse.move(p.x,p.y,{steps:3});await sleep(750);t=await tip();
  check(t.n===1&&t.text==='440 × 620','a window size shows its hint',t);
  await page.keyboard.press('Escape');await sleep(120);await page.keyboard.press('Escape');await sleep(150);

  // Home: an exact date and a cut-off title on the same tooltip, without native titles.
  await page.goto(base+'/');await page.locator('.board-card time[data-rel]').first().waitFor();await sleep(300);
  await page.mouse.move(5,5);await sleep(900);p=await at('.board-card time[data-rel]');await page.mouse.move(p.x,p.y);await sleep(800);
  t=await tip();check(t.n===1&&/\d{4}/.test(t.text),'Home: a relative date shows its exact time',t);
  check(await page.evaluate(()=>[...document.querySelectorAll('[title]')].filter(e=>e.tagName!=='IFRAME').length)===0,'Home: no native titles');
  await page.mouse.move(5,5);await sleep(900);
  const shortTitle=page.locator('.board-card h3',{hasText:/^Tooltips$/});p=await at(shortTitle);await page.mouse.move(p.x,p.y);await sleep(800);
  check((await tip()).n===0,'Home: a title that fits shows no tooltip');
  await page.mouse.move(5,5);await sleep(900);
  const longTitle=page.locator('.board-card h3',{hasText:/far too long/});p=await at(longTitle);await page.mouse.move(p.x,p.y);await sleep(800);
  t=await tip();check(t.n===1&&/far too long/.test(t.text),'Home: a title cut off shows itself in full',t);

  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:checks.length,evidence}));
} finally {await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
