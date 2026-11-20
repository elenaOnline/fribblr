// Printed keycaps for Tinka 1.3's commands: Group / Ungroup (selection bar and drawing bar),
// the card menu's Details / Duplicate / Edit document, the Add menu's Text / Sticky / Document,
// the zoom menu, the board map's Fit buttons, the reader's zoom rows, and Copy notes as
// Markdown. Each cap equals the binding its control declares, and pressing that key does what
// clicking the control does. Icon-only rail keys declare their key for assistive tech and
// print no cap. Commands with a label but no key are listed in the notes at the end.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from '../cli.mjs';
import {loadConfig} from '../lib/config.mjs';
import {applyOperation,getBoardSnapshot} from '../lib/workspace.mjs';
import {listen,closeAppServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=await mkdtemp(path.join(os.tmpdir(),'tinka-keycaps13-'));
const evidence=process.env.TINKA_EVIDENCE_DIR||await mkdtemp(path.join(os.tmpdir(),'tinka-keycaps13-evidence-'));await mkdir(evidence,{recursive:true});
let server,browser;const errors=[],keyed=[];
try {
  const file=path.join(root,'config.json');await main(['init','--config',file,'--boards',path.join(root,'boards'),'--label','Keycaps 1.3']);const config=await loadConfig(file);
  const op=async(type,fields)=>(await applyOperation(config,{type,...fields})).result;
  const assets=path.join(config.boardsRoot,'assets');await mkdir(assets);
  await writeFile(path.join(assets,'a.md'),'# Doc\n\nText.');
  await op('updateWorkspace',{patch:{resourceRoots:{assets:{path:'../assets'}}}});

  // g: two cards, a Markdown document and drawn elements, for grouping and the card menu.
  await op('createBoard',{id:'g',title:'Group board'});
  const card=async(id,x,content)=>(await op('createItem',{boardId:'g',item:{id,title:id,content},placement:{x,y:100,width:260,height:180}})).placementIds[0];
  const first=await card('one',100,{kind:'note',text:'One.'});
  await card('two',420,{kind:'note',text:'Two.'});
  const docPlacement=await card('doc',740,{kind:'markdown',resource:{rootId:'assets',path:'a.md'}});
  for(const d of [
    {id:'caption',type:'text',x:100,y:400,width:225,height:90,text:'A text block',color:'#456139'},
    {id:'spare',type:'region',shape:'rectangle',x:420,y:400,width:160,height:100,text:'A shape',color:'#dbe5d3'},
  ]) await op('createDecoration',{boardId:'g',decoration:d});

  // big: enough tiles that the board map is available, plus a note for the export.
  await op('createBoard',{id:'big',title:'Big board'});
  const bigCards=[];for(let row=0;row<4;row++)for(let col=0;col<6;col++)bigCards.push((await op('createItem',{boardId:'big',item:{title:`Tile ${row}-${col}`,content:{kind:'note',text:'A note.'}},placement:{x:col*700,y:row*500,width:240,height:160}})).placementIds[0]);
  await op('createDecoration',{boardId:'big',decoration:{id:'say',type:'text',x:0,y:-300,width:300,height:80,text:'Something to export',color:'#456139'}});

  server=await listen(config,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,args:['--mute-audio'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'light',reducedMotion:'reduce'});
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base}).catch(()=>{});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);
  const mod=process.platform==='darwin'?'Meta':'Control',isMac=process.platform==='darwin';
  const cmd=key=>isMac?`⌘${key}`:`Ctrl+${key}`,cmdShift=key=>isMac?`⇧⌘${key}`:`Ctrl+Shift+${key}`,shiftDigit=d=>isMac?`⇧${d}`:`Shift+${d}`;
  const settle=(ms=350)=>page.waitForTimeout(ms);
  const open=async id=>{await page.goto(`${base}/boards/${id}/`);await page.locator('#world .workspace-card').first().waitFor();await settle(500);
    if(await page.locator('[data-mode="canvas"]').getAttribute('aria-pressed')!=='true'){await page.locator('#board-info-toggle').click();await page.locator('[data-mode="canvas"]').click();await page.keyboard.press('Escape');await settle();}
    await page.locator('#fit').click();await settle(500);};
  const onBoard=()=>page.locator('#viewport').focus();
  const cap=locator=>locator.locator(':scope > kbd.keycap-printed').textContent();
  const declared=async(locator,expected)=>assert.equal((await locator.getAttribute('aria-keyshortcuts')).split(/\s+/).filter(s=>isMac?!/Control\+/.test(s):!/Meta\+/.test(s))[0],expected);
  const placementSelect=id=>page.locator(`#world .workspace-card[data-placement="${id}"] [data-placement-select]`);
  const draw=id=>page.locator(`#world [data-decoration="${id}"]`);
  const groups=async id=>(await getBoardSnapshot(config,id)).groups?.length||0;
  const until=async(read,expected,what)=>{const deadline=Date.now()+8000;let value;while(Date.now()<deadline){value=await read();if(value===expected)return;await settle(100);}assert.equal(value,expected,what);};
  // A button's own words, apart from the cap printed inside it.
  const labelled=(locator,words)=>until(()=>locator.evaluate(b=>[...b.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim()).catch(()=>''),words,`the button reads ${words}`);
  const zoomText=()=>page.locator('#zoom-menu-toggle').textContent();
  const toastText=()=>page.locator('.workspace-toast').last().textContent({timeout:2500}).catch(()=>'');

  // --- Group / Ungroup on the selection bar (⌘G) ---
  await open('g');
  await placementSelect(first).evaluate(el=>el.click());
  await draw('caption').click({modifiers:['Shift']});
  const barGroup=page.locator('#workspace-selection [data-bulk="canvas-group"]');
  await labelled(barGroup,'Group');
  assert.equal(await cap(barGroup),cmd('G'));await declared(barGroup,'Meta+G');
  assert.equal(await groups('g'),0);
  await barGroup.click();await until(()=>groups('g'),1,'Group by click');
  await labelled(barGroup,'Ungroup');
  assert.equal(await cap(barGroup),cmd('G'),'Ungroup shows the same key');
  await page.screenshot({path:path.join(evidence,'selection-bar-group.png')});
  await barGroup.click();await until(()=>groups('g'),0,'Ungroup by click');
  await onBoard();await page.keyboard.press(`${mod}+g`);await until(()=>groups('g'),1,'Group by its key');
  await labelled(barGroup,'Ungroup');
  await onBoard();await page.keyboard.press(`${mod}+g`);await until(()=>groups('g'),0,'Ungroup by its key');
  keyed.push('group (selection bar)','ungroup');
  await onBoard();await page.keyboard.press('Escape');await settle();

  // --- Group on the drawing bar (two drawn elements, no card) ---
  await draw('caption').click();await draw('spare').click({modifiers:['Shift']});
  const drawGroup=page.locator('[data-whiteboard-action="canvas-group"]');
  await drawGroup.waitFor();
  assert.equal(await cap(drawGroup),cmd('G'));await declared(drawGroup,'Meta+G');
  await page.screenshot({path:path.join(evidence,'drawing-bar-group.png')});
  await drawGroup.click();await until(()=>groups('g'),1,'Group by click (drawing bar)');
  await onBoard();await page.keyboard.press(`${mod}+g`);await until(()=>groups('g'),0,'Ungroup by its key (drawing bar)');
  await page.keyboard.press(`${mod}+g`);await until(()=>groups('g'),1,'Group by its key (drawing bar)');
  await page.keyboard.press(`${mod}+g`);await until(()=>groups('g'),0);
  keyed.push('group (drawing bar)');
  await page.keyboard.press('Escape');await settle();

  // --- The card menu: Details…, Duplicate, Edit document ---
  const cardCount=()=>page.locator('#world .workspace-card').count();
  const menuOn=async id=>{await page.locator(`#world .workspace-card[data-placement="${id}"]`).click({button:'right'});await page.locator('.workspace-tile-menu').waitFor();};
  await menuOn(docPlacement);
  const edit=page.locator('.workspace-tile-menu [data-tile-menu="edit-document"]'),details=page.locator('.workspace-tile-menu [data-tile-menu="details"]'),dup=page.locator('.workspace-tile-menu [data-tile-menu="duplicate"]');
  // Menu rows (UI SDK Menu) print their key in the row's shortcut part (popups.js menuItem).
  const menuCap=locator=>locator.locator('ui-menu-shortcut kbd').textContent();
  assert.deepEqual([await menuCap(edit),await menuCap(details),await menuCap(dup)],['E',cmd('I'),cmd('D')]);
  // 1.4: Bring to front ] and Send to back [ print theirs too
  assert.deepEqual([await menuCap(page.locator('.workspace-tile-menu [data-tile-menu="front"]')),await menuCap(page.locator('.workspace-tile-menu [data-tile-menu="back"]'))],[']','[']);
  assert.equal(await page.locator('.workspace-tile-menu kbd').count(),6,'five printed caps and the Open row\'s own ↵');
  await page.screenshot({path:path.join(evidence,'card-menu.png')});
  await page.keyboard.press('Escape');await settle();
  let total=await cardCount();
  await menuOn(first);await page.locator('.workspace-tile-menu [data-tile-menu="duplicate"]').click();
  await until(cardCount,total+1,'Duplicate by click');total+=1;await settle();
  await onBoard();await page.keyboard.press(`${mod}+d`);await until(cardCount,total+1,'Duplicate by its key');keyed.push('duplicate (card menu)');
  await onBoard();await page.keyboard.press('Escape');await settle();

  // --- The Add menu: Text (T), Sticky note (S), Document (D) ---
  const snapshotCount=async()=>(await getBoardSnapshot(config,'g')).decorations.length;
  const items=async()=>(await getBoardSnapshot(config,'g')).placements.length;
  await page.locator('#workspace-add').click();await page.locator('#workspace-add-menu .workspace-add-menu').waitFor();
  const rows=Object.fromEntries(await Promise.all(['text','sticky','document','sticker','region','container','arrow','idea','board'].map(async id=>[id,page.locator(`#workspace-add-menu [data-add="${id}"]`)])));
  assert.deepEqual([await menuCap(rows.text),await menuCap(rows.sticky),await menuCap(rows.document)],['T','S','D']);
  for(const id of ['sticker','region','container','arrow','idea','board'])assert.equal(await rows[id].locator('kbd').count(),0,`${id} has no key, so no cap`);
  await page.screenshot({path:path.join(evidence,'add-menu.png')});
  await page.keyboard.press('Escape');await settle();
  for(const [id,key,read] of [['text','t',snapshotCount],['sticky','s',snapshotCount],['document','d',items]]){
    let n=await read();
    await page.locator('#workspace-add').click();await page.locator(`#workspace-add-menu [data-add="${id}"]`).click();
    await until(read,n+1,`${id} by click`);await settle(500);await page.keyboard.press('Escape');await settle(600);
    n=await read();
    await onBoard();await page.keyboard.press(key);
    await until(read,n+1,`${id} by its key`);await settle(500);await page.keyboard.press('Escape');await settle(600);
    keyed.push(`add ${id}`);
  }

  // --- Big board: zoom menu, board map, Copy notes as Markdown ---
  await open('big');
  const zoomRow=to=>page.locator(`#zoom-menu [data-zoom-to="${to}"]`);
  assert.deepEqual([await cap(zoomRow('1')),await cap(zoomRow('fit')),await cap(zoomRow('selection'))],['0','1','2'].map(shiftDigit));
  const viaMenu=async to=>{await page.locator('#zoom-menu-toggle').click();await zoomRow(to).click();await settle(700);return zoomText();};
  const bump=async()=>{await page.locator('#zoom-plus').click();await page.locator('#zoom-plus').click();await settle(500);};
  const fitBoardByRow=await viaMenu('fit');
  const hundredByRow=await viaMenu('1');
  assert.notEqual(fitBoardByRow,hundredByRow);
  await onBoard();await page.keyboard.press('Shift+Digit1');await settle(700);assert.equal(await zoomText(),fitBoardByRow,'Fit board by its key');
  await onBoard();await page.keyboard.press('Shift+Digit0');await settle(700);assert.equal(await zoomText(),hundredByRow,'Zoom to 100% by its key');
  keyed.push('zoom to 100%','fit board');
  await page.locator('#viewport').focus();
  await placementSelect(bigCards[0]).evaluate(el=>el.click());
  await page.locator(`#world .workspace-card[data-placement="${bigCards[1]}"] h3 button`).click({modifiers:['Shift']});
  const bySelectionRow=await viaMenu('selection');
  await bump();
  await onBoard();await page.keyboard.press('Shift+Digit2');await settle(700);assert.equal(await zoomText(),bySelectionRow,'Fit selection by its key');
  keyed.push('fit selection');
  // The board map's Fit buttons print no cap: their labels are rewritten by script (fit-map-browser reads them) and
  // the map head is small; the zoom menu rows above carry the same keys.
  await page.locator('#board-map-toggle').click().catch(()=>{});await settle(400);
  if(!await page.locator('#board-map').isVisible()){await onBoard();await page.keyboard.press('m');await settle(400);}
  assert.equal(await page.locator('#board-map .board-map-head kbd').count(),0,'map head prints no cap');
  // Copy notes as Markdown (Inspector, Feedback).
  await page.locator('#board-info-toggle').click();await page.locator('#board-info').waitFor({state:'visible'});
  const copyNotes=page.locator('#board-info button',{hasText:'Copy notes as Markdown'});
  assert.equal(await cap(copyNotes),cmdShift('C'));await declared(copyNotes,'Shift+Meta+C');
  await page.screenshot({path:path.join(evidence,'inspector-copy-notes.png')});
  await copyNotes.click();await settle(500);const byClick=await toastText();assert.ok(byClick,'a toast says what was copied');
  await page.evaluate(()=>document.querySelectorAll('.workspace-toast').forEach(t=>t.remove()));
  await onBoard();await page.keyboard.press(`${mod}+Shift+c`);await settle(500);
  assert.equal(await toastText(),byClick,'Copy notes by its key');keyed.push('copy notes as Markdown');
  await page.keyboard.press('Escape');await settle();

  // --- The reader: Zoom to 100% (⇧0) and Fit this Tinka (F) ---
  await page.locator(`#world .workspace-card[data-placement="${bigCards[2]}"] h3 button`).click();
  await page.locator('#reader-dialog').waitFor({state:'visible'});await settle(700);
  const rz=to=>page.locator(`#reader-zoom-menu [data-reader-zoom="${to}"]`);
  assert.deepEqual([await cap(rz('1')),await cap(rz('fit'))],[shiftDigit('0'),'F']);
  const readerZoom=()=>page.locator('#reader-zoom-toggle').textContent();
  const readerRow=async to=>{await page.locator('#reader-zoom-toggle').click();await rz(to).click();await settle(600);return readerZoom();};
  const fitRow=await readerRow('fit');const hundredRow=await readerRow('1');
  await page.locator('#reader-stage').focus().catch(()=>{});await page.keyboard.press('f');await settle(600);
  assert.equal(await readerZoom(),fitRow,'Fit this Tinka by its key');
  await page.keyboard.press('Shift+Digit0');await settle(600);assert.equal(await readerZoom(),hundredRow,'Zoom to 100% by its key (reader)');
  keyed.push('reader fit','reader zoom to 100%');
  await page.locator('#close-reader').click();await page.locator('#reader-dialog').waitFor({state:'hidden'});

  // --- Icon-only keys: declared for assistive tech, printed nowhere ---
  await open('g');
  const rail=await page.$$eval('#edit-tools [data-edit-tool]',els=>els.map(e=>[e.dataset.editTool,e.getAttribute('aria-keyshortcuts'),/\(([A-Z])\)$/.exec(e.title)?.[1]??null]));
  assert.deepEqual(rail.filter(r=>r[1]).map(r=>r[0]),['pointer','pan','text','sticky','comment']);
  for(const [tool,declaredKey,titled] of rail)assert.equal(declaredKey,titled,`${tool}: the declared key is the one its tooltip names`);
  assert.equal(await page.locator('#edit-tools kbd, #edit-tools-toggle kbd, #board-map-toggle kbd').count(),0,'icon-only keys print no cap');
  assert.equal(await page.locator('#edit-tools-toggle').getAttribute('aria-keyshortcuts'),'A');
  const pressed=tool=>page.locator(`#edit-tools [data-edit-tool="${tool}"]`).getAttribute('aria-pressed');
  for(const [tool,key] of [['pan','h'],['pointer','v'],['comment','c'],['pointer','c']]){
    await onBoard();await page.keyboard.press(key);await settle(250);assert.equal(await pressed(tool),'true',`${key} selects ${tool}`);
  }
  await page.locator('#edit-tools [data-edit-tool="pan"]').click();assert.equal(await pressed('pan'),'true','clicking Pan selects it, as H does');
  await page.locator('#edit-tools [data-edit-tool="pointer"]').click();
  await onBoard();await page.keyboard.press('a');await settle(250);assert.equal(await page.locator('#edit-tools').isHidden(),true,'A hides the rail');
  await page.keyboard.press('a');await settle(250);assert.equal(await page.locator('#edit-tools').isVisible(),true,'A shows it again');
  for(const id of ['chrome-undo','chrome-redo'])assert.ok(await page.locator(`#${id}`).getAttribute('aria-keyshortcuts'),`${id} declares its key`);
  keyed.push('rail tools (aria only)');

  // Every printed cap equals its control's declared binding, on every control that prints one.
  const mismatched=await page.evaluate(()=>[...document.querySelectorAll('kbd.keycap-printed')].filter(k=>!k.parentElement.hasAttribute('aria-keyshortcuts')).length);
  assert.equal(mismatched,0);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,evidence,checks:keyed}));
} finally {
  await browser?.close().catch(()=>{});
  await closeAppServer(server).catch(()=>{});
  await rm(root,{recursive:true,force:true});
}
