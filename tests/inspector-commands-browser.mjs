// Clicked Inspector commands always run; board keys still yield to Inspector focus.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from '../cli.mjs';
import {loadConfig} from '../lib/config.mjs';
import {applyOperation,getBoardSnapshot} from '../lib/workspace.mjs';
import {listen,closeAppServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=await mkdtemp(path.join(os.tmpdir(),'tinka-inspector-'));let server,browser;
try{
 const file=path.join(root,'config.json');await main(['init','--config',file,'--boards',path.join(root,'boards'),'--label','Inspector fixture']);
 const config=await loadConfig(file),board=(await applyOperation(config,{type:'createBoard',title:'Inspector commands'})).result;
 const first=(await applyOperation(config,{type:'createItem',boardId:board.boardId,item:{title:'First idea'},placement:{x:0,y:0,width:320,height:260}})).result;
 await applyOperation(config,{type:'createItem',boardId:board.boardId,item:{title:'Second idea'},placement:{x:400,y:0,width:320,height:260}});
 const active=async()=>(await getBoardSnapshot(config,board.boardId)).placements.filter(p=>!p.removedAt&&!p.deletedAt).length;
 server=await listen(config,{port:0});
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/operations'))writes.push(r.postDataJSON()?.type);});
 // Never touch the OS clipboard: execCommand('copy') dispatches a synthetic copy event and records its data.
 await page.addInitScript(()=>{
  window.qaCopies=[];const blocked=()=>{throw new Error('QA must not touch OS clipboard');};
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{read:blocked,readText:blocked,write:blocked,writeText:blocked}});
  const exec=document.execCommand.bind(document);
  document.execCommand=(name,...args)=>{
   if(name!=='copy')return ['cut','paste'].includes(name)?blocked():exec(name,...args);
   const transfer=new DataTransfer(),event=new ClipboardEvent('copy',{clipboardData:transfer,bubbles:true,cancelable:true});
   (document.activeElement||document.body).dispatchEvent(event);
   window.qaCopies.push({prevented:event.defaultPrevented,types:[...transfer.types],text:transfer.getData('text/plain')});
   return true;
  };
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/boards/${board.boardId}/`);
 await page.locator('#workspace-copy').waitFor({state:'attached'});
 await page.waitForFunction(()=>document.querySelectorAll('.workspace-card[data-placement]').length===2);
 const card=page.locator(`.workspace-card[data-placement="${first.placementIds[0]}"]`);
 const selected=()=>page.locator('.workspace-card.selected').count();
 const openInspector=async()=>{if(await page.locator('#board-info').isHidden())await page.locator('#board-info-toggle').click();await page.locator('#board-info').waitFor();};
 // 1. Inspector → Keyboard shortcuts opens the sheet.
 await openInspector();
 await page.getByRole('button',{name:'Keyboard shortcuts',exact:true}).click();
 await page.getByRole('dialog',{name:'Keyboard shortcuts'}).waitFor();
 assert.match(await page.getByRole('dialog',{name:'Keyboard shortcuts'}).textContent(),/Duplicate selection/);
 await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Keyboard shortcuts'}).waitFor({state:'detached'});
 // 2. Inspector → Copy selection puts the selection on the clipboard without a graph write.
 await card.locator('[data-placement-select]').click();assert.equal(await selected(),1);
 await openInspector();assert.equal(await page.locator('#workspace-copy').isEnabled(),true);
 const before=writes.length;await page.locator('#workspace-copy').click();
 const copies=await page.evaluate(()=>window.qaCopies);
 assert.equal(copies.length,1);assert.equal(copies[0].prevented,true);
 assert.ok(copies[0].types.includes('application/x-tinka-placements+json'),JSON.stringify(copies[0].types));
 const envelope=JSON.parse(copies[0].text.slice(copies[0].text.indexOf('\n')+1));
 assert.equal(envelope.placements.length,1);assert.equal(envelope.placements[0].id,first.placementIds[0]);
 await page.locator('.workspace-toast').filter({hasText:'Copied selection.'}).first().waitFor();
 assert.equal(writes.length,before);
 // 3. Board keys pressed while focus sits on an Inspector button do not act on the board.
 const count=await active();
 await page.locator('#workspace-copy').focus();
 for(const key of ['Delete','Backspace','Meta+a','Control+a','Meta+d'])await page.keyboard.press(key);
 await page.waitForTimeout(400);
 assert.equal(await page.locator('#board-info').isVisible(),true);
 assert.equal(await selected(),1,'Select-all ignored while focus is in the Inspector');
 assert.equal(writes.length,before,'No removal or duplicate from Inspector focus');assert.equal(await active(),count);
 // 4. Inspector Undo is also an explicit command: undo a keyboard removal from the Inspector.
 await page.locator('#board-info-toggle').click();await page.locator('#board-info').waitFor({state:'hidden'});
 await page.locator('#viewport').focus();
 const removed=page.waitForResponse(r=>r.url().endsWith('/api/operations')&&r.request().postDataJSON()?.type==='remove'&&r.status()===200);
 await page.keyboard.press('Delete');await removed;assert.equal(await active(),count-1);
 await openInspector();await page.locator('#workspace-undo:not([disabled])').waitFor();
 const restored=page.waitForResponse(r=>r.url().endsWith('/api/operations')&&r.request().postDataJSON()?.type==='restoreMovement'&&r.status()===200);
 await page.locator('#workspace-undo').click();await restored;
 await page.waitForFunction(()=>document.querySelectorAll('.workspace-card[data-placement]').length===2);assert.equal(await active(),count);
 const focused=()=>page.evaluate(()=>{const a=document.activeElement;return a?.id||a?.dataset?.contextSelect!==undefined&&'select'||a?.className||a?.tagName;});
 const label=()=>page.evaluate(()=>document.activeElement?.textContent.trim());
 // 5. Favorites / Last 6 weeks / Archive are one toolbar (as Home's row): one Tab stop, arrows along it.
 const filters=page.locator('#board-info .inspector-toggles');
 assert.equal(await filters.getAttribute('role'),'toolbar');
 await page.locator('#workspace-favorites').focus();
 assert.equal(await filters.locator('button[tabindex="0"]').count(),1,'one Tab stop');
 await page.keyboard.press('ArrowRight');assert.equal(await focused(),'workspace-recent');
 await page.keyboard.press('End');assert.equal(await focused(),'workspace-archive');
 await page.keyboard.press('Home');assert.equal(await focused(),'workspace-favorites');
 await page.keyboard.press('Enter');assert.equal(await page.locator('#workspace-favorites').getAttribute('aria-pressed'),'true');
 await page.keyboard.press('Enter');assert.equal(await page.locator('#workspace-favorites').getAttribute('aria-pressed'),'false');
 await page.waitForFunction(()=>document.querySelectorAll('.workspace-card[data-placement]').length===2);
 // 6. Comparison order is a reorderable list: one Tab stop, ↑/↓ move focus, Space picks up / drops, ⌥↑/↓ moves at once.
 await page.getByRole('button',{name:'Comparison order…'}).click();
 const list=page.locator('#workspace-order');await list.waitFor();
 await page.waitForFunction(()=>document.activeElement?.matches('#workspace-order [role=option]'));
 assert.equal(await list.getAttribute('role'),'listbox');
 assert.equal(await list.locator('[role=option]').count(),2);assert.equal(await list.locator('[role=option][tabindex="0"]').count(),1,'one Tab stop');
 assert.equal(await list.locator('button').count(),0,'no per-row buttons');
 const order=()=>list.locator('.workspace-order-title').allTextContents();
 assert.deepEqual(await order(),['First idea','Second idea']);
 await page.keyboard.press('ArrowDown');assert.equal(await label(),'2Second idea');await page.keyboard.press('ArrowUp');
 await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-selected')),'true','picked up');
 await page.keyboard.press('ArrowDown');assert.deepEqual(await order(),['Second idea','First idea']);
 await page.keyboard.press('Escape');assert.deepEqual(await order(),['First idea','Second idea'],'Escape puts it back');
 assert.equal(await list.isVisible(),true,'Escape on a held row keeps the dialog');
 await page.keyboard.press('Space');await page.keyboard.press('ArrowDown');await page.keyboard.press('Space');
 assert.deepEqual(await order(),['Second idea','First idea']);assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-selected')),'false','dropped');
 assert.equal(await label(),'2First idea','focus stays on the moved row');
 await page.keyboard.press('Alt+ArrowUp');assert.deepEqual(await order(),['First idea','Second idea'],'⌥↑ moves at once');
 await page.keyboard.press('Shift+Alt+ArrowDown');assert.deepEqual(await order(),['Second idea','First idea'],'⇧⌥↓ moves to the end');
 const savedOrder=page.waitForResponse(r=>r.url().endsWith('/api/operations')&&r.request().postDataJSON()?.type==='updateBoard'&&r.status()===200);
 await page.getByRole('button',{name:'Save order'}).click();await savedOrder;
 const snapshot=await getBoardSnapshot(config,board.boardId),ids=snapshot.reviewOrder.filter(id=>snapshot.placements.some(p=>p.id===id&&!p.removedAt));
 assert.equal(snapshot.placements.find(p=>p.id===ids[0]).itemId!==first.itemId,true,'saved order puts Second idea first');
 // 7. The item Inspector's actions are a vertical toolbar: one Tab stop, ↑/↓ and Home/End along them.
 await page.locator('#board-info-toggle').click();await page.locator('#board-info').waitFor({state:'hidden'});
 await card.locator('[data-item-controls]').click();await page.locator('#workspace-tile-menu ui-menu-content[data-open]').waitFor();
 await page.locator('#workspace-tile-menu ui-menu-item').filter({hasText:'Details'}).first().click();
 const acts=page.locator('#workspace-item-controls .inspector-acts');await acts.waitFor();
 assert.equal(await acts.getAttribute('role'),'toolbar');assert.equal(await acts.getAttribute('aria-orientation'),'vertical');
 await acts.locator('[data-context-select]').focus();assert.equal(await acts.locator('button[tabindex="0"]').count(),1,'one Tab stop');
 await page.keyboard.press('ArrowDown');assert.equal(await label(),'Connect');
 await page.keyboard.press('End');assert.equal(await label(),'Remove from board…');
 await page.keyboard.press('ArrowDown');assert.match(await label(),/^(De)?select$/i,'wraps');
 await page.keyboard.press('Escape');await page.locator('#workspace-item-controls').waitFor({state:'detached'});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:7,checks:['Inspector Keyboard shortcuts opens the sheet','Inspector Copy selection writes the clipboard envelope','Delete/Backspace/Select-all/Duplicate ignored with Inspector focus','Inspector Undo restores a removal','Filter row is one toolbar','Comparison order is a reorderable list','Item actions are a vertical toolbar']}));
}finally{await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true});}
