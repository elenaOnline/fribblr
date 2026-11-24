// Headless check: a board opened as its own page has a zoom floor where all of it fits (100% at most; an empty board stops
// at 100%). Zooming out stops there (a gesture or press that reaches it, a held −), and a fresh zoom-out one step below
// goes up to the board it lives on: the parent she entered it from, in the view she entered from, else the parent's
// opening view centred on its card; the card selected and focused, Enter goes back in, and no other view is painted
// first. A board with several parents goes to the one she came from (?from=), else the one in its path. A board on Home
// goes Home, its tile selected and focused. A gesture still running after leaving an opened item stops at the board's
// floor. External fixtures only (ui-sdk.md § Zoom floor, back to the board, Expand).
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from '../cli.mjs';
import {loadConfig} from '../lib/config.mjs';
import {applyOperation} from '../lib/workspace.mjs';
import {listen,closeAppServer} from '../server.mjs';
import {sliderFromZoom} from '../public/canvas-zoom.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=await mkdtemp(path.join(os.tmpdir(),'tinka-board-zoom-out-'));
let server,browser,checks=0;const errors=[];
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
try{
 const file=path.join(root,'config.json');await main(['init','--config',file,'--boards',path.join(root,'boards'),'--label','Board zoom studio']);const config=await loadConfig(file);
 const op=async(type,fields)=>(await applyOperation(config,{type,...fields})).result;
 const assets=path.join(config.boardsRoot,'assets');await mkdir(assets);
 await writeFile(path.join(assets,'note.md'),'# A note\n\nOne paragraph.');
 await op('updateWorkspace',{patch:{resourceRoots:{assets:{path:'../assets'}}}});
 const note=(boardId,title,x,y)=>op('createItem',{boardId,item:{title,content:{kind:'markdown',resource:{rootId:'assets',path:'note.md'}}},placement:{x,y,width:320,height:240}});
 // top (on Home) holds kid's tile and empty's tile; other (on Home) shows kid's tile too. top and kid are wider than the
 // viewport, so their floors are below 100%.
 await op('createBoard',{id:'top',title:'Top board'});
 await op('createBoard',{id:'other',title:'Other board'});
 await note('top','Top left',0,0);await note('top','Top far',2600,1100);
 const kid=await op('createBoard',{id:'kid',title:'Kid board',parentBoardId:'top'});
 await op('updatePlacement',{boardId:'top',placementId:kid.placementIds[0],patch:{x:600,y:300}});
 const empty=await op('createBoard',{id:'empty',title:'Empty board',parentBoardId:'top'});
 await op('updatePlacement',{boardId:'top',placementId:empty.placementIds[0],patch:{x:1000,y:300}});
 await op('reference',{itemIds:[kid.itemId],targetBoardId:'other'});
 await op('createBoard',{id:'single',title:'Single card board',parentBoardId:'top'});await note('single','Only card',0,0);
 await note('kid','Kid left',0,0);await note('kid','Kid far',2400,1200);
 const kidTile=kid.placementIds[0];
 server=await listen(config,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
 const ws=await (await fetch(`${base}/api/workspace?view=graph&covers=0`)).json();
 const otherTile=ws.boards.find(b=>b.id==='other').placements.find(p=>p.itemId===kid.itemId)?.id;
 ok(otherTile,'Kid board is shown on two parents');
 ok(ws.homeBoardIds.includes('top')&&ws.homeBoardIds.includes('other')&&!ws.homeBoardIds.includes('kid'),'Top and Other are on Home; Kid is not');
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
 // Every painted frame's view while the canvas shows cards: the landing must not show another view first.
 await context.addInitScript(()=>{window.__frames=[];const tick=()=>{const v=document.getElementById('viewport'),w=document.getElementById('world'),p=document.getElementById('plane');if(v&&w&&p&&w.querySelector('.workspace-card')&&getComputedStyle(v).visibility!=='hidden')window.__frames.push(getComputedStyle(p).transform+'|'+getComputedStyle(w).transform);requestAnimationFrame(tick);};requestAnimationFrame(tick);});
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource|CORS/.test(m.text()))errors.push(m.text());});
 const zoom=()=>page.evaluate(()=>new DOMMatrix(getComputedStyle(document.getElementById('world')).transform).a);
 const boardView=()=>page.evaluate(()=>getComputedStyle(document.getElementById('plane')).transform+'|'+getComputedStyle(document.getElementById('world')).transform);
 const card=id=>page.locator(`#world .workspace-card[data-placement="${id}"]`);
 const boardPath=()=>new URL(page.url()).pathname;
 const load=async url=>{await page.goto(url,{waitUntil:'load'});await page.locator('#world .workspace-card').first().waitFor().catch(()=>{});await page.waitForTimeout(500);};
 const ctrlWheel=async(dy,gap=30)=>{await page.keyboard.down('Control');await page.mouse.wheel(0,dy);await page.keyboard.up('Control');await page.waitForTimeout(gap);};
 const newGesture=()=>page.waitForTimeout(400);
 const centre=()=>page.mouse.move(720,450);
 const waitBoard=async id=>{await page.waitForURL(u=>new URL(u).pathname===`/boards/${id}/`,{timeout:10000});await page.waitForTimeout(600);};
 const clearReturn=()=>page.evaluate(()=>{for(const k of Object.keys(sessionStorage))if(k.endsWith('/return-to-tile'))sessionStorage.removeItem(k);});
 const landed=async(id,label)=>{
  await page.waitForFunction(id=>document.activeElement?.closest?.('.workspace-card')?.dataset.placement===id,id,{timeout:4000}).catch(()=>{});
  const s=await page.evaluate(id=>{const c=document.querySelector(`#world .workspace-card[data-placement="${id}"]`),r=c.getBoundingClientRect(),v=document.getElementById('viewport').getBoundingClientRect();
   return {selected:c.classList.contains('selected'),focus:document.activeElement?.closest?.('.workspace-card')?.dataset.placement||null,dx:Math.abs(r.x+r.width/2-(v.x+v.width/2)),dy:Math.abs(r.y+r.height/2-(v.y+v.height/2)),inView:r.left>=v.left-1&&r.top>=v.top-1&&r.right<=v.right+1&&r.bottom<=v.bottom+1,frames:[...new Set(window.__frames)]};},id);
  ok(s.selected,`${label}: the card is selected`);eq(s.focus,id,`${label}: focus is on the card`);ok(s.inView,`${label}: the card is in view`);
  eq(s.frames.length,1,`${label}: no other view was painted before the landing (${s.frames.length} views)`);
  return s;
 };

 // (1) The floor: a wheel run into Kid from its tile stops where Kid fits; a held − stops; presets and slider agree.
 await load(`${base}/boards/top/`);
 const topView=await boardView();
 await card(kidTile).focus();await page.keyboard.press('Enter');await waitBoard('kid');
 ok(new URL(page.url()).search==='?from=top','Entering from the tile carries ?from=top');
 await centre();const z0=await zoom();
 for(let i=0;i<14;i++)await ctrlWheel(100);
 eq(boardPath(),'/boards/kid/','A wheel run from the opening zoom stops on Kid: no leaving in the same gesture');
 const floor=await zoom();ok(floor<z0&&floor<1,`It zoomed out to the floor (${floor.toFixed(3)})`);
 const fits=await page.evaluate(()=>{const v=document.getElementById('viewport').getBoundingClientRect();return [...document.querySelectorAll('#world .workspace-card')].every(c=>{const r=c.getBoundingClientRect();return r.width<v.width&&r.height<v.height;});});
 ok(fits,'At the floor every card is smaller than the view');
 eq(await page.locator('#zoom-slider').evaluate(el=>Number(el.min)),sliderFromZoom(floor),'The slider starts at the floor');
 await page.locator('#viewport').focus();await page.keyboard.press('=');await page.keyboard.press('=');
 for(let i=0;i<8;i++)await page.keyboard.down('-');await page.keyboard.up('-');await page.waitForTimeout(200);
 eq(boardPath(),'/boards/kid/','A held − from above the floor stops there and never leaves');eq(await zoom(),floor,'…and stays at the floor');
 await page.locator('#zoom-menu-toggle').click();await page.locator('#zoom-menu').waitFor({state:'visible'});
 if(floor>.5)eq(await page.locator('#zoom-menu [data-zoom-to="0.5"]').getAttribute('aria-disabled'),'true','Zoom to 50% is unavailable below the floor');
 await page.keyboard.press('Escape');
 await page.locator('#viewport').focus();await page.keyboard.press('=');await page.keyboard.press('-');
 eq(boardPath(),'/boards/kid/','− back down to the floor stops there');

 // (2) Leaving with a known view: Top opens in the view she entered Kid from, Kid's tile selected and focused.
 await centre();await newGesture();await ctrlWheel(100);
 await waitBoard('top');
 eq(await boardView(),topView,'Top opens in the view she entered Kid from');
 await landed(kidTile,'Kid → Top (view known)');
 await page.keyboard.press('Enter');await waitBoard('kid');checks++;  // Enter goes back in

 // (3) Leaving with no known view (a fresh load of Kid with ?from=top): Top's opening view, 100% at most, centred on the tile.
 await clearReturn();await load(`${base}/boards/kid/?from=top`);
 await page.locator('#viewport').focus();for(let i=0;i<12;i++)await page.keyboard.press('-');  // presses: the one at the floor stops, the next leaves
 await waitBoard('top');
 const fresh=await landed(kidTile,'Kid → Top (no known view)');
 ok(await zoom()<=1+1e-6,`Top's opening zoom, never above 100% (${(await zoom()).toFixed(3)})`);
 ok(fresh.dx<3&&fresh.dy<3,`The tile is centred (${fresh.dx.toFixed(1)}, ${fresh.dy.toFixed(1)} px off)`);

 // (4) Several parents: Kid entered from Other goes back to Other; with neither ?from= nor a tile, to the parent in its path.
 await clearReturn();await load(`${base}/boards/other/`);
 await card(otherTile).focus();await page.keyboard.press('Enter');await waitBoard('kid');
 ok(new URL(page.url()).search==='?from=other','Entered from Other');
 await page.locator('#viewport').focus();for(let i=0;i<12;i++)await page.keyboard.press('-');
 await waitBoard('other');await landed(otherTile,'Kid → Other (the parent she came from)');
 await clearReturn();await load(`${base}/boards/kid/`);
 await page.locator('#viewport').focus();for(let i=0;i<12;i++)await page.keyboard.press('-');
 await waitBoard('top');await landed(kidTile,'Kid → Top (no ?from=: the parent in its path)');

 // (5) An empty board: its floor is 100%; one − at 100% goes up; + then − stops at 100%.
 await clearReturn();await page.goto(`${base}/boards/empty/?from=top`,{waitUntil:'load'});await page.waitForTimeout(800);
 eq(Math.round(await zoom()*100),100,'An empty board opens at 100%');
 eq(await page.locator('#zoom-slider').evaluate(el=>Number(el.min)),sliderFromZoom(1),'Its floor is 100%');
 await page.locator('#viewport').focus();await page.keyboard.press('=');await page.keyboard.press('-');
 eq(boardPath(),'/boards/empty/','+ then − comes back to 100% and stops');
 await page.keyboard.press('-');await waitBoard('top');
 await landed(empty.placementIds[0],'Empty → Top');

 // (6) A board on Home goes Home: Top's tile selected and focused.
 await page.locator('#zoom-minus').click();await page.waitForTimeout(150);
 for(let i=0;i<12&&boardPath()!=='/';i++){await page.locator('#zoom-minus').click().catch(()=>{});await page.waitForTimeout(80);}
 await page.waitForURL(u=>new URL(u).pathname==='/',{timeout:10000});await page.waitForTimeout(800);
 const home=await page.evaluate(()=>({focus:document.activeElement?.closest?.('.board-card')?.dataset.homeBoard||null,selected:[...document.querySelectorAll('.board-card.workspace-home-selected')].map(c=>c.dataset.homeBoard)}));
 eq(home.focus,'top','Top → Home: its tile has focus');eq(home.selected,['top'],'…and is selected');
 await page.keyboard.press('Enter');await waitBoard('top');checks++;  // Enter goes back in

 // (7) Leaving an opened item at a board already at its floor: the rest of the gesture stops at the board's floor.
 await clearReturn();await load(`${base}/boards/kid/?from=top`);
 await page.locator('#viewport').focus();await centre();
 for(let i=0;i<14;i++)await ctrlWheel(100);
 const kidFloor=await zoom();
 const kidLeft=(await page.evaluate(()=>document.querySelector('#world .workspace-card')?.dataset.placement));
 await card(kidLeft).focus();await page.keyboard.press('Enter');await page.locator('#reader-dialog[open]').waitFor();await page.waitForTimeout(800);
 await centre();await newGesture();
 for(let i=0;i<8;i++)await ctrlWheel(100);
 await page.waitForTimeout(600);
 ok(!(await page.locator('#reader-dialog').evaluate(d=>d.open)),'The first notch leaves the opened item');
 eq(boardPath(),'/boards/kid/','…and the rest of that gesture stops at the board\'s floor, not going on up');
 eq(await zoom(),kidFloor,'…at the floor');

 // (8) At the floor all of the board is in view, wherever the pointer was and whatever the zoom-out input, at 1440 and
 // at phone width: the last stretch draws the view to the floor view (the content centred).
 const contained=()=>page.evaluate(()=>{const v=document.getElementById('viewport').getBoundingClientRect();const out=[...document.querySelectorAll('#world .workspace-card')].filter(c=>{const r=c.getBoundingClientRect();return r.left<v.left-1||r.top<v.top-1||r.right>v.right+1||r.bottom>v.bottom+1;});return {n:document.querySelectorAll('#world .workspace-card').length,out:out.length};});
 for(const [w,h] of [[1440,900],[390,844]]){
  await page.setViewportSize({width:w,height:h});
  for(const [label,px,py] of [['centre',w/2,h/2],['corner',30,140]]){
   await clearReturn();await load(`${base}/boards/top/`);
   await page.mouse.move(px,py);for(let i=0;i<4;i++)await ctrlWheel(-100);  // in first, about the pointer
   for(let i=0;i<24;i++)await ctrlWheel(100);
   eq(boardPath(),'/boards/top/',`${w}px, pointer at the ${label}: the run stops at the floor`);
   const c=await contained();ok(c.n>=4&&c.out===0,`${w}px, pointer at the ${label}: every card is inside the view at the floor (${c.out} of ${c.n} outside)`);
  }
  await clearReturn();await load(`${base}/boards/top/`);
  await page.locator('#viewport').focus();await page.keyboard.press('=');for(let i=0;i<24;i++)await page.keyboard.down('-');await page.keyboard.up('-');
  {const c=await contained();ok(c.out===0,`${w}px, held −: every card is inside the view at the floor (${c.out} outside)`);}
  await clearReturn();await load(`${base}/boards/top/`);
  await page.locator('#zoom-slider').evaluate(el=>{el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));});
  {const c=await contained();ok(c.out===0,`${w}px, slider to its minimum: every card is inside the view (${c.out} outside)`);}
 }
 // (9) The floor comes from the content, not a minimum frame: an empty board and a one-card board stop at 100% on a phone.
 for(const id of ['empty','single']){
  await clearReturn();await page.goto(`${base}/boards/${id}/?from=top`,{waitUntil:'load'});await page.waitForTimeout(700);
  eq(await page.locator('#zoom-slider').evaluate(el=>Number(el.min)),sliderFromZoom(1),`390px: ${id} board's floor is 100%`);
 }
 await page.setViewportSize({width:1440,height:900});
 eq(errors,[],'No page errors');
 console.log(`Board zoom out browser checks passed: ${checks}`);
}finally{await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true});}
