// Pointing mode (pointing-mode.js) on a real board page, driven with a real pointer and keyboard: P enters, typing and
// pointing interleave (marquee, lasso, point, the laser's circle, @), chips land at the caret, Backspace and Undo take
// a chip and its mark away and back, the board is never selected or edited, Enter sends one thread to the agent with
// the pointing record, Escape leaves with the view and selection as they were, and the sent thread's card reads as
// her sentence with chips. At 1280 also: a sent mark follows a card an agent moves or resizes, an edited target's chip
// takes its new text, a deleted target's mark stays where it was drawn labelled Deleted, a draft mark follows a card
// moved while she types, and Send clears at once, lets her type on while it sends, and gives a failed message back.
// The review's fixes (team/pointing/STATUS.md, 2026-11-25): an @ name with spaces keeps the list open and Enter picks;
// a press on the bar keeps focus in the field; a number on screen is never used twice; ⌥R, the @ list's Selected
// group, ⌥ zoom and Tab out of the bar; panels stay open; the laser dot goes with the pointer; the 20-mark and length
// limits and an app that isn't answering said plainly; the draft survives a reload. At 1280 also: a click points at the
// whole thing with its spot and content coordinates (page px, image px), text counts where its words are drawn, an
// arrow by its line, a slow laser circle round a sticky is the whole sticky, and an open thread card clears its marks.
// Light at 1280 and a phone at 390. Isolated fixture, headless, port 0.
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from '../cli.mjs';
import {loadConfig} from '../lib/config.mjs';
import {applyOperation,getBoardSnapshot} from '../lib/workspace.mjs';
import {listFeedback} from '../lib/feedback.mjs';
import {createAppServer,closeAppServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const fixture=await mkdtemp(path.join(os.tmpdir(),'tinka-pointing-'));
const evidence=process.env.TINKA_EVIDENCE_DIR||path.join(fixture,'evidence');await mkdir(evidence,{recursive:true});
const MOD=process.platform==='darwin'?'Meta':'Control';
let server,browser,config,url;const results=[];
const listBoard=id=>getBoardSnapshot(config,id);
const until=async(fn,ms=5000)=>{const end=Date.now()+ms;let last;while(Date.now()<end){try{last=await fn();if(last)return last;}catch(e){last=e;}await new Promise(r=>setTimeout(r,80));}return last;};
let shoot=null;
async function check(name,body){try{await body();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:String(e.message).split('\n').slice(0,8).join(' | ')});await shoot?.(`fail-${results.length}`).catch(()=>{});}}
try{
  const configFile=path.join(fixture,'local/config.json');
  await main(['init','--config',configFile,'--boards',path.join(fixture,'boards'),'--label','Pointing fixture']);
  config=await loadConfig(configFile);
  server=createAppServer(config);await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;
  // Content for the click, content-coordinate, text and arrow checks: a page, a picture, a wide heading and an arrow.
  const assets=path.join(config.boardsRoot,'assets');await mkdir(assets);
  await writeFile(path.join(assets,'page.html'),'<!doctype html><body style="margin:0;font:16px sans-serif"><h1 style="margin:20px">Page</h1><button style="margin:20px">Submit</button></body>');
  await writeFile(path.join(assets,'pic.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#678"/></svg>');
  await applyOperation(config,{type:'updateWorkspace',patch:{resourceRoots:{assets:{path:'../assets'}}}});
  browser=await chromium.launch({headless:true,args:['--mute-audio'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  for(const width of [1280,390]){
    const boardId=(await applyOperation(config,{type:'createBoard',title:`Pointing ${width}`})).result.boardId;
    // On a phone the three cards stand in a column, so all of them are on screen.
    const narrow=width<600,R=narrow?110:150;
    for(const [i,title] of ['Login mock','Hero B','Pricing'].entries())await applyOperation(config,{type:'createItem',boardId,item:{title},placement:narrow?{x:0,y:i*200,width:220,height:160}:{x:i*260,y:0,width:220,height:170}});
    await applyOperation(config,{type:'createDecoration',boardId,decoration:{id:'note1',type:'region',shape:'rectangle',x:narrow?240:0,y:narrow?0:240,width:narrow?120:160,height:120,color:'#f6e6a4',text:'A sticky'}});
    const context=await browser.newContext({viewport:{width,height:width>600?860:800},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
    page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
    shoot=name=>page.screenshot({path:path.join(evidence,`${name}-${width}.png`)});
    await page.goto(`${url}/boards/${boardId}/`);await page.waitForSelector('#world .workspace-card');await page.waitForSelector('[data-pointing-enter]',{state:'attached'});await page.waitForTimeout(400);
    const tag=`${width}:`,field=page.locator('.pointing-field'),chips=()=>field.locator('.pointing-chip').allTextContents();
    const centre=async sel=>{const b=await page.locator(sel).first().boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2,b};};
    const card=title=>`#world .workspace-card:has(:text("${title}"))`;
    let selected,view;
    await check(`${tag} P enters; keys stay in the composer; a press on the board selects nothing`,async()=>{
      // a real selection first: Tab to the first card, Space selects it
      await page.evaluate(()=>document.getElementById('viewport').focus());await page.keyboard.press('Tab');await page.keyboard.press('Space');
      selected=await page.locator('#world .workspace-card.selected').count();assert.equal(selected,1,'one card selected before');
      view=await page.evaluate(()=>document.getElementById('plane').style.transform+'|'+document.getElementById('world').style.transform);
      await page.keyboard.press('p');
      await until(()=>page.evaluate(()=>document.body.classList.contains('pointing-on')));
      assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('pointing-field')),true,'the composer has focus');
      const c=await centre(card('Pricing'));await page.mouse.click(c.x,c.y);
      assert.equal(await page.locator('#world .workspace-card.selected').count(),1,'the press selected nothing new');
      assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('pointing-field')),true,'focus never left the composer');
      await page.keyboard.press('Backspace');await page.keyboard.press('Backspace');
      assert.deepEqual(await chips(),[],'Backspace took the chip back');
    });
    await check(`${tag} type, point, type, point: chips at the caret in that order; a part as a region`,async()=>{
      await page.keyboard.press('Alt+KeyM');
      await page.keyboard.type('change this ');
      const a=await centre(card('Login mock'));
      await page.mouse.move(a.b.x+20,a.b.y+40);await page.mouse.down();await page.mouse.move(a.b.x+80,a.b.y+70,{steps:6});await page.mouse.move(a.b.x+120,a.b.y+90,{steps:4});await page.mouse.up();
      await page.keyboard.type('to look more like this ');
      await page.keyboard.press('Alt+KeyP');
      const b=await centre(card('Hero B'));await page.mouse.click(b.x,b.y);
      await page.keyboard.type('please');
      const all=await chips();
      assert.equal(all.length,2,`two chips: ${all}`);assert.match(all[0],/^2\s*Login mock/);assert.match(all[1],/^3\s*Hero B/);
      assert.match((await field.textContent()).replace(/\s+/g,' '),/^change this 2 ?Login mock to look more like this 3 ?Hero B please$/,'mark 1 was deleted: its number is not used again in this draft');
      assert.equal(await page.locator('.pointing-marks .pointing-badge').count(),2,'two marks on the board');
    });
    await check(`${tag} Backspace takes a chip and its mark; Undo brings both back`,async()=>{
      for(const _ of 'please')await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');await page.keyboard.press('Backspace');
      assert.equal((await chips()).length,1);assert.equal(await page.locator('.pointing-marks .pointing-badge').count(),1);
      await page.keyboard.press(`${MOD}+z`);
      await until(async()=>(await chips()).length===2);assert.equal(await page.locator('.pointing-marks .pointing-badge').count(),2);
    });
    await check(`${tag} the lasso and the laser's circle; @ picks by name`,async()=>{
      await page.keyboard.press('End');await page.keyboard.type(' and ');
      await page.keyboard.press('Alt+KeyL');
      const s=await centre(card('Pricing'));
      await page.mouse.move(s.x+R,s.y);await page.mouse.down();
      for(let d=0;d<=360;d+=20)await page.mouse.move(s.x+R*Math.cos(d*Math.PI/180),s.y+R*.8*Math.sin(d*Math.PI/180));
      await page.mouse.up();
      await page.keyboard.press('Alt+KeyK');await page.keyboard.type(' or ');
      const n=await centre('#world [data-decoration="note1"]');
      const r=narrow?75:110;
      await page.mouse.move(n.x-r,n.y+r);await page.mouse.down();
      for(let x=0;x<160;x+=16)await page.mouse.move(n.x-r+x*(narrow?.5:1),n.y+r+(x%32?20:-20)); // waving: no reference
      for(let d=0;d<=420;d+=15)await page.mouse.move(n.x+r*Math.cos(d*Math.PI/180),n.y+r*.8*Math.sin(d*Math.PI/180));
      await page.mouse.up();
      await page.keyboard.type(' @pric');await page.locator('.cref-picker[data-open]').waitFor();await page.keyboard.press('Enter');
      const all=await chips();
      assert.equal(all.length,5,`five chips: ${all}`);assert.match(all[2],/^4\s*Pricing/);assert.match(all[3],/^5\s*A sticky|^5\s*Sticky/);assert.match(all[4],/^6\s*Pricing/);
    });
    let threadId;
    await check(`${tag} Enter sends one thread to the agent with the pointing record`,async()=>{
      await page.keyboard.press('Enter');
      const t=await until(async()=>(await listFeedback(config,{boardId,includeBodies:true})).threads.find(t=>t.pointing));
      assert.ok(t,'a pointing thread');threadId=t.id;
      assert.equal(t.status,'sent');assert.deepEqual(t.to,{kind:'agent'});
      assert.match(t.body,/^change this @1 Login mock to look more like this @2 Hero B and @3 Pricing or @4 .+ @5 Pricing$/);
      const p=t.pointing;assert.equal(p.source,'typed');assert.equal(p.marks.length,5);
      assert.deepEqual(p.parts.filter(x=>'mark' in x).map(x=>x.mark),[1,2,3,4,5]);
      assert.deepEqual(p.marks.map(m=>m.tool),['marquee','point','lasso','laser','keyboard']);
      const m1=p.marks[0];assert.equal(m1.targets[0].title,'Login mock');assert.equal(m1.targets[0].whole,false);assert.ok(m1.targets[0].region.w>0&&m1.targets[0].region.w<1);
      assert.equal(p.marks[1].targets[0].whole,true);assert.equal(p.marks[3].targets[0].kind,'decoration');
      assert.equal(p.appearance,'light','the board\'s appearance goes with the message');
      // Every mark has a crop file or a plain note saying why not (the server renders them before the thread exists).
      for(const m of p.marks){assert.ok(m.crop?.path||m.cropNote,`mark ${m.n}: a crop or a note`);assert.ok(m.end>=m.at);}
      assert.ok(p.parts.every(x=>'mark' in x||(Number.isInteger(x.at)&&x.end>=x.at)),'every typed run has its times');
      assert.equal(t.anchor.kind,'point');
      assert.equal(await field.textContent(),'','the composer cleared');
      assert.equal(await page.evaluate(()=>document.body.classList.contains('pointing-on')),true,'the mode stays');
    });
    await check(`${tag} Escape leaves: view and selection as they were; the board was never edited`,async()=>{
      await page.mouse.wheel(0,240);await page.waitForTimeout(150);
      await page.keyboard.press('Escape');
      await until(async()=>!(await page.evaluate(()=>document.body.classList.contains('pointing-on'))));
      assert.equal(await page.evaluate(()=>document.getElementById('plane').style.transform+'|'+document.getElementById('world').style.transform),view,'view restored');
      assert.equal(await page.locator('#world .workspace-card.selected').count(),selected,'selection kept');
      assert.equal(await page.locator('#world .workspace-card').count(),3,'no card added or removed');
      assert.equal(await page.locator('#world .workspace-decoration').count(),1,'no drawing added');
    });
    await check(`${tag} the thread card reads as her sentence with numbered chips; its marks show while open`,async()=>{
      await page.evaluate(()=>window.dispatchEvent(new HashChangeEvent('hashchange')));
      await page.evaluate(id=>{location.hash=`#comments/${encodeURIComponent(id)}`;},threadId);
      const cardEl=page.locator('.ct-card');await cardEl.waitFor();
      await until(async()=>(await cardEl.locator('.pointing-chip').count())===5);
      assert.match((await cardEl.locator('[data-body]').first().textContent()).replace(/\s+/g,' '),/change this 1 ?Login mock to look more like this 2 ?Hero B/);
      await until(async()=>(await page.locator('.pointing-marks .pointing-badge').count())===5);
      await page.screenshot({path:path.join(evidence,`pointing-thread-${width}.png`)});
      await page.keyboard.press('Escape');await cardEl.waitFor({state:'detached'});
      await until(()=>page.evaluate(()=>document.querySelector('.pointing-marks').hidden));
    });
    if(!narrow){
      const t=(await listFeedback(config,{boardId,includeBodies:true})).threads.find(x=>x.id===threadId),marks=t.pointing.marks;
      const shapeBox=n=>page.evaluate(n=>{const e=document.querySelector(`.pointing-marks [data-n="${n}"]:is(rect,path)`);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};},n);
      const cardBox=async title=>{const b=await page.locator(card(title)).first().boundingBox();return b&&{x:b.x,y:b.y,w:b.width,h:b.height};};
      const close=(a,b,tol=3)=>!!a&&!!b&&['x','y','w','h'].every(k=>Math.abs(a[k]-b[k])<=tol);
      const openCard=async()=>{await page.evaluate(id=>{history.replaceState(null,'',location.pathname+location.search);window.dispatchEvent(new HashChangeEvent('hashchange'));location.hash=`#comments/${encodeURIComponent(id)}`;},threadId);await page.locator('.ct-card').waitFor();await until(async()=>(await page.locator('.pointing-marks .pointing-badge').count())===5);
        // The board holds an agent's changes while a field it does not own has focus (the card's reply box); off it, they come.
        await page.evaluate(()=>document.activeElement?.blur());};
      await check(`${tag} a sent mark follows its card when it is moved and resized; a part keeps its place on the card`,async()=>{
        await openCard();
        assert.ok(close(await shapeBox(2),await cardBox('Hero B'),4),'mark 2 outlines Hero B before the move');
        const hero=marks[1].targets[0].id,login=marks[0].targets[0].id,region=marks[0].targets[0].region;
        await applyOperation(config,{type:'updatePlacement',boardId,placementId:hero,patch:{x:300,y:430,width:300,height:200}});
        await applyOperation(config,{type:'updatePlacement',boardId,placementId:login,patch:{width:330,height:250}});
        const moved=await until(async()=>{const c=await cardBox('Hero B'),m=await shapeBox(2);return close(m,c,4)&&c.w>280?{c,m}:null;},6000);
        assert.ok(moved?.c,`mark 2 followed Hero B: card ${JSON.stringify(await cardBox('Hero B'))} mark ${JSON.stringify(await shapeBox(2))}`);
        const part=await until(async()=>{const c=await cardBox('Login mock'),m=await shapeBox(1);if(!c||!m||c.w<300)return null;
          const f={x:(m.x-c.x)/c.w,y:(m.y-c.y)/c.h,w:m.w/c.w,h:m.h/c.h};return ['x','y','w','h'].every(k=>Math.abs(f[k]-region[k])<.03)?f:null;},6000);
        assert.ok(part?.w,`mark 1 is the same part of the resized card (${JSON.stringify(region)} vs ${JSON.stringify(part)})`);
      });
      let drawn4;
      await check(`${tag} an edited target: the chip shows its new text and the mark its new size`,async()=>{
        drawn4=await shapeBox(4);
        await applyOperation(config,{type:'updateDecoration',boardId,decorationId:'note1',patch:{text:'Renamed sticky',width:220}});
        assert.ok(await until(async()=>/Renamed sticky/.test(await page.locator('.ct-card .pointing-chip[data-point-n="4"]').textContent())),'the chip has the new text');
        const ok=await until(async()=>{const d=await page.locator('#world [data-decoration="note1"]').boundingBox(),m=await shapeBox(4);return d&&m&&d.width>200&&m.w>d.width?true:null;});
        assert.ok(ok,'the laser circle widened with the sticky');
      });
      await check(`${tag} a deleted target: its mark stays where it was drawn, plain, labelled Deleted; the chip says so`,async()=>{
        await applyOperation(config,{type:'removeDecoration',boardId,decorationId:'note1'});
        assert.ok(await until(async()=>(await page.locator('.pointing-marks .pointing-badge[data-n="4"].pointing-gone').count())===1,6000),'mark 4 shows as gone');
        assert.match(await page.locator('.pointing-marks .pointing-badge[data-n="4"]').textContent(),/^4\s*Deleted$/);
        assert.equal(await page.evaluate(()=>document.querySelector('.pointing-marks [data-n="4"]:is(rect,path)').classList.contains('pointing-gone')),true);
        assert.ok(close(await shapeBox(4),drawn4,2),'the gone mark is where it was drawn');
        assert.ok(await until(async()=>(await page.locator('.ct-card .pointing-chip.missing').count())===1),'the open card\'s chip 4 says Deleted');
        assert.equal(await page.locator('.ct-card .pointing-chip.missing').getAttribute('data-tip'),'Deleted');
        await page.screenshot({path:path.join(evidence,`pointing-followed-${width}.png`)});
        await page.locator('.ct-card [data-act="close"]').click();await page.locator('.ct-card').waitFor({state:'detached'});
      });
      await check(`${tag} a draft mark follows a card an agent moves while she types`,async()=>{
        await page.keyboard.press('p');await until(()=>page.evaluate(()=>document.body.classList.contains('pointing-on')));
        await page.keyboard.press('Alt+KeyP');await page.keyboard.type('this ');
        const c=await centre(card('Pricing'));await page.mouse.click(c.x,c.y);
        assert.ok(close(await shapeBox(1),await cardBox('Pricing'),5),'outlines Pricing');
        await applyOperation(config,{type:'updatePlacement',boardId,placementId:marks[2].targets[0].id,patch:{x:640,y:300}});
        const ok=await until(async()=>{const b=await cardBox('Pricing'),m=await shapeBox(1);return b&&b.y>c.b.y+100&&close(m,b,5);},6000);
        assert.ok(ok===true,`the draft mark followed Pricing: card ${JSON.stringify(await cardBox('Pricing'))} mark ${JSON.stringify(await shapeBox(1))} was ${JSON.stringify(c.b)}`);
      });
      await check(`${tag} Send clears at once; the next message can be typed while it sends; a failure gives the message back`,async()=>{
        let posts=0;
        await page.route('**/api/operations',async route=>{const body=route.request().postDataJSON();if(body?.type!=='addComment')return route.continue();posts++;await new Promise(r=>setTimeout(r,1200));await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'The server is restarting.'})});});
        await page.keyboard.press('Enter');
        assert.equal(await field.textContent(),'','cleared at once');
        assert.ok(await until(async()=>(await page.locator('.pointing-status').textContent())==='Sending…',1000),'Sending… on the bar');
        assert.equal(await page.locator('.pointing-marks .pointing-badge').count(),0,'its marks went with it');
        await page.keyboard.type('next one');
        assert.equal(await field.textContent(),'next one','typing goes on while it sends');
        assert.ok(await until(async()=>/^Not sent: The server is restarting\. Your message is back/.test(await page.locator('.pointing-status').textContent()),5000),'the reason, plainly');
        assert.equal(posts,1);
        assert.match((await field.textContent()).replace(/ /g,' '),/^this 1Pricing\s*\nnext one$/,`the message is back, before the new one: ${JSON.stringify(await field.textContent())}`);
        assert.deepEqual(await chips(),['1Pricing'],'its chip, numbered');
        assert.equal(await page.locator('.pointing-marks .pointing-badge').count(),1,'and its mark');
        await page.unroute('**/api/operations');
        await page.keyboard.press('Enter');
        const sent=await until(async()=>(await listFeedback(config,{boardId,includeBodies:true})).threads.find(x=>x.pointing&&x.id!==threadId));
        assert.match(sent.body,/^this @1 Pricing\s*next one$/);
        assert.deepEqual(sent.pointing.marks.map(m=>m.n),[1]);
        assert.ok(await until(async()=>page.locator('.pointing-status').isHidden()),'the line goes once nothing is sending');
        await page.keyboard.press('Escape');
      });
    }
    // ---- the review's fixes ----
    if(!narrow){ // the checks above moved, resized and deleted things: put the board back as it began
      const snap=(await listBoard(boardId));
      for(const [i,title] of ['Login mock','Hero B','Pricing'].entries()){const p=snap.placements.find(x=>!x.removedAt&&snap.items[x.itemId]?.title===title);await applyOperation(config,{type:'updatePlacement',boardId,placementId:p.id,patch:{x:i*260,y:0,width:220,height:170}});}
      await applyOperation(config,{type:'createDecoration',boardId,decoration:{id:'note2',type:'region',shape:'rectangle',x:0,y:240,width:160,height:120,color:'#f6e6a4',text:'A sticky'}});
      await until(async()=>(await page.locator('#world [data-decoration="note2"]').count())===1,6000);
      await page.evaluate(()=>document.getElementById('viewport').focus());await page.keyboard.press('Shift+Digit0');await page.waitForTimeout(300);
    }
    const on=()=>page.evaluate(()=>document.body.classList.contains('pointing-on'));
    const enterMode=async()=>{if(!(await on())){await page.evaluate(()=>document.getElementById('viewport').focus());await page.keyboard.press('p');await until(on);}};
    const emptyField=async()=>{await page.locator('.pointing-field').focus();await page.keyboard.press(`${MOD}+a`);await page.keyboard.press('Backspace');};
    const inField=()=>page.evaluate(()=>document.activeElement?.classList.contains('pointing-field'));
    const pointingThreads=async()=>(await listFeedback(config,{boardId,includeBodies:true})).threads.filter(x=>x.pointing).length;
    await check(`${tag} an @ name with spaces: the list stays open, Enter picks and never sends; "No match" only when nothing matches`,async()=>{
      await enterMode();await emptyField();const before=await pointingThreads();
      await page.keyboard.type('see @pric');await page.locator('.cref-picker[data-open]').waitFor();
      assert.equal(await page.locator('.cref-picker[data-open] .cref-empty').isVisible(),false,'no "No match" above matching rows');
      await page.keyboard.press('Backspace');await page.keyboard.press('Backspace');await page.keyboard.press('Backspace');await page.keyboard.press('Backspace');
      await page.keyboard.type('sticky · a st');await page.waitForTimeout(150);
      assert.equal(await page.locator('.cref-picker[data-open]').count(),1,'open across the spaces');
      await page.keyboard.press('Enter');
      assert.match((await chips()).at(-1)||'',/sticky/i,'Enter picked the sticky');
      assert.equal(await on(),true);assert.equal(await pointingThreads(),before,'Enter did not send');
      await page.keyboard.type('and @zz top');await until(async()=>(await page.locator('.cref-picker[data-open]').count())===0,2000);
      assert.equal(await page.locator('.cref-picker[data-open]').count(),0,'a space that matches nothing closes the list');
      assert.match((await field.textContent()).replace(/\s+/g,' '),/and @zz top$/,'the rest is plain text');
      await emptyField();
    });
    await check(`${tag} a pointer press on a bar key keeps focus in the composer; a number on screen is never used twice`,async()=>{
      await enterMode();await emptyField();
      await page.locator('[data-pointing-tool="lasso"]').click();
      assert.equal(await inField(),true,'focus stayed in the composer');
      await page.keyboard.type('ab ');assert.match(await field.textContent(),/ab\s$/);
      await page.keyboard.press('Alt+KeyP');
      for(const title of ['Login mock','Hero B','Pricing']){const c=await centre(card(title));await page.mouse.click(c.x,c.y);}
      await page.keyboard.press(`${MOD}+a`);await page.keyboard.press('Backspace');await page.keyboard.press(`${MOD}+z`);
      await until(async()=>(await chips()).length===3);
      await page.keyboard.press('End');const c=await centre(card('Login mock'));await page.mouse.click(c.x,c.y);
      const nums=(await field.locator('.pointing-chip .pointing-n').allTextContents());
      assert.equal(new Set(nums).size,nums.length,`numbers unique: ${nums}`);
      const badges=await page.locator('.pointing-marks .pointing-badge b').allTextContents();
      assert.deepEqual([...badges].sort(),[...nums].sort(),'the board shows the same numbers');
      await emptyField();
    });
    await check(`${tag} keyboard: ⌥R points at the selection; @ lists it first; ⌥= ⌥0 zoom; Tab leaves the bar to the next control`,async()=>{
      await enterMode();await emptyField();
      assert.equal(await page.locator('.pointing-selected').getAttribute('aria-keyshortcuts'),'Alt+R');
      await page.keyboard.press('Alt+KeyR');
      const sel=await page.locator('#world .workspace-card.selected').first().textContent();
      assert.equal((await chips()).length,1,'one chip');assert.ok(sel.includes((await chips())[0].replace(/^\d+/,'').trim().slice(0,8)),`the selected card: ${await chips()}`);
      await page.keyboard.type(' @');await page.locator('.cref-picker[data-open]').waitFor();
      assert.equal(await page.locator('.cref-picker[data-open] ui-trigger-menu-group-label').first().textContent(),'Selected');
      await page.keyboard.press('Escape');await page.keyboard.press('Backspace');
      const zoom=()=>page.locator('#zoom-menu-toggle').textContent();
      const z0=await zoom();await page.keyboard.press('Alt+Equal');await until(async()=>(await zoom())!==z0,2000);
      assert.notEqual(await zoom(),z0,'⌥= zoomed');await page.keyboard.press('Alt+Digit0');await until(async()=>(await zoom())==='100%',2000);
      assert.equal(await zoom(),'100%');assert.match(await field.textContent(),/^\d+\S/,'no = or º typed');
      await page.locator('.pointing-leave').focus();await page.keyboard.press('Tab');
      const next=await page.evaluate(()=>{const a=document.activeElement,bar=document.querySelector('.pointing-bar');return a&&a!==document.body&&!bar.contains(a)&&!!(bar.compareDocumentPosition(a)&Node.DOCUMENT_POSITION_FOLLOWING);});
      assert.equal(next,true,'Tab from Leave goes on to the next control');
      await emptyField();
    });
    if(!narrow)await check(`${tag} panels stay: the rail key and the bar's keys never close an open Inspector`,async()=>{
      if(await on()){await page.keyboard.press('Escape');await until(async()=>!(await on()));}
      await page.evaluate(()=>document.getElementById('viewport').focus());await page.keyboard.press(`${MOD}+i`); // the selected card's Inspector
      const inspector=()=>page.evaluate(()=>[...document.querySelectorAll('.calm-side')].some(e=>e.getBoundingClientRect().width>0));
      await until(inspector);assert.equal(await inspector(),true,'Inspector open');
      await page.locator('[data-pointing-enter]').click();
      await until(on);assert.equal(await inspector(),true,'still open after the rail key');
      await page.locator('[data-pointing-tool="marquee"]').click();assert.equal(await inspector(),true,'still open after a tool key');
      assert.equal(await inField(),true);
      await page.keyboard.press('Escape');await until(async()=>!(await on()));assert.equal(await inspector(),true,'still open after leaving');
      await page.locator('.calm-side [data-context-close]').first().click();await until(async()=>!(await inspector()));
    });
    await check(`${tag} the laser dot goes when the pointer leaves the board`,async()=>{
      await enterMode();await page.keyboard.press('Alt+KeyK');
      const ink=()=>page.evaluate(()=>{const c=document.querySelector('.pointing-sheet'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;return n;});
      const c=await centre(card('Pricing'));await page.mouse.move(c.x,c.y);await page.mouse.move(c.x+10,c.y+5);
      assert.ok(await until(async()=>(await ink())>0,1000),'a dot on the board');
      const b=await page.locator('.pointing-bar').boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:4});
      assert.ok(await until(async()=>(await ink())===0,2000),'nothing left on the board');
      await page.keyboard.press('Alt+KeyP');
    });
    await check(`${tag} limits and failures in plain words: the 21st mark, a message too long, the app not answering`,async()=>{
      await enterMode();await emptyField();
      const {b}=await centre(card('Login mock'));for(let i=0;i<21;i++)await page.mouse.click(b.x+30+(i%10)*12,b.y+50+Math.floor(i/10)*12);
      assert.equal((await chips()).length,20,'the 21st was not taken');
      assert.equal(await page.locator('.pointing-status').textContent(),'A message can have at most 20 marks. Send this one, or delete a mark first.');
      await emptyField();
      await page.evaluate(()=>document.execCommand('insertText',false,'x'.repeat(25000)));
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.pointing-status').textContent(),'A message can be at most 20,000 characters. This one has 25,000: shorten it and send again.');
      assert.equal((await field.textContent()).length,25000,'kept in the field');
      await emptyField();
      await page.route('**/api/operations',route=>route.request().postDataJSON()?.type==='addComment'?route.abort('failed'):route.continue());
      await page.keyboard.type('offline');await page.keyboard.press('Enter');
      assert.ok(await until(async()=>(await page.locator('.pointing-status').textContent())==="The app isn't answering. Your message is back in the field.",4000),`said plainly: ${await page.locator('.pointing-status').textContent()}`);
      assert.equal(await field.textContent(),'offline');
      await page.unroute('**/api/operations');await emptyField();
    });
    await check(`${tag} the draft survives leaving the page: words, chips and marks, and the mode, come back`,async()=>{
      await enterMode();await emptyField();await page.keyboard.press('Alt+KeyP');
      await page.keyboard.type('kept ');const c=await centre(card('Hero B'));await page.mouse.click(c.x,c.y);await page.keyboard.type('here');
      const text=await field.textContent();await page.waitForTimeout(400);
      await page.evaluate(()=>history.replaceState(null,'',location.pathname));await page.reload();await page.waitForSelector('#world .workspace-card');await until(on,6000);
      assert.equal(await field.textContent(),text);assert.equal((await chips()).length,1);
      assert.ok(await until(async()=>(await page.locator('.pointing-marks .pointing-badge').count())===1),'its mark');
      await page.keyboard.type('!');assert.equal(await field.textContent(),text+'!','typing goes on at the end');
      await emptyField();await page.keyboard.press('Escape');await until(async()=>!(await on()));
    });
    if(!narrow){
      const cb=(await applyOperation(config,{type:'createBoard',title:'Pointing content'})).result.boardId;
      await applyOperation(config,{type:'createItem',boardId:cb,item:{title:'A page',content:{kind:'html',resource:{rootId:'assets',path:'page.html'}}},placement:{x:0,y:0,width:420,height:320}});
      await applyOperation(config,{type:'createItem',boardId:cb,item:{title:'A picture',content:{kind:'image',resource:{rootId:'assets',path:'pic.svg'}}},placement:{x:480,y:0,width:420,height:260}});
      await applyOperation(config,{type:'createDecoration',boardId:cb,decoration:{id:'head',type:'text',x:0,y:380,width:900,height:60,text:'Heading',color:'#333333'}});
      await applyOperation(config,{type:'createDecoration',boardId:cb,decoration:{id:'arr',type:'line',text:'',x:0,y:480,width:300,height:100,from:{x:0,y:480},to:{x:300,y:580},color:'#333333',endArrow:true,route:'straight'}});
      await applyOperation(config,{type:'createDecoration',boardId:cb,decoration:{id:'stk',type:'region',shape:'rectangle',x:420,y:480,width:200,height:140,color:'#f6e6a4',text:'Round me'}});
      await page.goto(`${url}/boards/${cb}/`);await page.waitForSelector('#world .workspace-card iframe');await page.waitForTimeout(800);
      await check(`${tag} a click points at the whole thing with its spot and content (page px, image px); text by its words, arrows by their line`,async()=>{
        await page.keyboard.press('p');await until(on);await page.keyboard.press('Alt+KeyP');
        const pageCard=await page.locator(card('A page')).boundingBox(),pic=await page.locator(card('A picture')).boundingBox();
        await page.keyboard.type('this ');await page.mouse.click(pageCard.x+pageCard.width*.3,pageCard.y+pageCard.height*.5);
        await page.keyboard.type('like this ');await page.mouse.click(pic.x+pic.width*.5,pic.y+pic.height*.6);
        await page.keyboard.press('Alt+KeyM');await page.keyboard.type('part ');
        await page.mouse.move(pic.x+40,pic.y+80);await page.mouse.down();await page.mouse.move(pic.x+200,pic.y+180,{steps:6});await page.mouse.up();
        const head=await page.locator('#world [data-decoration="head"]').boundingBox();
        await page.keyboard.type(' beside the heading ');await page.mouse.move(head.x+300,head.y+5);await page.mouse.down();await page.mouse.move(head.x+500,head.y+head.height-5,{steps:5});await page.mouse.up();
        const arr=await page.locator('#world [data-decoration="arr"]').boundingBox();
        await page.keyboard.type(' across the arrow ');await page.mouse.move(arr.x+arr.width/2-15,arr.y-10);await page.mouse.down();await page.mouse.move(arr.x+arr.width/2+15,arr.y+arr.height+10,{steps:5});await page.mouse.up();
        await page.keyboard.type(' off its line ');await page.mouse.move(arr.x+arr.width*.75,arr.y+2);await page.mouse.down();await page.mouse.move(arr.x+arr.width-2,arr.y+arr.height*.35,{steps:5});await page.mouse.up();
        // the laser: a slow circle (about 2.5 s) round the sticky
        const stk=await page.locator('#world [data-decoration="stk"]').boundingBox(),cx=stk.x+stk.width/2,cy=stk.y+stk.height/2,rx=stk.width*.62,ry=stk.height*.62;
        await page.keyboard.press('Alt+KeyK');await page.keyboard.type(' round ');
        await page.mouse.move(cx+rx,cy);await page.mouse.down();for(let d=0;d<=380;d+=10){await page.mouse.move(cx+rx*Math.cos(d*Math.PI/180),cy+ry*Math.sin(d*Math.PI/180));await page.waitForTimeout(65);}await page.mouse.up();
        const all=await chips();
        assert.equal(all.length,7,`seven chips: ${all}`);
        assert.match(all[3],/Board area/,'beside the heading\'s words is the board');assert.match(all[4],/Arrow/);assert.match(all[5],/Board area/,'off the arrow\'s line is the board');
        assert.match(all[6],/Round me/);
        const tips=await field.locator('.pointing-chip').evaluateAll(cs=>cs.map(c=>c.dataset.tip));
        assert.ok(!/^Part of/.test(tips[0])&&!/^Part of/.test(tips[1]),`clicks are whole: ${tips}`);assert.ok(!/^Part of/.test(tips[6]),`the circle is the whole sticky: ${tips[6]}`);
        await page.keyboard.press('Enter');
        const t=await until(async()=>(await listFeedback(config,{boardId:cb,includeBodies:true})).threads.find(x=>x.pointing));
        const [m1,m2,m3]=t.pointing.marks,a=m1.targets[0],b=m2.targets[0],part=m3.targets[0];
        assert.equal(a.whole,true);assert.ok(a.spot.x>.25&&a.spot.x<.35,`spot ${JSON.stringify(a.spot)}`);
        assert.equal(a.content.unit,'px');assert.match(a.content.of,/^page \d+ px wide$/);assert.equal(a.content.w,0);
        assert.equal(b.whole,true);assert.equal(b.content.of,'image 400 × 200 px');assert.ok(b.content.x>150&&b.content.x<250,`image x ${b.content.x}`);
        assert.equal(part.whole,false);assert.equal(part.content.unit,'px');assert.ok(part.content.w>0&&part.content.x+part.content.w<=400);
        await page.keyboard.press('Escape');await until(async()=>!(await on()));
        // the open thread card sits clear of its marks' numbers, parts and spots
        await page.evaluate(id=>{location.hash=`#comments/${encodeURIComponent(id)}`;},t.id);await page.locator('.ct-card').waitFor();
        await until(async()=>(await page.locator('.pointing-marks .pointing-badge').count())===7);await page.waitForTimeout(600);
        const over=await page.evaluate(()=>{const c=document.querySelector('.ct-card').getBoundingClientRect();return [...document.querySelectorAll('.pointing-marks :is(.pointing-shape:not(.pointing-outline),.pointing-badge,.pointing-dot)')].map(e=>e.getBoundingClientRect()).filter(m=>m.width&&m.right>c.left&&m.left<c.right&&m.bottom>c.top&&m.top<c.bottom).length;});
        await page.screenshot({path:path.join(evidence,`pointing-card-clear-${width}.png`)});
        assert.equal(over,0,'the card covers no mark');
        await page.keyboard.press('Escape');
      });
    }
    assert.deepEqual(errors,[],`${tag} page errors`);
    await context.close();
  }
}finally{await browser?.close();if(server)await closeAppServer(server);if(!process.env.TINKA_EVIDENCE_DIR)await rm(fixture,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
for(const r of results)console.log(`${r.pass?'PASS':'FAIL'}  ${r.name}${r.error?'  -- '+r.error:''}`);
const failed=results.filter(r=>!r.pass).length;console.log(JSON.stringify({passed:results.length-failed,failed,evidence}));
process.exit(failed?1:0);
