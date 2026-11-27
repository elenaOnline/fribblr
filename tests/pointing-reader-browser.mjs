// Pointing inside the opened item (pointing-reader.js; team/pointing/CONTRACT.md § Round 2 `place`, `element`, `text`)
// and the snap sources wired on board cards, driven with a real pointer and keyboard: P enters inside an opened HTML
// item (the composer inside the reader's dialog, the reader's key pressed); the wheel scrolls the page; a click on a
// button names it (tag, name, selector, box in page px with the scroll) and its mark follows the scroll; zooming out
// never leaves the item; Escape steps (a gesture, then the mode with the reader's view and scroll back, then the
// reader); a marquee over a paragraph in a Markdown document gives its text range, a box over part of it the words it
// covers; a click on a picture in an opened image snaps to its shape by pixels and the crop is cut from the file; on
// the board a click on a live card's button names the button, a box round the whole card is the card, and the element
// a click would name is outlined on hover; a message holds marks from the board and from inside an item, each chip
// shows where, and the agent reads both. Isolated fixture, headless, port 0.
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from '../cli.mjs';
import {loadConfig} from '../lib/config.mjs';
import {applyOperation} from '../lib/workspace.mjs';
import {listFeedback} from '../lib/feedback.mjs';
import {createAppServer,closeAppServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const fixture=await mkdtemp(path.join(os.tmpdir(),'tinka-pointing-reader-'));
const evidence=process.env.TINKA_EVIDENCE_DIR||path.join(fixture,'evidence');await mkdir(evidence,{recursive:true});
let server,browser,config,url;const results=[];
const until=async(fn,ms=5000)=>{const end=Date.now()+ms;let last;while(Date.now()<end){try{last=await fn();if(last)return last;}catch(e){last=e;}await new Promise(r=>setTimeout(r,80));}return last;};
let shoot=null;
async function check(name,body){try{await body();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:String(e.message).split('\n').slice(0,8).join(' | ')});await shoot?.(`fail-${results.length}`).catch(()=>{});}}
try{
  const configFile=path.join(fixture,'local/config.json');
  await main(['init','--config',configFile,'--boards',path.join(fixture,'boards'),'--label','Reader pointing fixture']);
  config=await loadConfig(configFile);
  server=createAppServer(config);await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;
  const assets=path.join(config.boardsRoot,'assets');await mkdir(assets);
  // A long page: a heading, filler, and a Sign in button 1400 px down (she has to scroll to it).
  await writeFile(path.join(assets,'long.html'),`<!doctype html><body style="margin:0;font:16px sans-serif"><header style="padding:20px"><h1>Welcome</h1></header>${Array.from({length:12},(_,i)=>`<p style="margin:20px;height:90px">Filler paragraph ${i+1}.</p>`).join('')}<form id="login" style="padding:20px"><label for="em">Email</label> <input id="em" name="email"> <button type="submit" id="go">Sign in</button></form><div style="height:600px"></div></body>`);
  await writeFile(path.join(assets,'notes.md'),`# Plan\n\nThe first paragraph says what the plan is about and why it matters to the team this quarter.\n\nThe second paragraph lists the risks we know about and the ones we are still looking for.\n\n## Next\n\nA closing line.\n`);
  // A picture with one clear shape: a dark disc on a light ground.
  await writeFile(path.join(assets,'disc.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#f2efe6"/><circle cx="400" cy="250" r="120" fill="#24425e"/></svg>');
  await applyOperation(config,{type:'updateWorkspace',patch:{resourceRoots:{assets:{path:'../assets'}}}});
  const boardId=(await applyOperation(config,{type:'createBoard',title:'Reader pointing'})).result.boardId;
  const make=async(title,content,placement)=>(await applyOperation(config,{type:'createItem',boardId,item:{title,content},placement})).result;
  await make('Login page',{kind:'html',resource:{rootId:'assets',path:'long.html'}},{x:0,y:0,width:420,height:320,presentation:{viewport:{width:800,height:600}}});
  await make('Plan document',{kind:'markdown',resource:{rootId:'assets',path:'notes.md'}},{x:480,y:0,width:360,height:320});
  await make('Disc picture',{kind:'image',resource:{rootId:'assets',path:'disc.svg'}},{x:900,y:0,width:400,height:260});
  await applyOperation(config,{type:'createDecoration',boardId,decoration:{id:'stk',type:'region',shape:'rectangle',x:0,y:380,width:170,height:120,color:'#f6e6a4',text:'A sticky'}});
  browser=await chromium.launch({headless:true,args:['--mute-audio'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1280,height:860},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
  shoot=name=>page.screenshot({path:path.join(evidence,`${name}.png`)});
  await page.goto(`${url}/boards/${boardId}/`);await page.waitForSelector('#world .workspace-card');await page.waitForSelector('#edit-tools [data-pointing-enter]',{state:'attached'});await page.waitForTimeout(600);
  const mode=fn=>page.evaluate(async src=>{const {pointingGuard}=await import('/app/pointing-guard.js');return new Function('m',`return (${src})(m)`)(pointingGuard.mode);},fn.toString());
  const lastMark=()=>mode(m=>{const x=[...m.marks.values()].at(-1);return x&&JSON.parse(JSON.stringify(x));});
  const chips=()=>page.locator('.pointing-field .pointing-chip').evaluateAll(cs=>cs.map(c=>({text:c.textContent,tip:c.dataset.tip,inside:c.classList.contains('pointing-inside'),away:c.classList.contains('pointing-elsewhere')})));
  const cardKey=title=>page.evaluate(t=>[...document.querySelectorAll('#world .workspace-card[data-placement]')].find(c=>c.textContent.includes(t))?.dataset.key,title);
  const open=async title=>{const key=await cardKey(title);await page.evaluate(k=>{location.hash=k;},key);await page.waitForSelector('#reader-dialog[open]');await until(()=>mode(m=>!!m.board.hooks.reader()));await page.waitForTimeout(900);};
  // An element of the opened item's page, in this page's client px (through the reader's frames and zoom).
  const inItem=(sel,{doc='inner'}={})=>page.evaluate(async([sel,doc])=>{
    const {toTop}=await import('/app/pointing-reader.js');const f=document.getElementById('active-reader');
    const inner=f.contentDocument.querySelector('#item-content > iframe.item-full-frame');const win=doc==='inner'&&inner?inner.contentWindow:f.contentWindow;
    const e=win.document.querySelector(sel);if(!e)return null;const r=e.getBoundingClientRect(),t=toTop(win);
    return {x:t.x+t.k*r.left,y:t.y+t.k*r.top,w:t.k*r.width,h:t.k*r.height,cx:t.x+t.k*(r.left+r.width/2),cy:t.y+t.k*(r.top+r.height/2),scrollY:win.scrollY};
  },[sel,doc]);
  const innerScroll=()=>page.evaluate(()=>document.getElementById('active-reader').contentDocument.querySelector('#item-content > iframe.item-full-frame')?.contentWindow.scrollY);

  let before;
  await check('P inside an opened HTML item: the composer in the reader\'s dialog, its key pressed, a sheet over its stage',async()=>{
    await open('Login page');
    before=await mode(m=>({...m.board.hooks.reader().canvas.view}));
    await page.keyboard.press('p');
    await until(()=>page.evaluate(()=>document.body.classList.contains('pointing-on')));
    assert.ok(await page.evaluate(()=>!!document.querySelector('#reader-dialog .pointing-bar:not([hidden])')),'the bar is inside the dialog');
    assert.ok(await page.evaluate(()=>!!document.querySelector('#reader-dialog .pointing-reader-sheet:not([hidden])')),'a sheet over the stage');
    assert.equal(await page.locator('#reader-header [data-pointing-enter]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('pointing-field')),true,'keys go to the composer');
  });
  let signIn;
  await check('the wheel scrolls the page; a click on the button names it: tag, name, selector, its box in page px with the scroll',async()=>{
    await page.mouse.move(640,400);
    // scroll until the button is in the middle of what shows (it starts 1400 px down)
    for(let i=0;i<12;i++){const g=await inItem('#go'),w=await page.locator('#reader-window').boundingBox();if(g.cy<w.y+w.height*.6)break;await page.mouse.wheel(0,200);await page.waitForTimeout(60);}
    const y=await innerScroll();assert.ok(y>800,`scrolled ${y}`);
    await page.keyboard.type('make ');
    const b=await inItem('#go');signIn=b;
    await page.mouse.move(b.cx,b.cy);await page.waitForTimeout(150);
    await page.mouse.click(b.cx,b.cy);
    const m=await until(()=>lastMark());
    assert.equal(m.tool,'click');assert.equal(m.place.kind,'item');assert.equal(m.place.view.unit,'page px');
    assert.equal(Math.round(m.place.view.scrollY),Math.round(y),'the scroll she saw');
    const el=m.targets[0].element;
    assert.equal(el.tag,'button');assert.equal(el.name,'Sign in');assert.equal(el.selector,'#go');assert.match(el.path,/form#login > button#go/);
    const real=await page.evaluate(()=>{const w=document.getElementById('active-reader').contentDocument.querySelector('#item-content > iframe.item-full-frame').contentWindow,r=w.document.getElementById('go').getBoundingClientRect();return {x:r.left+w.scrollX,y:r.top+w.scrollY};});
    assert.ok(Math.abs(el.box.x-real.x)<1.5&&Math.abs(el.box.y-real.y)<1.5,`box ${JSON.stringify(el.box)} vs ${JSON.stringify(real)}`);
    assert.ok(el.box.y>1000,'document coordinates, the scroll included');
    assert.equal(m.snap.source,'dom');assert.equal(m.snap.label,'button "Sign in"');
    const c=(await chips()).at(-1);assert.match(c.text,/button "Sign in"/);assert.equal(c.inside,true);assert.match(c.tip,/inside Login page/);
  });
  await check('the mark is drawn in the item\'s plane and follows the page\'s scroll',async()=>{
    const at=()=>page.evaluate(()=>document.querySelector('.pointing-reader-marks .pointing-badge')?.getBoundingClientRect().top);
    const a=await at();await page.mouse.move(640,400);await page.mouse.wheel(0,-150);await until(async()=>Math.abs((await at())-a)>100);
    const b=await at();assert.ok(Math.abs((b-a)-150)<6,`moved ${b-a} for a 150 px scroll`);
    // and its zoom: zoomed in, the outline is still round the button
    await page.keyboard.press('Alt+Equal');await page.keyboard.press('Alt+Equal');await page.waitForTimeout(250);
    const [shape,btn]=[await page.evaluate(()=>document.querySelector('.pointing-reader-marks rect.pointing-shape')?.getBoundingClientRect().toJSON()),await inItem('#go')];
    assert.ok(shape&&Math.abs(shape.x-btn.x)<3&&Math.abs(shape.y-btn.y)<3&&Math.abs(shape.width-btn.w)<4,`outline ${JSON.stringify(shape)} button ${JSON.stringify(btn)}`);
    await page.keyboard.press('Alt+Digit1');await page.waitForTimeout(200);
  });
  await check('zooming out in the mode never leaves the item; the reader\'s − says why',async()=>{
    for(let i=0;i<4;i++){await page.keyboard.press('Alt+Minus');await page.waitForTimeout(60);}
    await page.mouse.move(640,400);
    for(let i=0;i<8;i++){await page.keyboard.down('Control');await page.mouse.wheel(0,200);await page.keyboard.up('Control');await page.waitForTimeout(40);}
    await page.waitForTimeout(400);
    assert.ok(await page.evaluate(()=>!!document.querySelector('#reader-dialog[open]')),'still open');
    assert.ok(await page.evaluate(()=>document.body.classList.contains('pointing-on')),'still pointing');
    assert.match(await page.locator('#reader-zoom-minus').getAttribute('data-tip')||await page.locator('#reader-zoom-minus').getAttribute('aria-label'),/Point and type|Zoom out/);
  });
  await check('Escape steps: a gesture in progress, then the mode (the reader\'s view and scroll back), then the reader',async()=>{
    await page.keyboard.press('Alt+Equal');await page.keyboard.press('Alt+Equal');await page.waitForTimeout(200);
    await page.mouse.move(500,300);await page.mouse.down();await page.mouse.move(600,380,{steps:4});
    await page.keyboard.press('Escape');await page.mouse.up();
    assert.ok(await page.evaluate(()=>document.body.classList.contains('pointing-on')),'the gesture went, the mode stays');
    const n=(await chips()).length;assert.equal(n,1,'no mark from the cancelled gesture');
    await page.keyboard.press('Escape');
    await until(()=>page.evaluate(()=>!document.body.classList.contains('pointing-on')));
    const now=await mode(m=>({...m.board.hooks.reader().canvas.view}));
    assert.ok(Math.abs(now.zoom-before.zoom)<1e-6&&Math.abs(now.x-before.x)<1&&Math.abs(now.y-before.y)<1,`view back: ${JSON.stringify(now)} vs ${JSON.stringify(before)}`);
    assert.equal(await innerScroll(),0,'scroll back');
    assert.ok(await page.evaluate(()=>!!document.querySelector('#reader-dialog[open]')),'the reader stays');
    assert.equal(await page.locator('#reader-header [data-pointing-enter]').getAttribute('aria-pressed'),'false');
    await page.keyboard.press('Escape');
    await until(()=>page.evaluate(()=>!document.querySelector('#reader-dialog[open]')));
  });
  await check('a Markdown document: a marquee over a paragraph gives its text range; a box over part of a line, the words it covers',async()=>{
    await open('Plan document');
    await page.keyboard.press('p');await until(()=>page.evaluate(()=>document.body.classList.contains('pointing-on')));
    await page.keyboard.type(' and ');
    const p=await until(()=>inItem('.markdown p:nth-of-type(2)'));
    await page.mouse.move(p.x-10,p.y-6);await page.mouse.down();await page.mouse.move(p.x+p.w/2,p.y+p.h/2,{steps:4});await page.mouse.move(p.x+p.w+10,p.y+p.h+6,{steps:4});await page.mouse.up();
    let m=await until(async()=>{const x=await lastMark();return x?.targets?.[0]?.text?.quote?.includes('second')&&x;});
    assert.equal(m.targets[0].text.quote,'The second paragraph lists the risks we know about and the ones we are still looking for.');
    assert.ok(m.targets[0].text.prefix.endsWith('this quarter. '),`prefix: ${m.targets[0].text.prefix}`);
    assert.ok(Number.isInteger(m.targets[0].text.start)&&m.targets[0].text.end>m.targets[0].text.start);
    assert.equal(m.targets[0].element.tag,'p');assert.equal(m.place.view.unit,'page px');
    // ⌘ held: exactly the box drawn, over the first words of the first paragraph
    const q=await inItem('.markdown p:nth-of-type(1)');
    await page.keyboard.down(process.platform==='darwin'?'Meta':'Control');
    await page.mouse.move(q.x+1,q.y+2);await page.mouse.down();await page.mouse.move(q.x+q.w*.3,q.y+16,{steps:4});await page.mouse.up();
    await page.keyboard.up(process.platform==='darwin'?'Meta':'Control');
    m=await until(async()=>{const x=await lastMark();return x?.targets?.[0]?.text?.quote?.startsWith('The first')&&x;});
    assert.ok(!m.snap,'not snapped');assert.match(m.targets[0].text.quote,/^The first paragraph/);
    assert.ok(m.targets[0].text.quote.length<60,`a part: ${m.targets[0].text.quote}`);assert.ok(!/\S$/.test(m.targets[0].text.quote)||/\w$/.test(m.targets[0].text.quote),'whole words');
  });
  await check('an opened image: a click on the shape snaps to it by its pixels, in image px',async()=>{
    await page.keyboard.press('Escape');await until(()=>page.evaluate(()=>!document.body.classList.contains('pointing-on')));
    await page.keyboard.press('Escape');await until(()=>page.evaluate(()=>!document.querySelector('#reader-dialog[open]')));
    await open('Disc picture');
    await page.keyboard.press('p');await until(()=>page.evaluate(()=>document.body.classList.contains('pointing-on')));
    const v=await until(()=>mode(m=>m.reader.current().kind==='image'&&m.reader.view()));
    await page.mouse.move(v.left+400*v.zoom,v.top+250*v.zoom);await page.waitForTimeout(700); // first hover prepares the picture
    await page.keyboard.type(' this ');
    await page.mouse.click(v.left+400*v.zoom,v.top+250*v.zoom);
    const m=await until(async()=>{const x=await lastMark();return x?.place?.view?.unit==='image px'&&x;});
    assert.equal(m.place.view.unit,'image px');
    assert.equal(m.snap?.source,'pixels',`snapped by pixels: ${JSON.stringify(m.snap)}`);
    const c=m.targets[0].content;
    assert.ok(Math.abs(c.x-280)<14&&Math.abs(c.y-130)<14&&Math.abs(c.w-240)<20&&Math.abs(c.h-240)<20,`the disc: ${JSON.stringify(c)}`);
    assert.equal(c.of,'image 800 × 500 px');
    assert.ok(m.picture?.endsWith('disc.svg'),'the picture to crop from');
  });
  await check('one message, marks from the item and the board: chips show where, the agent reads both, the image crop comes from its file',async()=>{
    // Up (the reader's top bar) while pointing: back to the board, still pointing, the draft kept
    await page.click('#close-reader');
    await until(()=>page.evaluate(()=>!document.querySelector('#reader-dialog[open]')&&document.body.classList.contains('pointing-on')));
    await page.waitForTimeout(700); // the board lands on the card it opened (canvas.js returnToTile)
    await shoot('after-up');
    let cs=await chips();assert.ok(cs.length>=3);assert.ok(cs.every(c=>c.inside&&c.away),'item marks listed, made elsewhere');
    assert.ok(await page.evaluate(()=>[...document.querySelectorAll('#world .pointing-marks .pointing-badge')].some(b=>/Inside/.test(b.textContent))),'shown on the board as their cards, Inside');
    await page.keyboard.press('Alt+Digit1');await page.waitForTimeout(400); // fit the board: everything in view
    await page.keyboard.type(' next to ');
    const s=await page.locator('#world [data-decoration="stk"]').boundingBox();
    await page.mouse.click(s.x+s.width/2,s.y+s.height/2);
    cs=await chips();const last=cs.at(-1);assert.equal(last.inside,false);assert.equal(last.away,false);
    await page.keyboard.press('Enter');
    const t=await until(async()=>(await listFeedback(config,{boardId,includeBodies:true})).threads.find(x=>x.pointing),12000);
    assert.ok(t,`sent: ${await page.locator('.pointing-status').textContent()}`);
    const item=t.pointing.marks.filter(x=>x.place?.kind==='item'),board=t.pointing.marks.filter(x=>!x.place);
    assert.ok(item.length>=3&&board.length===1,`${item.length} inside, ${board.length} on the board`);
    const button=item.find(x=>x.targets[0]?.element?.selector==='#go');assert.ok(button,'the button mark');
    assert.match(t.pointing.read,/inside the opened item "Login page"/);assert.match(t.pointing.read,/#go/);
    const disc=item.find(x=>x.place.view.unit==='image px');assert.ok(disc.crop?.path,'the image crop');assert.match(disc.crop.from,/opened image's own file/);
    assert.match(t.messages?.[0]?.body||t.body||'',/button "Sign in" in Login page/);
  });
  await check('board cards: a click on a live card\'s button names it, hover outlines it first; a box round the whole card is the card',async()=>{
    await page.keyboard.press('Alt+KeyM');
    const card=page.locator('#world .workspace-card[data-placement]').filter({hasText:'Login page'});
    const target=await page.evaluate(async()=>{
      const {toTop}=await import('/app/pointing-reader.js');const {resolveFrame}=await import('/app/pointing-snap-dom.js');
      const card=[...document.querySelectorAll('#world .workspace-card[data-placement]')].find(c=>c.textContent.includes('Login page'));const f=resolveFrame(card);
      const e=f.doc.querySelector('h1'),r=e.getBoundingClientRect(),t=toTop(f.win);return {cx:t.x+t.k*(r.left+r.width/2),cy:t.y+t.k*(r.top+r.height/2)};
    });
    await page.mouse.move(target.cx,target.cy);await page.waitForTimeout(150);await page.mouse.move(target.cx+1,target.cy);
    await until(()=>mode(m=>m.hoverSnap?.label==='heading "Welcome"'));
    await page.mouse.click(target.cx,target.cy);
    let m=await until(async()=>{const x=await lastMark();return x?.targets?.[0]?.element?.tag==='h1'&&x;});
    assert.equal(m.targets[0].kind,'placement');assert.equal(m.targets[0].whole,false);assert.equal(m.targets[0].element.name,'Welcome');assert.equal(m.label,'heading "Welcome"');
    const b=await card.boundingBox();
    await page.mouse.move(b.x-12,b.y-12);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:4});await page.mouse.move(b.x+b.width+12,b.y+b.height+12,{steps:4});await page.mouse.up();
    m=await until(async()=>{const x=await lastMark();return x?.tool==='marquee'&&x;});
    assert.equal(m.snap.source,'object');assert.equal(m.targets[0].whole,true);
  });
  await check('no page errors',async()=>{assert.deepEqual(errors,[]);});
  await context.close();
}finally{
  await browser?.close().catch(()=>{});
  if(server)await closeAppServer(server).catch(()=>{});
  for(const r of results)console.log(`${r.pass?'PASS':'FAIL'}  ${r.name}${r.pass?'':`  -- ${r.error}`}`);
  const failed=results.filter(r=>!r.pass).length;
  console.log(JSON.stringify({passed:results.length-failed,failed,evidence}));
  if(!process.env.TINKA_EVIDENCE_DIR&&!failed)await rm(fixture,{recursive:true,force:true}).catch(()=>{});
  process.exitCode=failed?1:0;
}
