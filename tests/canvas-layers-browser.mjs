// Headless checks of a board saved before the shared stacking order: its drawings
// have no z, and its cards' z is a creation count (0, 1, 2 ... 40). Whatever its z, a
// card shows above the regions, containers, shapes, stickies and text saved that way,
// and below the arrows, stickers and comment pins, also inside a group or a container;
// Bring to front / Send to back and new cards still follow the one order. Regions, the
// board background and cards stay reachable by the pointer. Uses only external fixtures.
import './helpers/offline.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from '../cli.mjs';
import {loadConfig} from '../lib/config.mjs';
import {applyOperation,getBoardSnapshot} from '../lib/workspace.mjs';
import {listen,closeAppServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=await mkdtemp(path.join(os.tmpdir(),'tinka-canvas-layers-'));
const evidence=process.env.TINKA_EVIDENCE_DIR||await mkdtemp(path.join(os.tmpdir(),'tinka-canvas-layers-evidence-'));await mkdir(evidence,{recursive:true});
let server,browser,checks=0;const errors=[];
const ok=(value,message)=>{assert.ok(value,message);checks++;};
try{
 const file=path.join(root,'config.json');await main(['init','--config',file,'--boards',path.join(root,'boards'),'--label','Layers studio']);const config=await loadConfig(file);
 const op=async(type,fields)=>(await applyOperation(config,{type,boardId:'layers',...fields})).result;
 await op('createBoard',{id:'layers',title:'Layers'});
 const note=(title,placement)=>op('createItem',{item:{title,content:{kind:'note',text:'Above what is drawn under it.'}},placement}).then(r=>r.placementIds[0]);
 // One row per kind of drawn element, each under four cards whose z spans the range a
 // real board reaches (z is the creation count, so a board of 40 items reaches 39).
 const kinds=[['region',{type:'region'}],['rectangle',{type:'region',shape:'rectangle'}],['rounded',{type:'region',shape:'rounded'}],['ellipse',{type:'region',shape:'ellipse'}],['diamond',{type:'region',shape:'diamond'}],['text',{type:'text'}]];
 const zs=[0,1,2,40],cards={};
 for(const [row,[kind,fields]] of kinds.entries()){
  await op('createDecoration',{decoration:{id:`under-${kind}`,x:0,y:row*240,width:4*300,height:200,color:'#c9b6ea',text:`${kind} under the cards`,...fields}});
  for(const [col,z] of zs.entries())cards[`${kind}/${z}`]=(await op('createItem',{item:{title:`On a ${kind}, z ${z}`,content:{kind:'note',text:'Above what is drawn under it.'}},placement:{x:col*300+20,y:row*240+30,width:240,height:150,z}})).placementIds[0];
 }
 // Above the cards: an arrow across a high-z card, and a comment pinned on it.
 const top=cards['region/40'];
 await op('createDecoration',{decoration:{id:'across',type:'line',x:880,y:20,width:280,height:180,color:'#6c8060',text:'',endArrow:true,from:{x:880,y:20},to:{x:1160,y:200}}});
 const thread=(await op('addComment',{anchor:{kind:'point',x:1020,y:105,placementId:top,relative:{x:.5,y:.5}},author:{id:'human-robin',label:'Robin',kind:'human'},body:'Pinned on a high card'})).threadId;
 // Overlapping cards still stack by their own z.
 const front=(await op('createItem',{item:{title:'Front card',content:{kind:'note',text:'z 3'}},placement:{x:1300,y:0,width:240,height:150,z:3}})).placementIds[0];
 const behind=(await op('createItem',{item:{title:'Card behind',content:{kind:'note',text:'z 2'}},placement:{x:1360,y:60,width:240,height:150,z:2}})).placementIds[0];
 // A sticker on a high card, like an arrow, stays above it, and one on a z 2 card.
 const stuck=await note('Under a sticker, z 40',{x:20,y:1480,width:240,height:150,z:40});
 await op('createDecoration',{decoration:{id:'sticker',type:'text',text:'🚀',sticker:true,x:150,y:1500,width:96,height:96,color:'palette:neutral'}});
 const stuckLow=await note('Under a sticker, z 2',{x:1300,y:1480,width:240,height:150,z:2});
 await op('createDecoration',{decoration:{id:'sticker-low',type:'text',text:'🚀',sticker:true,x:1430,y:1500,width:96,height:96,color:'palette:neutral'}});
 // Grouping a card with a shape it lies on changes membership only, not layers.
 await op('createDecoration',{decoration:{id:'grouped-shape',type:'region',shape:'rounded',x:320,y:1460,width:280,height:200,color:'#c9b6ea',text:''}});
 const grouped=await note('Grouped with its shape, z 0',{x:340,y:1490,width:240,height:150,z:0});
 await op('groupOccurrences',{placementIds:[grouped],decorationIds:['grouped-shape']});
 // A container holding a shape and a card, and a loose card at z 0 lying on its shape.
 await op('createDecoration',{decoration:{id:'held-shape',type:'region',shape:'rectangle',x:0,y:0,width:240,height:150,color:'#c9b6ea',text:''}});
 const held=await note('In a container, z 0',{x:0,y:0,width:240,height:150,z:0});
 await op('createDecoration',{decoration:{id:'holder',type:'region',x:660,y:1460,width:100,height:100,color:'#dbe5d3',text:'Container',container:{layout:'horizontal',children:['held-shape',{placementId:held}]}}});
 const laid=(await getBoardSnapshot(config,'layers')).decorations.find(d=>d.id==='held-shape');
 const loose=await note('Loose on a container shape, z 1',{x:laid.x+40,y:laid.y+25,width:160,height:100,z:1});
 // Saved by Tinka 1.3: no drawing carries a z.
 const boardFiles=path.join(root,'boards','.tinka','boards');
 for(const name of await readdir(boardFiles)){const file=path.join(boardFiles,name),board=JSON.parse(await readFile(file,'utf8'));
  if(board.id!=='layers')continue;for(const drawn of board.decorations)delete drawn.z;await writeFile(file,JSON.stringify(board,null,2));}
 server=await listen(config,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
 const page=await browser.newPage({viewport:{width:1700,height:1900},colorScheme:'light',reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/boards/layers/',{waitUntil:'load'});await page.locator('.workspace-card').first().waitFor();
 if(await page.locator('[data-mode="canvas"]').getAttribute('aria-pressed')!=='true'){await page.locator('#board-info-toggle').click();await page.locator('[data-mode="canvas"]').click();await page.keyboard.press('Escape');}
 await page.locator(`[data-comment-pin="${thread}"]`).waitFor();await page.waitForTimeout(150);
 // What the pointer meets at a point inside an element (its centre, or a fraction of its box).
 const topAt=(selector,fx=.5,fy=.5)=>page.evaluate(([selector,fx,fy])=>{const el=document.querySelector(selector),r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width*fx,r.top+r.height*fy);
  return hit?.closest('[data-comment-pin]')?'pin':hit?.closest('.decoration-line')?'arrow':hit?.closest('[data-placement]')?`card:${hit.closest('[data-placement]').dataset.placement}`:hit?.closest('[data-decoration]')?`decoration:${hit.closest('[data-decoration]').dataset.decoration}`:hit?.id||hit?.tagName;},[selector,fx,fy]);
 const card=id=>`.workspace-card[data-placement="${id}"]`;

 for(const [key,id] of Object.entries(cards))for(const [fx,fy] of [[.5,.5],[.08,.1],[.92,.9]])
  assert.equal(await topAt(card(id),fx,fy),`card:${id}`,`A card stays above the ${key.replace('/',' it lies on, at z ')} (${fx},${fy})`);
 checks++;
 // Regions and shapes stay reachable where no card covers them, and so does the board.
 for(const [kind] of kinds.filter(([kind])=>kind!=='text'))ok(await topAt(`[data-decoration="under-${kind}"]`,.995,.5)===`decoration:under-${kind}`,`The ${kind} is still reachable beside its cards`);
 ok(['world','plane','viewport'].includes(await topAt('[data-decoration="under-region"]',.5,1.1)),'The blank board between rows is still reachable');
 // Arrows and comment pins stay above even a high card.
 ok(await topAt(`[data-comment-pin="${thread}"]`)==='pin',`A comment pin stays above the z 40 card it is pinned on: ${await topAt(`[data-comment-pin="${thread}"]`)}`);
 const onArrow=await page.evaluate(()=>{const p=document.querySelector('[data-decoration="across"] .whiteboard-line-hit'),svg=p.ownerSVGElement,pt=p.getPointAtLength(p.getTotalLength()*.62),[tx,ty]=p.parentNode.getAttribute('transform').match(/-?[\d.]+/g).map(Number),view=svg.viewBox.baseVal,r=svg.getBoundingClientRect();
  const x=r.left+(pt.x+tx)*r.width/view.width,y=r.top+(pt.y+ty)*r.height/view.height,hit=document.elementFromPoint(x,y);return {over:!!hit?.closest('[data-decoration="across"]'),card:document.elementsFromPoint(x,y).some(el=>el.matches?.('.workspace-card'))};});
 ok(onArrow.card&&onArrow.over,`An arrow across a z 40 card stays above it: ${JSON.stringify(onArrow)}`);
 // Cards keep their own order.
 ok(await topAt(card(behind),.2,.2)===`card:${front}`,'Overlapping cards still stack by their z');
 // The card layer moves nothing: a card sits exactly where its board units say.
 // Groups and containers keep the same layers.
 ok(await topAt(card(stuck),.6,.25)==='decoration:sticker',`A sticker stays above the z 40 card it is on: ${await topAt(card(stuck),.6,.25)}`);
 ok(await topAt(card(stuckLow),.6,.25)==='decoration:sticker-low',`A sticker stays above the z 2 card it is on: ${await topAt(card(stuckLow),.6,.25)}`);
 for(const [fx,fy] of [[.5,.5],[.08,.1],[.92,.9]])assert.equal(await topAt(card(grouped),fx,fy),`card:${grouped}`,`A grouped card stays above the shape it is grouped with (${fx},${fy})`);
 checks++;
 for(const [fx,fy] of [[.5,.5],[.08,.1],[.92,.9]])assert.equal(await topAt(card(held),fx,fy),`card:${held}`,`A card in a container stays above the container (${fx},${fy})`);
 checks++;
 ok(await topAt('[data-decoration="held-shape"]',.06,.08)==='decoration:held-shape',`A shape in a container stays above the container, beside the card on it: ${await topAt('[data-decoration="held-shape"]',.06,.08)}`);
 for(const [fx,fy] of [[.5,.5],[.08,.1],[.92,.9]])assert.equal(await topAt(card(loose),fx,fy),`card:${loose}`,`A loose card stays above the container shape it lies on (${fx},${fy})`);
 checks++;
 const offset=await page.evaluate(([c,d])=>{const a=document.querySelector(c).getBoundingClientRect(),b=document.querySelector(d).getBoundingClientRect(),z=new DOMMatrix(getComputedStyle(document.getElementById('world')).transform).a;return {dx:(a.left-b.left)/z,dy:(a.top-b.top)/z};},[card(cards['region/0']),'[data-decoration="under-region"]']);
 ok(Math.abs(offset.dx-20)<.5&&Math.abs(offset.dy-30)<.5,`Cards keep their board position: ${JSON.stringify(offset)}`);
 // A card is still picked up by the pointer through the layer.
 await page.locator(`${card(cards['rounded/0'])} h3 button`).click({modifiers:['Shift']});
 ok(await page.locator(`${card(cards['rounded/0'])}.selected`).count()===1,'A card on a shape is still selectable');
 await page.keyboard.press('Escape');
 // The one order still rules: Bring to front lifts a shape saved without z over its
 // cards, Send to back puts it beneath them again, each as a saved z.
 const shapeAt=async(id,fx,fy)=>{const r=await page.locator(`[data-decoration="${id}"]`).boundingBox();await page.mouse.click(r.x+r.width*fx,r.y+r.height*fy);};
 await shapeAt('under-rounded',.995,.5);await page.keyboard.press(']');
 await page.waitForFunction(id=>document.elementFromPoint(...(r=>[r.left+r.width/2,r.top+r.height/2])(document.querySelector(`.workspace-card[data-placement="${id}"]`).getBoundingClientRect()))?.closest('[data-decoration="under-rounded"]'),cards['rounded/40']);
 ok(await topAt(card(cards['rounded/40']))==='decoration:under-rounded','Bring to front lifts a shape saved without z above the z 40 card on it');
 await page.keyboard.press('[');
 await page.waitForFunction(id=>document.elementFromPoint(...(r=>[r.left+r.width/2,r.top+r.height/2])(document.querySelector(`.workspace-card[data-placement="${id}"]`).getBoundingClientRect()))?.closest(`[data-placement="${id}"]`),cards['rounded/0']);
 ok(await topAt(card(cards['rounded/0']))===`card:${cards['rounded/0']}`,'Send to back puts the shape beneath its z 0 card again');
 ok(Number.isFinite((await getBoardSnapshot(config,'layers')).decorations.find(d=>d.id==='under-rounded').z),'The restacked shape now has a saved z');
 // A new card lands on top, over the arrow saved without z.
 const fresh=(await op('createItem',{item:{title:'New card under the arrow',content:{kind:'note',text:'Lands on top.'}},placement:{x:1040,y:121,width:120,height:80}})).placementIds[0];
 await page.reload({waitUntil:'load'});await page.locator(card(fresh)).waitFor();await page.waitForTimeout(150);
 ok(await topAt(card(fresh),.5,.5)===`card:${fresh}`,`A new card lands on top of the arrow across it: ${await topAt(card(fresh),.5,.5)}`);
 await page.screenshot({path:path.join(evidence,'canvas-layers.png')});
 assert.deepEqual(errors,[]);checks++;
 console.log(JSON.stringify({passed:true,checks,evidence}));
}finally{
 await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true});
}
