// Pointing mode, round 2 review fixes (team/pointing/CONTRACT.md § Round 2 review fixes), on a real board page with a
// real pointer paced like a hand (one move per 16 ms): the area shown is the area mapped (a stroke along the gap
// between two rows of cards underlines neither; a box round two cards snaps to two outlines, never one box round
// both); circling a card leaves out the arrow arriving at it; a slip of the hand is a click and a quick straight dash
// is nothing; a lift mid-wave carries on further along the stroke; inside the opened item an underline holds the line
// just above it, a label names its field, a heading counts by its words, a span with words is a thing, a PDF mark says
// what it is, the visible part of a zoomed item is recorded; marks made inside one item have their numbers side by
// side on its card. Isolated fixture, headless, port 0.
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from '../cli.mjs';
import {loadConfig} from '../lib/config.mjs';
import {applyOperation} from '../lib/workspace.mjs';
import {createAppServer,closeAppServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const fixture=await mkdtemp(path.join(os.tmpdir(),'tinka-pointing-review-'));
const evidence=process.env.TINKA_EVIDENCE_DIR||path.join(fixture,'evidence');await mkdir(evidence,{recursive:true});
let server,browser,config,url;const results=[];
const until=async(fn,ms=5000)=>{const end=Date.now()+ms;let last;while(Date.now()<end){try{last=await fn();if(last)return last;}catch(e){last=e;}await new Promise(r=>setTimeout(r,80));}return last;};
let shoot=null;
async function check(name,body){try{await body();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:String(e.message).split('\n').slice(0,8).join(' | ')});await shoot?.(`fail-${results.length}`).catch(()=>{});}}
// A PDF with one line of text (the headless shell shows no PDF viewer; the reader still knows it is a PDF).
const pdf=()=>{const objs=['<</Type/Catalog/Pages 2 0 R>>','<</Type/Pages/Kids[3 0 R]/Count 1>>','<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',null,'<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
  const text='BT /F1 24 Tf 72 700 Td (Quarterly report) Tj ET';objs[3]=`<</Length ${text.length}>>stream\n${text}\nendstream`;
  let out='%PDF-1.4\n';const at=[];objs.forEach((o,i)=>{at.push(out.length);out+=`${i+1} 0 obj\n${o}\nendobj\n`;});
  const x=out.length;out+=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n${at.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<</Size ${objs.length+1}/Root 1 0 R>>\nstartxref\n${x}\n%%EOF\n`;return out;};
try{
  const configFile=path.join(fixture,'local/config.json');
  await main(['init','--config',configFile,'--boards',path.join(fixture,'boards'),'--label','Pointing review fixture']);
  config=await loadConfig(configFile);
  server=createAppServer(config);await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;
  const assets=path.join(config.boardsRoot,'assets');await mkdir(assets);
  await writeFile(path.join(assets,'form.html'),`<!doctype html><body style="margin:0;font:16px sans-serif"><nav style="display:flex;gap:24px;padding:16px"><b>Sample site</b><span>Overview</span><span>Pricing</span><span>Contact</span></nav><h2 style="margin:24px 20px;width:900px">Choose a plan</h2><form style="padding:20px"><label for="e">Email</label> <input id="e"></form><p style="margin:20px">Closing words of the page, long enough to be a paragraph of their own.</p></body>`);
  await writeFile(path.join(assets,'list.md'),'# Lists\n\n- List item one of section 1\n- List item two, with a longer line\n- Three\n\nA closing paragraph.\n');
  await writeFile(path.join(assets,'disc.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#f2efe6"/><circle cx="400" cy="250" r="120" fill="#24425e"/></svg>');
  await writeFile(path.join(assets,'report.pdf'),pdf());
  await applyOperation(config,{type:'updateWorkspace',patch:{resourceRoots:{assets:{path:'../assets'}}}});
  const boardId=(await applyOperation(config,{type:'createBoard',title:'Review fixes'})).result.boardId;
  const make=async(title,content,placement)=>(await applyOperation(config,{type:'createItem',boardId,item:{title,...(content?{content}:{})},placement})).result;
  // Two rows of three cards 30 apart (the showcase's dense board), an arrow from the top row's middle card to the one below.
  for(const [r,y] of [[1,0],[2,200]])for(const [k,x] of [['A',0],['B',260],['C',520]])await make(`Row${r} ${k}`,null,{x,y,width:230,height:170});
  await applyOperation(config,{type:'createDecoration',boardId,decoration:{id:'arr',type:'line',x:375,y:170,width:20,height:30,color:'#999999',text:'',endArrow:true,from:{x:375,y:170},to:{x:385,y:200}}});
  await make('Disc picture',{kind:'image',resource:{rootId:'assets',path:'disc.svg'}},{x:820,y:0,width:320,height:220});
  await make('Form page',{kind:'html',resource:{rootId:'assets',path:'form.html'}},{x:820,y:260,width:420,height:300,presentation:{viewport:{width:1000,height:700}}});
  await make('Lists',{kind:'markdown',resource:{rootId:'assets',path:'list.md'}},{x:1290,y:0,width:300,height:240});
  await make('Report PDF',{kind:'pdf',resource:{rootId:'assets',path:'report.pdf'}},{x:1290,y:300,width:300,height:240});
  browser=await chromium.launch({headless:true,args:['--mute-audio'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
  shoot=name=>page.screenshot({path:path.join(evidence,`${name}.png`)});
  await page.goto(`${url}/boards/${boardId}/`);await page.waitForSelector('#world .workspace-card');await page.waitForSelector('#edit-tools [data-pointing-enter]',{state:'attached'});
  // The whole board in view.
  await page.keyboard.press('Shift+1');await page.waitForTimeout(700);
  const mode=fn=>page.evaluate(async src=>{const {pointingGuard}=await import('/app/pointing-guard.js');return new Function('m',`return (${src})(m)`)(pointingGuard.mode);},fn.toString());
  const marks=()=>mode(m=>m.chips().map(c=>JSON.parse(JSON.stringify(m.marks.get(c.dataset.mark)))));
  const chips=()=>page.locator('.pointing-field .pointing-chip').evaluateAll(cs=>cs.map(c=>({text:c.querySelector('.cref-label').textContent,tip:c.dataset.tip})));
  const card=async title=>{const b=await page.locator(`#world .workspace-card:has(:text-is("${title}"))`).first().boundingBox();return {...b,cx:b.x+b.width/2,cy:b.y+b.height/2};};
  const sleep=ms=>page.waitForTimeout(ms);
  // A hand's pace: one pointer move every 16 ms.
  const stroke=async(pts,{up=true}={})=>{await page.mouse.move(...pts[0]);await sleep(30);await page.mouse.down();for(const p of pts.slice(1)){await page.mouse.move(...p);await sleep(16);}if(up)await page.mouse.up();await sleep(200);};
  const line=(x0,y0,x1,y1,n=24)=>Array.from({length:n+1},(_,i)=>[x0+(x1-x0)*i/n,y0+(y1-y0)*i/n]);
  const clear=async()=>{await page.keyboard.press(process.platform==='darwin'?'Meta+a':'Control+a');await page.keyboard.press('Backspace');await sleep(150);};
  const titles=m=>m.targets.map(t=>t.title).sort();
  const cardKey=title=>page.evaluate(t=>[...document.querySelectorAll('#world .workspace-card[data-placement]')].find(c=>c.textContent.includes(t))?.dataset.key,title);
  const open=async title=>{const key=await cardKey(title);await page.evaluate(k=>{location.hash=k;},key);await page.waitForSelector('#reader-dialog[open]');await until(()=>mode(m=>!!m.board.hooks.reader()));await sleep(1000);};
  const inItem=sel=>page.evaluate(async sel=>{
    const {toTop}=await import('/app/pointing-reader.js');const f=document.getElementById('active-reader');
    const inner=f.contentDocument.querySelector('#item-content > iframe.item-full-frame');let win=inner?inner.contentWindow:f.contentWindow;
    let e=win.document.querySelector(sel),w0=win;if(!e){e=f.contentWindow.document.querySelector(sel);w0=f.contentWindow;}if(!e)return null;win=w0;const t=toTop(win),r=document.createRange();r.selectNodeContents(e);const w=r.getBoundingClientRect(),b=e.getBoundingClientRect();
    return {x:t.x+t.k*w.left,y:t.y+t.k*w.top,w:t.k*w.width,h:t.k*w.height,cx:t.x+t.k*(w.left+w.width/2),cy:t.y+t.k*(w.top+w.height/2),blockW:t.k*b.width};
  },sel);

  await page.keyboard.press('p');await until(()=>page.evaluate(()=>document.body.classList.contains('pointing-on')));

  await check('1: a stroke along the gap between two rows underlines neither; a box round two cards snaps to their two outlines',async()=>{
    await page.keyboard.press('Alt+KeyW');
    const a=await card('Row1 A'),c=await card('Row1 C'),d=await card('Row2 A'),gap=(a.y+a.height+d.y)/2;
    await page.keyboard.type('gap ');await stroke(line(a.x+10,gap,c.x+c.width-10,gap+2));
    let ms=await marks();assert.equal(ms.length,1);assert.deepEqual(ms[0].targets,[],`nothing underlined: ${titles(ms[0])}`);assert.equal(ms[0].snap,undefined);
    await page.keyboard.press('Alt+KeyM');const b=await card('Row1 B');
    await page.keyboard.type(' two ');await stroke(line(a.x-12,a.y-10,b.x+b.width+10,b.y+b.height+8,10));
    ms=await marks();const m=ms[1];
    assert.deepEqual(titles(m),['Row1 A','Row1 B']);assert.equal(m.snap?.shape.kind,'path');assert.equal(m.snap.shape.rings.length,2,'each card\'s outline, not one box round both');
    const subpaths=await page.evaluate(n=>(document.querySelector(`.pointing-marks path[data-n="${n}"]`)?.getAttribute('d').match(/M/g)||[]).length,m.n);
    assert.equal(subpaths,2,'drawn as two outlines');
    await clear();
  });
  await check('2: a circle round a card leaves out the arrow arriving at it from another card',async()=>{
    await clear();await page.keyboard.press('Alt+KeyW');const b=await card('Row2 B'),rx=b.width/2+20,ry=b.height/2+20;
    await page.keyboard.type('this ');await stroke(Array.from({length:40},(_,i)=>{const t=Math.PI+i/38*2.1*Math.PI;return [b.cx+rx*Math.cos(t),b.cy+ry*Math.sin(t)];}));
    const [m]=await marks();assert.deepEqual(titles(m),['Row2 B']);assert.equal(m.snap?.shape.kind,'rect');
    await clear();
  });
  await check('3: a slip of the hand is a click; a quick straight dash released on empty board is nothing',async()=>{
    await clear();await page.keyboard.press('Alt+KeyW');const p=await card('Disc picture');
    await page.keyboard.type('slip ');await stroke(line(p.cx,p.cy,p.cx+8,p.cy+1,3));
    let ms=await marks();assert.equal(ms.length,1);assert.equal(ms[0].tool,'click','an 8 px slip is a click');assert.equal(ms[0].via,'wand');
    const a=await card('Row1 A'),d=await card('Row2 A'),gap=(a.y+a.height+d.y)/2;
    await page.keyboard.type(' dash ');
    await page.mouse.move(a.x-40,gap);await page.mouse.down();await page.mouse.move(a.x+800,gap+6,{steps:6});await page.mouse.up();await sleep(250);
    assert.equal((await marks()).length,1,'no reference from a dash');
    // a natural wave over a card still counts
    const c=await card('Row1 C');await page.keyboard.type(' wave ');
    await stroke([...line(c.x+20,c.cy,c.x+c.width-20,c.cy+4,12),...line(c.x+c.width-20,c.cy+4,c.x+20,c.cy-4,12)]);
    ms=await marks();assert.equal(ms.length,2);assert.deepEqual(titles(ms[1]),['Row1 C']);
    await clear();
  });
  await check('4: a lift mid-wave carries on when the new press is further along the stroke',async()=>{
    await clear();await page.keyboard.press('Alt+KeyW');const c=await card('Row2 C');
    await page.keyboard.type('this ');await stroke(line(c.x+15,c.y+40,c.x+110,c.y+40,8));
    await stroke(line(c.x+150,c.y+42,c.x+c.width-15,c.y+42,6));
    const ms=await marks();assert.equal(ms.length,1,`one reference: ${ms.map(m=>m.label)}`);assert.deepEqual(titles(ms[0]),['Row2 C']);
    assert.equal(await page.locator('.pointing-marks .pointing-badge').count(),1);
    await clear();
  });
  await check('5: inside a document, an underline holds the line just above it, not the next one',async()=>{
    await page.keyboard.press('Escape');await sleep(200);
    await open('Lists');await page.keyboard.press('p');await until(()=>mode(m=>m.active&&!!m.reader));
    await page.keyboard.press('Alt+KeyW');
    const li=await until(()=>inItem('.markdown li'));
    await page.keyboard.type('this item ');await stroke(line(li.x-4,li.y+li.h+4,li.x+li.w+4,li.y+li.h+5,14));
    const ms=await marks(),m=ms.at(-1);
    assert.equal(m.targets[0].text?.quote,'List item one of section 1',`the line above: ${JSON.stringify(m.targets[0].text)}`);
    assert.equal(m.place.kind,'item');assert.ok(m.place.view.visible?.w>0,'the visible part is recorded');
    await page.keyboard.press('Escape');await sleep(200);await page.keyboard.press('Escape');await page.waitForSelector('#reader-dialog[open]',{state:'detached'}).catch(()=>{});await sleep(400);
    await page.keyboard.press('p');await until(()=>mode(m=>m.active&&!m.reader));await clear();
  });
  await check('6, 7, 8: inside a page, a label names its field; a heading counts by its words; a span with words is a thing; zoomed in, the visible part is the part shown',async()=>{
    await page.keyboard.press('Escape');await sleep(200);
    await open('Form page');await page.keyboard.press('p');await until(()=>mode(m=>m.active&&!!m.reader));
    await page.keyboard.press('Alt+KeyM');
    const lab=await inItem('label');await page.keyboard.type('the field ');await page.mouse.click(lab.cx,lab.cy);await sleep(250);
    let m=(await marks()).at(-1);assert.equal(m.targets[0].element?.tag,'input');assert.equal(m.targets[0].element?.name,'Email');assert.match(m.label,/^field "Email"/);
    const h=await inItem('h2');assert.ok(h.blockW>2*h.w,'the heading\'s block is much wider than its words');
    await page.keyboard.type(' the heading ');await stroke(line(h.x-12,h.y-10,h.x+h.w+14,h.y+h.h+10,8));
    m=(await marks()).at(-1);assert.match(m.snap?.label||'',/^heading "Choose a plan"/,`snapped by its words: ${m.label}`);
    const s=await inItem('nav span:nth-of-type(2)');await page.keyboard.type(' pricing ');await page.mouse.click(s.cx,s.cy);await sleep(250);
    m=(await marks()).at(-1);assert.equal(m.label,'text "Pricing"');
    const full=m.place.view.visible;
    await page.keyboard.press('Alt+Equal');await sleep(400);await page.keyboard.press('Alt+Equal');await sleep(600);
    const p=await inItem('p');await page.keyboard.type(' zoomed ');await page.mouse.click(Math.min(p.cx,1000),Math.min(p.cy,600));await sleep(250);
    m=(await marks()).at(-1);const v=m.place.view.visible;
    assert.ok(v&&full&&v.w<full.w&&v.h<=full.h,`zoomed in, less is visible: ${JSON.stringify(v)} vs ${JSON.stringify(full)}`);
  });
  await check('10: on the board, numbers of marks made inside one item sit side by side, none covering another',async()=>{
    await page.keyboard.press('Escape');await sleep(200);await page.keyboard.press('Escape');await page.waitForSelector('#reader-dialog[open]',{state:'detached'}).catch(()=>{});await sleep(400);
    await page.keyboard.press('p');await until(()=>mode(m=>m.active&&!m.reader));await sleep(300);
    const boxes=await page.evaluate(()=>[...document.querySelectorAll('#world .pointing-marks .pointing-badge')].map(b=>{const r=b.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom,text:b.textContent};}));
    assert.ok(boxes.length>=4,`a number per mark: ${boxes.map(b=>b.text)}`);
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];assert.ok(a.r<=b.l+0.5||b.r<=a.l+0.5||a.b<=b.t+0.5||b.b<=a.t+0.5,`${a.text} and ${b.text} overlap`);}
    assert.equal(boxes.filter(b=>/Inside/.test(b.text)).length,1,'"Inside" once for the item');
    await clear();
  });
  await check('9: inside a PDF, a mark says plainly what it is and what the agent gets',async()=>{
    await page.keyboard.press('Escape');await sleep(200);
    await open('Report PDF');await page.keyboard.press('p');await until(()=>mode(m=>m.active&&!!m.reader));
    await page.keyboard.press('Alt+KeyM');
    const w=await page.evaluate(()=>{const r=document.getElementById('reader-window').getBoundingClientRect();return {cx:r.left+r.width/2,cy:r.top+r.height/2};});
    await page.keyboard.type('this ');await page.mouse.click(w.cx,w.cy);await sleep(250);
    await stroke(line(w.cx-80,w.cy-40,w.cx+80,w.cy+40,6));
    const cs=await chips();
    assert.equal(cs.at(-2).text,'Point on the PDF view');assert.equal(cs.at(-1).text,'Area of the PDF view');
    assert.match(cs.at(-1).tip,/cannot be read/);
    // outside the item: said so, not "Point"
    const out=await page.evaluate(()=>{const s=document.querySelector('.pointing-reader-sheet').getBoundingClientRect(),r=document.getElementById('reader-window').getBoundingClientRect();return {x:s.left+12,y:Math.max(s.top+12,r.top+10),inside:s.left+12>=r.left};});
    if(!out.inside){await page.mouse.click(out.x,out.y);await sleep(250);assert.equal((await chips()).at(-1).text,'Outside the item');}
  });
  assert.deepEqual(errors,[],'page errors');
  await context.close();
}finally{await browser?.close();if(server)await closeAppServer(server);if(!process.env.TINKA_EVIDENCE_DIR)await rm(fixture,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
for(const r of results)console.log(`${r.pass?'PASS':'FAIL'}  ${r.name}${r.error?'  -- '+r.error:''}`);
const failed=results.filter(r=>!r.pass).length;console.log(JSON.stringify({passed:results.length-failed,failed,evidence}));
process.exit(failed?1:0);
