// The emoji sticker picker on UI SDK's norms (ui-sdk.md § Sticker picker): a popover beside its opener, kept inside the
// window; focus in on open and back to the opener on close; a combobox field whose arrows move one highlight through the
// grid in two dimensions while the caret stays put; Enter places the highlighted sticker; Escape empties the query, then
// closes; matching ignores case and accents; the grid, the categories and the skin tones are one Tab stop each; skin
// tone is a remembered radio choice; only the rows in view are rendered. Also the Add menu's Sticker row and dragging
// a sticker onto the board.
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
const root=await mkdtemp(path.join(os.tmpdir(),'tinka-sticker-picker-'));
let server,browser;const errors=[];
try {
  const file=path.join(root,'config.json');await main(['init','--config',file,'--boards',path.join(root,'boards'),'--label','Sticker picker']);const config=await loadConfig(file);
  const op=async(type,fields)=>(await applyOperation(config,{type,...fields})).result;
  await op('createBoard',{id:'s',title:'Stickers'});
  await op('createItem',{boardId:'s',item:{id:'card',title:'A card',content:{kind:'note',text:'A note.'}},placement:{x:100,y:100,width:260,height:180}});
  server=await listen(config,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,args:['--mute-audio'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'light',reducedMotion:'reduce'});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);
  const settle=(ms=250)=>page.waitForTimeout(ms);
  const until=async(read,expected,what)=>{const deadline=Date.now()+8000;let value;while(Date.now()<deadline){value=await read();if(value===expected)return;await settle(80);}assert.equal(value,expected,what);};
  const stickers=async()=>(await getBoardSnapshot(config,'s')).decorations.filter(d=>d.sticker).map(d=>d.text);
  const open=async()=>{await page.goto(`${base}/boards/s/`);await page.locator('#world .workspace-card').first().waitFor();await settle(500);
    if(await page.locator('[data-mode="canvas"]').getAttribute('aria-pressed')!=='true'){await page.locator('#board-info-toggle').click();await page.locator('[data-mode="canvas"]').click();await page.keyboard.press('Escape');await settle();}};
  const rail=page.locator('[data-edit-tool="sticker"]');
  const dialog=page.getByRole('dialog',{name:'Emoji stickers'});
  const field=page.getByRole('combobox',{name:'Search emoji'});
  const grid=page.locator('.emoji-picker-results');
  const focused=()=>page.evaluate(()=>{const a=document.activeElement;return a?.matches('.emoji-picker-search')?'field':a?.matches('.emoji-picker-results')?'grid':a?.matches('.emoji-picker-category')?'category':a?.matches('ui-segmented-control-item')?'tone':a?.matches('[data-edit-tool="sticker"]')?'rail':a?.matches('#workspace-add')?'add':a?.closest?.('[data-decoration]')?'sticker':a?.tagName||'none';});
  // The highlighted sticker as the field and the grid point at it: [emoji, index], or null.
  const lit=()=>page.evaluate(()=>{const owner=document.querySelector('.emoji-picker-results');const id=owner?.getAttribute('aria-activedescendant');const cell=id&&document.getElementById(id);
    const marked=[...document.querySelectorAll('.emoji-picker-option[data-highlighted]')];
    if(!cell)return marked.length?'marked without aria-activedescendant':null;
    if(marked.length!==1||marked[0]!==cell)return 'aria-activedescendant and data-highlighted disagree';
    if(document.querySelector('.emoji-picker-search').getAttribute('aria-activedescendant')!==id)return 'field and grid disagree';
    return [cell.dataset.emoji,Number(cell.dataset.index)];});
  const cols=()=>page.evaluate(()=>Number(document.querySelector('.emoji-picker-results').getAttribute('aria-colcount')));
  const openPicker=async()=>{await rail.click();await dialog.waitFor();await until(focused,'field','Opening the picker puts focus in its search field');};

  await open();

  // ---- Opening: a dialog beside the Sticker key, inside the window; focus in the field; the key says it is expanded.
  await openPicker();
  assert.equal(await rail.getAttribute('aria-expanded'),'true');
  assert.equal(await rail.getAttribute('aria-controls'),await dialog.getAttribute('id'),'The opener points at the picker');
  const box=await dialog.boundingBox(),key=await rail.boundingBox();
  assert.ok(box.x>=8&&box.y>=8&&box.x+box.width<=1440-8&&box.y+box.height<=900-8,`The picker stays inside the window: ${JSON.stringify(box)}`);
  assert.ok(box.y+box.height<=key.y,'The Sticker key sits at the bottom, so the picker opens above it');
  assert.equal(await field.getAttribute('aria-controls'),await grid.getAttribute('id'));
  assert.equal(await field.getAttribute('aria-haspopup'),'grid');
  const tree=await dialog.ariaSnapshot();
  for(const role of ['combobox "Search emoji"','group "Emoji categories"','radiogroup "Skin tone"','grid "Favorites"','row','gridcell "Light bulb"'])assert.ok(tree.includes(role),`The picker exposes ${role}:\n${tree}`);
  assert.equal(await lit(),null,'Nothing is highlighted before a key moves into the grid');

  // ---- The field: arrows move one highlight in two dimensions; the caret never leaves the field.
  const c=await cols();
  assert.ok(c>=6,`The grid lays out ${c} columns`);
  await page.keyboard.press('ArrowDown');assert.deepEqual(await lit(),['💡',0],'Down from the field highlights the first sticker');
  await page.keyboard.press('ArrowRight');assert.deepEqual((await lit())[1],1,'Right moves one cell');
  await page.keyboard.press('ArrowDown');assert.deepEqual((await lit())[1],1+c,'Down moves one row');
  await page.keyboard.press('ArrowLeft');assert.deepEqual((await lit())[1],c,'Left moves one cell back');
  await page.keyboard.press('ArrowLeft');assert.deepEqual((await lit())[1],c-1,'Left from a row start goes to the end of the row above (reading order)');
  await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp');
  assert.equal(await lit(),null,'Up from the first row gives the field its arrows back');
  assert.equal(await focused(),'field','The caret stayed in the field throughout');
  assert.match(await page.locator('.emoji-picker-foot').textContent(),/102 emoji/,'The foot counts what the view holds');
  await page.keyboard.press('ArrowDown');
  assert.match(await page.locator('.emoji-picker-foot').textContent(),/💡\s+Light bulb/,'The foot names the highlighted sticker');

  // ---- Matching ignores case and accents; typing highlights the best match.
  await field.fill('PIÑATA');
  assert.deepEqual(await lit(),['🪅',0],'PIÑATA finds the piñata and highlights it');
  await field.fill('pinata');
  assert.deepEqual(await lit(),['🪅',0],'pinata (no accent, lower case) finds it too');
  assert.equal(await page.locator('.emoji-picker-title').textContent(),'Search results');
  assert.equal(await page.locator('.emoji-picker-category[aria-pressed="true"]').count(),0,'No category is pressed while a search shows its results');

  // ---- Escape empties the query first, then closes, and focus goes back to the opener.
  await page.keyboard.press('Escape');
  assert.equal(await field.inputValue(),'','The first Escape empties the field');
  assert.ok(await dialog.isVisible(),'...and keeps the picker open');
  assert.equal(await page.locator('.emoji-picker-title').textContent(),'Favorites');
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'detached'});
  assert.equal(await focused(),'rail','The second Escape closes the picker and focus returns to the Sticker key');
  assert.equal(await rail.getAttribute('aria-expanded'),'false');

  // ---- Enter places the highlighted sticker.
  await openPicker();
  await page.keyboard.type('pina');
  await page.keyboard.press('Enter');
  await dialog.waitFor({state:'detached'});
  await until(async()=>(await stickers()).join(),'🪅','Enter placed the highlighted piñata');
  assert.equal(await focused(),'sticker','The placed sticker has focus, as when any drawn element is added');

  // ---- One Tab stop each: field, categories, skin tone, grid; then out, as if the picker followed its opener.
  await openPicker();
  await until(()=>page.locator('.emoji-picker-category').count(),11,'The categories load');
  await page.keyboard.press('Tab');assert.equal(await focused(),'category','Tab: the categories');
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'People & Body','Arrows move along the categories');
  assert.equal(await page.locator('.emoji-picker-title').textContent(),'Favorites','...without choosing one');
  await page.keyboard.press('Space');
  assert.equal(await page.locator('.emoji-picker-title').textContent(),'People & Body','Space chooses the focused category');
  assert.equal(await page.locator('.emoji-picker-category[aria-pressed="true"]').getAttribute('aria-label'),'People & Body');
  await page.keyboard.press('Space');
  assert.equal(await page.locator('.emoji-picker-category[aria-pressed="true"]').count(),1,'Pressing the chosen category again keeps it chosen');
  await page.keyboard.press('Tab');assert.equal(await focused(),'tone','Tab: the skin tones, one stop');
  await page.keyboard.press('Tab');assert.equal(await focused(),'grid','Tab: the grid, one stop');
  assert.equal((await lit())[1],0,'Entering the grid highlights its first sticker');
  await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowRight');
  assert.equal((await lit())[1],c+1,'Arrows move in two dimensions in the grid too');
  await page.keyboard.press('End');assert.equal((await lit())[1],2*c-1,'End: the end of the row');
  await page.keyboard.press('Home');assert.equal((await lit())[1],c,'Home: the start of the row');
  // Virtualised: a few rows exist, Control+End reaches the last sticker and renders its row.
  const people=await page.evaluate(()=>[document.querySelectorAll('.emoji-picker-option').length,Number(document.querySelector('.emoji-picker-results').getAttribute('aria-rowcount'))]);
  assert.ok(people[0]<people[1]*c/2,`Only the rows in view are rendered (${people[0]} cells of ${people[1]} rows)`);
  await page.keyboard.press('Control+End');
  const lastPerson=await lit();
  assert.ok(lastPerson[1]>300,`Control+End goes to the last sticker (${lastPerson[1]})`);
  assert.ok(await page.locator('.emoji-picker-option[data-highlighted]').isVisible(),'...and scrolls it into view');
  await page.keyboard.press('Control+Home');assert.equal((await lit())[1],0,'Control+Home goes back to the first');
  await page.keyboard.press('PageDown');assert.ok((await lit())[1]>=3*c,'PageDown moves a page of rows');
  // Typing on the grid searches.
  await page.keyboard.press('r');
  assert.equal(await focused(),'field','A letter typed on the grid goes to the search field');
  assert.equal(await field.inputValue(),'r');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Shift+Tab');assert.equal(await focused(),'rail','Shift+Tab from the field goes back to the opener');
  assert.ok(await dialog.isVisible(),'...which belongs to the picker, as a popover trigger does, so it stays open');
  await page.keyboard.press('Enter');
  await dialog.waitFor({state:'detached'});
  assert.equal(await focused(),'rail','Enter on the opener closes it');

  // Tab from the grid leaves the picker for what follows the opener, and the picker closes.
  await openPicker();
  for(let i=0;i<3;i++)await page.keyboard.press('Tab');
  assert.equal(await focused(),'grid');
  await page.keyboard.press('Tab');
  await dialog.waitFor({state:'detached'});
  assert.ok(!['field','grid','rail','BODY','none'].includes(await focused()),`Tab from the grid moved on past the Sticker key (${await focused()})`);

  // ---- Skin tone: a radio choice, applied to the stickers that take one, remembered between visits.
  await openPicker();
  const tones=page.getByRole('radiogroup',{name:'Skin tone'});
  assert.equal(await tones.getByRole('radio',{checked:true}).getAttribute('aria-label'),'Default skin tone');
  const thumbs=()=>page.locator('.emoji-picker-option[aria-label^="Thumbs up"]').getAttribute('data-emoji');
  assert.equal(await thumbs(),'👍');
  await tones.getByRole('radio',{name:'Medium skin tone'}).click();
  assert.equal(await tones.getByRole('radio',{checked:true}).getAttribute('aria-label'),'Medium skin tone');
  await until(thumbs,'👍🏽','Favorites show the chosen tone');
  await page.keyboard.press('ArrowRight');
  await until(thumbs,'👍🏾','Arrows check the next tone (a radio group)');
  await field.focus();await field.fill('thumbs');
  assert.deepEqual(await lit(),['👍🏾',0],'Search results show the chosen tone, once each');
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  await page.reload();await page.locator('#world .workspace-card').first().waitFor();await settle(400);
  await openPicker();
  assert.equal(await page.getByRole('radiogroup',{name:'Skin tone'}).getByRole('radio',{checked:true}).getAttribute('aria-label'),'Medium-dark skin tone','The tone is remembered');
  await page.getByRole('radiogroup',{name:'Skin tone'}).getByRole('radio',{name:'Default skin tone'}).click();
  await until(thumbs,'👍','Back to the default tone');

  // ---- Pointer: hovering highlights; a press outside closes without taking focus back; the opener toggles it.
  const cell=page.locator('.emoji-picker-option').nth(3);
  await cell.hover();
  assert.equal((await lit())[1],3,'Hovering a sticker highlights it (one highlight for pointer and keys)');
  await rail.click();
  await dialog.waitFor({state:'detached'});
  assert.equal(await focused(),'rail','Pressing the Sticker key again closes the picker');
  await openPicker();
  await page.mouse.click(300,200);
  await dialog.waitFor({state:'detached'});
  assert.notEqual(await focused(),'rail','A press outside closes it and leaves focus where the press put it');

  // ---- A click places a sticker.
  await openPicker();
  await page.locator('.emoji-picker-option[aria-label="Rocket"]').click();
  await dialog.waitFor({state:'detached'});
  await until(async()=>(await stickers()).sort().join(),['🪅','🚀'].sort().join(),'A click placed the rocket');

  // ---- Drag a sticker onto the board.
  await openPicker();
  await page.locator('.emoji-picker-option[aria-label="Target"]').dragTo(page.locator('#viewport'),{targetPosition:{x:1000,y:300}});
  await until(async()=>(await stickers()).includes('🎯'),true,'Dragging a sticker onto the board places it');

  // ---- The Add menu's Sticker row opens the same picker; Escape returns to Add.
  await open();
  await page.locator('#workspace-add').click();
  await page.getByRole('menuitem',{name:'Sticker'}).click();
  await dialog.waitFor();
  await until(focused,'field','The Add menu opens the picker with focus in its field');
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'detached'});
  assert.equal(await focused(),'add','Escape returns focus to Add');

  // ---- Narrow window: still inside it.
  await page.setViewportSize({width:390,height:844});await settle(300);
  await open();
  await openPicker();
  const narrow=await dialog.boundingBox();
  assert.ok(narrow.x>=8&&narrow.x+narrow.width<=390-8&&narrow.y>=8&&narrow.y+narrow.height<=844-8,`At 390 px the picker stays inside the window: ${JSON.stringify(narrow)}`);
  assert.ok(await cols()>=6);
  await page.keyboard.press('Escape');

  assert.deepEqual(errors,[]);
  console.log('sticker picker browser test passed');
} finally {
  await browser?.close();
  if(server)await closeAppServer(server).catch(()=>server.close());
  await rm(root,{recursive:true,force:true});
}
