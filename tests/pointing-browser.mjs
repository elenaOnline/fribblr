// Pointing mode (pointing-mode.js) on a real board page, driven with a real pointer and keyboard: P enters, typing and
// pointing interleave (marquee, lasso, point, the laser's circle, @), chips land at the caret, Backspace and Undo take
// a chip and its mark away and back, the board is never selected or edited, Enter sends one thread to the agent with
// the pointing record, Escape leaves with the view and selection as they were, and the sent thread's card reads as
// her sentence with chips. Light at 1280 and a phone at 390. Isolated fixture, headless, port 0.
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
const fixture=await mkdtemp(path.join(os.tmpdir(),'tinka-pointing-'));
const evidence=process.env.TINKA_EVIDENCE_DIR||path.join(fixture,'evidence');await mkdir(evidence,{recursive:true});
const MOD=process.platform==='darwin'?'Meta':'Control';
let server,browser,config,url;const results=[];
const until=async(fn,ms=5000)=>{const end=Date.now()+ms;let last;while(Date.now()<end){try{last=await fn();if(last)return last;}catch(e){last=e;}await new Promise(r=>setTimeout(r,80));}return last;};
async function check(name,body){try{await body();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:String(e.message).split('\n').slice(0,8).join(' | ')});}}
try{
  const configFile=path.join(fixture,'local/config.json');
  await main(['init','--config',configFile,'--boards',path.join(fixture,'boards'),'--label','Pointing fixture']);
  config=await loadConfig(configFile);
  server=createAppServer(config);await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,args:['--mute-audio'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  for(const width of [1280,390]){
    const boardId=(await applyOperation(config,{type:'createBoard',title:`Pointing ${width}`})).result.boardId;
    // On a phone the three cards stand in a column, so all of them are on screen.
    const narrow=width<600,R=narrow?110:150;
    for(const [i,title] of ['Login mock','Hero B','Pricing'].entries())await applyOperation(config,{type:'createItem',boardId,item:{title},placement:narrow?{x:0,y:i*200,width:220,height:160}:{x:i*260,y:0,width:220,height:170}});
    await applyOperation(config,{type:'createDecoration',boardId,decoration:{id:'note1',type:'region',shape:'rectangle',x:narrow?240:0,y:narrow?0:240,width:narrow?120:160,height:120,color:'#f6e6a4',text:'A sticky'}});
    const context=await browser.newContext({viewport:{width,height:width>600?860:800},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
    page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
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
      assert.equal(all.length,2,`two chips: ${all}`);assert.match(all[0],/^1\s*Login mock/);assert.match(all[1],/^2\s*Hero B/);
      assert.match((await field.textContent()).replace(/\s+/g,' '),/^change this 1 ?Login mock to look more like this 2 ?Hero B please$/);
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
      assert.equal(all.length,5,`five chips: ${all}`);assert.match(all[2],/^3\s*Pricing/);assert.match(all[3],/^4\s*A sticky|^4\s*Sticky/);assert.match(all[4],/^5\s*Pricing/);
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
      for(const m of p.marks){assert.equal(m.crop,null);assert.ok(m.cropNote);assert.ok(m.end>=m.at);}
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
    assert.deepEqual(errors,[],`${tag} page errors`);
    await context.close();
  }
}finally{await browser?.close();if(server)await closeAppServer(server);if(!process.env.TINKA_EVIDENCE_DIR)await rm(fixture,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
for(const r of results)console.log(`${r.pass?'PASS':'FAIL'}  ${r.name}${r.error?'  -- '+r.error:''}`);
const failed=results.filter(r=>!r.pass).length;console.log(JSON.stringify({passed:results.length-failed,failed,evidence}));
process.exit(failed?1:0);
