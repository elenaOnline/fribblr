// Headless checks of how cards and drawn elements layer on Canvas under the board's one
// stacking order (public/stacking.js, Tinka 1.4). Cards share the drawings' order: there is
// no separate card layer, so Bring to front and Send to back move a drawing over or under a
// card. On a board saved before 1.4 (drawn elements without a stored z) a card stays above
// the region it lies on at any z, and above a shape or text from z 1; a comment pin stays
// above a high card; overlapping cards keep their own order; cards keep their board position
// and regions, the board and cards stay reachable by the pointer. Uses only external fixtures.
import './helpers/offline.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from '../cli.mjs';
import {loadConfig} from '../lib/config.mjs';
import {applyOperation} from '../lib/workspace.mjs';
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
 // One row per kind of drawn element, each under cards whose z spans the range a board saved
 // before 1.4 reaches (z was the creation count, so a board of 40 items reaches 39).
 const kinds=[['region',{type:'region'}],['rectangle',{type:'region',shape:'rectangle'}],['rounded',{type:'region',shape:'rounded'}],['ellipse',{type:'region',shape:'ellipse'}],['diamond',{type:'region',shape:'diamond'}],['text',{type:'text'}]];
 const zs=[0,1,2,40],cards={};
 for(const [row,[kind,fields]] of kinds.entries()){
  await op('createDecoration',{decoration:{id:`under-${kind}`,x:0,y:row*240,width:4*300,height:200,color:'#c9b6ea',text:`${kind} under the cards`,...fields}});
  for(const [col,z] of zs.entries())cards[`${kind}/${z}`]=await note(`On a ${kind}, z ${z}`,{x:col*300+20,y:row*240+30,width:240,height:150,z});
 }
 // An arrow and a sticker across a high card, and a comment pinned on it.
 const top=cards['region/40'];
 await op('createDecoration',{decoration:{id:'across',type:'line',x:880,y:20,width:280,height:180,color:'#6c8060',text:'',endArrow:true,from:{x:880,y:20},to:{x:1160,y:200}}});
 await op('createDecoration',{decoration:{id:'sticker',type:'text',text:'🚀',sticker:true,x:1100,y:40,width:80,height:80,color:'palette:neutral'}});
 const thread=(await op('addComment',{anchor:{kind:'point',x:1020,y:105,placementId:top,relative:{x:.5,y:.5}},author:{id:'human-robin',label:'Robin',kind:'human'},body:'Pinned on a high card'})).threadId;
 // Overlapping cards still stack by their own z.
 const front=await note('Front card',{x:1300,y:0,width:240,height:150,z:3});
 const behind=await note('Card behind',{x:1360,y:60,width:240,height:150,z:2});
 // Saved before 1.4: drawn elements carry no z and keep their former level.
 const boards=path.join(config.boardsRoot,'.tinka/boards');
 for(const name of await readdir(boards)){const at=path.join(boards,name),board=JSON.parse(await readFile(at,'utf8'));if(board.id!=='layers')continue;for(const d of board.decorations||[])delete d.z;await writeFile(at,JSON.stringify(board,null,2));}
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
 const onArrow=()=>page.evaluate(()=>{const p=document.querySelector('[data-decoration="across"] .whiteboard-line-hit'),svg=p.ownerSVGElement,pt=p.getPointAtLength(p.getTotalLength()*.62),t=p.parentNode.getAttribute('transform'),[tx,ty]=t?t.match(/-?[\d.]+/g).map(Number):[0,0],view=svg.viewBox.baseVal,r=svg.getBoundingClientRect();
  const x=r.left+(pt.x+tx)*r.width/view.width,y=r.top+(pt.y+ty)*r.height/view.height,hit=document.elementFromPoint(x,y);return {over:!!hit?.closest('[data-decoration="across"]'),card:document.elementsFromPoint(x,y).some(el=>el.matches?.('.workspace-card'))};});

 // No card layer: cards paint in #world's one order with the drawings.
 eq(await page.evaluate(()=>{const s=getComputedStyle(document.querySelector('#world > .workspace-cards'));return [s.position,s.zIndex];}),['static','auto'],'Cards share the drawings’ stacking order (no card layer)');
 for(const z of zs)for(const [fx,fy] of [[.5,.5],[.08,.1],[.92,.9]])
  assert.equal(await topAt(card(cards[`region/${z}`]),fx,fy),`card:${cards[`region/${z}`]}`,`A card stays above the region it lies on, at z ${z} (${fx},${fy})`);
 checks++;
 for(const [kind] of kinds.slice(1))for(const z of [1,2,40])
  assert.equal(await topAt(card(cards[`${kind}/${z}`])),`card:${cards[`${kind}/${z}`]}`,`A card at z ${z} stays above the ${kind} it lies on`);
 checks++;
 // Regions and shapes stay reachable where no card covers them, and so does the board.
 for(const [kind] of kinds.filter(([kind])=>kind!=='text'))ok(await topAt(`[data-decoration="under-${kind}"]`,.995,.5)===`decoration:under-${kind}`,`The ${kind} is still reachable beside its cards`);
 ok(['world','plane','viewport'].includes(await topAt('[data-decoration="under-region"]',.5,1.1)),'The blank board between rows is still reachable');
 ok(await topAt(`[data-comment-pin="${thread}"]`)==='pin',`A comment pin stays above the z 40 card it is pinned on: ${await topAt(`[data-comment-pin="${thread}"]`)}`);
 ok(await topAt(card(behind),.2,.2)===`card:${front}`,'Overlapping cards still stack by their z');
 const offset=await page.evaluate(([c,d])=>{const a=document.querySelector(c).getBoundingClientRect(),b=document.querySelector(d).getBoundingClientRect(),z=new DOMMatrix(getComputedStyle(document.getElementById('world')).transform).a;return {dx:(a.left-b.left)/z,dy:(a.top-b.top)/z};},[card(cards['region/0']),'[data-decoration="under-region"]']);
 ok(Math.abs(offset.dx-20)<.5&&Math.abs(offset.dy-30)<.5,`Cards keep their board position: ${JSON.stringify(offset)}`);
 await page.locator(`${card(cards['rounded/2'])} h3 button`).click({modifiers:['Shift']});
 ok(await page.locator(`${card(cards['rounded/2'])}.selected`).count()===1,'A card on a shape is still selectable');
 await page.keyboard.press('Escape');

 // One order: Bring to front puts a drawing over the cards on it, Send to back under them again.
 const restack=async(decorationIds,to)=>{await applyOperation(config,{type:'restackOccurrences',boardId:'layers',decorationIds,to});await page.reload({waitUntil:'load'});await page.locator(`[data-comment-pin="${thread}"]`).waitFor();await page.waitForTimeout(150);};
 await restack(['under-rectangle','across','sticker'],'front');
 ok(await topAt(card(cards['rectangle/40']))==='decoration:under-rectangle','A shape brought to front covers the z 40 card on it');
 const arrow=await onArrow();ok(arrow.card&&arrow.over,`An arrow brought to front is above the z 40 card it crosses: ${JSON.stringify(arrow)}`);
 ok(await topAt('[data-decoration="sticker"]')==='decoration:sticker','A sticker brought to front is above the z 40 card');
 ok(await topAt(`[data-comment-pin="${thread}"]`)==='pin','Pins stay above everything restacked');
 await restack(['under-rectangle'],'back');
 for(const z of zs)assert.equal(await topAt(card(cards[`rectangle/${z}`])),`card:${cards[`rectangle/${z}`]}`,`A shape sent to back is under the z ${z} card on it`);
 checks++;
 await page.screenshot({path:path.join(evidence,'canvas-layers.png')});
 assert.deepEqual(errors,[]);checks++;
 console.log(JSON.stringify({passed:true,checks,evidence}));
}finally{
 await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true});
}
function eq(a,b,m){assert.deepEqual(a,b,m);checks++;}
