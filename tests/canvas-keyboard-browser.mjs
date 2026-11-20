// Headless checks for the board canvas keyboard (UI SDK canvas norms, public/ui-sdk.md § Surfaces › Board canvas):
// the board's items are one Tab stop that remembers the item focused last; arrows move focus to the nearest item
// that way (Left is screen-left); Home / End reach the first card / the last item; Space selects without moving focus and
// Enter opens the focused card, focus coming back to it; Option/Alt with an arrow moves the focused item (alone, with
// the selection when it is selected, with its group when it is grouped), 10 units with Shift, while plain arrows never
// move anything; arrows on a focused resize corner resize (cards, shapes, stickers); + / − / 0 zoom from a focused
// item; moves and resizes are announced. Containers are composite items: Enter goes in, the arrows stay among its
// members, Option-arrow reorders a member, Escape comes back out. Controls inside items (task boxes, version tickers)
// leave the Tab order unless their item holds the stop.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
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
 const add=async(title,x,y,board='keys')=>(await op('createItem',{boardId:board,item:{title,content:{kind:'note',text:`${title}.`}},placement:{x,y,width:240,height:160}})).placementIds[0];
 const c={};
 c.b1=await add('B1',0,260);c.a2=await add('A2',300,0);c.a1=await add('A1',0,0);c.a3=await add('A3',600,0);c.b2=await add('B2',300,260);c.b3=await add('B3',600,260);
 const sticky=(await op('createDecoration',{boardId:'keys',decoration:{type:'region',shape:'rounded',x:900,y:20,width:160,height:120,color:'#f3d36b',text:'Sticky'}})).decorationId;

 // Tinka 1.3's board things: containers (a stack of text, a grid), a group (a card and a region), a sticker, a text
 // block holding a task box, and a version stack card.
 await op('createBoard',{id:'things',title:'Things'});
 const assets=path.join(config.boardsRoot,'assets');await mkdir(assets);
 for(const name of ['page-v01.html','page-v02.html','page-v03.html'])await writeFile(path.join(assets,name),`<!doctype html><p>${name}</p>`);
 await op('updateWorkspace',{patch:{resourceRoots:{assets:{path:'../assets'}}}});
 const stackCard=(await op('createItem',{boardId:'things',item:{id:'stacked',title:'Stacked page',content:{kind:'html',resource:{rootId:'assets',path:'page-v01.html'}}},
   placement:{x:1300,y:0,width:320,height:240,presentation:{mode:'card'}}})).placementIds[0];
 const g1=await add('G1',700,300,'things');
 const text=(id,body,x=0,y=0)=>({id,type:'text',x,y,width:200,height:50,text:body,color:'#456139'});
 for(const decoration of [
   text('t1','One'),text('t2','Two'),text('t3','Three'),
   {id:'stack',type:'region',x:0,y:0,width:260,height:220,text:'Stack',color:'#dbe5d3',container:{layout:'vertical',children:['t1','t2','t3']}},
   text('g-a','GA'),text('g-b','GB'),text('g-c','GC'),text('g-d','GD'),
   {id:'grid',type:'region',x:0,y:420,width:460,height:200,text:'Grid',color:'#dbe5d3',container:{layout:'grid',columns:2,children:['g-a','g-b','g-c','g-d']}},
   {id:'rocket',type:'text',text:'🚀',sticker:true,x:700,y:0,width:112,height:112,color:'palette:neutral'},
   {id:'region',type:'region',shape:'rounded',x:1000,y:300,width:200,height:150,text:'Grouped region',color:'#dbe5d3'},
   text('todo','- [ ] A task to tick',700,620),
   {id:'note',type:'region',shape:'rectangle',x:1300,y:420,width:180,height:120,text:'A sticky note',color:'#f3d36b'},
 ]) await op('createDecoration',{boardId:'things',decoration});
 const group=(await op('groupOccurrences',{boardId:'things',placementIds:[g1],decorationIds:['region']})).groupId;
 ok(group,'The fixture has a group');

 server=await listen(config,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,args:['--mute-audio'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1280,height:800},colorScheme:'light',reducedMotion:'reduce'});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const mod=process.platform==='darwin'?'Meta':'Control';
 await page.goto(base+'/boards/keys/',{waitUntil:'load'});await page.locator('.workspace-card').first().waitFor();
 if(await page.locator('[data-mode="canvas"]').getAttribute('aria-pressed')!=='true'){await page.locator('#board-info-toggle').click();await page.locator('[data-mode="canvas"]').click();await page.keyboard.press('Escape');}
 await page.waitForTimeout(300);
 const focused=()=>page.evaluate(()=>{const a=document.activeElement;return a?.dataset?.placement?`card:${a.getAttribute('aria-label')}`:a?.dataset?.decoration?`drawn:${a.dataset.decoration}`:a?.closest?.('.workspace-card')?`in:${a.closest('.workspace-card').getAttribute('aria-label')}:${a.className.split(' ')[0]}`:a?.closest?.('[data-decoration]')?`in:${a.closest('[data-decoration]').dataset.decoration}:${a.className.split(' ')[0]}`:a?.id||a?.tagName;});
 const selected=()=>page.evaluate(()=>[...document.querySelectorAll('#world .workspace-card.selected')].map(c=>c.getAttribute('aria-label')).sort());
 let board='keys';
 const snapshot=async()=>(await fetch(`${base}/api/boards/${board}`)).json();
 const placement=async id=>(await snapshot()).placements.find(p=>p.id===id);
 const decoration=async id=>(await snapshot()).decorations.find(d=>d.id===id);
 const until=async(fn,ms=3000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,40));}return fn();};
 const announced=()=>page.evaluate(()=>[...document.querySelectorAll('[aria-live]')].map(e=>e.textContent.trim()).join(' | '));
 const press=async(key,expect,message)=>{await page.keyboard.press(key);assert.equal(await focused(),expect,message||`${key} → ${expect}`);checks++;};

 // One Tab stop for the board's items, and the first card holds it.
 const stops=await page.evaluate(()=>[...document.querySelectorAll('#world .workspace-card, #world [data-decoration]')].filter(e=>e.tabIndex===0).map(e=>e.getAttribute('aria-label')||e.dataset.decoration));
 assert.deepEqual(stops,['B1'],'Exactly one item is a Tab stop: the first card');checks++;
 const onlyStop=()=>page.evaluate(()=>[...document.querySelectorAll('#world button,#world a[href],#world [tabindex]')].filter(e=>e.tabIndex>=0&&!e.disabled&&!e.closest('[hidden]'))
   .every(e=>(e.closest('.workspace-card,[data-decoration]')?.tabIndex===0)));
 ok(await onlyStop(),'Only the stop item and its own controls are in the Tab order');
 await page.locator('#viewport').focus();await page.keyboard.press('Tab');
 assert.equal(await focused(),'card:B1','Tab from the canvas lands on the stop card');checks++;
 await page.keyboard.press('Tab');
 ok((await focused()).startsWith('in:B1:'),`The next Tab reaches that card's own controls: ${await focused()}`);
 await page.keyboard.press('Shift+Tab');assert.equal(await focused(),'card:B1');checks++;

 // Spatial arrows.
 await press('ArrowUp','card:A1');await press('ArrowRight','card:A2');await press('ArrowRight','card:A3');
 await press('ArrowRight',`drawn:${sticky}`,'Right from A3 reaches the sticky');await press('ArrowLeft','card:A3');
 await press('ArrowDown','card:B3');await press('ArrowLeft','card:B2');await press('ArrowDown','card:B2','Nothing below: focus stays');
 await press('Home','card:B1','Home: the first card');await press('End',`drawn:${sticky}`,'End: the last item (drawn elements follow the cards)');await press('ArrowLeft','card:A3');await press('ArrowDown','card:B3');
 // The stop follows focus: Tab out and back returns to the item focused last.
 await page.locator('#viewport').focus();await page.keyboard.press('Tab');
 assert.equal(await focused(),'card:B3','Tab returns to the item focused last');checks++;
 assert.equal(await page.evaluate(()=>document.querySelectorAll('#world .workspace-card[tabindex="0"], #world [data-decoration][tabindex="0"]').length),1);checks++;

 // Plain arrows never move a card, even a selected one.
 const b3=await placement(c.b3);
 await page.keyboard.press('Space');assert.deepEqual(await selected(),['B3'],'Space selects the focused card');checks++;
 assert.equal(await focused(),'card:B3','Focus stays on the card');checks++;
 ok(await until(async()=>(await announced()).includes('B3 selected. 1 selected.')),`Selecting is announced: ${await announced()}`);
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
 await press('ArrowRight','card:A3');await press('ArrowRight',`drawn:${sticky}`);
 const sy=(await decoration(sticky)).y;
 await page.keyboard.press('Alt+ArrowDown');
 ok(await until(async()=>(await decoration(sticky)).y===sy+1),'Alt+↓ on a focused sticky moves it');
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');

 // Escape in the selection bar clears the selection and sends focus back to the board's roving item.
 await page.locator(`.workspace-card[data-placement="${c.a2}"]`).focus();await page.keyboard.press('Space');
 await page.locator('#workspace-selection button:not([hidden])').first().focus();await page.waitForTimeout(100);
 // A tooltip shown by that focus takes the first Escape (UI SDK: Escape closes only the tooltip).
 if(await page.locator('ui-tooltip-content[data-open]').count()){await page.keyboard.press('Escape');ok(await until(async()=>!(await page.locator('ui-tooltip-content[data-open]').count())),'The first Escape closes the tooltip');}
 await page.keyboard.press('Escape');
 ok(await until(async()=>(await selected()).length===0),'Escape in the selection bar clears the selection');
 ok(await until(async()=>(await focused())==='card:A2'),`Focus goes back to the item focused last: ${await focused()}`);
 // Resize corner: arrows move the bottom-right corner, 10 with Shift; the minimum holds.
 await page.locator(`.workspace-card[data-placement="${c.a1}"]`).focus();
 const handle=page.locator(`.workspace-card[data-placement="${c.a1}"] .workspace-resize`);
 assert.equal(await handle.getAttribute('aria-label'),'Resize bottom right of A1');checks++;
 await handle.focus();const a1=await placement(c.a1);
 await page.keyboard.press('ArrowRight');
 ok(await until(async()=>(await placement(c.a1)).width===a1.width+1),'→ on the corner widens the card');
 await page.keyboard.press('Shift+ArrowDown');
 ok(await until(async()=>(await placement(c.a1)).height===a1.height+10),'Shift+↓ on the corner makes it 10 units taller');
 const a1r=await placement(c.a1);ok(a1r.x===a1.x&&a1r.y===a1.y,'Resizing never moves the card');
 ok(await until(async()=>(await announced()).includes(`A1 resized to ${a1.width+1} by ${a1.height+10}`)),`The resize is announced: ${await announced()}`);
 for(let i=0;i<12;i++){await page.keyboard.press('Shift+ArrowLeft');await page.waitForTimeout(120);}
 ok(await until(async()=>(await placement(c.a1)).width===160),'Width stops at the 160 minimum');
 ok((await focused()).endsWith(':workspace-resize'),'Focus stays on the corner');

 // Zoom keys from a focused card.
 await page.locator(`.workspace-card[data-placement="${c.a1}"]`).focus();
 const zoom=()=>page.evaluate(()=>new DOMMatrix(getComputedStyle(document.getElementById('world')).transform).a);
 const z0=await zoom();
 await page.keyboard.press('=');ok(await zoom()>z0,'+ zooms in from a focused card');
 await page.keyboard.press('-');await page.keyboard.press('-');ok(await zoom()<z0,'− zooms out');
 await page.keyboard.press('0');ok(Math.abs(await zoom()-1)<1e-6,'0 shows 100%');
 ok((await page.locator('#view-announce').textContent()).includes('Zoom 100%'),'The zoom is announced');

 // Enter opens the focused card (not the selected one); Escape brings focus back to it.
 await page.locator(`.workspace-card[data-placement="${c.b2}"]`).focus();await page.keyboard.press('Space');
 await page.locator(`.workspace-card[data-placement="${c.a3}"]`).focus();
 await page.keyboard.press('Enter');await page.locator('#reader-dialog[open]').waitFor();
 assert.equal((await page.locator('#reader-name').textContent()).trim(),'A3','Enter opens the focused card, not the selected one');checks++;
 await page.keyboard.press('Escape');await page.locator('#reader-dialog').waitFor({state:'hidden'});
 ok(await until(async()=>(await focused())==='card:A3'),`Closing it returns focus to the card: ${await focused()}`);
 await page.screenshot({path:path.join(evidence,'canvas-keyboard-focus-1280.png')});
 await page.keyboard.press('Escape');

 // A click makes the clicked card the Tab stop.
 await page.locator(`.workspace-card[data-placement="${c.b1}"] .workspace-item-footer`).first().click({modifiers:['Shift'],position:{x:12,y:10}});
 await page.locator('#viewport').focus();await page.keyboard.press('Tab');
 assert.equal(await focused(),'card:B1','After a click, Tab lands on the clicked card');checks++;
 // J steps the selection and focus follows to the stepped card; on a Mac ⌥→ no longer steps.
 await page.keyboard.press('Escape');
 await page.keyboard.press('j');
 ok(await until(async()=>(await selected()).length===1),'J selects one card');
 ok(await until(async()=>(await focused())===`card:${(await selected())[0]}`),'Focus follows the step to its card');
 // ] brings the focused, selected card to the front (1.4) and never steps; focus and the selection stay on it.
 {const card=await focused(),held=await selected();
  const sent=page.waitForRequest(r=>r.url().endsWith('/api/operations')&&r.postDataJSON()?.type==='restackOccurrences',{timeout:3000});
  await page.keyboard.press(']');
  ok((await sent.then(r=>r.postDataJSON()?.to).catch(()=>null))==='front','] writes Bring to front');
  await page.waitForTimeout(300);
  assert.deepEqual(await selected(),held,'] does not step the selection');checks++;
  ok(await until(async()=>(await focused())===card),'Focus stays on the card after Bring to front');}
 // While a keyboard move is still being written, Space on a select circle still presses it (the key queue must not
 // swallow a button's native press), and a second Option-arrow waits its turn instead of racing the first.
 await page.keyboard.press('Escape');
 let release,barrier;const hold=()=>{barrier=new Promise(r=>{release=r;});};hold();
 await page.route('**/api/operations',async route=>{if(route.request().postDataJSON()?.type==='translatePlacements')await barrier;await route.continue().catch(()=>{});});
 await page.locator(`.workspace-card[data-placement="${c.a3}"]`).focus();const a3=await placement(c.a3);
 await page.keyboard.press('Alt+ArrowRight');await page.keyboard.press('Alt+ArrowRight');await page.waitForTimeout(150);
 release();
 ok(await until(async()=>(await placement(c.a3)).x===a3.x+2,6000),'Both Option-arrow presses land, the second after the first: 2 units');
 await page.waitForTimeout(300);hold();
 await page.keyboard.press('Alt+ArrowLeft');await page.waitForTimeout(150);
 await page.locator(`.workspace-card[data-placement="${c.b1}"] [data-placement-select]`).focus();await page.keyboard.press('Space');
 ok(await until(async()=>(await selected()).includes('B1')),'Space on a select circle works while a move is being saved');
 release();await page.waitForTimeout(500);await page.unroute('**/api/operations');

 // ---- Tinka 1.3's board things ----
 board='things';
 await page.goto(base+'/boards/things/',{waitUntil:'load'});await page.locator('.workspace-card').first().waitFor();await page.waitForTimeout(400);
 await page.locator('#fit').click();await page.waitForTimeout(300);
 const firstStop=await page.evaluate(()=>document.querySelector('#world [tabindex="0"]')?.dataset.placement);
 assert.equal(firstStop,stackCard,'The first card on the board itself holds the stop at first');checks++;
 await page.locator('#world [data-decoration="rocket"]').focus();
 ok(await onlyStop(),'Task boxes, version tickers and handles inside items are out of the Tab order unless their item holds the stop');
 const tickerTabbable=()=>page.evaluate(id=>[...document.querySelectorAll(`#world .workspace-card[data-placement="${id}"] .workspace-file-versions button`)].map(b=>b.tabIndex),stackCard);
 ok((await tickerTabbable()).length===3&&(await tickerTabbable()).every(t=>t===-1),'A version stack\'s ticker is out of the Tab order while another item holds the stop');
 await page.locator(`.workspace-card[data-placement="${stackCard}"]`).focus();
 // The ticker is a toolbar (‹ name ›): one Tab stop after the card, arrows along it.
 ok((await tickerTabbable()).filter(t=>t===0).length===1&&(await tickerTabbable())[0]===0,'Focused, the version stack card brings its ticker into the Tab order after it, as one stop');
 const taskTab=()=>page.evaluate(()=>document.querySelector('#world [data-decoration="todo"] [data-deco-task]')?.tabIndex);
 assert.equal(await taskTab(),-1,'A text block\'s task box is out of the Tab order while another item holds the stop');checks++;
 await page.locator('#world [data-decoration="todo"]').focus();
 assert.equal(await taskTab(),0,'Focused, the text block brings its task box after it');checks++;

 // A container is one item on the board: the arrows outside pass over its members.
 await page.locator('#world [data-decoration="stack"]').focus();
 await page.keyboard.press('ArrowDown');
 assert.equal(await focused(),'drawn:grid','Down from the stack goes to the next item on the board, not into the stack');checks++;
 await press('ArrowUp','drawn:stack');
 // Enter goes in, onto the first member; arrows stay among the members.
 await press('Enter','drawn:t1','Enter on a container goes in, to its first member');
 ok(await until(async()=>(await announced()).includes('Stack: 3 items')),`Going in is announced: ${await announced()}`);
 await press('ArrowDown','drawn:t2');await press('ArrowDown','drawn:t3');
 await press('ArrowDown','drawn:t3','The arrows stay inside the container');await press('ArrowRight','drawn:t3');
 await press('Home','drawn:t1','Home: the container\'s first member');await press('End','drawn:t3','End: its last member');
 // Escape comes back out; Enter goes back to the member focused last.
 await press('Escape','drawn:stack','Escape on a member goes back to its container');
 await press('Enter','drawn:t3','Enter returns to the member focused last');
 // Option-arrow reorders a member inside its container (one place; Shift to the end), and focus stays on it.
 await page.keyboard.press('Alt+ArrowUp');
 ok(await until(async()=>JSON.stringify((await decoration('stack')).container.children)===JSON.stringify(['t1','t3','t2'])),'Alt+↑ on a stack member moves it one place up');
 ok(await until(async()=>(await announced()).includes('Dropped Three at position 2 of 3')),`The reorder is announced: ${await announced()}`);
 assert.equal(await focused(),'drawn:t3','Focus stays on the moved member');checks++;
 await page.keyboard.press('Alt+Shift+ArrowUp');
 ok(await until(async()=>(await decoration('stack')).container.children[0]==='t3'),'Alt+Shift+↑ moves it to the first place');
 await page.waitForTimeout(300);
 await page.keyboard.press('Alt+ArrowLeft');await page.waitForTimeout(300);
 assert.deepEqual((await decoration('stack')).container.children,['t3','t1','t2'],'Left does not move a member of a stack');checks++;
 await page.keyboard.press(`${mod}+z`);
 ok(await until(async()=>(await decoration('stack')).container.children[0]==='t1'),'One undo step per reorder');
 // The undo's toast is announced through the same polite announcer, batched a moment after it shows: let it speak
 // before the next reorder, whose announcement it would otherwise replace.
 const spoken=text=>page.evaluate(text=>[...document.querySelectorAll('[data-ui-sdk-announcer]')].some(e=>e.textContent.includes(text)),text);
 ok(await until(()=>spoken('Undid arrange in container.')),`The undo is announced: ${await announced()}`);
 // In a grid, Option+↓ moves a member down a row.
 await page.locator('#world [data-decoration="grid"]').focus();await press('Enter','drawn:g-a');
 await page.keyboard.press('Alt+ArrowDown');
 ok(await until(async()=>JSON.stringify((await decoration('grid')).container.children)===JSON.stringify(['g-b','g-c','g-a','g-d'])),'Alt+↓ in a 2-column grid moves a member one row down');
 ok(await until(async()=>(await announced()).includes('Dropped GA at position 3 of 4')),`Announced: ${await announced()}`);
 await page.keyboard.press('Escape');

 // Groups: Space on a grouped item selects the whole group, as a click does; Option-arrow on an unselected grouped
 // item carries its group, as dragging it does.
 await page.locator(`.workspace-card[data-placement="${g1}"]`).focus();
 await page.keyboard.press('Space');
 ok(await until(async()=>(await announced()).includes('Group of 2 selected')),`The group is selected and announced: ${await announced()}`);
 ok(await page.evaluate(()=>document.querySelector('#world [data-decoration="region"]').classList.contains('selected')),'The grouped region is selected with the card');
 await page.keyboard.press('Escape');await page.waitForTimeout(150);
 const gp=await placement(g1),gr=await decoration('region');
 await page.keyboard.press('Alt+ArrowRight');
 ok(await until(async()=>(await placement(g1)).x===gp.x+1&&(await decoration('region')).x===gr.x+1),'Alt+→ on an unselected grouped card moves its group');
 // Grouping by keyboard: Space adds each, ⌘/Ctrl-G groups, Space on one selects the group, ⌘/Ctrl-G ungroups.
 await page.locator('#world [data-decoration="rocket"]').focus();await page.keyboard.press('Space');
 await page.locator('#world [data-decoration="todo"]').focus();await page.keyboard.press('Space');
 await page.keyboard.press(`${mod}+g`);
 ok(await until(async()=>(await snapshot()).groups.some(g=>g.decorationIds.includes('rocket')&&g.decorationIds.includes('todo'))),'⌘/Ctrl-G groups what Space selected');
 const drawnSelected=()=>page.evaluate(()=>document.querySelectorAll('#world .workspace-decoration.selected').length);
 ok(await until(async()=>await page.locator('#chrome-undo').isEnabled()&&await drawnSelected()===2),'The new group stays selected');
 await page.keyboard.press('Escape');
 ok(await until(async()=>await drawnSelected()===0),'Escape clears it');
 await page.locator('#world [data-decoration="rocket"]').focus();await page.keyboard.press('Space');
 await page.keyboard.press(`${mod}+g`);
 ok(await until(async()=>!(await snapshot()).groups.some(g=>g.decorationIds.includes('rocket'))),'Space on a grouped item, then ⌘/Ctrl-G, ungroups');
 // The server has it before the board has re-read it: wait for the board to settle, as for grouping above, so the
 // Escape lands on the settled selection (else the next Space toggles a still-selected sticker off).
 ok(await until(()=>page.evaluate(()=>!document.getElementById('workspace-paste')?.disabled&&!document.getElementById('chrome-undo')?.matches('[disabled],[aria-disabled=true]'))),'The ungroup settles');
 await page.keyboard.press('Escape');
 ok(await until(async()=>await drawnSelected()===0),'Escape clears the selection');

 // A selected sticker or shape has a keyboard resize corner; a sticker keeps its proportions.
 await page.locator('#world [data-decoration="rocket"]').focus();await page.keyboard.press('Space');
 const corner=page.locator('#world [data-decoration="rocket"] [data-decoration-resize="se"]');
 await corner.waitFor();
 assert.equal(await corner.getAttribute('aria-label'),'Resize bottom right of sticker 🚀');checks++;
 await corner.focus();const r0=await decoration('rocket');
 await page.keyboard.press('Shift+ArrowRight');
 ok(await until(async()=>(await decoration('rocket')).width>r0.width),'Shift+→ on a sticker\'s corner makes it bigger');
 const r1=await decoration('rocket');ok(Math.abs(r1.width/r1.height-r0.width/r0.height)<.01,'The sticker keeps its proportions');
 ok(await until(async()=>(await announced()).includes('resized to')),`The resize is announced: ${await announced()}`);
 ok(await until(async()=>(await focused()).startsWith('in:rocket:')),`Focus stays on the corner: ${await focused()}`);
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 await page.locator('#world [data-decoration="note"]').focus();await page.keyboard.press('Space');
 const noteCorner=page.locator('#world [data-decoration="note"] [data-decoration-resize="se"]');await noteCorner.waitFor();await noteCorner.focus();
 const s0=await decoration('note');
 await page.keyboard.press('ArrowDown');
 ok(await until(async()=>(await decoration('note')).height===s0.height+1),'↓ on a shape\'s corner makes it 1 unit taller');
 await page.screenshot({path:path.join(evidence,'canvas-keyboard-things-1280.png')});

 assert.deepEqual(errors,[]);checks++;
 console.log(`Canvas keyboard browser checks passed: ${checks} assertions. Evidence: ${evidence}`);
}finally{await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true});}
