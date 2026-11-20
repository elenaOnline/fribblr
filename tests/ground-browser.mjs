// Background (the ground: blue desk or flat white) is a kept choice for this browser: switched from Home's Appearance menu
// and the board Inspector, kept across reloads on Home and boards, on <html> before the first frame, light only.
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
const root=await mkdtemp(path.join(os.tmpdir(),'tinka-ground-'));
let server,browser;const errors=[];
// What <html> carries at the first animation frame (before the first paint) and when <body> is first parsed.
const FIRST=()=>{if(window.top!==window)return;window.__first={};
  requestAnimationFrame(()=>{const d=document.documentElement.dataset;window.__first.frame={ground:d.ground,appearance:d.appearance};});
  new MutationObserver((_,observer)=>{if(!document.body)return;const d=document.documentElement.dataset;window.__first.body={ground:d.ground,appearance:d.appearance};observer.disconnect();}).observe(document,{childList:true,subtree:true});};
try{
  const file=path.join(root,'config.json');
  await main(['init','--config',file,'--boards',path.join(root,'boards'),'--label','Ground study']);
  const config=await loadConfig(file);
  await applyOperation(config,{type:'createBoard',id:'study',title:'Ground study'});
  await applyOperation(config,{type:'createItem',boardId:'study',item:{id:'note',title:'A note',content:{kind:'note',text:'On the ground'}},placement:{x:0,y:0,width:320,height:200,presentation:{mode:'card'}}});
  server=await listen(config,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,args:['--mute-audio'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'light'});await context.addInitScript(FIRST);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const html=name=>page.locator('html').getAttribute(name);
  const first=async()=>{await page.waitForFunction(()=>window.__first?.frame&&window.__first?.body);return page.evaluate(()=>window.__first);};
  const stored=()=>page.evaluate(()=>localStorage.getItem('tinka/ground'));

  // Home: desk by default; the Appearance menu is closed until asked for, and reachable by keyboard.
  await page.goto(base+'/');await page.locator('.board-card').first().waitFor();
  assert.equal(await html('data-ground'),'desk');
  const trigger=page.getByRole('button',{name:'Appearance',exact:true});
  const ground=page.getByRole('radiogroup',{name:'Background',exact:true});
  assert.equal(await ground.isVisible(),false,'The Background choice is not on screen until the menu opens');
  await trigger.focus();await page.keyboard.press('Enter');
  await ground.waitFor();assert.equal(await trigger.getAttribute('aria-expanded'),'true');
  assert.deepEqual(await ground.getByRole('radio').allTextContents(),['Blue','White']);
  assert.equal(await ground.getByRole('radio',{name:'Blue'}).getAttribute('aria-checked'),'true');
  await ground.getByRole('radio',{name:'White'}).focus();await page.keyboard.press('Space');
  assert.equal(await html('data-ground'),'white');assert.equal(await stored(),'white');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(255, 255, 255)','White is a flat white ground');
  await page.keyboard.press('Escape');assert.equal(await ground.isVisible(),false);
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Appearance','Escape returns focus to the button');

  // Kept: a reload of the board and of Home carries White on <html> before the first frame.
  await page.goto(base+'/boards/study/');await page.locator('.workspace-card').first().waitFor();
  let at=await first();
  assert.deepEqual(at.body,{ground:'white',appearance:'light'},'Board: ground set before <body> is parsed');
  assert.deepEqual(at.frame,{ground:'white',appearance:'light'},'Board: ground set at the first frame');
  await page.reload();await page.locator('.workspace-card').first().waitFor();
  assert.equal((await first()).frame.ground,'white');
  await page.goto(base+'/');await page.locator('.board-card').first().waitFor();
  at=await first();
  assert.deepEqual(at.body,{ground:'white',appearance:'light'},'Home: ground set before <body> is parsed');
  assert.deepEqual(at.frame,{ground:'white',appearance:'light'},'Home: ground set at the first frame');

  // The board Inspector carries the same choice, beside Mode, under Appearance.
  await page.goto(base+'/boards/study/');await page.locator('.workspace-card').first().waitFor();
  await page.locator('#board-info-toggle').click();
  const inspector=page.locator('#board-info .inspector-appearance');await inspector.waitFor();
  const boardGround=inspector.getByRole('radiogroup',{name:'Background',exact:true});
  assert.equal(await boardGround.getByRole('radio',{name:'White'}).getAttribute('aria-checked'),'true');
  await boardGround.getByRole('radio',{name:'Blue'}).click();
  assert.equal(await html('data-ground'),'desk');assert.equal(await stored(),'desk');
  await boardGround.getByRole('radio',{name:'White'}).click();assert.equal(await html('data-ground'),'white');

  // Dark has one ground: White is kept for light, and the row cannot be changed while dark.
  const mode=inspector.getByRole('radiogroup',{name:'Appearance mode'});
  await mode.getByRole('radio',{name:'Dark'}).click();
  assert.equal(await html('data-appearance'),'dark');assert.equal(await html('data-ground'),'desk');
  assert.equal(await boardGround.getByRole('radio',{name:'White'}).isDisabled(),true);assert.equal(await stored(),'white');
  await page.reload();await page.locator('.workspace-card').first().waitFor();
  assert.deepEqual((await first()).body,{ground:'desk',appearance:'dark'},'Dark reloads dark, on its own ground');
  await page.evaluate(()=>localStorage.setItem('tinka/appearance','light'));await page.reload();await page.locator('.workspace-card').first().waitFor();
  assert.equal((await first()).body.ground,'white','Back in light, White returns');

  // Another tab follows the change.
  const other=await context.newPage();other.on('pageerror',e=>errors.push(e.message));
  await other.goto(base+'/');await other.locator('.board-card').first().waitFor();
  await page.evaluate(()=>localStorage.setItem('tinka/ground','desk'));
  await other.waitForFunction(()=>document.documentElement.dataset.ground==='desk');await other.close();

  // 390 wide: the menu is one button in the masthead and opens inside the screen.
  await page.setViewportSize({width:390,height:844});await page.goto(base+'/');await page.locator('.board-card').first().waitFor();
  await trigger.click();await ground.waitFor();
  const box=await page.locator('.appearance-pop').boundingBox();
  assert.ok(box.x>=0&&box.x+box.width<=390,`Menu fits the screen: ${box.x}..${box.x+box.width}`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No sideways scroll');
  await ground.getByRole('radio',{name:'White'}).click();assert.equal(await html('data-ground'),'white');
  await page.mouse.click(200,600);assert.equal(await ground.isVisible(),false,'Click-away closes the menu');

  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:['home menu by keyboard','kept on board and home before first frame','board inspector','dark has one ground','other tab follows','390 wide']}));
}finally{await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
