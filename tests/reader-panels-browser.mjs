// Headless checks for the UI SDK behaviour of the opened item, the Inspectors, the top bars and the board map
// (public/ui-sdk.md § Opened item, § Inspectors, § Top bars, § Board map):
// - the reader: focus on Tinka at open, Tab wraps inside it, Escape peels one layer, focus back to the card;
// - the stepper (ui-pagination): at the end its step keeps focus and says it is disabled;
// - the board, item and Tinka Inspectors (non-modal ui-dialog): first control on open, Escape returns focus to the
//   opener (or, after ⌘I, to what had focus), Tab leaves and the panel stays open, outside press closes;
// - the top bars' commands (ui-toolbar): one Tab stop, arrows, Home/End, disabled Undo reachable;
// - the board map: its head is a toolbar, Escape anywhere in it closes it, 0 shows 100%.
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
const root=await mkdtemp(path.join(os.tmpdir(),'tinka-reader-panels-'));
const evidence=process.env.TINKA_EVIDENCE_DIR||await mkdtemp(path.join(os.tmpdir(),'tinka-reader-panels-evidence-'));await mkdir(evidence,{recursive:true});
let server,browser,checks=0;const errors=[];
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
try{
 const file=path.join(root,'config.json');await main(['init','--config',file,'--boards',path.join(root,'boards'),'--label','Panels studio']);const config=await loadConfig(file);
 const op=async(type,fields)=>(await applyOperation(config,{type,...fields})).result;
 await op('createBoard',{id:'notes',title:'Notes board'});
 const ids=[];
 for(let i=0;i<3;i++)ids.push((await op('createItem',{boardId:'notes',item:{title:`Note ${i+1}`,content:{kind:'note',text:`Note number ${i+1}.`}},placement:{x:i*420,y:0,width:360,height:280}})).placementIds[0]);
 // A large board: the map opens by itself.
 await op('createBoard',{id:'large',title:'Large board'});
 for(let row=0;row<4;row++)for(let col=0;col<6;col++)await op('createItem',{boardId:'large',item:{title:`Tile ${row}-${col}`,content:{kind:'note',text:'A note.'}},placement:{x:col*900,y:row*700,width:800,height:600}});
 server=await listen(config,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'light',reducedMotion:'reduce'});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const focused=()=>page.evaluate(()=>{const a=document.activeElement;return a?.id||a?.getAttribute('aria-label')||a?.dataset?.placement||a?.tagName;});
 const isFocused=selector=>page.locator(selector).first().evaluate(el=>el===document.activeElement||el.contains(document.activeElement));
 const open=async id=>{await page.goto(`${base}/boards/${id}/`,{waitUntil:'load'});await page.locator('.workspace-card').first().waitFor();
  if(await page.locator('[data-mode="canvas"]').getAttribute('aria-pressed')!=='true'){await page.locator('#board-info-toggle').click();await page.locator('[data-mode="canvas"]').click();await page.keyboard.press('Escape');}
  await page.waitForTimeout(150);};
 const card=id=>page.locator(`.workspace-card[data-placement="${id}"]`);
 const readerOpen=()=>page.locator('#reader-dialog').evaluate(d=>d.open);
 const keyOff=async(key,{selector='#viewport'}={})=>{await page.locator(selector).focus();await page.keyboard.press(key);};

 // (1) The top bar: navigation links each a Tab stop, then one toolbar of commands.
 await open('notes');
 eq(await page.locator('#chrome-actions').getAttribute('role'),'toolbar','The board\'s commands are a toolbar');
 eq(await page.locator('#chrome-actions').getAttribute('aria-label'),'Board actions','…named Board actions');
 await page.locator('#chrome-search').focus();
 await page.keyboard.press('Tab');
 ok(!(await page.locator('#chrome-actions').evaluate(el=>el.contains(document.activeElement))),'Tab leaves the toolbar after one stop');
 await page.keyboard.press('Shift+Tab');
 eq(await focused(),'chrome-search','Shift+Tab comes back to the item focused last');
 await page.keyboard.press('ArrowRight');eq(await focused(),'chrome-undo','→ moves along the toolbar');
 eq(await page.locator('#chrome-undo').getAttribute('aria-disabled'),'true','Undo with nothing to undo says it is disabled and stays reachable');
 ok(await page.locator('#chrome-undo').isDisabled(),'…and reads as disabled');
 await page.keyboard.press('End');eq(await focused(),'workspace-add','End goes to the last command');
 await page.keyboard.press('ArrowRight');eq(await focused(),'chrome-search','→ wraps to the first');
 await page.keyboard.press('Home');eq(await focused(),'chrome-search','Home goes to the first command');
 ok(await page.locator('#canvas-header .identity a.brand').evaluate(el=>el.tabIndex===0),'Home link stays its own Tab stop');

 // (2) The board Inspector: non-modal dialog.
 const boardInfo=page.locator('#board-info');
 await page.locator('#board-info-toggle').click();await boardInfo.waitFor({state:'visible'});
 eq(await boardInfo.getAttribute('role'),'dialog','The Inspector is a dialog');
 ok(await page.locator('#board-info').evaluate(el=>el.querySelector('.calm-side-body').contains(document.activeElement)),'Opening focuses the first control of its body, not the ×');
 await page.keyboard.press('Escape');await boardInfo.waitFor({state:'hidden'});
 eq(await focused(),'board-info-toggle','Escape inside returns focus to the toggle');
 eq(await page.locator('#board-info-toggle').getAttribute('aria-expanded'),'false','The toggle says it is closed');
 await keyOff(process.platform==='darwin'?'Meta+i':'Control+i');await boardInfo.waitFor({state:'visible'});
 await page.keyboard.press('Escape');await boardInfo.waitFor({state:'hidden'});
 eq(await focused(),'viewport','Opened with ⌘I from the canvas, Escape returns focus to the canvas');
 await page.locator('#board-info-toggle').click();await boardInfo.waitFor({state:'visible'});
 for(let i=0;i<60&&await page.locator('#board-info').evaluate(el=>el.contains(document.activeElement));i++)await page.keyboard.press('Tab');
 ok(!(await page.locator('#board-info').evaluate(el=>el.contains(document.activeElement))),'Tab leaves the Inspector');
 ok(await boardInfo.isVisible(),'…and the Inspector stays open (non-modal)');
 const empty=await page.evaluate(()=>{for(let y=200;y<700;y+=20)for(let x=40;x<700;x+=20){const el=document.elementFromPoint(x,y);if(el&&['viewport','plane','world'].includes(el.id))return{x,y};}return null;});
 await page.mouse.click(empty.x,empty.y);await boardInfo.waitFor({state:'hidden'});ok(true,'A press outside closes it');checks++;
 await page.locator('#board-info-toggle').click();await boardInfo.waitFor({state:'visible'});
 await page.locator('#board-info-toggle').click();await boardInfo.waitFor({state:'hidden'});ok(true,'Its toggle closes it again');checks++;

 // (3) The item Inspector: ⌘I with one card selected, Escape back to the card.
 await card(ids[0]).locator('.workspace-select-dot').click();
 await card(ids[0]).focus();
 await page.keyboard.press(process.platform==='darwin'?'Meta+i':'Control+i');
 const itemInfo=page.locator('#workspace-item-controls');await itemInfo.waitFor({state:'visible'});
 eq(await itemInfo.getAttribute('role'),'dialog','The item Inspector is a dialog');
 ok(await isFocused('#workspace-item-controls textarea'),'It opens on its notes, as before');
 await page.keyboard.press('Escape');await itemInfo.waitFor({state:'detached'});
 ok(await card(ids[0]).evaluate(el=>el===document.activeElement||el.contains(document.activeElement)),'Escape returns focus to the card it was opened from');

 // (4) The reader: focus on open, Tab wraps, stepper keeps focus at its end, Escape one layer at a time, back to the card.
 await page.keyboard.press('Escape');
 const launch=card(ids[1]).locator('[data-open]:not([data-slot])').first();
 await launch.focus();await page.keyboard.press('Enter');
 await page.locator('#reader-dialog[open]').waitFor();await page.waitForTimeout(200);
 eq(await focused(),'reader-stage','Opening focuses fribblr\'s canvas');
 const stops=await page.evaluate(async()=>{const {tabStops}=await import('/app/reader-dialog.js');const list=tabStops(document.getElementById('reader-dialog'));return {first:list[0]?.id,last:list.at(-1)?.id};});
 await page.locator(`#${stops.last}`).focus();await page.keyboard.press('Tab');
 eq(await focused(),stops.first,'Tab from the last control wraps to the first');
 await page.keyboard.press('Shift+Tab');eq(await focused(),stops.last,'Shift+Tab from the first wraps to the last');
 eq(await page.locator('#reader-stepper').getAttribute('role'),'navigation','The stepper is a pagination');
 await page.locator('#reader-next').focus();await page.keyboard.press('Enter');await page.waitForTimeout(250);
 eq(await page.locator('#reader-count').textContent(),'3 / 3','Next steps to the last');
 eq(await focused(),'reader-next','At the end Next keeps focus');
 eq(await page.locator('#reader-next').getAttribute('aria-disabled'),'true','…and says it is disabled');
 await page.keyboard.press(process.platform==='darwin'?'Meta+i':'Control+i');
 await page.locator('#reader-info').waitFor({state:'visible'});
 ok(await page.locator('#reader-info .calm-side-body').evaluate(el=>el.contains(document.activeElement)),'The item Inspector opens on its first control');
 await page.keyboard.press('Escape');await page.locator('#reader-info').waitFor({state:'hidden'});
 ok(await readerOpen(),'Escape closes the Inspector and leaves the item open');
 eq(await focused(),'reader-next','…and focus returns to what had it');
 await page.locator('#reader-info-toggle').click();await page.locator('#reader-info').waitFor({state:'visible'});
 await page.locator('#reader-stage').focus();await page.keyboard.press('Escape');await page.locator('#reader-info').waitFor({state:'hidden'});
 ok(await readerOpen(),'Escape from fribblr\'s canvas peels the Inspector first');
 await page.keyboard.press('Escape');await page.locator('#reader-dialog').waitFor({state:'hidden'});
 await page.waitForTimeout(150);
 ok(await card(ids[2]).evaluate(el=>el===document.activeElement||el.contains(document.activeElement)),'Closing returns focus to the card last viewed');
 // The reader's commands are a toolbar too; ←/→ move along it.
 await launch.focus();await page.keyboard.press('Enter');await page.locator('#reader-dialog[open]').waitFor();await page.waitForTimeout(300);
 eq(await page.locator('#reader-header .chrome-actions').getAttribute('role'),'toolbar','The reader\'s commands are a toolbar');
 await page.locator('#reader-star').focus();await page.keyboard.press('ArrowRight');
 eq(await focused(),'notes-toggle','→ moves along the reader\'s toolbar, it does not step');
 eq(await page.locator('#reader-count').textContent(),'2 / 3','…and the item stays');
 await page.locator('#reader-stage').focus();await page.keyboard.press('Escape');await page.locator('#reader-dialog').waitFor({state:'hidden'});

 // (5) The board map: head toolbar, 0 shows 100%, Escape from the head closes it and focus goes to the toggle.
 await open('large');
 const map=page.locator('#board-map');await map.waitFor({state:'visible'});
 eq(await page.locator('.board-map-tools').getAttribute('role'),'toolbar','The map\'s head is a toolbar');
 eq(await page.locator('.board-map-stage').getAttribute('role'),'application','The map stage stays an application');
 await page.locator('.board-map-stage').focus();await page.keyboard.press('0');await page.waitForTimeout(100);
 eq(await page.locator('#zoom-menu-toggle').textContent(),'100%','0 on the map shows the board at 100%');
 eq(await page.locator('#view-announce').textContent(),'Zoom 100%','…and says so');
 await page.locator('[data-map-fit="board"]').focus();await page.keyboard.press('ArrowRight');
 ok(await page.locator('[data-map-close]').evaluate(el=>el===document.activeElement),'→ moves along the map\'s head');
 await page.keyboard.press('Escape');await map.waitFor({state:'hidden'});
 eq(await focused(),'board-map-toggle','Escape from the map\'s head closes it and focus goes to its toggle');
 await page.screenshot({path:path.join(evidence,'reader-panels-1440.png')});

 // (6) Narrow: the top bar toolbar keeps one stop, items dropped at this width leave the arrows.
 await page.setViewportSize({width:390,height:844});await open('notes');
 const reachable=await page.evaluate(()=>[...document.querySelectorAll('#chrome-actions ui-toolbar-button')].filter(p=>p.getAttribute('focusable-when-disabled')!=='false').map(p=>p.querySelector('button').getClientRects().length>0));
 ok(reachable.length>=3&&reachable.every(Boolean),'At 390 px every reachable toolbar item is on screen; the ones the bar drops leave the arrows');
 await page.locator('#chrome-search').focus();const seen=new Set();for(let i=0;i<6;i++){await page.keyboard.press('ArrowRight');seen.add(await focused());}
 const dropped=await page.evaluate(()=>[...document.querySelectorAll('#chrome-actions button')].filter(b=>!b.getClientRects().length).map(b=>b.id));
 ok([...seen].every(id=>!dropped.includes(id)),`Arrows never land on a dropped item (${dropped.join(', ')||'none dropped'})`);
 await page.screenshot({path:path.join(evidence,'reader-panels-390.png')});

 assert.deepEqual(errors,[]);
 console.log(`Reader, Inspector, top bar and map checks passed (${checks} checks). Evidence: ${evidence}`);
}finally{
 await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true});
}
