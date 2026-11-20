// Overlay surfaces follow UI SDK: toasts, dialogs, alert dialogs, the tile notes popover and Quick jot.
// Pointer, keyboard, focus (where it opens, where it returns) and roles, in a headless browser.
import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {main} from '../cli.mjs';import {loadConfig} from '../lib/config.mjs';import {applyOperation,getBoardSnapshot} from '../lib/workspace.mjs';import {listen,closeAppServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=await mkdtemp(path.join(os.tmpdir(),'tinka-overlays-'));let browser,server;const errors=[],checks=[];
const ok=name=>checks.push(name);
try{
 const file=path.join(root,'config.json'),boards=path.join(root,'boards');
 await main(['init','--config',file,'--boards',boards,'--label','Overlays']);
 const config=await loadConfig(file),op=async(type,fields)=>(await applyOperation(config,{type,...fields})).result;
 await op('createBoard',{id:'graph',title:'Overlay board'});const placements={};
 for(const [i,id] of ['a','b','c'].entries()){const result=await op('createItem',{boardId:'graph',item:{id,title:`Note ${id}`,content:{kind:'note',text:'Material'}},placement:{x:i*380,y:0,width:320,height:240}});placements[id]=result.placementIds[0];}
 server=await listen(config,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
 const active=()=>page.evaluate(()=>{const a=document.activeElement;return a?{tag:a.tagName,id:a.id,cls:String(a.className||''),label:a.getAttribute('aria-label')||a.textContent.trim().slice(0,30)}:null;});
 const openCount=()=>page.locator('[data-slot$="-content"][data-open]').count();
 await page.goto(base+'/boards/graph/');await page.locator('.workspace-card').first().waitFor();
 await page.locator('#viewport').click({position:{x:4,y:400}});

 // ---- Toasts: stack of three, newest in front, F6 reaches it, Escape dismisses it, close button, announced region
 await page.evaluate(async()=>{const m=await import('/app/workspace.js');for(const t of ['One','Two','Three','Four'])m.toast(t);});
 await page.locator('.workspace-toast').first().waitFor();
 assert.equal(await page.locator('.workspace-toast').count(),3,'three toasts show at once, the fourth waits');
 assert.equal(await page.locator('.workspace-toast[data-front] ui-toast-title').textContent(),'Four','the newest toast is in front');
 assert.equal(await page.locator('ui-toast-region').getAttribute('role'),'region');
 assert.equal(await page.locator('.workspace-toast').first().getAttribute('role'),'listitem');
 await page.keyboard.press('F6');assert.equal((await active()).tag,'UI-TOAST','F6 focuses the newest toast');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>![...document.querySelectorAll('.workspace-toast')].some(t=>t.textContent.includes('Four')));
 ok('toast stack, F6, Escape');
 await page.locator('.workspace-toast-close').first().click();await page.waitForTimeout(500);
 assert.ok(await page.locator('.workspace-toast').count()<=2,'the close button dismisses a toast');
 await page.evaluate(async()=>{const {dismissToast}=await import('/app/toasts.js');dismissToast();});
 await page.waitForFunction(()=>!document.querySelector('.workspace-toast'));
 ok('toast close button and dismissToast');

 // ---- Dialog: focus on the first field, Tab wraps, Escape asks only when something was typed, focus returns
 await page.evaluate(()=>{const b=document.createElement('button');b.id='qa-opener';b.textContent='Opener';b.style.cssText='position:fixed;left:8px;top:60px;z-index:5';document.body.append(b);b.focus();});
 const makeForm=()=>page.evaluate(async()=>{const {makeDialog}=await import('/app/workspace.js');window.qaSaves=[];makeDialog('QA form','<label>Name<input name="name"></label><button type="submit" class="workspace-primary">Save</button>',async f=>{qaSaves.push(f.get('name'));});});
 await makeForm();await page.locator('ui-dialog-content[data-open]').waitFor();
 assert.equal((await active()).tag,'INPUT','focus opens on the first field');
 assert.equal(await page.locator('ui-dialog-content[data-open]').getAttribute('aria-modal'),'true');
 for(let i=0;i<3;i++)await page.keyboard.press('Tab');
 assert.ok(await page.evaluate(()=>!!document.activeElement.closest('ui-dialog-content')),'Tab stays inside the dialog');
 await page.keyboard.press('Escape');await page.locator('ui-dialog-content[data-open]').waitFor({state:'detached'});
 assert.equal((await active()).id,'qa-opener','Escape closes a clean dialog and focus returns to the opener');
 await makeForm();await page.locator('ui-dialog-content[data-open] input').fill('typed');
 await page.keyboard.press('Escape');
 await page.locator('ui-alert-dialog-content[data-open]').waitFor();
 assert.equal((await active()).label,'Keep editing','the discard question starts on Keep editing');
 assert.equal(await page.locator('ui-alert-dialog-content[data-open] h2').textContent(),'Discard the text you typed','the question says what is lost, as a statement');
 assert.equal(await page.locator('ui-alert-dialog-content[data-open] p').first().textContent(),'Nothing in “QA form” is saved yet.');
 await page.keyboard.press('Escape');await page.locator('ui-alert-dialog-content').waitFor({state:'detached'});
 assert.equal(await page.locator('ui-dialog-content[data-open]').count(),1,'Escape on the question keeps the form');
 assert.equal(await page.locator('ui-dialog-content[data-open] input').inputValue(),'typed');
 await page.mouse.click(4,500);await page.locator('ui-alert-dialog-content[data-open]').waitFor();
 await page.getByRole('button',{name:'Discard',exact:true}).click();await page.locator('ui-dialog-content.workspace-dialog').waitFor({state:'detached'});
 assert.equal((await active()).id,'qa-opener');
 ok('dialog focus, Tab wrap, dirty discard question, focus return');
 await makeForm();await page.locator('ui-dialog-content[data-open] input').fill('saved');await page.keyboard.press('ControlOrMeta+Enter');
 await page.locator('ui-dialog-content.workspace-dialog').waitFor({state:'detached'});assert.deepEqual(await page.evaluate(()=>qaSaves),['saved']);
 assert.equal((await active()).id,'qa-opener');
 await makeForm();await page.mouse.click(4,500);await page.locator('ui-dialog-content.workspace-dialog').waitFor({state:'detached'});
 ok('submit shortcut, backdrop closes a clean dialog');
 // Only typed text asks: a choice costs one press to make again, and text typed back to what it was is nothing lost.
 await page.evaluate(async()=>{const {makeDialog}=await import('/app/workspace.js');makeDialog('QA choice','<fieldset><legend>Where</legend><label><input type="radio" name="to" value="a" checked>A</label><label><input type="radio" name="to" value="b">B</label></fieldset><label><input type="checkbox" name="also">Also</label><label>Note<input name="note" value="kept"></label><button type="submit" class="workspace-primary">Save</button>',async()=>{});});
 await page.locator('ui-dialog-content[data-open]').waitFor();
 await page.locator('ui-dialog-content[data-open] input[value=a]').focus();await page.keyboard.press('ArrowDown');
 assert.equal(await page.locator('ui-dialog-content[data-open] input[value=b]').isChecked(),true,'the radio choice moved');
 await page.locator('ui-dialog-content[data-open] input[name=also]').check();
 await page.locator('ui-dialog-content[data-open] input[name=note]').focus();await page.keyboard.press('End');await page.keyboard.type('x');await page.keyboard.press('Backspace');
 await page.keyboard.press('Escape');await page.locator('ui-dialog-content.workspace-dialog').waitFor({state:'detached'});
 assert.equal(await page.locator('ui-alert-dialog-content').count(),0,'a radio, a checkbox and text typed back to what it was close without a question');
 ok('only typed text asks before discarding');

 // ---- Keyboard shortcuts dialog (?)
 await page.evaluate(()=>document.getElementById('qa-opener').remove());await page.locator('#viewport').click({position:{x:4,y:400}});
 await page.keyboard.press('?');await page.getByRole('dialog',{name:'Keyboard shortcuts'}).waitFor();
 assert.equal((await active()).label,'Close dialog','a dialog with no field starts on the close key');
 await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Keyboard shortcuts'}).waitFor({state:'detached'});
 ok('shortcuts dialog');

 // ---- Alert dialog: Cancel first, backdrop does nothing, Escape says no, confirm removes
 await page.locator(`[data-placement-select="${placements.c}"]`).click();
 await page.getByRole('button',{name:'Remove from board…'}).click();
 const alert=page.getByRole('alertdialog',{name:'Remove these placements?'});await alert.waitFor();
 assert.equal((await active()).label,'Cancel','a confirmation starts on Cancel');
 await page.mouse.click(4,500);await page.waitForTimeout(300);assert.equal(await alert.count(),1,'a press on the backdrop does not answer a confirmation');
 await page.keyboard.press('Tab');await page.keyboard.press('Tab');assert.equal((await active()).label,'Cancel','Tab wraps inside the confirmation');
 await page.keyboard.press('Escape');await alert.waitFor({state:'detached'});
 assert.equal((await getBoardSnapshot(config,'graph')).placements.filter(p=>!p.removedAt).length,3,'Escape means no');
 await page.getByRole('button',{name:'Remove from board…'}).click();await alert.waitFor();
 await alert.getByRole('button',{name:'Remove from this board'}).click();await alert.waitFor({state:'detached'});
 await page.waitForFunction(()=>document.querySelectorAll('.workspace-card').length===2);
 assert.equal((await getBoardSnapshot(config,'graph')).placements.filter(p=>!p.removedAt).length,2);
 ok('alert dialog');
 await page.locator('.workspace-toast').filter({hasText:'Removed 1 Tinka'}).first().waitFor();
 await page.locator('.workspace-toast-action').click();
 await page.waitForFunction(()=>document.querySelectorAll('.workspace-card').length===3);
 assert.equal((await getBoardSnapshot(config,'graph')).placements.filter(p=>!p.removedAt).length,3,'the Remove toast has an Undo action that restores the placement');
 ok('remove toast undo');
 await page.evaluate(async()=>{const {dismissToast}=await import('/app/toasts.js');dismissToast();});

 // ---- Tile notes popover: in the body, not in the card; Escape keeps the draft and returns focus; outside press closes
 const control=page.locator(`[data-placement="${placements.a}"] [data-item-controls]`);
 await control.focus();await page.keyboard.press('Enter');await page.getByRole('menuitem',{name:'Notes',exact:true}).click();
 const notes=page.locator('.tile-notes[data-open]');await notes.waitFor();
 assert.equal((await active()).tag,'TEXTAREA','focus opens in the note');
 assert.equal(await notes.evaluate(el=>!!el.closest('.workspace-card')),false,'the popover is not inside the card');
 assert.equal(await notes.getAttribute('role'),'dialog');
 await page.keyboard.type('draft kept');await page.keyboard.press('Escape');await page.locator('.tile-notes').waitFor({state:'detached'});
 assert.ok((await active()).cls.includes('workspace-tile-more'),'focus returns to the card control');
 await control.focus();await page.keyboard.press('Enter');await page.getByRole('menuitem',{name:'Notes',exact:true}).click();await notes.waitFor();
 assert.equal(await page.locator('.tile-notes textarea').inputValue(),'draft kept');
 await page.mouse.click(1400,700);await page.locator('.tile-notes').waitFor({state:'detached'});
 await control.focus();await page.keyboard.press('Enter');await page.getByRole('menuitem',{name:'Notes',exact:true}).click();await notes.waitFor();
 await page.locator('[data-note-cancel]').click();await page.locator('.tile-notes').waitFor({state:'detached'});
 await control.focus();await page.keyboard.press('Enter');await page.getByRole('menuitem',{name:'Notes',exact:true}).click();await notes.waitFor();
 assert.equal(await page.locator('.tile-notes textarea').inputValue(),'','Cancel drops the draft');
 await page.keyboard.type('final');await page.keyboard.press('ControlOrMeta+Enter');await page.locator('.tile-notes').waitFor({state:'detached'});
 assert.equal((await getBoardSnapshot(config,'graph')).items.a.review.note,'final');
 ok('tile notes popover');

 // ---- Quick jot: a non-modal dialog; the board stays usable; Escape returns focus
 await page.locator('#viewport').click({position:{x:4,y:600}});
 // A press on the empty canvas takes focus off the items, onto the board, a frame later (workspace-board.js).
 await page.waitForFunction(()=>document.activeElement?.id==='viewport');
 const beforeJot=await active();await page.keyboard.press('n');await page.locator('.quick-jot[data-open] input').waitFor();
 assert.equal((await active()).label,'Quick jot');assert.notEqual(await page.locator('.quick-jot').getAttribute('aria-modal'),'true');assert.equal(await page.locator('.quick-jot').getAttribute('role'),'dialog');
 await page.mouse.click(1400,300);assert.equal(await page.locator('.quick-jot[data-open]').count(),1,'a press on the board does not close a non-modal jot');
 await page.locator('.quick-jot input').focus();await page.keyboard.press('Escape');await page.locator('.quick-jot').waitFor({state:'detached'});
 assert.deepEqual(await active(),beforeJot,'focus returns to where it was before the jot opened');
 ok('quick jot');

 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,checks,errors}));
}finally{await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
