// Headless checks for the board canvas keyboard (UI SDK canvas norms, public/ui-sdk.md § Surfaces › Board canvas):
// the board's items are one Tab stop that remembers the item focused last; arrows move focus to the nearest item
// that way (Left is screen-left); Home / End reach the first card / the last item; Space selects without moving focus and
// Enter opens the focused card, focus coming back to it; Option/Alt with an arrow moves the focused item (alone, or
// with the selection when it is selected), 10 units with Shift, while plain arrows never move anything; arrows on a
// focused resize handle resize; + / − / 0 zoom from a focused card; moves and resizes are announced.
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
const root=await mkdtemp(path.join(os.tmpdir(),'tinka-canvas-keys-'));
const evidence=process.env.TINKA_EVIDENCE_DIR||await mkdtemp(path.join(os.tmpdir(),'tinka-canvas-keys-evidence-'));await mkdir(evidence,{recursive:true});
let server,browser,checks=0;const errors=[];
const ok=(value,message)=>{assert.ok(value,message);checks++;};
try{
 const file=path.join(root,'config.json');await main(['init','--config',file,'--boards',path.join(root,'boards'),'--label','Keys studio']);const config=await loadConfig(file);
 const op=async(type,fields)=>(await applyOperation(config,{type,...fields})).result;
 await op('createBoard',{id:'keys',title:'Keys'});
 // A 3 × 2 grid of cards (review order deliberately not reading order) and one sticky to the right of the top row.
 const add=async(title,x,y)=>(await op('createItem',{boardId:'keys',item:{title,content:{kind:'note',text:`${title}.`}},placement:{x,y,width:240,height:160}})).placementIds[0];
 const c={};
 c.b1=await add('B1',0,260);c.a2=await add('A2',300,0);c.a1=await add('A1',0,0);c.a3=await add('A3',600,0);c.b2=await add('B2',300,260);c.b3=await add('B3',600,260);
 const sticky=(await op('createDecoration',{boardId:'keys',decoration:{type:'region',shape:'rounded',x:900,y:20,width:160,height:120,color:'#f3d36b',text:'Sticky'}})).decorationId;
 server=await listen(config,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1280,height:800},colorScheme:'light',reducedMotion:'reduce'});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/boards/keys/',{waitUntil:'load'});await page.locator('.workspace-card').first().waitFor();
 if(await page.locator('[data-mode="canvas"]').getAttribute('aria-pressed')!=='true'){await page.locator('#board-info-toggle').click();await page.locator('[data-mode="canvas"]').click();await page.keyboard.press('Escape');}
 await page.waitForTimeout(200);
 const focused=()=>page.evaluate(()=>{const a=document.activeElement;return a?.dataset?.placement?`card:${a.getAttribute('aria-label')}`:a?.dataset?.decoration?'sticky':a?.closest?.('.workspace-card')?`in:${a.closest('.workspace-card').getAttribute('aria-label')}:${a.className.split(' ')[0]}`:a?.id||a?.tagName;});
 const selected=()=>page.evaluate(()=>[...document.querySelectorAll('#world .workspace-card.selected')].map(c=>c.getAttribute('aria-label')).sort());
 const placement=async id=>(await (await fetch(`${base}/api/boards/keys`)).json()).placements.find(p=>p.id===id);
 const until=async(fn,ms=3000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,40));}return fn();};
 const announced=()=>page.evaluate(()=>[...document.querySelectorAll('[aria-live]')].map(e=>e.textContent.trim()).join(' | '));

 // One Tab stop for the board's items, and the first card holds it.
 const stops=await page.evaluate(()=>[...document.querySelectorAll('#world .workspace-card, #world [data-decoration]')].filter(e=>e.tabIndex===0).map(e=>e.getAttribute('aria-label')||e.dataset.decoration));
 assert.deepEqual(stops,['B1'],'Exactly one item is a Tab stop: the first card');checks++;
 const tabbable=await page.evaluate(()=>[...document.querySelectorAll('#world button,#world a[href],#world [tabindex]')].filter(e=>e.tabIndex>=0&&!e.disabled&&!e.closest('[hidden]')).every(e=>e.closest('.workspace-card')?.tabIndex===0||e.tabIndex===0&&e.matches('.workspace-card')));
 ok(tabbable,'Only the stop card and its own controls are in the Tab order');
 await page.locator('#viewport').focus();await page.keyboard.press('Tab');
 assert.equal(await focused(),'card:B1','Tab from the canvas lands on the stop card');checks++;
 await page.keyboard.press('Tab');
 ok((await focused()).startsWith('in:B1:'),'The next Tab reaches that card\'s own controls');
 await page.keyboard.press('Shift+Tab');assert.equal(await focused(),'card:B1');checks++;

 // Spatial arrows.
 const press=async(key,expect,message)=>{await page.keyboard.press(key);assert.equal(await focused(),expect,message||`${key} → ${expect}`);checks++;};
 await press('ArrowUp','card:A1');await press('ArrowRight','card:A2');await press('ArrowRight','card:A3');
 await press('ArrowRight','sticky','Right from A3 reaches the sticky');await press('ArrowLeft','card:A3');
 await press('ArrowDown','card:B3');await press('ArrowLeft','card:B2');await press('ArrowDown','card:B2','Nothing below: focus stays');
 await press('Home','card:B1','Home: the first card');await press('End','sticky','End: the last item (drawn elements follow the cards)');await press('ArrowLeft','card:A3');await press('ArrowDown','card:B3');
 // The stop follows focus: Tab out and back returns to the item focused last.
 await page.locator('#zoom-plus').focus();await page.locator('#viewport').focus();await page.keyboard.press('Tab');
 assert.equal(await focused(),'card:B3','Tab returns to the item focused last');checks++;
 assert.equal(await page.evaluate(()=>document.querySelectorAll('#world .workspace-card[tabindex="0"], #world [data-decoration][tabindex="0"]').length),1);checks++;

 // Plain arrows never move a card, even a selected one.
 const b3=await placement(c.b3);
 await page.keyboard.press('Space');assert.deepEqual(await selected(),['B3'],'Space selects the focused card');checks++;
 assert.equal(await focused(),'card:B3','Focus stays on the card');checks++;
 await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowRight');await page.waitForTimeout(250);
 ok((await placement(c.b3)).x===b3.x,'Plain arrows move focus, not the selection');
 assert.equal(await focused(),'card:B3');checks++;

 // Option/Alt + arrow: the focused selected card carries the selection.
 await press('ArrowLeft','card:B2');await page.keyboard.press('Space');assert.deepEqual(await selected(),['B2','B3']);checks++;
 const b2=await placement(c.b2);
 await page.keyboard.press('Alt+ArrowRight');
 ok(await until(async()=>(await placement(c.b2)).x===b2.x+1&&(await placement(c.b3)).x===b3.x+1),'Alt+→ on a selected card moves the whole selection 1 unit');
 ok(await until(async()=>(await announced()).includes('2 items moved to')),`The move is announced: ${await announced()}`);
 await page.keyboard.press('Alt+Shift+ArrowDown');
 ok(await until(async()=>(await placement(c.b2)).y===b2.y+10&&(await placement(c.b3)).y===b3.y+10),'Alt+Shift+↓ moves it 10 units');
 assert.equal(await focused(),'card:B2','Focus stays on the moved card');checks++;
 // An unselected focused card moves alone.
 await press('ArrowUp','card:A2');
 const a2=await placement(c.a2);
 await page.keyboard.press('Alt+ArrowLeft');
 ok(await until(async()=>(await placement(c.a2)).x===a2.x-1),'Alt+← on an unselected card moves just that card');
 ok((await placement(c.b2)).x===b2.x+1,'The selection stays where it was');
 ok(await until(async()=>(await announced()).includes('A2 moved to')),`Announced with its name: ${await announced()}`);
 // A focused drawn element moves too.
 await press('ArrowRight','card:A3');await press('ArrowRight','sticky');
 const sy=(await (await fetch(`${base}/api/boards/keys`)).json()).decorations.find(d=>d.id===sticky).y;
 await page.keyboard.press('Alt+ArrowDown');
 ok(await until(async()=>(await (await fetch(`${base}/api/boards/keys`)).json()).decorations.find(d=>d.id===sticky).y===sy+1),'Alt+↓ on a focused sticky moves it');
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');

 // Resize handle: arrows move the bottom-right corner, 10 with Shift; the minimum holds.
 await page.locator(`.workspace-card[data-placement="${c.a1}"]`).focus();
 const handle=page.locator(`.workspace-card[data-placement="${c.a1}"] .workspace-resize`);
 assert.equal(await handle.getAttribute('aria-label'),'Resize bottom right of A1');checks++;
 await handle.focus();const a1=await placement(c.a1);
 await page.keyboard.press('ArrowRight');
 ok(await until(async()=>(await placement(c.a1)).width===a1.width+1),'→ on the handle widens the card');
 await page.keyboard.press('Shift+ArrowDown');
 ok(await until(async()=>(await placement(c.a1)).height===a1.height+10),'Shift+↓ on the handle makes it 10 units taller');
 const a1r=await placement(c.a1);ok(a1r.x===a1.x&&a1r.y===a1.y,'Resizing never moves the card');
 ok(await until(async()=>(await announced()).includes(`A1 resized to ${a1.width+1} by ${a1.height+10}`)),`The resize is announced: ${await announced()}`);
 for(let i=0;i<12;i++){await page.keyboard.press('Shift+ArrowLeft');await page.waitForTimeout(120);}
 ok(await until(async()=>(await placement(c.a1)).width===160),'Width stops at the 160 minimum');
 ok((await focused()).endsWith(':workspace-resize'),'Focus stays on the handle');

 // Zoom keys from a focused card.
 await page.locator(`.workspace-card[data-placement="${c.a1}"]`).focus();
 const zoom=()=>page.evaluate(()=>new DOMMatrix(getComputedStyle(document.getElementById('world')).transform).a);
 const z0=await zoom();
 await page.keyboard.press('=');ok(await zoom()>z0,'+ zooms in from a focused card');
 await page.keyboard.press('-');await page.keyboard.press('-');ok(await zoom()<z0,'− zooms out');
 await page.keyboard.press('0');ok(Math.abs(await zoom()-1)<1e-6,'0 shows 100%');
 ok((await page.locator('#view-announce').textContent()).includes('Zoom 100%'),'The zoom is announced');

 // Enter opens the focused card (not the selected one); Escape brings focus back to it.
 await page.locator(`.workspace-card[data-placement="${c.a3}"]`).focus();
 await page.keyboard.press('Enter');await page.locator('#reader-dialog[open]').waitFor();
 assert.equal((await page.locator('#reader-name').textContent()).trim(),'A3','Enter opens the focused card');checks++;
 await page.keyboard.press('Escape');await page.locator('#reader-dialog').waitFor({state:'hidden'});
 ok(await until(async()=>(await focused())==='card:A3'),`Closing it returns focus to the card: ${await focused()}`);
 await page.screenshot({path:path.join(evidence,'canvas-keyboard-focus-1280.png')});

 // A click makes the clicked card the Tab stop.
 await page.locator(`.workspace-card[data-placement="${c.b1}"] .workspace-item-footer`).first().click({modifiers:['Shift'],position:{x:12,y:10}});
 await page.locator('#viewport').focus();await page.keyboard.press('Tab');
 assert.equal(await focused(),'card:B1','After a click, Tab lands on the clicked card');checks++;
 // ] steps the selection and focus follows to the stepped card.
 await page.keyboard.press('Escape');
 await page.keyboard.press(']');
 ok(await until(async()=>(await selected()).length===1),'] selects one card');
 ok(await until(async()=>(await focused())===`card:${(await selected())[0]}`),'Focus follows the step to its card');
 assert.deepEqual(errors,[]);checks++;
 console.log(`Canvas keyboard browser checks passed: ${checks} assertions. Evidence: ${evidence}`);
}finally{await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true});}
