// Headless checks that the board's selection bar never squeezes its actions: in every
// place it can be put (its usual centre, beside an open Navigator or Inspector, raised
// beside wide zoom controls, left of an open map, a phone) each button keeps its whole
// label, no two buttons overlap, and the bar stays on screen. Uses only external fixtures.
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
const root=await mkdtemp(path.join(os.tmpdir(),'tinka-selection-bar-'));
const evidence=process.env.TINKA_EVIDENCE_DIR||await mkdtemp(path.join(os.tmpdir(),'tinka-selection-bar-evidence-'));await mkdir(evidence,{recursive:true});
let server,browser,checks=0;const errors=[];
const ok=(value,message)=>{assert.ok(value,message);checks++;};
try{
 const file=path.join(root,'config.json');await main(['init','--config',file,'--boards',path.join(root,'boards'),'--label','Selection bar studio']);const config=await loadConfig(file);
 const op=async(type,fields)=>(await applyOperation(config,{type,...fields})).result;
 await op('createBoard',{id:'small',title:'Small board'});
 const small=[];for(let i=0;i<3;i++)small.push((await op('createItem',{boardId:'small',item:{title:`Small ${i}`,content:{kind:'note',text:'A note.'}},placement:{x:i*300,y:0,width:240,height:160}})).placementIds[0]);
 // Large enough that the map opens by itself.
 await op('createBoard',{id:'large',title:'Large board'});
 const large=[];for(let row=0;row<4;row++)for(let col=0;col<6;col++)large.push((await op('createItem',{boardId:'large',item:{title:`Tile ${row}-${col}`,content:{kind:'note',text:'A note.'}},placement:{x:col*780,y:row*620,width:720,height:560}})).placementIds[0]);
 server=await listen(config,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'light',reducedMotion:'reduce'});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const bar=page.locator('#workspace-selection'),pill=page.locator('.canvas-footer .zoom-pill'),mapEl=page.locator('#board-map');
 const overlap=(a,b)=>a&&b&&a.x<b.x+b.width-.5&&a.x+a.width>b.x+.5&&a.y<b.y+b.height-.5&&a.y+a.height>b.y+.5;
 const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const open=async(id,width,height=900)=>{await page.setViewportSize({width,height});await page.goto(base+`/boards/${id}/`,{waitUntil:'load'});await page.locator('.workspace-card').first().waitFor();
  if(await page.locator('[data-mode="canvas"]').getAttribute('aria-checked')!=='true'){await page.locator('#board-info-toggle').click();await page.locator('[data-mode="canvas"]').click();await page.keyboard.press('Escape');}
  await settle();};
 const selectOne=async placement=>{await page.locator(`.workspace-card[data-placement="${placement}"] h3 button`).click({modifiers:['Shift']});await bar.waitFor();await settle();
  assert.match(await bar.locator('strong').innerText(),/^1 selected/);};
 // Every action keeps its whole label inside its own button, side by side, all on screen.
 const intact=async name=>{
  await settle();
  const state=await bar.evaluate(el=>{
   const box=r=>({x:r.left,y:r.top,width:r.width,height:r.height});
   const buttons=[...el.querySelectorAll('button')].map(b=>({label:b.textContent.trim()||b.getAttribute('aria-label'),box:box(b.getBoundingClientRect()),cut:b.scrollWidth>b.clientWidth+1}));
   return {bar:box(el.getBoundingClientRect()),buttons,rows:new Set(buttons.map(b=>Math.round(b.box.y))).size,scrolls:el.scrollWidth>el.clientWidth+1,viewport:innerWidth,page:document.documentElement.scrollWidth};});
  const {bar:b,buttons}=state;
  ok(buttons.length>=8,`${name}: the one-item actions are all there (${buttons.map(x=>x.label).join(', ')})`);
  ok(buttons.every(x=>!x.cut),`${name}: no label is cut: ${buttons.filter(x=>x.cut).map(x=>x.label).join(', ')}`);
  for(let i=0;i<buttons.length;i++)for(let j=i+1;j<buttons.length;j++)assert.ok(!overlap(buttons[i].box,buttons[j].box),`${name}: "${buttons[i].label}" and "${buttons[j].label}" overlap`);
  checks++;
  ok(!state.scrolls,`${name}: no action is scrolled out of the bar`);
  ok(b.x>=0&&b.x+b.width<=state.viewport&&b.y>=0,`${name}: the bar is on screen: ${JSON.stringify(b)}`);
  ok(state.page<=state.viewport,`${name}: no horizontal page scroll`);
  await page.screenshot({path:path.join(evidence,`selection-bar-${name}.png`)});
  return state;};
 const clear=async(locator,name)=>ok(!overlap(await bar.boundingBox(),await locator.boundingBox()),`${name}: the bar clears ${await locator.evaluate(el=>el.id||el.className)}`);

 // (1) Its usual place at 1440: one row, beside the status line or over a quiet one.
 await open('small',1440);await selectOne(small[0]);
 let state=await intact('1440');ok(state.rows===1,'1440: one row');await clear(pill,'1440');

 // (2) A wide window with the Navigator open: the bar is as wide as its actions, not
 // the room right of its centred left edge, so it stays one unsqueezed row.
 await open('small',1920);await selectOne(small[0]);
 await page.locator('#chrome-search').click();await page.locator('#project-navigator').waitFor();
 state=await intact('1920-navigator');ok(state.rows===1,'1920 with the Navigator: one row');await clear(page.locator('#project-navigator'),'1920-navigator');

 // (3) The Navigator kept open and the Inspector open at 1440: too little room for one
 // row, so the actions wrap; none is squeezed.
 await page.setViewportSize({width:1440,height:900});await settle();
 await page.locator('[data-nav-pin]').click();await page.locator('#board-info-toggle').click();await page.locator('#board-info').waitFor();
 ok(await page.locator('#project-navigator').isVisible(),'The kept-open Navigator stays beside the Inspector');
 state=await intact('1440-navigator-inspector');ok(state.rows>1,'1440 between Navigator and Inspector: the actions wrap');
 await clear(page.locator('#project-navigator'),'1440-navigator-inspector');await clear(page.locator('#board-info'),'1440-navigator-inspector');
 await page.locator('#board-info-toggle').click();await page.locator('[data-nav-pin]').click();await page.keyboard.press('Escape');

 // (4) Too narrow beside the zoom controls: raised above the footer row, still in the
 // free space left of them, its actions wrap there.
 await open('small',1000);await selectOne(small[1]);
 state=await intact('1000-raised');ok(state.rows>1,'1000 raised: the actions wrap');await clear(pill,'1000-raised');
 const raised=await bar.boundingBox(),controls=await pill.boundingBox();
 ok(raised.y+raised.height<=controls.y&&raised.x+raised.width<=controls.x,`1000: the bar is raised, left of the zoom controls: ${JSON.stringify(raised)}`);

 // (5) An open map beside it: the bar stays left of the map and wraps rather than squeezes.
 await open('large',1100);ok(await mapEl.isVisible(),'The map is open on the large board');
 await selectOne(large[0]);
 await intact('1100-map');await clear(mapEl,'1100-map');await clear(pill,'1100-map');
 await page.locator('#board-info-toggle').click();await page.locator('#board-info').waitFor();
 await intact('1100-map-inspector');await clear(mapEl,'1100-map-inspector');await clear(page.locator('#board-info'),'1100-map-inspector');
 await page.locator('#board-info-toggle').click();

 // (6) A phone: the bar spans the width and wraps.
 await open('small',390,844);await selectOne(small[0]);
 await intact('390');await clear(pill,'390');

 assert.deepEqual(errors,[]);checks++;
 console.log(JSON.stringify({passed:true,checks,evidence}));
}finally{
 await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true});
}
