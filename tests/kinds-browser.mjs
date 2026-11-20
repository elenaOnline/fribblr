// Item kinds on the page: data-kind / data-family on cards, the reader and Home; the
// kind legend in the board's foot (light one, dim the rest, nothing moves, counts
// follow adds and removals); the kinds line on Home; printed shortcut keycaps.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from '../cli.mjs';
import {loadConfig} from '../lib/config.mjs';
import {applyOperation,getBoardSnapshot} from '../lib/workspace.mjs';
import {listen,closeAppServer} from '../server.mjs';
import {kindOf,familyOf} from '../public/kinds.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=await mkdtemp(path.join(os.tmpdir(),'tinka-kinds-browser-'));
const evidence=process.env.TINKA_EVIDENCE_DIR||await mkdtemp(path.join(os.tmpdir(),'tinka-kinds-evidence-'));await mkdir(evidence,{recursive:true});
let server,browser;const errors=[];
try {
  const file=path.join(root,'config.json');await main(['init','--config',file,'--boards',path.join(root,'boards'),'--label','Kinds']);const config=await loadConfig(file);
  const op=async(type,fields)=>(await applyOperation(config,{type,...fields})).result;
  await op('createBoard',{id:'mixed',title:'Mixed kinds'});
  const assets=path.join(config.boardsRoot,'assets');await mkdir(assets);
  await writeFile(path.join(assets,'a.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#678"/></svg>');
  await writeFile(path.join(assets,'a.html'),'<!doctype html><p>Page</p>');
  await writeFile(path.join(assets,'a.md'),'# Doc\n\nText.');
  await op('updateWorkspace',{patch:{resourceRoots:{assets:{path:'../assets'}}}});
  let x=0;const add=(id,item)=>op('createItem',{boardId:'mixed',item:{id,title:id,...item},placement:{x:(x+=360)-360,y:0,width:320,height:240,presentation:{mode:'card'}}});
  await add('page-1',{content:{kind:'html',resource:{rootId:'assets',path:'a.html'}}});
  await add('page-2',{content:{kind:'url',url:'https://example.org/'}});
  await add('doc-1',{content:{kind:'markdown',resource:{rootId:'assets',path:'a.md'}}});
  await add('pic-1',{content:{kind:'image',resource:{rootId:'assets',path:'a.svg'}}});
  await add('note-1',{content:{kind:'note',text:'A note.'}});
  await add('idea-1',{});
  await op('createBoard',{id:'inside',title:'Inside',parentBoardId:'mixed'});
  server=await listen(config,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,args:['--mute-audio'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:900},colorScheme:'light'});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/boards/mixed/');await page.locator('#world .workspace-card').first().waitFor();await page.waitForTimeout(300);

  // Every card carries the kind its stored item has, by the shared rule.
  const snapshot=await getBoardSnapshot(config,'mixed');
  const expected=Object.fromEntries(snapshot.placements.map(p=>[p.id,kindOf(snapshot.items[p.itemId])]));
  const cards=await page.$$eval('#world .workspace-card',els=>els.map(e=>[e.dataset.placement,e.dataset.kind,e.dataset.family]));
  assert.equal(cards.length,7);
  for(const [id,kind,family] of cards){assert.equal(kind,expected[id],id);assert.equal(family,familyOf(kind),id);}
  assert.deepEqual(cards.map(c=>c[1]).sort(),['board','html','idea','image','markdown','note','url']);

  // The legend: one entry per family present, in order, with counts, reachable and labelled.
  const legend=()=>page.$$eval('.kind-legend button',els=>els.map(b=>[b.dataset.family,b.querySelector('.kind-legend-count').textContent]));
  assert.deepEqual(await legend(),[['page','2'],['doc','1'],['pic','1'],['plain','2'],['board','1']]);
  assert.equal(await page.getAttribute('.kind-legend','role'),'group');
  assert.equal(await page.getAttribute('.kind-legend','aria-label'),'Kinds on this board');
  assert.match(await page.locator('.kind-legend button[data-family="doc"]').evaluate(b=>b.textContent),/Documents\s*1/);

  // Pointing lights one family and dims the rest; nothing moves.
  const rects=()=>page.$$eval('#world .workspace-card',els=>els.map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(Math.round).join(',');}).join(';'));
  const before=await rects();
  const opacities=()=>page.$$eval('#world .workspace-card',els=>els.map(e=>[e.dataset.family,Number(getComputedStyle(e).opacity)]));
  await page.locator('.kind-legend button[data-family="page"]').hover();await page.waitForTimeout(250);
  for(const [family,opacity] of await opacities())assert.ok(family==='page'?opacity===1:opacity<.5,`${family} ${opacity} while pages are lit`);
  assert.equal(await rects(),before,'lighting a kind moves nothing');
  await page.screenshot({path:path.join(evidence,'kinds-legend-hover.png')});
  await page.mouse.move(700,300);await page.waitForTimeout(250);
  assert.ok((await opacities()).every(([,o])=>o===1),'leaving the legend un-dims');

  // Clicking keeps it lit, across a live re-render; clicking again lets go.
  const pic=page.locator('.kind-legend button[data-family="pic"]');
  await pic.click();await page.mouse.move(700,300);await page.waitForTimeout(250);
  assert.equal(await pic.getAttribute('aria-pressed'),'true');
  assert.equal(await page.$eval('#world',w=>w.dataset.lit),'pic');

  // Adding and removing items: kinds stay on the cards, counts follow, the kept family stays lit.
  const added=await op('createItem',{boardId:'mixed',item:{id:'pic-2',title:'pic-2',content:{kind:'video',resource:{rootId:'assets',path:'a.svg'}}},placement:{x:0,y:400,width:320,height:240,presentation:{mode:'card'}}});
  await page.waitForFunction(()=>document.querySelector('.kind-legend button[data-family="pic"] .kind-legend-count')?.textContent==='2',null,{timeout:15000});
  assert.equal(await page.locator(`[data-placement="${added.placementIds[0]}"]`).getAttribute('data-family'),'pic');
  assert.equal(await page.$eval('#world',w=>w.dataset.lit),'pic');
  assert.equal(await pic.getAttribute('aria-pressed'),'true');
  const docPlacement=snapshot.placements.find(p=>p.itemId==='doc-1').id;
  await op('remove',{boardId:'mixed',placementIds:[docPlacement]});
  await page.waitForFunction(()=>!document.querySelector('.kind-legend button[data-family="doc"]'),null,{timeout:15000});
  assert.deepEqual((await legend()).map(e=>e[0]),['page','pic','plain','board']);
  await page.screenshot({path:path.join(evidence,'kinds-legend-kept.png')});
  await pic.click();await page.waitForTimeout(100);
  assert.equal(await page.$eval('#world',w=>w.dataset.lit??null),null);

  // Keyboard: Tab reaches the entries, Space keeps, Escape lets go.
  await page.locator('.kind-legend button').first().focus();await page.keyboard.press('Space');
  assert.equal(await page.$eval('#world',w=>w.dataset.lit),'page');
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#world',w=>w.dataset.lit??null),null);

  // The reader's item carries its kind.
  await page.locator(`[data-placement="${snapshot.placements.find(p=>p.itemId==='note-1').id}"] h3 button`).click();
  await page.locator('#reader-dialog').waitFor({state:'visible'});
  assert.deepEqual(await page.$eval('.reader-title-row',r=>[r.dataset.kind,r.dataset.family]),['note','plain']);
  await page.locator('#close-reader').click();await page.locator('#reader-dialog').waitFor({state:'hidden'});

  // A printed keycap says what the control declares, and that key does the same thing.
  const fit=page.locator('#fit');
  assert.equal(await fit.locator('kbd.keycap-printed').textContent(),'F');
  assert.equal((await fit.getAttribute('aria-keyshortcuts')).split(' ')[0],'F');
  await page.locator('#zoom-plus').click();await page.locator('#zoom-plus').click();await page.waitForTimeout(300);
  const zoomed=await page.locator('#zoom-menu-toggle').textContent();
  await page.locator('#viewport').focus();await page.keyboard.press('f');await page.waitForTimeout(600);
  const fitByKey=await page.locator('#zoom-menu-toggle').textContent();
  assert.notEqual(fitByKey,zoomed,'pressing the printed key fits');
  await page.locator('#zoom-plus').click();await fit.click();await page.waitForTimeout(600);
  assert.equal(await page.locator('#zoom-menu-toggle').textContent(),fitByKey,'the key and the button fit alike');
  assert.equal(await page.locator('.keycap-printed').evaluateAll(caps=>caps.every(c=>c.getAttribute('aria-hidden')==='true')),true);

  // Every labelled command with a key: its cap prints the binding the control declares,
  // and pressing that key (from the board) does what clicking the control does.
  const mac=process.platform==='darwin',mod=mac?'Meta':'Control';
  const cap=locator=>locator.locator('kbd.keycap-printed').textContent();
  // A key pressed on the board, with the pointer resting on the board. Where a click left the pointer on a control, its
  // tooltip shows, and Escape then closes only the tooltip (UI SDK tooltip norm; tooltips-browser checks it), so every
  // key here starts with the pointer parked on bare board and no tooltip showing.
  const onBoard=async()=>{const box=await page.locator('#viewport').boundingBox();await page.mouse.move(box.x+4,box.y+box.height/2);
    await page.waitForFunction(()=>!document.querySelector('ui-tooltip-content[data-open]'));await page.locator('#viewport').focus();};
  const settle=()=>page.waitForTimeout(350);
  const cardCount=()=>page.locator('#world .workspace-card').count();
  const toastText=()=>page.locator('.workspace-toast').last().textContent({timeout:2000}).catch(()=>'');
  const notePlacement=snapshot.placements.find(p=>p.itemId==='note-1').id,noteCard=page.locator(`[data-placement="${notePlacement}"]`);
  const at=async id=>{const p=(await getBoardSnapshot(config,'mixed')).placements.find(p=>p.id===id);return `${p.x},${p.y}`;};
  const keyed=[];
  // Find boards and items: the caret goes to the Navigator's search.
  const search=page.locator('#chrome-search');
  assert.equal(await cap(search),mac?'⌘K':'Ctrl+K');
  await search.click();await settle();
  const searchFocus=await page.evaluate(()=>document.activeElement?.id);assert.equal(searchFocus,'navigator-query');
  await onBoard();await page.keyboard.press(`${mod}+k`);await settle();
  assert.equal(await page.evaluate(()=>document.activeElement?.id),searchFocus);keyed.push('search');
  // Details… on the selection bar: the selected item's details.
  await onBoard();await noteCard.locator('[data-placement-select]').click();
  const details=page.locator('#workspace-selection button',{hasText:'Details'});
  assert.equal(await cap(details),mac?'⌘I':'Ctrl+I');
  const panelTitle=()=>page.locator('#workspace-item-controls h2').textContent();
  await details.click();await settle();assert.equal(await panelTitle(),'note-1');
  await page.locator('#workspace-item-controls [data-context-close]').click();await settle();
  assert.equal(await page.locator('#workspace-item-controls').count(),0);
  await onBoard();await page.keyboard.press(`${mod}+i`);await settle();
  assert.equal(await panelTitle(),'note-1');keyed.push('details');
  // Duplicate in the item's details: one more of it.
  const duplicate=page.locator('#workspace-item-controls [data-context-duplicate]');
  assert.equal(await cap(duplicate),mac?'⌘D':'Ctrl+D');
  let total=await cardCount();
  await duplicate.click();await page.waitForFunction(n=>document.querySelectorAll('#world .workspace-card').length===n,total+1,{timeout:10000});
  total+=1;await settle();
  await onBoard();await page.keyboard.press(`${mod}+d`);
  await page.waitForFunction(n=>document.querySelectorAll('#world .workspace-card').length===n,total+1,{timeout:10000});keyed.push('duplicate');
  await onBoard();await page.keyboard.press('Escape');await settle();
  // Edit document on the selection bar: the selected Markdown document opens for editing in place.
  const doc=await op('createItem',{boardId:'mixed',item:{id:'doc-2',title:'doc-2',content:{kind:'markdown',resource:{rootId:'assets',path:'a.md'}}},placement:{x:1100,y:400,width:320,height:240,presentation:{mode:'card'}}});
  const docCard=page.locator(`[data-placement="${doc.placementIds[0]}"]`);await docCard.waitFor({timeout:10000});
  await docCard.locator('[data-placement-select]').click();
  const edit=page.locator('#workspace-selection [data-edit-document]');
  assert.equal(await cap(edit),'E');
  await edit.click();await page.waitForFunction(id=>document.querySelector(`[data-placement="${id}"]`)?.classList.contains('doc-editing'),doc.placementIds[0],{timeout:10000});
  await onBoard();await page.keyboard.press('Escape');
  await page.waitForFunction(id=>!document.querySelector(`[data-placement="${id}"]`)?.classList.contains('doc-editing'),doc.placementIds[0],{timeout:10000});
  if(!await page.locator('#workspace-selection [data-edit-document]:visible').count())await docCard.locator('[data-placement-select]').click();
  await onBoard();await page.keyboard.press('e');
  await page.waitForFunction(id=>document.querySelector(`[data-placement="${id}"]`)?.classList.contains('doc-editing'),doc.placementIds[0],{timeout:10000});keyed.push('edit document');
  await onBoard();await page.keyboard.press('Escape');
  await page.waitForFunction(id=>!document.querySelector(`[data-placement="${id}"]`)?.classList.contains('doc-editing'),doc.placementIds[0],{timeout:10000});
  await page.keyboard.press('Escape');await settle();
  // The board Inspector's Edit and Help rows: Undo, Redo, Copy selection, Keyboard shortcuts.
  await page.locator('#board-info-toggle').click();await page.locator('#board-info').waitFor({state:'visible'});
  const undo=page.locator('#workspace-undo'),redo=page.locator('#workspace-redo'),copy=page.locator('#workspace-copy'),guide=page.locator('#workspace-keyboard-shortcuts');
  assert.deepEqual([await cap(undo),await cap(redo),await cap(copy),await cap(guide)],mac?['⌘Z','⇧⌘Z','⌘C','?']:['Ctrl+Z','Ctrl+Shift+Z','Ctrl+C','?']);
  await page.screenshot({path:path.join(evidence,'keycaps-inspector.png')});
  // (a card on the left, clear of the Inspector)
  const leftPlacement=snapshot.placements.find(p=>p.itemId==='page-2').id,leftCard=page.locator(`[data-placement="${leftPlacement}"]`);
  const rest=await at(leftPlacement);
  const drag=async()=>{const box=await leftCard.boundingBox();const x=box.x+box.width/2,y=box.y+12;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+40,y+30,{steps:5});await page.mouse.move(x+80,y+60,{steps:5});await page.mouse.up();await page.waitForTimeout(700);};
  await drag();const moved=await at(leftPlacement);assert.notEqual(moved,rest);
  const inspector=async()=>{if(await page.locator('#board-info').isHidden()){await page.locator('#board-info-toggle').click();await page.locator('#board-info').waitFor({state:'visible'});}};
  await inspector();await undo.click();await page.waitForTimeout(700);assert.equal(await at(leftPlacement),rest,'Undo by click');
  await inspector();await redo.click();await page.waitForTimeout(700);assert.equal(await at(leftPlacement),moved,'Redo by click');
  await onBoard();await page.keyboard.press(`${mod}+z`);await page.waitForTimeout(700);assert.equal(await at(leftPlacement),rest,'Undo by its key');keyed.push('undo');
  await page.keyboard.press(`${mod}+Shift+z`);await page.waitForTimeout(700);assert.equal(await at(leftPlacement),moved,'Redo by its key');keyed.push('redo');
  await leftCard.locator('[data-placement-select]').click();await settle();
  await inspector();await copy.click();await settle();const copiedByClick=await toastText();assert.match(copiedByClick,/^Copied (selection\.|1 )/);   // Tinka 1.3: "Copied selection."
  await page.evaluate(()=>document.querySelectorAll('.workspace-toast').forEach(t=>t.remove()));   // the key must make its own
  await onBoard();await page.keyboard.press(`${mod}+c`);await settle();
  assert.equal(await toastText(),copiedByClick);keyed.push('copy selection');
  await inspector();await guide.click();const shortcuts=page.getByRole('dialog',{name:'Keyboard shortcuts'});await shortcuts.waitFor();
  await page.keyboard.press('Escape');await shortcuts.waitFor({state:'detached'}).catch(()=>shortcuts.waitFor({state:'hidden'}));
  await onBoard();await page.keyboard.press('?');await shortcuts.waitFor();keyed.push('keyboard shortcuts');
  await page.keyboard.press('Escape');await settle();
  // Every cap is a member of the raised height: a lower lip inside its own box.
  assert.ok(await page.locator('kbd.tk-kbd').evaluateAll(caps=>caps.filter(c=>c.offsetParent).every(c=>/inset/.test(getComputedStyle(c).boxShadow))),'keycaps stand at the raised height');
  // Not printed, by design: the Comments key (⇧C shows and hides comments: the "Show comments" row of its menu, not the key that opens the menu).
  assert.equal(await page.locator('#comment-layer-toggle kbd').count(),0);

  // Home: boards are boards, and each says what is inside it.
  await page.goto(base+'/');await page.locator('.board-card[data-home-board="mixed"]').waitFor();
  const home=page.locator('.board-card[data-home-board="mixed"]');
  assert.deepEqual(await home.evaluate(e=>[e.dataset.kind,e.dataset.family]),['board','board']);
  assert.deepEqual(await home.locator('.kinds-line-entry').evaluateAll(es=>es.map(e=>[e.dataset.family,e.textContent])),
    [['page','2 pages'],['doc','1 document'],['pic','2 pictures'],['plain','4 notes'],['board','1 board']]);   // after the keycap section's document and two duplicates
  await page.screenshot({path:path.join(evidence,'kinds-home.png')});

  // Box-shadow layers, in order: the far edge (a face copy shifted up), the front edge (shifted down), the dark ring
  // under both (so the corners carry no seam), the side, its contour, the cast.
  // The slab zooms as one object: its side is a world length (10 px at every zoom from 25 % up, so a constant
  // fraction of the card on screen), floored only far out (2.5 screen px); the face's left, right and front edges are
  // drawn in its own side's colour, per family; hover closes the far edge in that colour too.
  await page.setViewportSize({width:1440,height:900});await page.goto(base+'/boards/mixed/');await page.locator('#world .workspace-card').first().waitFor();
  const slab=()=>page.$$eval('#world .workspace-card[data-family]',els=>els.map(e=>{
    const parts=getComputedStyle(e).boxShadow.split(/,(?![^(]*\))/).map(x=>x.trim());
    const px=str=>str.match(/(-?[\d.]+)px/g).map(parseFloat);
    const probe=document.createElement('i');e.append(probe);probe.style.color=`var(--kind-${e.dataset.family}-side)`;const edge=getComputedStyle(probe).color;probe.remove();
    const paint=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
    const colour=str=>{paint.clearRect(0,0,1,1);paint.fillStyle=str.replace(/\s*-?[\d.]+px/g,'').trim();paint.fillRect(0,0,1,1);return [...paint.getImageData(0,0,1,1).data].slice(0,3).join(',');};   // any notation (rgb, color(srgb), oklch) to r,g,b
    return {family:e.dataset.family,front:colour(parts[1]),ring:colour(parts[2]),side:px(parts[3])[1],height:e.getBoundingClientRect().height/parseFloat(getComputedStyle(document.getElementById('viewport')).getPropertyValue('--canvas-zoom')||1),edge:colour(edge),edgeRaw:edge};}));
  const zoomTo=z=>page.evaluate(z=>{const b=document.createElement('button');b.dataset.zoomTo=String(z);b.hidden=true;document.getElementById('zoom-menu').append(b);b.click();b.remove();},z);
  for(const z of [.25,.45,.7,1,2]){
    await zoomTo(z);await page.waitForTimeout(250);
    for(const c of await slab()){
      assert.ok(Math.abs(c.side-10)<.05,`${c.family} side is 10 world px at ${z*100}% (got ${c.side})`);
      assert.deepEqual([c.ring,c.front],[c.edge,c.edge],`${c.family}: the face's ring (left and right edges) and front edge are its side's colour`);
    }
  }
  await zoomTo(.1);await page.waitForTimeout(250);
  for(const c of await slab())assert.ok(Math.abs(c.side*.1-2.5)<.05,`far out the side is held at 2.5 screen px (got ${c.side*.1})`);
  await zoomTo(1);await page.waitForTimeout(250);
  const far=()=>page.locator('#world .workspace-card[data-family="page"]').first().evaluate(e=>getComputedStyle(e).boxShadow.split(/,(?![^(]*\))/)[0].trim());
  const farRest=await far();await page.locator('#world .workspace-card[data-family="page"]').first().hover();await page.waitForTimeout(200);
  assert.notEqual(await far(),farRest,'hover closes the far edge');
  const rgb=str=>{const m=str.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/);return m?m.slice(1).map(v=>Math.round(v*255)).join(','):str.match(/rgba?\((\d+), (\d+), (\d+)/).slice(1).join(',');};
  assert.equal(rgb(await far()),rgb((await slab()).find(c=>c.family==='page').edgeRaw),'...in the side\'s colour');

  // Phone width and touch: no legend, no keycaps.
  await page.setViewportSize({width:390,height:844});await page.goto(base+'/boards/mixed/');await page.locator('#world .workspace-card').first().waitFor();
  assert.equal(await page.locator('.kind-legend').evaluate(l=>getComputedStyle(l).display),'none');
  assert.ok(await page.locator('.keycap-printed').evaluateAll(caps=>caps.every(c=>getComputedStyle(c).display==='none')));

  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,evidence,checks:['kind and family on every card by the shared rule','slab side 10 world px at 25-200 % (floor 2.5 screen px far out); face edges in the side\'s colour per family; hover closes the far edge','legend families, order, counts and labels','hover lights one family, dims the rest, moves nothing','click keeps across live adds and removals','keyboard keep and Escape','reader item kind','keycap matches aria-keyshortcuts and its key fits as the button does','search, details, duplicate, edit document, undo, redo, copy selection and keyboard shortcuts: cap = declared binding, key = click','Home board kind and kinds line','no legend or keycaps at phone width']}));
} finally {await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
