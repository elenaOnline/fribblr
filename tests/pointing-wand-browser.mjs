// Pointing mode's round 2 (team/pointing/CONTRACT.md § Round 2) on a real board page, driven with a real pointer and
// keyboard: the Wand (a held drag waving over a card, underlining a heading, circling a sticky is one reference each,
// drawn as still glitter; travelling between targets, moving while typing and a resting hand make none; a lift
// mid-wave carries the same reference on; Backspace and Undo take the last one back and bring it again), snapping to
// board objects (a sloppy marquee round a card, a lasso round a sticky, a marquee round a container, an underline
// under text) shown before release, ⌘ held takes exactly what the reviewer drew, and a click recorded as tool "click" with the
// tool in `via`. The sent record carries the swath, the snap and the raw gesture. Light at 1x for the checks; dark at
// 2x for the look. Isolated fixture, headless, port 0.
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from '../cli.mjs';
import {loadConfig} from '../lib/config.mjs';
import {applyOperation} from '../lib/workspace.mjs';
import {listFeedback} from '../lib/feedback.mjs';
import {createAppServer,closeAppServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const fixture=await mkdtemp(path.join(os.tmpdir(),'tinka-wand-'));
const evidence=process.env.TINKA_EVIDENCE_DIR||path.join(fixture,'evidence');await mkdir(evidence,{recursive:true});
const MOD=process.platform==='darwin'?'Meta':'Control';
let server,browser,config,url;const results=[];
const until=async(fn,ms=5000)=>{const end=Date.now()+ms;let last;while(Date.now()<end){try{last=await fn();if(last)return last;}catch(e){last=e;}await new Promise(r=>setTimeout(r,80));}return last;};
let shoot=null;
async function check(name,body){try{await body();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:String(e.message).split('\n').slice(0,8).join(' | ')});await shoot?.(`fail-${results.length}`).catch(()=>{});}}
try{
  const configFile=path.join(fixture,'local/config.json');
  await main(['init','--config',configFile,'--boards',path.join(fixture,'boards'),'--label','Wand fixture']);
  config=await loadConfig(configFile);
  server=createAppServer(config);await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,args:['--mute-audio'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  const makeBoard=async title=>{
    const boardId=(await applyOperation(config,{type:'createBoard',title})).result.boardId;
    for(const [i,t] of ['Login mock','Hero B'].entries())await applyOperation(config,{type:'createItem',boardId,item:{title:t},placement:{x:i*320,y:0,width:260,height:180}});
    for(const decoration of [
      {id:'stk',type:'region',shape:'rectangle',x:660,y:0,width:170,height:130,color:'#f6e6a4',text:'A sticky'},
      {id:'head',type:'text',x:0,y:250,width:600,height:60,text:'Quarterly plan',color:'#333333',textSize:28},
      {id:'box',type:'region',x:660,y:230,width:300,height:200,text:'Box',color:'#dbe5d3',container:{layout:'vertical',children:[]}},
    ])await applyOperation(config,{type:'createDecoration',boardId,decoration});
    return boardId;
  };
  const boardId=await makeBoard('Wand');
  const context=await browser.newContext({viewport:{width:1280,height:860},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
  shoot=name=>page.screenshot({path:path.join(evidence,`${name}.png`)});
  await page.goto(`${url}/boards/${boardId}/`);await page.waitForSelector('#world .workspace-card');await page.waitForSelector('[data-pointing-enter]',{state:'attached'});await page.waitForTimeout(400);
  const field=page.locator('.pointing-field'),chips=()=>field.locator('.pointing-chip').allTextContents();
  const card=title=>`#world .workspace-card:has(:text("${title}"))`;
  const box=async sel=>{const b=await page.locator(sel).first().boundingBox();return {...b,cx:b.x+b.width/2,cy:b.y+b.height/2};};
  const words=sel=>page.evaluate(sel=>{const el=document.querySelector(sel),r=document.createRange(),w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(let n=w.nextNode();n;n=w.nextNode()){if(!n.nodeValue.trim())continue;r.selectNodeContents(n);for(const b of r.getClientRects()){x0=Math.min(x0,b.left);y0=Math.min(y0,b.top);x1=Math.max(x1,b.right);y1=Math.max(y1,b.bottom);}}return {x:x0,y:y0,width:x1-x0,height:y1-y0,cx:(x0+x1)/2,cy:(y0+y1)/2};},sel);
  const marks=()=>page.locator('.pointing-marks .pointing-badge').count();
  const wave=async(b,{passes=4,y=b.cy}={})=>{await page.mouse.move(b.x+12,y);await page.mouse.down();for(let k=0;k<passes;k++)for(let i=0;i<=10;i++)await page.mouse.move(b.x+12+(k%2?10-i:i)*(b.width-24)/10,y+(k-passes/2)*5);await page.mouse.up();};
  const circle=async(b,pad=26)=>{const rx=b.width/2+pad,ry=b.height/2+pad;await page.mouse.move(b.cx-rx,b.cy);await page.mouse.down();for(let d=180;d<=560;d+=12)await page.mouse.move(b.cx+rx*Math.cos(d*Math.PI/180),b.cy+ry*Math.sin(d*Math.PI/180));await page.mouse.up();};
  // Red on the sheet near a point (device px = CSS px at 1x): the snapped outline's corner while dragging.
  const redAt=(x,y)=>page.evaluate(([x,y])=>{const c=document.querySelector('.pointing-sheet'),r=c.getBoundingClientRect(),k=c.width/r.width,d=c.getContext('2d').getImageData(Math.round((x-r.left)*k),Math.round((y-r.top)*k),1,1).data;return d[3]>200&&d[0]>140&&d[1]<90;},[x,y]);
  const sent=async n=>until(async()=>{const ts=(await listFeedback(config,{boardId,includeBodies:true})).threads.filter(t=>t.pointing);return ts.length>=n?ts.sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[n-1]:null;});

  await check('P, ⌥W: the Wand is the chosen tool, its key says so, and the ring replaces the cursor',async()=>{
    await page.keyboard.press('p');await until(()=>page.evaluate(()=>document.body.classList.contains('pointing-on')));
    await page.keyboard.press('Alt+KeyW');
    const key=page.locator('[data-pointing-tool="wand"]');
    assert.equal(await key.getAttribute('aria-keyshortcuts'),'Alt+W');assert.equal(await key.getAttribute('aria-label'),'Wand');
    assert.equal(await key.getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.pointing-sheet').evaluate(e=>getComputedStyle(e).cursor),'none');
  });
  await check('a wave over a card, an underline under a heading, a circle round a sticky: one reference each, snapped to the thing',async()=>{
    await page.keyboard.type('wave ');await wave(await box(card('Hero B')));
    await page.keyboard.type(' under ');
    const w=await words('#world [data-decoration="head"]');
    await page.mouse.move(w.x-10,w.y+w.height+6);await page.mouse.down();for(let x=w.x-10;x<=w.x+w.width+10;x+=12)await page.mouse.move(x,w.y+w.height+6+Math.sin(x/40)*2);await page.mouse.up();
    await page.keyboard.type(' round ');await circle(await box('#world [data-decoration="stk"]'));
    const all=await chips();
    assert.equal(all.length,3,`three chips: ${all}`);assert.match(all[0],/^1\s*Hero B/);assert.match(all[1],/^2\s*(Text · )?Quarterly plan/);assert.match(all[2],/^3\s*(Sticky · )?A sticky/);
    const tips=await field.locator('.pointing-chip').evaluateAll(cs=>cs.map(c=>c.dataset.tip));
    assert.match(tips[0],/snapped to the card "Hero B"/);assert.match(tips[1],/snapped to the text "Quarterly plan"/);assert.match(tips[2],/snapped to the sticky "A sticky"/);
    assert.equal(await page.locator('.pointing-marks .pointing-swath').count(),3,'each drawn as glitter');
  });
  await check('the glitter is still: once a gesture commits nothing on the board moves on its own',async()=>{
    await page.mouse.move(1270,850);await page.waitForTimeout(700);
    const read=()=>page.evaluate(()=>[...document.querySelectorAll('.pointing-swath')].map(c=>c.toDataURL()).join('|')+'#'+document.querySelector('.pointing-sheet').toDataURL());
    const a=await read();await page.waitForTimeout(900);const b=await read();
    assert.ok(a===b,'nothing changed with no input');
    const ink=await page.evaluate(()=>{const c=document.querySelector('.pointing-swath'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;return n/(c.width*c.height);});
    assert.ok(ink>0.01&&ink<0.4,`flecks, not a fill (${(ink*100).toFixed(1)} % of the patch is ink)`);
  });
  await check('travelling between targets, moving while typing and a resting hand make no reference',async()=>{
    const before=(await chips()).length;
    for(const t of [card('Login mock'),'#world [data-decoration="box"]',card('Hero B'),'#world [data-decoration="stk"]']){const b=await box(t);await page.mouse.move(b.cx,b.cy,{steps:3});}
    for(const ch of 'moving while typing '){await page.keyboard.type(ch);const b=await box(card('Login mock'));await page.mouse.move(b.cx+Math.random()*40,b.cy+Math.random()*20,{steps:2});}
    await page.waitForTimeout(1500);
    assert.equal((await chips()).length,before,'no chip from moving without the button');
    await page.keyboard.press(`${MOD}+a`);await page.keyboard.press('Backspace');
  });
  await check('a lift mid-wave carries the same reference on; Backspace takes the last one back, Undo brings it again',async()=>{
    const b=await box(card('Login mock'));
    await page.keyboard.type('this ');
    await page.mouse.move(b.x+12,b.cy);await page.mouse.down();for(let i=0;i<=10;i++)await page.mouse.move(b.x+12+i*(b.width-24)/10,b.cy);await page.mouse.up();
    assert.equal((await chips()).length,1);
    await page.mouse.down();for(let i=10;i>=0;i--)await page.mouse.move(b.x+12+i*(b.width-24)/10,b.cy+6);for(let i=0;i<=10;i++)await page.mouse.move(b.x+12+i*(b.width-24)/10,b.cy-6);await page.mouse.up();
    const all=await chips();assert.equal(all.length,1,`still one chip: ${all}`);assert.match(all[0],/Login mock/);
    assert.equal(await marks(),1);
    await page.keyboard.press('Backspace');await page.keyboard.press('Backspace');
    assert.equal((await chips()).length,0,'Backspace took the chip');assert.equal(await marks(),0,'and its mark');
    await page.keyboard.press(`${MOD}+z`);
    assert.ok(await until(async()=>(await chips()).length===1),'Undo brought it back');assert.equal(await marks(),1);
  });
  let first;
  await check('Enter sends the wand marks: a swath (centre line and width), the snap, and the targets it snapped to',async()=>{
    await page.keyboard.press(`${MOD}+a`);await page.keyboard.press('Backspace');
    await page.keyboard.type('wave ');await wave(await box(card('Hero B')));
    await page.keyboard.type(' circle ');await circle(await box('#world [data-decoration="stk"]'));
    await page.keyboard.type(' raw ');await page.keyboard.down(MOD);await wave(await box(card('Login mock')),{passes:2,y:(await box(card('Login mock'))).y+40});await page.keyboard.up(MOD);
    await page.keyboard.press('Enter');
    first=await sent(1);
    const [m1,m2,m3]=first.pointing.marks;
    assert.deepEqual(first.pointing.marks.map(m=>m.tool),['wand','wand','wand']);
    for(const m of [m1,m2,m3]){assert.equal(m.shape.kind,'swath');assert.ok(m.shape.width>20&&m.shape.points.length>=2&&m.shape.points.length<=400);}
    assert.equal(m1.snap.source,'object');assert.equal(m1.snap.label,'card "Hero B"');assert.equal(m1.targets[0].whole,true);
    assert.equal(m2.snap.label,'sticky "A sticky"');assert.equal(m2.snap.shape.kind,'rect');
    assert.equal(m3.snap,undefined,'⌘ held: exactly what the reviewer drew');assert.equal(m3.targets[0].title,'Login mock');assert.equal(m3.targets[0].whole,false);assert.ok(m3.targets[0].region.h<0.7);
  });
  await check('snapping per kind, shown before release: a sloppy marquee round a card, a lasso round a sticky, a marquee round a container; ⌘ takes the raw box',async()=>{
    await page.keyboard.press('Alt+KeyM');
    const c=await box(card('Login mock'));
    await page.keyboard.type('card ');
    await page.mouse.move(c.x+20,c.y-14);await page.mouse.down();await page.mouse.move(c.x+c.width+15,c.y+c.height+12,{steps:8});
    assert.equal(await redAt(c.x+3,c.y-5.5),true,'the snapped outline shows before release');
    await page.keyboard.down(MOD);await page.mouse.move(c.x+c.width+16,c.y+c.height+12);
    assert.equal(await until(async()=>!(await redAt(c.x+3,c.y-5.5)),1000),true,'⌘ held: no snapped outline');
    await page.keyboard.up(MOD);await page.mouse.move(c.x+c.width+15,c.y+c.height+12);
    assert.equal(await until(()=>redAt(c.x+3,c.y-5.5),1000),true,'⌘ let go: it is back');
    await page.mouse.up();
    await page.keyboard.type(' sticky ');await page.keyboard.press('Alt+KeyL');
    const s=await box('#world [data-decoration="stk"]');
    await page.mouse.move(s.cx-s.width/2-20,s.cy);await page.mouse.down();for(let d=180;d<=540;d+=15)await page.mouse.move(s.cx+(s.width/2+20)*Math.cos(d*Math.PI/180),s.cy+(s.height/2+18)*Math.sin(d*Math.PI/180));await page.mouse.up();
    await page.keyboard.type(' box ');await page.keyboard.press('Alt+KeyM');
    const x=await box('#world [data-decoration="box"]');
    await page.mouse.move(x.x+12,x.y+10);await page.mouse.down();await page.mouse.move(x.x+x.width-10,x.y+x.height+14,{steps:8});await page.mouse.up();
    await page.keyboard.type(' raw ');await page.keyboard.down(MOD);
    await page.mouse.move(c.x+60,c.y-14);await page.mouse.down();await page.mouse.move(c.x+c.width+15,c.y+c.height+12,{steps:8});await page.mouse.up();await page.keyboard.up(MOD);
    await page.keyboard.press('Enter');
    const t=await sent(2),[a,b,d,e]=t.pointing.marks;
    assert.deepEqual(t.pointing.marks.map(m=>m.tool),['marquee','lasso','marquee','marquee']);
    assert.equal(a.snap?.label,'card "Login mock"');assert.equal(a.targets[0].whole,true);
    const placed=a.targets[0].placed;assert.ok(placed&&Math.abs(a.snap.shape.x-placed.x)<2&&Math.abs(a.snap.shape.w-placed.w)<2,`the snapped outline is the card: ${JSON.stringify(a.snap.shape)} vs ${JSON.stringify(placed)}`);
    assert.ok(a.shape.x>a.snap.shape.x+10,'the raw box is kept beside it');
    assert.equal(b.snap?.label,'sticky "A sticky"');assert.equal(b.shape.kind,'path');
    assert.equal(d.snap?.label,'container "Box"');assert.equal(d.targets[0].itemKind,'container');
    assert.equal(e.snap,undefined);assert.equal(e.targets[0].whole,false,'⌘ held: the part the reviewer drew');
  });
  await check('a click is recorded as tool "click" with the active tool in via',async()=>{
    await page.keyboard.press('Alt+KeyM');await page.keyboard.type('a ');const h=await box(card('Hero B'));await page.mouse.click(h.cx,h.cy);
    await page.keyboard.press('Alt+KeyW');await page.keyboard.type(' b ');const s=await box('#world [data-decoration="stk"]');await page.mouse.move(s.cx,s.cy);await page.mouse.down();await page.mouse.up();
    await page.keyboard.press('Alt+KeyP');await page.keyboard.type(' c ');await page.mouse.click(h.cx,h.cy+20);
    await page.keyboard.press('Enter');
    const t=await sent(3);
    assert.deepEqual(t.pointing.marks.map(m=>[m.tool,m.via]),[['click','marquee'],['click','wand'],['click','point']]);
    assert.match(t.pointing.marks[1].targets[0].title,/A sticky$/);assert.equal(t.pointing.marks[0].targets[0].whole,true);
  });
  await check('⌥[ ⌥] change the wand\'s width; the next stroke is that wide',async()=>{
    await page.keyboard.press('Alt+KeyW');await page.keyboard.press('Alt+BracketRight');
    await page.keyboard.type('wide ');await wave(await box(card('Hero B')),{passes:2});
    await page.keyboard.press('Alt+BracketLeft');await page.keyboard.press('Alt+BracketLeft');
    await page.keyboard.type(' narrow ');await page.keyboard.down(MOD);await wave(await box(card('Hero B')),{passes:2});await page.keyboard.up(MOD);
    assert.doesNotMatch(await field.textContent(),/[\[\]“‘]/,'no bracket typed');
    await page.keyboard.press('Enter');
    const t=await sent(4),[w,n]=t.pointing.marks;
    assert.ok(w.shape.width>n.shape.width*1.8,`wide ${w.shape.width} vs narrow ${n.shape.width}`);
    await page.keyboard.press('Alt+BracketRight');
  });
  await check('the snap-source seam: a source inside a card is asked in the card\'s unit and its answer becomes the snap; a null answer leaves the raw gesture',async()=>{
    await page.evaluate(async()=>{
      const {pointingGuard}=await import('/app/pointing-guard.js');
      window.__asked=[];
      // a stub in card units (no frame or picture on these cards): "the top-left quarter", for marquees only
      pointingGuard.mode.addSnapSource({propose:req=>{window.__asked.push({kind:req.kind,unit:req.unit,title:req.item?.title,g:req.geometry});return req.kind==='rect'?{shape:{kind:'rect',x:0,y:0,w:130,h:90},label:'the top-left quarter',source:'dom',score:.9,element:{tag:'section',selector:'#q',path:'main > section#q',box:{x:0,y:0,w:130,h:90},frameUrl:'about:blank'}}:null;}});
      pointingGuard.mode.addSnapSource({propose:()=>null});
    });
    await page.keyboard.press('Alt+KeyM');await page.keyboard.type('quarter ');
    const c=await box(card('Hero B'));
    await page.mouse.move(c.x+30,c.y+40);await page.mouse.down();await page.mouse.move(c.x+110,c.y+100,{steps:6});await page.mouse.up();
    await page.keyboard.press('Alt+KeyP');await page.keyboard.type(' click ');await page.mouse.click(c.cx,c.cy);
    const asked=await page.evaluate(()=>window.__asked);
    assert.ok(asked.some(a=>a.kind==='rect'&&a.unit==='card'&&a.title==='Hero B'&&Math.abs(a.g.x-30)<4),`asked in card units: ${JSON.stringify(asked.at(-2))}`);
    assert.ok(asked.some(a=>a.kind==='point'),'a click asks too');
    const tips=await field.locator('.pointing-chip').evaluateAll(cs=>cs.map(c=>c.dataset.tip));
    assert.match(tips[0],/^Part of Hero B, snapped to the the top-left quarter|^Part of Hero B, snapped to the top-left quarter/);
    assert.doesNotMatch(tips[1],/snapped/);
    // the server keeps the element only once it accepts that field (CONTRACT § Round 2, target `element`): checked on the client record here
    const rec=await page.evaluate(async()=>{const {pointingGuard}=await import('/app/pointing-guard.js');const m=pointingGuard.mode;return m.message().marks.map(x=>({snap:x.snap,targets:x.targets}));});
    assert.equal(rec[0].snap.source,'dom');assert.deepEqual(rec[0].snap.shape.w>0,true);assert.equal(rec[0].targets[0].element.selector,'#q');
    assert.ok(Math.abs(rec[0].targets[0].region.w-0.5)<0.02&&Math.abs(rec[0].targets[0].region.h-0.5)<0.02,`region follows the snap: ${JSON.stringify(rec[0].targets[0].region)}`);
    await page.keyboard.press(`${MOD}+a`);await page.keyboard.press('Backspace');
  });
  assert.deepEqual(errors,[],'page errors');
  await context.close();

  // The look: dark, 2x. A wave over a card (snapped), a circle round the sticky, and a raw stroke (⌘) on a card.
  const look=await makeBoard('Wand look');
  for(const [mode,dpr] of [['dark',2],['light',2],['dark',1],['light',1]]){
    const ctx=await browser.newContext({viewport:{width:1280,height:860},deviceScaleFactor:dpr,colorScheme:mode,reducedMotion:'reduce'}),p=await ctx.newPage();
    await p.addInitScript(mode=>{try{localStorage.setItem('tinka/appearance',mode);}catch{}},mode);
    await p.goto(`${url}/boards/${look}/`);await p.waitForSelector('#world .workspace-card');await p.waitForSelector('[data-pointing-enter]',{state:'attached'});await p.waitForTimeout(400);
    await check(`the look, ${mode} ${dpr}x: glitter in the mark red over the content`,async()=>{
      await p.keyboard.press('p');await p.keyboard.press('Alt+KeyW');
      const b=await p.locator(card('Hero B')).first().boundingBox();
      await p.mouse.move(b.x+12,b.y+b.height/2);await p.mouse.down();for(let k=0;k<4;k++)for(let i=0;i<=10;i++)await p.mouse.move(b.x+12+(k%2?10-i:i)*(b.width-24)/10,b.y+b.height/2+(k-2)*5);
      await p.screenshot({path:path.join(evidence,`wand-casting-${mode}-${dpr}x.png`)});
      await p.mouse.up();
      const s=await p.locator('#world [data-decoration="stk"]').boundingBox(),cx=s.x+s.width/2,cy=s.y+s.height/2;
      await p.mouse.move(cx-s.width/2-26,cy);await p.mouse.down();for(let d=180;d<=560;d+=12)await p.mouse.move(cx+(s.width/2+26)*Math.cos(d*Math.PI/180),cy+(s.height/2+26)*Math.sin(d*Math.PI/180));await p.mouse.up();
      const l=await p.locator(card('Login mock')).first().boundingBox();
      await p.keyboard.down(MOD);await p.mouse.move(l.x+20,l.y+70);await p.mouse.down();for(let k=0;k<3;k++)for(let i=0;i<=10;i++)await p.mouse.move(l.x+20+(k%2?10-i:i)*14,l.y+70+k*10);await p.mouse.up();await p.keyboard.up(MOD);
      await p.mouse.move(1000,700,{steps:6});await p.waitForTimeout(600);
      await p.screenshot({path:path.join(evidence,`wand-${mode}-${dpr}x.png`)});
      assert.equal(await p.locator('.pointing-marks .pointing-swath').count(),3);
      await p.keyboard.press(`${MOD}+a`);await p.keyboard.press('Backspace');
    });
    await ctx.close();
  }
}finally{await browser?.close();if(server)await closeAppServer(server);if(!process.env.TINKA_EVIDENCE_DIR)await rm(fixture,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
for(const r of results)console.log(`${r.pass?'PASS':'FAIL'}  ${r.name}${r.error?'  -- '+r.error:''}`);
const failed=results.filter(r=>!r.pass).length;console.log(JSON.stringify({passed:results.length-failed,failed,evidence}));
process.exit(failed?1:0);
