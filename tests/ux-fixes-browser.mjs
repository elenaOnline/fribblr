// Headless checks for the keyboard and focus fixes found in review of the UI SDK branch: Tab out of the zoom popover
// and the Navigator (popups that live at the end of <body>) continues from their trigger; a card's context menu and
// Details… send focus back to the card (the ⋯ when it opened from the ⋯); Escape in the selection bar returns focus to
// the roving card; a card adds no duplicate Open Tab stop; the canvas focus ring is rounded; the Remove toast has Undo.
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
const root=await mkdtemp(path.join(os.tmpdir(),'tinka-ux-fixes-'));
let server,browser,checks=0;const errors=[];
const ok=(value,message)=>{assert.ok(value,message);checks++;};
try{
 const file=path.join(root,'config.json');await main(['init','--config',file,'--boards',path.join(root,'boards'),'--label','Fixes studio']);const config=await loadConfig(file);
 const op=async(type,fields)=>(await applyOperation(config,{type,...fields})).result;
 await op('createBoard',{id:'fixes',title:'Fixes'});
 for(const [title,x,y] of [['A1',0,0],['A2',300,0],['A3',600,0]])await op('createItem',{boardId:'fixes',item:{title,content:{kind:'note',text:`${title}.`}},placement:{x,y,width:240,height:160}});
 server=await listen(config,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
 const page=await(await browser.newContext({viewport:{width:1280,height:800},colorScheme:'light',reducedMotion:'reduce'})).newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/boards/fixes/',{waitUntil:'load'});await page.locator('.workspace-card').first().waitFor();
 if(await page.locator('[data-mode="canvas"]').getAttribute('aria-pressed')!=='true'){await page.locator('#board-info-toggle').click();await page.locator('[data-mode="canvas"]').click();await page.keyboard.press('Escape');}
 await page.waitForTimeout(300);
 const focused=()=>page.evaluate(()=>{const a=document.activeElement;return a?.matches?.('.workspace-card')?`card:${a.getAttribute('aria-label')}`:a?.classList?.contains('workspace-tile-more')?'more':a?.id||a?.tagName;});
 const wait=ms=>page.waitForTimeout(ms);

 // Card Tab order: select, ⋯, title, resize, Open, Comments, Favorite: one Open-like stop per capability.
 await page.locator('#viewport').focus();await page.keyboard.press('Tab');assert.equal(await focused(),'card:A1');checks++;
 const stops=await page.evaluate(()=>[...document.querySelectorAll('#world .workspace-card[tabindex="0"] :is(button,a)')].filter(e=>e.tabIndex>=0&&!e.disabled).map(e=>e.className||e.tagName));
 ok(!stops.some(c=>String(c).includes('workspace-preview-launch')),'The preview Open takes no Tab stop');
 ok(stops.some(c=>String(c).includes('workspace-tool-open')),'The toolbar Open stays a Tab stop');

 // The focus ring follows the card's shape.
 const ring=await page.evaluate(()=>parseFloat(getComputedStyle(document.querySelector('#world .workspace-card[tabindex="0"]'),'::after').borderTopLeftRadius));
 ok(ring>12,'The focus ring has rounded corners');

 // Card menu from the keyboard returns to the card, from the ⋯ to the ⋯.
 await page.locator('#world .workspace-card[tabindex="0"]').focus();
 await page.keyboard.press('Shift+F10');await wait(400);await page.keyboard.press('Escape');await wait(300);
 assert.equal(await focused(),'card:A1','Escape from a menu opened on the card returns to the card');checks++;
 await page.keyboard.press('Shift+F10');await wait(400);await page.keyboard.press('d');await page.keyboard.press('Enter');await wait(500);
 await page.keyboard.press('Escape');await wait(400);
 assert.equal(await focused(),'card:A1','Details… then Escape returns to the card');checks++;
 await page.locator('#world .workspace-card[tabindex="0"] .workspace-tile-more').focus();await page.keyboard.press('Enter');await wait(400);await page.keyboard.press('Escape');await wait(300);
 assert.equal(await focused(),'more','A menu opened from the ⋯ returns to the ⋯');checks++;

 // Escape in the selection bar.
 await page.locator('#world .workspace-card .workspace-select-dot').nth(1).evaluate(b=>b.click());await wait(500);
 await page.locator('#viewport').focus();await page.keyboard.press('Shift+Tab');await wait(200);
 ok(await page.evaluate(()=>!!document.activeElement.closest('#workspace-selection')),'Shift+Tab reaches the selection bar');
 // (a tooltip on the focused bar button takes the first Escape)
 for(let i=0;i<3&&await page.locator('#world .workspace-card.selected').count();i++){await page.keyboard.press('Escape');await wait(400);}
 ok((await focused()).startsWith('card:'),'Escape in the selection bar returns focus to a card, not <body>');

 // A fresh page where no card was ever focused: ⌘A, Arrange, Escape. The Arrange hint stays closed when focus returns to
 // it, the selection bar's Escape sends focus to the first card, and Item details returns to its own button.
 {
  const fresh=await page.context().newPage();fresh.on('pageerror',e=>errors.push(e.message));
  await fresh.goto(base+'/boards/fixes/',{waitUntil:'load'});await fresh.locator('.workspace-card').first().waitFor();await fresh.waitForTimeout(500);
  const tipOpen=()=>fresh.evaluate(()=>!!document.querySelector('ui-tooltip-content[data-open]'));
  const active=()=>fresh.evaluate(()=>{const a=document.activeElement;return a?.matches?.('.workspace-card')?`card:${a.getAttribute('aria-label')}`:a===document.body?'BODY':(a?.getAttribute('data-arrange-open')!==null&&a?.hasAttribute('data-arrange-open'))?'arrange':a?.hasAttribute('data-selection-details')?'details':a?.id||a?.tagName;});
  await fresh.locator('#viewport').focus();await fresh.keyboard.press('ControlOrMeta+a');await fresh.waitForTimeout(400);
  const arr=await fresh.locator('[data-arrange-open]').boundingBox();await fresh.mouse.click(arr.x+arr.width/2,arr.y+arr.height/2);await fresh.waitForTimeout(500);
  await fresh.mouse.move(640,500);await fresh.keyboard.press('Escape');await fresh.waitForTimeout(700);
  assert.equal(await active(),'arrange','Escape from the Arrange menu returns to Arrange');checks++;
  ok(!await tipOpen(),'The Arrange hint does not reopen when focus returns to it');
  for(let i=0;i<3&&await fresh.locator('#world .workspace-card.selected').count();i++){await fresh.keyboard.press('Escape');await fresh.waitForTimeout(400);}
  assert.equal(await active(),'card:A1','Escape in the selection bar with no card ever focused sends focus to the first card');checks++;
  // Item details from the bar: Escape closes the Inspector and focus returns to Details, with no hint.
  await fresh.locator('#world .workspace-card .workspace-select-dot').first().evaluate(b=>b.click());await fresh.waitForTimeout(400);
  const det=await fresh.locator('[data-selection-details]').boundingBox();await fresh.mouse.click(det.x+det.width/2,det.y+det.height/2);await fresh.waitForTimeout(500);
  await fresh.mouse.move(640,500);await fresh.keyboard.press('Escape');await fresh.waitForTimeout(600);
  assert.equal(await active(),'details','Closing the Inspector opened from the selection bar returns to Item details');checks++;
  ok(!await tipOpen(),'The Item details hint does not reopen when focus returns to it');
  await fresh.close();
 }

 // Zoom popover: Tab from the last control closes it and moves on from the trigger; Shift+Tab from the first goes back to it.
 await page.locator('#zoom-menu-toggle').focus();await page.keyboard.press('Enter');await wait(400);
 await page.keyboard.press('Shift+Tab');await wait(150);
 assert.equal(await focused(),'zoom-menu-toggle','Shift+Tab from the first control returns to the trigger');checks++;
 await page.keyboard.press('ArrowDown');await wait(400);
 for(let i=0;i<10&&await page.evaluate(()=>document.getElementById('zoom-popover').open);i++){await page.keyboard.press('Tab');await wait(100);}
 ok(!await page.evaluate(()=>document.getElementById('zoom-popover').open),'Tab out of the zoom popover closes it');
 ok(await page.evaluate(()=>!document.getElementById('zoom-menu').contains(document.activeElement)),'Focus is outside the closed popover');

 // Navigator: Tab past its last tree lands on the page after the toggle, never <body>.
 await page.locator('#viewport').focus();await page.keyboard.press('Meta+k');await wait(500);
 for(let i=0;i<4;i++){await page.keyboard.press('Tab');await wait(100);}
 const nav=await page.evaluate(()=>({tag:document.activeElement.tagName,inside:!!document.activeElement.closest('#project-navigator')}));
 ok(nav.tag!=='BODY'&&!nav.inside,'Tab past the Navigator leaves it for the page, not <body>');
 await page.keyboard.press('Escape');await wait(300);await page.mouse.click(5,5);

 // Remove toast carries Undo, and it restores the card.
 const count=()=>page.locator('#world .workspace-card').count();const n0=await count();
 await page.locator('#world .workspace-card').first().focus();await page.keyboard.press('Shift+F10');await wait(400);await page.keyboard.press('End');await page.keyboard.press('Enter');await wait(500);
 await page.getByRole('button',{name:/Remove from this board/}).click();await wait(1000);
 assert.equal(await count(),n0-1);checks++;
 const undo=page.locator('ui-toast').getByRole('button',{name:'Undo',exact:true});
 ok(await undo.count()>0,'The Remove toast has an Undo button');
 ok(!/Undo to restore/.test(await page.locator('ui-toast').first().innerText()),'The toast text is plain');
 await undo.last().click();await wait(1200);
 assert.equal(await count(),n0,'Undo in the toast restores the card');checks++;
 assert.deepEqual(errors,[]);checks++;
 console.log(`UX fixes browser checks passed: ${checks} assertions.`);
}finally{await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true});}
