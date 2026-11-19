// Disposable headless checks for Home's board list and its selection: one Tab stop, arrows that follow the grid,
// typeahead, Space, the board's corner circle, ⌘/Ctrl-click, Shift-click ranges, ⌘A, the marquee and one floating
// selection bar (UI SDK collection norms; public/home-board-list.js). Never writes.
import './helpers/offline.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from '../cli.mjs';
import {loadConfig} from '../lib/config.mjs';
import {applyOperation} from '../lib/workspace.mjs';
import {listen,closeAppServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const fixture=await mkdtemp(path.join(os.tmpdir(),'tinka-home-selection-'));
const evidence=process.env.TINKA_EVIDENCE_DIR||await mkdtemp(path.join(os.tmpdir(),'tinka-home-selection-evidence-'));
await mkdir(evidence,{recursive:true});
const configPath=path.join(fixture,'local/config.json'),boards=path.join(fixture,'boards');
// The selection mark is the theme's one blue (tokens.css --mark-blue): the approved value in light,
// and in dark whatever the dark tokens resolve it to (dark is derived, not designed).
const LIGHT_RING='rgb(0, 94, 139)';let DARK_ACCENT=null;
const markBlue=page=>page.evaluate(()=>{const probe=document.createElement('i');probe.style.color='var(--mark-blue)';document.body.append(probe);const value=getComputedStyle(probe).color;probe.remove();return value;});
let browser,server;
try {
  await main(['init','--config',configPath,'--boards',boards,'--label','Home selection']);
  const config=await loadConfig(configPath);
  const op=async(type,fields)=>(await applyOperation(config,{type,...fields})).result;
  // Oldest first, so Home (newest first) shows Delta, Gamma, Beta, Alpha.
  for(const title of ['Alpha','Beta','Gamma','Delta']){
    const b=await op('createBoard',{title});
    await op('createItem',{boardId:b.boardId,item:{title:`${title} note`,content:{kind:'note',text:'Something to look at.'}}});
  }
  server=await listen(config,{port:0});
  const base=`http://127.0.0.1:${server.address().port}`;
  const revision=async()=>(await (await fetch(base+'/api/workspace')).json()).revision;
  const before=await revision();
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const cards=page.locator('#board-grid .board-card[data-home-item]');
  const card=title=>cards.filter({has:page.getByRole('heading',{name:title,exact:true})});
  const selectedTitles=()=>page.locator('#board-grid .board-card.workspace-home-selected h3').allTextContents();
  const bar=page.locator('[data-home-selection]');
  const expectSelected=async(titles,why)=>{
    const end=Date.now()+3000;let got;
    while(Date.now()<end){got=(await selectedTitles()).sort();if(JSON.stringify(got)===JSON.stringify([...titles].sort()))return;await page.waitForTimeout(50);}
    assert.deepEqual(got,[...titles].sort(),why);
  };
  // No checkbox inputs and no small square controls outside the cover window.
  const noSquares=()=>page.evaluate(()=>{
    const bad=[];
    if(document.querySelector('#board-grid input[type=checkbox],#board-grid .workspace-home-select'))bad.push('checkbox control');
    for(const el of document.querySelectorAll('#board-grid .board-card *')){
      // The kinds line's swatches are tiny slabs naming a kind's colour, not controls.
      if(el.closest('.board-art')||el.matches('.kind-swatch'))continue;
      const r=el.getBoundingClientRect(),s=getComputedStyle(el);
      if(!r.width||r.width>40||Math.abs(r.width-r.height)>4||Number(s.opacity)<.05||s.visibility==='hidden')continue;
      const painted=s.backgroundColor!=='rgba(0, 0, 0, 0)'||s.boxShadow!=='none'||parseFloat(s.borderTopWidth)>0;
      if(painted&&parseFloat(s.borderTopLeftRadius)<r.width*.4)bad.push(`${el.tagName}.${el.className} ${Math.round(r.width)}px`);
    }
    return bad;
  });
  const dotState=title=>card(title).locator('[data-home-select]').evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {opacity:Number(s.opacity),radius:s.borderRadius,width:r.width,bg:s.backgroundColor,hidden:el.getAttribute('aria-hidden'),tabindex:el.getAttribute('tabindex'),selected:el.closest('.board-card').querySelector('.board-link').getAttribute('aria-selected')};});
  const option=title=>page.getByRole('option',{name:title,exact:true});
  const focused=()=>page.evaluate(()=>document.activeElement?.closest?.('.board-card')?.querySelector('h3')?.textContent||document.activeElement?.tagName);
  const passed=[];

  await page.goto(base+'/');
  await cards.nth(3).waitFor();
  assert.equal(await cards.count(),4);
  assert.deepEqual(await noSquares(),[],'no squares at rest (1440)');
  for(const t of ['Alpha','Beta','Gamma','Delta'])assert.equal((await dotState(t)).opacity,0,`${t} circle hidden at rest`);
  await card('Delta').locator('h3').hover();await page.waitForTimeout(250);
  let dot=await dotState('Delta');
  assert.equal(dot.opacity,1,'hover shows the circle');assert.equal(dot.radius,'50%');assert.equal(Math.round(dot.width),22);
  assert.equal(dot.hidden,'true','the circle is for the pointer: out of the accessibility tree');assert.equal(dot.tabindex,'-1','and out of the Tab order');assert.equal(dot.selected,'false');
  assert.deepEqual(await noSquares(),[],'no squares on hover (1440)');
  await page.screenshot({path:path.join(evidence,'home-hover-1440.png')});
  passed.push('no checkboxes or squares at rest or hover (1440)','hover shows the corner circle');

  // The grid is one listbox: one Tab stop, options that say whether they are selected.
  const list=page.getByRole('listbox',{name:'Boards'});
  assert.equal(await list.getAttribute('aria-multiselectable'),'true');
  assert.equal(await list.getByRole('option').count(),4);
  assert.equal(await page.locator('#board-grid a,#board-grid button').evaluateAll(els=>els.filter(el=>el.tabIndex>=0).length),2,'one Tab stop for the boards, one for New board');
  await page.locator('#home-find').focus();
  for(let i=0;i<6&&await focused()!=='Delta';i++)await page.keyboard.press('Tab');
  assert.equal(await focused(),'Delta','Tab enters the grid on the first board');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.matches('.new-board.empty-card')),true,'the next Tab leaves the grid');
  await page.keyboard.press('Shift+Tab');assert.equal(await focused(),'Delta');
  // Arrows follow the grid as laid out: three columns at 1440 (Delta Gamma Beta / Alpha).
  const keys=async(list,expect,why)=>{for(const k of list)await page.keyboard.press(k);assert.equal(await focused(),expect,why);};
  await keys(['ArrowRight'],'Gamma','Right moves along the row');
  await keys(['ArrowRight','ArrowRight'],'Alpha','Right wraps from a row end to the next row');
  await keys(['ArrowUp'],'Delta','Up moves one column up');
  await keys(['ArrowDown'],'Alpha','Down moves one column down');
  await keys(['ArrowDown','ArrowRight'],'Alpha','no move past the last row or the last board');
  await keys(['ArrowUp','ArrowRight'],'Gamma','back up to the first row');
  await keys(['ArrowDown'],'Alpha','Down from a column with nothing below lands on the last board');
  await keys(['Home'],'Delta','Home');await keys(['End'],'Alpha','End');await keys(['Control+Home'],'Delta','Ctrl+Home');
  await keys(['b'],'Beta','typeahead by title');
  await page.waitForTimeout(700);await page.keyboard.type('al');assert.equal(await focused(),'Alpha','a quick run of letters matches a prefix');
  await page.waitForTimeout(700);await keys(['g'],'Gamma','after a pause a letter starts a new search');
  await expectSelected([],'moving focus selects nothing');
  passed.push('one Tab stop; arrows follow the grid; Home/End; typeahead by title');
  // Space toggles the focused board (once a typeahead run has ended: within it, Space types a space);
  // Shift+arrows extend from it; ⌘A selects all, again clears.
  await page.waitForTimeout(700);await page.keyboard.press('Space');
  await expectSelected(['Gamma'],'Space selects');
  assert.equal(await option('Gamma').getAttribute('aria-selected'),'true');
  await page.keyboard.press('Shift+ArrowRight');
  await expectSelected(['Gamma','Beta'],'Shift+Right extends');
  await page.keyboard.press('Shift+ArrowLeft');await page.keyboard.press('Shift+ArrowLeft');
  await expectSelected(['Delta','Gamma'],'Shift+Left re-ranges from the anchor');
  await page.keyboard.press('Space');
  await expectSelected(['Gamma'],'Space deselects the focused board');
  await page.keyboard.press('ControlOrMeta+a');
  await expectSelected(['Alpha','Beta','Gamma','Delta'],'⌘A selects every board');
  await page.keyboard.press('ControlOrMeta+a');
  await expectSelected([],'⌘A again clears');
  await page.keyboard.press('ArrowRight');await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');
  assert.equal(await focused(),'Gamma','Tab returns to the board focused last');
  await page.evaluate(()=>document.activeElement.blur());
  passed.push('Space toggles; Shift+arrows extend; ⌘A selects all and clears');

  // The circle toggles by pointer and moves focus to its board without taking it itself.
  await card('Delta').locator('h3').hover();
  await card('Delta').locator('[data-home-select]').click();
  await expectSelected(['Delta'],'circle selects');
  dot=await dotState('Delta');assert.equal(dot.selected,'true');
  assert.equal(await focused(),'Delta','the press focuses the board');
  await page.keyboard.press('Space');
  await expectSelected([],'Space on the focused board deselects');
  await page.evaluate(()=>document.activeElement.blur());
  passed.push('circle toggles by pointer; Space on the board toggles');

  // ⌘- and Ctrl-click toggle one board; Shift-click selects the range from the anchor, in grid order.
  const url=page.url();
  await card('Delta').locator('h3').click({modifiers:['Shift']});
  await expectSelected(['Delta'],'Shift-click with nothing selected starts a range there');
  await card('Beta').locator('h3').click({modifiers:['Shift']});
  await expectSelected(['Delta','Gamma','Beta'],'Shift-click selects the range in grid order');
  await card('Gamma').locator('h3').click({modifiers:['Shift']});
  await expectSelected(['Delta','Gamma'],'a second Shift-click changes the range');
  await card('Beta').locator('h3').click({modifiers:['Control']});
  await expectSelected(['Delta','Gamma','Beta'],'Ctrl click adds');
  await card('Beta').locator('h3').click({modifiers:['Meta']});
  await expectSelected(['Delta','Gamma'],'⌘ click again removes');
  await page.waitForTimeout(300);
  assert.equal(page.url(),url,'modifier clicks do not navigate');
  assert.equal(context.pages().length,1,'modifier clicks open no tab or window');
  passed.push('⌘ and Ctrl click toggle, Shift click selects a range, without navigating');

  // Selected: blue ring and blue circle with a check; one floating bar.
  const ring=await card('Delta').locator('.board-link').evaluate(el=>{const s=getComputedStyle(el);return `${s.outlineStyle} ${s.outlineColor} ${s.boxShadow}`;});
  assert.equal(await markBlue(page),LIGHT_RING,'the mark is the approved blue');
  assert(ring.includes(LIGHT_RING)&&ring.startsWith('solid'),`blue ring: ${ring}`);
  dot=await dotState('Gamma');assert.equal(dot.opacity,1);assert.equal(dot.bg,LIGHT_RING,'selected circle is the blue mark');
  await bar.waitFor();
  assert.equal(await bar.locator('strong').textContent(),'2 selected');
  const vb=await bar.boundingBox();
  assert(Math.abs(vb.x+vb.width/2-720)<=2&&Math.abs(1000-(vb.y+vb.height)-16)<=2,`bar floats bottom centre: ${JSON.stringify(vb)}`);
  assert.equal(await bar.evaluate(el=>getComputedStyle(el).position),'fixed');
  assert.deepEqual(await bar.getByRole('button').evaluateAll(bs=>bs.map(b=>b.getAttribute('aria-label')||b.textContent)),['Move…','Add reference…','Archive everywhere','Remove from home…','Clear selection']);
  assert.equal(await page.locator('.workspace-home-toolbar [data-home-action]').count(),0,'no inline selection group in the toolbar');
  await page.mouse.move(1400,980);await page.waitForTimeout(200);
  await page.screenshot({path:path.join(evidence,'home-selected-light-1440.png')});
  await bar.getByRole('button',{name:'Clear selection'}).click();
  await expectSelected([],'× clears');assert(await bar.isHidden(),'bar hides when empty');
  passed.push('selected cards carry the blue ring and check','floating bar shows the count and Home bulk actions','× clears');

  // Marquee from empty space over two cards; Shift adds; Escape restores.
  const box=async t=>card(t).locator('.board-link').boundingBox();
  const drag=async(from,to,{shift=false,finish=true,mid}={})=>{
    if(shift)await page.keyboard.down('Shift');
    await page.mouse.move(from.x,from.y);await page.mouse.down();
    await page.mouse.move(from.x+3,from.y+2);
    assert.equal(await page.locator('.home-marquee').count(),0,'no box before 6px');
    await page.mouse.move(to.x,to.y,{steps:8});
    if(mid)await mid();
    if(finish)await page.mouse.up();
    if(shift)await page.keyboard.up('Shift');
  };
  const d=await box('Delta'),g=await box('Gamma');
  await drag({x:d.x-18,y:d.y-12},{x:g.x+40,y:g.y+40},{mid:async()=>{
    const look=await page.locator('.home-marquee').evaluate(el=>{const s=getComputedStyle(el);return `${s.backgroundColor} | ${s.boxShadow}`;});
    assert(look.includes(LIGHT_RING)&&!look.startsWith('rgba(0, 0, 0, 0)'),`translucent accent box: ${look}`);
    await expectSelected(['Delta','Gamma'],'live intersection');
    await page.screenshot({path:path.join(evidence,'home-marquee-1440.png')});
  }});
  await expectSelected(['Delta','Gamma'],'marquee selects two cards');
  assert.equal(await page.locator('.home-marquee').count(),0,'box removed after release');
  assert.equal(await bar.locator('strong').textContent(),'2 selected');
  assert.equal(page.url(),url,'marquee does not navigate');
  const a=await box('Alpha');
  await drag({x:a.x-18,y:a.y+30},{x:a.x+60,y:a.y+60},{shift:true});
  await expectSelected(['Delta','Gamma','Alpha'],'Shift marquee adds');
  const b=await box('Beta');
  await drag({x:b.x+100,y:b.y-10},{x:b.x+140,y:b.y+60},{finish:false,mid:async()=>{
    await expectSelected(['Beta'],'plain marquee replaces live');
    await page.keyboard.press('Escape');
  }});
  await page.mouse.up();
  await expectSelected(['Delta','Gamma','Alpha'],'Escape restores the original selection');
  assert.equal(await page.locator('.home-marquee').count(),0);
  passed.push('marquee selects by intersection after 6px','Shift marquee adds','Escape cancels the marquee and restores');

  // Empty clicks: Shift keeps, plain clears. Escape clears when no field is focused.
  await page.keyboard.down('Shift');await page.mouse.click(d.x-18,d.y-12);await page.keyboard.up('Shift');
  await expectSelected(['Delta','Gamma','Alpha'],'Shift empty click keeps');
  await page.mouse.click(d.x-18,d.y-12);
  await expectSelected([],'empty click clears');
  await card('Beta').locator('h3').click({modifiers:['Shift']});
  await page.locator('#home-find').focus();await page.keyboard.press('Escape');
  await expectSelected(['Beta'],'Escape in the find field keeps the selection');
  await page.evaluate(()=>document.activeElement.blur());
  await page.keyboard.press('Escape');
  await expectSelected([],'Escape clears');assert(await bar.isHidden());
  passed.push('empty click clears, Shift empty click keeps','Escape clears outside fields');

  // Marquee survives page scroll.
  await page.setViewportSize({width:1440,height:620});
  await page.evaluate(()=>scrollTo(0,260));
  const sd=await box('Alpha');
  await drag({x:sd.x-18,y:sd.y+20},{x:sd.x+60,y:sd.y+60},{finish:false,mid:async()=>{await page.mouse.wheel(0,80);await page.waitForTimeout(150);await page.mouse.move(sd.x+62,sd.y+40);}});
  await page.mouse.up();
  await expectSelected(['Alpha'],'marquee on a scrolled page selects what it covers');
  await page.mouse.click(sd.x-18,sd.y-40);await expectSelected([]);
  passed.push('marquee works with page scroll');

  // Dark theme: same ring and circle in the dark blue mark.
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>scrollTo(0,0));
  await page.emulateMedia({colorScheme:'dark'});
  await card('Delta').locator('h3').click({modifiers:['Shift']});await card('Gamma').locator('h3').click({modifiers:['Shift']});
  await page.mouse.move(1400,980);await page.waitForTimeout(250);
  DARK_ACCENT=await markBlue(page);assert.notEqual(DARK_ACCENT,LIGHT_RING,'dark resolves its own blue');
  assert.equal((await dotState('Delta')).bg,DARK_ACCENT,'dark selected circle');
  assert((await card('Delta').locator('.board-link').evaluate(el=>getComputedStyle(el).outlineColor))===DARK_ACCENT,'dark ring');
  await page.screenshot({path:path.join(evidence,'home-selected-dark-1440.png')});
  await page.keyboard.press('Escape');await expectSelected([]);
  await page.emulateMedia({colorScheme:'light'});
  passed.push('dark theme ring and circle');

  // 390: no stray squares, no horizontal scroll, the bar stays on screen.
  await page.setViewportSize({width:390,height:844});await page.reload();await cards.nth(3).waitFor();
  assert.deepEqual(await noSquares(),[],'no squares at rest (390)');
  await card('Delta').locator('h3').hover();await page.waitForTimeout(250);
  assert.deepEqual(await noSquares(),[],'no squares on hover (390)');
  assert.equal((await dotState('Delta')).opacity,1);
  await card('Delta').locator('h3').click({modifiers:['Shift']});await card('Gamma').locator('h3').click({modifiers:['Shift']});
  await expectSelected(['Delta','Gamma']);
  await page.mouse.move(380,10);await page.waitForTimeout(250);
  const nb=await bar.boundingBox();
  assert(nb.x>=7&&nb.x+nb.width<=383&&nb.y+nb.height<=844-6,`bar fits at 390: ${JSON.stringify(nb)}`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal scroll at 390');
  await page.screenshot({path:path.join(evidence,'home-selected-light-390.png')});
  await page.emulateMedia({colorScheme:'dark'});await page.waitForTimeout(150);
  await page.screenshot({path:path.join(evidence,'home-selected-dark-390.png')});
  await page.emulateMedia({colorScheme:'light'});
  await bar.getByRole('button',{name:'Clear selection'}).click();await expectSelected([]);
  // One column: Up and Down step board by board, as do Left and Right.
  await option('Delta').focus();
  await page.keyboard.press('ArrowDown');assert.equal(await focused(),'Gamma','390: Down is the next board');
  await page.keyboard.press('ArrowRight');assert.equal(await focused(),'Beta','390: Right is the next board');
  await page.keyboard.press('ArrowUp');assert.equal(await focused(),'Gamma','390: Up is the previous board');
  await page.evaluate(()=>document.activeElement.blur());
  passed.push('390: no squares, no horizontal scroll, bar on screen, arrows follow one column');

  assert.equal(await revision(),before,'selection never writes');
  passed.push('workspace revision unchanged');
  // Enter opens the focused board; a plain click still opens a board too.
  await option('Gamma').focus();await page.keyboard.press('Enter');
  await page.waitForURL(/\/boards\/[^/]+\/$/);
  passed.push('Enter opens the focused board');
  await page.goBack();await cards.nth(3).waitFor();
  await card('Delta').locator('h3').click();
  await page.waitForURL(/\/boards\/[^/]+\/$/);
  passed.push('plain click opens the board');
  assert.deepEqual(errors,[]);
  const receipt={passed,fixture,evidence};
  await writeFile(path.join(evidence,'receipt.json'),JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({passed:true,checks:passed,evidence}));
} finally {await browser?.close();if(server)await closeAppServer(server);}
