// Toolbars, toggle groups, segmented controls and value controls behave as UI SDK specifies (toolbar.md, toggle.md,
// segmented-control.md, radio.md, slider.md): one Tab stop per toolbar or group on the item focused last, arrows move
// along it (and wrap, Home/End jump) without pressing anything, a segmented control checks as you arrow, a menu button
// opens on ArrowDown, and a scrub handle steps by arrows, large steps by Shift and Page keys, and saves once.
// Isolated fixtures only; headless.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from '../cli.mjs';
import {loadConfig} from '../lib/config.mjs';
import {applyOperation,getBoardSnapshot} from '../lib/workspace.mjs';
import {createAppServer,closeAppServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const fixture=await mkdtemp(path.join(os.tmpdir(),'tinka-toolbars-'));
let server,browser,checks=0;
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const eq=(a,b,message)=>{assert.equal(a,b,message);checks++;};
try{
 const configFile=path.join(fixture,'local/config.json');
 await main(['init','--config',configFile,'--boards',path.join(fixture,'boards'),'--label','Toolbars fixture']);
 const config=await loadConfig(configFile),board=(await applyOperation(config,{type:'createBoard',title:'Toolbars'})).result;
 const op=operation=>applyOperation(config,{...operation,boardId:board.boardId});
 const placements=[];
 for(let i=0;i<3;i++)placements.push((await op({type:'createItem',item:{title:`Note ${i}`,content:{kind:'note',text:'A note.'}},placement:{x:i*300,y:600,width:240,height:160}})).result.placementIds[0]);
 for(const decoration of [
  {id:'words',type:'text',x:20,y:20,width:280,height:70,color:'#7a8a68',text:'Write something'},
  {id:'a1',type:'line',x:400,y:40,width:200,height:60,color:'#6c8060',text:'',endArrow:true,from:{x:400,y:40},to:{x:600,y:100}},
  {id:'box',type:'region',x:20,y:160,width:260,height:200,color:'#dbe5d3',text:'Container',container:{layout:'grid',gap:12,padding:16,columns:2,children:[]}},
 ])await op({type:'createDecoration',decoration});
 server=createAppServer(config);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
 const page=await browser.newPage({viewport:{width:1280,height:860}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${url}/boards/${board.boardId}/`);await page.locator('[data-decoration=words]').waitFor();
 const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,60)))));
 const focused=()=>page.evaluate(()=>{const a=document.activeElement;return a?(a.dataset.whiteboardAction||a.dataset.editTool||a.dataset.bulk||a.dataset.layoutMetric||a.dataset.swatch||a.id||a.getAttribute('aria-label')||a.textContent.trim())+(a.dataset.value?':'+a.dataset.value:''):null;});
 const stops=selector=>page.locator(selector).evaluateAll(list=>list.filter(b=>b.getClientRects().length&&!b.closest('[hidden]')).map(b=>b.tabIndex));
 const find=async id=>(await getBoardSnapshot(config,board.boardId)).decorations.find(d=>d.id===id);
 const key=async(k,n=1)=>{for(let i=0;i<n;i++)await page.keyboard.press(k);await settle();};
 const idle=()=>page.waitForFunction(()=>document.getElementById('workspace-paste')?.disabled===false&&!document.querySelector('.whiteboard-bar-status'));
 const select=async id=>{await idle();await page.locator(`[data-decoration="${id}"] [data-decoration-label]`).click();await page.locator('.whiteboard-arrow-bar').waitFor();await settle();};
 const eventually=async(read,done)=>{let value;for(let i=0;i<100;i++){value=await read();if(done(value))return value;await page.waitForTimeout(50);}return value;};

 // ---- the canvas tools rail: one toolbar, the tool choices are toggle groups, arrows never press ----
 const rail=page.locator('#edit-tools');
 eq(await rail.evaluate(el=>el.tagName.toLowerCase()),'ui-toolbar','the tools rail is a ui-toolbar');
 eq(await rail.getAttribute('role'),'toolbar');eq(await rail.getAttribute('aria-label'),'Canvas tools');
 eq((await stops('#edit-tools button')).filter(t=>t===0).length,1,'one Tab stop in the rail');
 await page.locator('#edit-tools [data-edit-tool=pointer]').focus();
 await key('ArrowRight');eq(await focused(),'pan','an arrow moves along the rail');
 eq(await page.locator('#edit-tools [data-edit-tool=pointer]').getAttribute('aria-pressed'),'true','moving focus did not press Pan');
 await key('ArrowRight',2);eq(await focused(),'sticky','arrows pass from the navigation tools to the drawing tools');
 // the last key is Point and type (pointing-mode.js adds it to the rail)
 await key('End');eq(await focused(),'Point and type');await key('ArrowLeft');eq(await focused(),'comment','the comment tool before it');
 await key('ArrowRight',2);eq(await focused(),'pointer','arrows wrap');
 await key('ArrowLeft');eq(await focused(),'Point and type','arrows wrap backwards');
 await key('Home');await key('ArrowRight');await key('Space');
 eq(await page.locator('#edit-tools [data-edit-tool=pan]').getAttribute('aria-pressed'),'true','Space presses the focused tool');
 eq(await page.locator('#edit-tools [data-edit-tool=pointer]').getAttribute('aria-pressed'),'false','one navigation tool at a time');
 await page.locator('#edit-tools [data-edit-tool=pointer]').click();
 eq(await page.locator('#edit-tools [data-edit-tool=pointer]').getAttribute('aria-pressed'),'true','a click chooses a tool');
 await page.locator('#edit-tools [data-edit-tool=comment]').focus();await key('Enter');
 eq(await page.locator('#edit-tools [data-edit-tool=comment]').getAttribute('aria-pressed'),'true','Enter puts the comment tool down');
 await key('Enter');eq(await page.locator('#edit-tools [data-edit-tool=pointer]').getAttribute('aria-pressed'),'true','pressing Comment again goes back to the pointer');
 // The rail and the map are toggle items of the view pill.
 const pillStops=await stops('.canvas-footer .zoom-pill button');
 eq(pillStops.filter(t=>t===0).length,1,'one Tab stop in the zoom pill');
 await page.locator('#edit-tools-toggle').focus();await key('Space');
 ok(await rail.evaluate(el=>el.hidden),'the rail toggle hides the rail');
 eq(await page.locator('#edit-tools-toggle').getAttribute('aria-pressed'),'false');
 await key('Space');ok(!await rail.evaluate(el=>el.hidden),'and shows it again');

 // ---- the zoom pill: ArrowDown opens the % menu, Left and Right keep moving ----
 await page.locator('#zoom-minus').focus();await key('ArrowRight');eq(await focused(),'zoom-menu-toggle');
 await key('ArrowRight');eq(await focused(),'zoom-plus');
 await key('Home');eq(await focused(),'zoom-minus');await key('End');eq(await focused(),'fit');
 await key('ArrowRight');eq(await focused(),'zoom-minus','the pill wraps');
 await page.locator('#zoom-menu-toggle').focus();await key('ArrowDown');
 await page.waitForFunction(()=>document.querySelector('#zoom-menu-toggle').getAttribute('aria-expanded')==='true');checks++;
 await key('Escape');

 // ---- the selection bar: one Tab stop, built once, so a focused action survives a selection change ----
 await page.locator(`[data-placement="${placements[0]}"] .workspace-select-dot`).click({force:true});
 const bar=page.locator('#workspace-selection');await bar.waitFor();
 eq(await bar.evaluate(el=>el.tagName.toLowerCase()),'ui-toolbar');
 const first=await bar.evaluate(el=>el.querySelector('[data-bulk=move]')?.tagName);ok(first,'Move… is there');
 eq((await stops('#workspace-selection button')).filter(t=>t===0).length,1,'one Tab stop in the selection bar');
 await bar.locator('[data-bulk=move]').focus();await key('ArrowRight');
 ok(await focused()!=='move','an arrow moves along the bar instead of nudging the card');
 const before=await page.evaluate(id=>{const c=document.querySelector(`[data-placement="${id}"]`);return c.style.left+c.style.top+c.style.transform+getComputedStyle(c).left;},placements[0]);
 await key('ArrowRight');
 eq(await page.evaluate(id=>{const c=document.querySelector(`[data-placement="${id}"]`);return c.style.left+c.style.top+c.style.transform+getComputedStyle(c).left;},placements[0]),before,'the selected card did not move');
 await key('Home');const homeStop=await focused();await key('End');eq(await focused(),'clear','End goes to the last action');
 await key('ArrowRight');eq(await focused(),homeStop,'the bar wraps');
 // A selection change updates the bar in place: the same elements, so a focused action would keep focus (a click elsewhere moves it, as anywhere).
 await page.evaluate(()=>{window.__bulkMove=document.querySelector('#workspace-selection [data-bulk=move]');});
 await page.locator(`[data-placement="${placements[1]}"] .workspace-select-dot`).click({force:true});await settle();
 ok(await page.evaluate(()=>window.__bulkMove===document.querySelector('#workspace-selection [data-bulk=move]')),'the bar keeps its elements across a selection change');
 ok(/^\d+ selected$/.test(await bar.locator('strong').innerText()),'and still shows its count');
 await page.locator('#viewport').focus();await key('Escape');

 // ---- the object bar: choices are toggle groups, popup buttons open on ArrowDown ----
 const arrowMid=id=>page.evaluate(id=>{const p=document.querySelector(`[data-decoration="${id}"] .whiteboard-line-hit`),svg=p.ownerSVGElement,pt=p.getPointAtLength(p.getTotalLength()/2),[tx,ty]=p.parentNode.getAttribute('transform').match(/-?[\d.]+/g).map(Number),view=svg.viewBox.baseVal,r=svg.getBoundingClientRect();return {x:r.left+(pt.x+tx)*r.width/view.width,y:r.top+(pt.y+ty)*r.height/view.height};},id);
 await idle();{const m=await arrowMid('a1');await page.mouse.click(m.x,m.y);}await page.locator('.whiteboard-arrow-bar').waitFor();await settle();
 const objectBar=page.locator('.whiteboard-toolbar');
 eq(await objectBar.evaluate(el=>el.tagName.toLowerCase()),'ui-toolbar','the object bar is a ui-toolbar');
 eq((await stops('.whiteboard-toolbar button')).filter(t=>t===0).length,1,'one Tab stop in the object bar');
 eq(await objectBar.locator('ui-toggle-group[aria-label="Arrow route"]').count(),1,'the route choice is a toggle group');
 await objectBar.locator('[data-whiteboard-action=route][data-value=straight]').focus();
 await key('ArrowRight');eq(await focused(),'route:elbow','an arrow moves to the next route');
 eq((await find('a1')).route??'straight','straight','moving along the bar chooses nothing');
 await key('Space');
 eq((await eventually(()=>find('a1'),d=>d.route==='elbow')).route,'elbow','Space chooses it');
 eq(await objectBar.locator('[data-whiteboard-action=route][data-value=elbow]').getAttribute('aria-pressed'),'true');
 await page.keyboard.press('Escape');

 // ---- a container's options: Gap, Padding and Columns are one segmented control (a radio group) ----
 await select('box');
 await page.locator('[data-whiteboard-action=container-layout]').waitFor({timeout:5000});
 await page.locator('[data-whiteboard-action=container-layout]').focus();await key('ArrowDown');
 await page.locator('.container-layout-metrics').waitFor();
 const metrics=page.locator('.container-layout-metrics');
 eq(await metrics.getAttribute('role'),'radiogroup');eq(await metrics.getAttribute('aria-label'),'Layout spacing');
 deepEq(await metrics.locator('[role=radio]').allTextContents(),['Gap','Padding','Columns'],'a grid offers Gap, Padding and Columns');
 await page.waitForFunction(()=>document.activeElement?.dataset?.layoutMetric==='gap');checks++;
 await key('ArrowRight');eq(await focused(),'padding','an arrow moves to Padding');
 eq(await metrics.locator('[data-layout-metric=padding]').getAttribute('aria-checked'),'true','and checks it');
 await key('ArrowRight');await key('ArrowRight');eq(await focused(),'gap','the control wraps');
 await key('ArrowLeft');await settle();
 await page.waitForFunction(()=>document.querySelector('.container-column-options'));checks++;
 eq(await page.locator('.container-column-options [aria-checked=true]').getAttribute('data-columns'),'2','Columns shows the current count');
 await page.locator('.container-column-options [data-columns="3"]').click();
 eq((await eventually(()=>find('box'),d=>d.container.columns===3)).container.columns,3,'choosing a column count saves it');
 await page.keyboard.press('Escape');

 // ---- the scrub handle: presets are a radio group; the handle steps by arrows, large by Shift, saves once ----
 await select('words');
 await objectBar.locator('[data-whiteboard-action=text-size]').waitFor();
 await objectBar.locator('[data-whiteboard-action=text-size]').focus();await key('ArrowDown');
 const presets=page.locator('.whiteboard-menu .preset-scrub-presets');await presets.waitFor();
 eq(await presets.getAttribute('role'),'radiogroup','the size presets are a radio group');
 await presets.locator('[data-scrub-preset=large]').click();
 eq((await eventually(()=>find('words'),d=>d.textSize==='large')).textSize,'large','a preset is saved when chosen');
 const handle=page.locator('.whiteboard-menu [data-scrub-value]');
 await handle.focus();const read=()=>handle.getAttribute('aria-valuenow').then(Number);
 const start=await read();eq(start,36,'Large is 36');
 // Holding an arrow previews on each repeat and saves once, when the key comes up.
 for(let i=0;i<3;i++)await page.keyboard.down('ArrowRight');
 eq(await read(),start+3,'each repeat of an arrow steps by one');
 await page.waitForTimeout(250);eq((await find('words')).textSize,'large','nothing is saved while the key is down');
 await page.keyboard.up('ArrowRight');
 eq((await eventually(()=>find('words'),d=>d.textSize===39)).textSize,39,'the value is saved once, when the key comes up');
 await key('Shift+ArrowRight');eq(await read(),49,'Shift with an arrow takes a large step (ten steps)');
 await key('PageUp');eq(await read(),59,'Page Up takes a large step');
 await key('PageDown');eq(await read(),49,'Page Down takes a large step back');
 await key('Home');eq(await read(),10,'Home goes to the minimum');await key('End');eq(await read(),144,'End goes to the maximum');
 eq((await eventually(()=>find('words'),d=>d.textSize===144)).textSize,144,'End saved the maximum');

 ok(!errors.length,`no page errors: ${errors.join('; ')}`);
 console.log(JSON.stringify({passed:true,checks}));
}finally{
 await browser?.close();if(server)await closeAppServer(server);await rm(fixture,{recursive:true,force:true});
}
function deepEq(a,b,message){assert.deepEqual(a.map(t=>t.trim()),b,message);checks++;}
