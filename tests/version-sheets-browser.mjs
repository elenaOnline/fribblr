// Version stacks stand on sheets (depth.css data-sheets): one sheet per other version, at most three, drawn as the
// slab's own --under layers, so the cast and the selection line move down with them. A plain card has none.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from '../cli.mjs';
import {loadConfig} from '../lib/config.mjs';
import {applyOperation} from '../lib/workspace.mjs';
import {listen,closeAppServer} from '../server.mjs';
import {versionSheets} from '../public/version-stack.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=await mkdtemp(path.join(os.tmpdir(),'tinka-version-sheets-'));
let server,browser;const errors=[];
try {
  assert.equal(versionSheets({}),0);
  assert.equal(versionSheets({versionStack:{versions:[{id:'a'}]}}),0);
  assert.equal(versionSheets({versionStack:{versions:[{id:'a'},{id:'b'},{id:'c'}]}}),2);
  assert.equal(versionSheets({versionStack:{versions:Array.from({length:9},(_,i)=>({id:String(i)}))}}),3);

  const file=path.join(root,'config.json');await main(['init','--config',file,'--boards',path.join(root,'boards'),'--label','Sheets']);const config=await loadConfig(file);
  const op=async(type,fields)=>(await applyOperation(config,{type,...fields})).result;
  await op('createBoard',{id:'stacks',title:'Stacks'});
  const assets=path.join(config.boardsRoot,'assets');await mkdir(assets);
  for(const name of ['two-v01.html','two-v02.html','many-v01.html','many-v02.html','many-v03.html','many-v04.html','many-v05.html','plain.html'])
    await writeFile(path.join(assets,name),`<!doctype html><p>${name}</p>`);
  await op('updateWorkspace',{patch:{resourceRoots:{assets:{path:'../assets'}}}});
  let x=0;const add=(id,file)=>op('createItem',{boardId:'stacks',item:{id,title:id,content:{kind:'html',resource:{rootId:'assets',path:file}}},
    placement:{x:(x+=400)-400,y:0,width:320,height:240,presentation:{mode:'card'}}});
  await add('two','two-v01.html');await add('many','many-v01.html');await add('plain','plain.html');
  server=await listen(config,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,args:['--mute-audio'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:900},colorScheme:'light'});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/boards/stacks/');await page.locator('#world .workspace-card').first().waitFor();await page.waitForTimeout(300);
  const card=id=>page.locator(`#world .workspace-card:has(> [data-placement-select][aria-label$=" ${id}"])`).first();
  const read=id=>card(id).evaluate(el=>{
    const css=getComputedStyle(el);
    return {sheets:el.dataset.sheets??null,layers:(css.boxShadow.match(/rgb|oklch|color\(/g)||[]).length,
      under:(()=>{const i=document.createElement('i');i.style.cssText='position:absolute;width:var(--under-d,0px)';el.append(i);const w=i.getBoundingClientRect().width/(el.getBoundingClientRect().width/el.offsetWidth);i.remove();return w;})(),
      outlineOffset:parseFloat(css.outlineOffset)};
  });
  const two=await read('two'),many=await read('many'),plain=await read('plain');
  assert.equal(two.sheets,'1');assert.equal(many.sheets,'3');assert.equal(plain.sheets,null);
  // each sheet is four layers (paper, its rim, side, contour), in place of the plain slab's one empty --under layer
  assert.equal(two.layers,plain.layers+3);assert.equal(many.layers,plain.layers+11);
  assert.ok(two.under>0&&Math.abs(many.under-3*two.under)<.01,'each sheet adds one step of height');
  // selected, the line is drawn clear of the sheets too
  await card('many').locator('[data-placement-select]').click({force:true});await page.waitForTimeout(200);
  await card('plain').locator('[data-placement-select]').click({force:true,modifiers:['Shift']});await page.waitForTimeout(200);
  const [manySel,plainSel]=[await read('many'),await read('plain')];
  assert.ok(Math.abs(manySel.outlineOffset-plainSel.outlineOffset-many.under)<.5,`selection offset ${manySel.outlineOffset} vs ${plainSel.outlineOffset}`);
  // A card's own toolbars (the hover strip, a stack's ‹ name › ticker) are one Tab stop each, with arrows along them.
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#world .workspace-card.selected'));
  const focusedIn=()=>page.evaluate(()=>{const a=document.activeElement,bar=a?.closest('[data-roving]');return {bar:bar?.className.split(' ')[0]||null,label:a?.getAttribute('aria-label')||a?.textContent.trim()};});
  const tabTo=async(id,match)=>{await card(id).focus();for(let i=0;i<12;i++){await page.keyboard.press('Tab');const f=await focusedIn();if(match(f))return f;}throw new Error(`no ${id} stop matched`);};
  let f=await tabTo('plain',f=>f.bar==='workspace-tile-toolbar');
  assert.match(f.label,/^Open plain$/,'Tab enters the strip on its first control');
  assert.equal(await card('plain').locator('.workspace-tile-toolbar').getAttribute('role'),'toolbar');
  assert.equal(await card('plain').locator('.workspace-tile-toolbar :is(button,a)[tabindex="0"], .workspace-tile-toolbar :is(button,a):not([tabindex])').count(),1,'one Tab stop');
  await page.keyboard.press('ArrowRight');assert.match((await focusedIn()).label,/^Comments on plain/);
  await page.keyboard.press('End');assert.match((await focusedIn()).label,/^Favorite plain/);
  await page.keyboard.press('ArrowRight');assert.match((await focusedIn()).label,/^Open plain/,'wraps');
  await page.keyboard.press('ArrowLeft');await page.keyboard.press('Tab');assert.notEqual((await focusedIn()).bar,'workspace-tile-toolbar','Tab leaves the strip');
  await page.keyboard.press('Shift+Tab');assert.match((await focusedIn()).label,/^Favorite plain/,'Shift+Tab comes back to the control focused last');
  f=await tabTo('many',f=>f.bar==='workspace-file-versions');
  const ticker=card('many').locator('.workspace-file-versions');
  assert.equal(await ticker.getAttribute('role'),'toolbar');assert.equal(await ticker.locator('button[tabindex="0"], button:not([tabindex])').count(),1,'one Tab stop');
  assert.equal(f.label,'Previous version');
  await page.keyboard.press('ArrowRight');assert.match((await focusedIn()).label,/choose a version$/);
  await page.keyboard.press('End');assert.equal((await focusedIn()).label,'Next version');
  assert.equal(await ticker.locator('[data-file-version-step=next]').getAttribute('aria-disabled'),'true','the newest version: Next stays reachable, disabled');
  await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowDown');
  await page.locator('#file-version-menu ui-menu-content[data-open]').waitFor();
  await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.matches('[data-file-version-menu]'));
  await page.keyboard.press('Home');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>/V04|v04/.test(document.querySelector('#world .workspace-file-version-name [role=status]')?.textContent||'')||[...document.querySelectorAll('#world [data-file-version-menu]')].some(b=>/04/.test(b.textContent)));
  assert.equal((await focusedIn()).label,'Previous version','focus stays on Previous as the version steps');
  // The reader's version strip is a toolbar too.
  await card('many').locator('.workspace-tool-open').evaluate(el=>el.click());await page.locator('#reader-dialog[open]').waitFor();
  const strip=page.locator('#reader-file-versions');await strip.waitFor();
  assert.equal(await strip.getAttribute('role'),'toolbar');
  await page.locator('#reader-older-file').focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'reader-file-version-choose');
  await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement?.id),'reader-newer-file');
  assert.equal(await strip.locator('button[tabindex="0"]').count(),1,'one Tab stop');
  assert.deepEqual(errors,[]);
  console.log('Version stacks stand on one sheet per other version (at most three), and the cast and selection follow. A card\'s hover strip and version ticker, and the reader\'s strip, are one toolbar stop each.');
} finally {
  await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true});
}
