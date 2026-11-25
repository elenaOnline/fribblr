// Headless check: an opened Tinka's fitted view is the floor of its zoom. Zooming out at the floor goes back to the board
// it lives on, by every input at the same threshold (one zoom step below fit): a wheel notch, a Control-wheel or pinch
// gesture that would shrink it by a fifth, − and the pill's − button. A gesture that reaches fit from above stops there; a
// held − never leaves. The board comes back as she opened it from (or, when the card isn't in that view, at that zoom with
// the card centred), the card selected and focused; Enter opens it again, and Escape then returns to the same view. Expand fills the stage (past 100%), makes the floor a wall (− aria-disabled, nothing zooms out or leaves),
// and ends by its toggle, by the path (Up) or by Escape, one layer. The same for an item that owns a board, after
// stepping, and from a direct link. External fixtures only (ui-sdk.md § Opened item).
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {main} from '../cli.mjs';
import {loadConfig} from '../lib/config.mjs';
import {applyOperation} from '../lib/workspace.mjs';
import {listen,closeAppServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
function png(width,height){
 const table=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
 const crc=bytes=>{let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
 const chunk=(type,data)=>{const length=Buffer.alloc(4),sum=Buffer.alloc(4),body=Buffer.concat([Buffer.from(type),data]);length.writeUInt32BE(data.length);sum.writeUInt32BE(crc(body));return Buffer.concat([length,body,sum]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const row=Buffer.alloc(1+width*3);for(let x=0;x<width;x++)row.set([60+x%180,140,90],1+x*3);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(Buffer.concat(Array(height).fill(row)))),chunk('IEND',Buffer.alloc(0))]);
}
const root=await mkdtemp(path.join(os.tmpdir(),'tinka-zoom-out-'));
let server,browser,checks=0;const errors=[];
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
try{
 const file=path.join(root,'config.json');await main(['init','--config',file,'--boards',path.join(root,'boards'),'--label','Zoom studio']);const config=await loadConfig(file);
 const op=async(type,fields)=>(await applyOperation(config,{type,...fields})).result;
 const assets=path.join(config.boardsRoot,'assets');await mkdir(assets);
 await writeFile(path.join(assets,'small.png'),png(600,400));
 await writeFile(path.join(assets,'note.md'),'# A short note\n\nOne paragraph.');
 await op('updateWorkspace',{patch:{resourceRoots:{assets:{path:'../assets'}}}});
 await op('createBoard',{id:'zb',title:'Zoom board'});
 await op('createBoard',{id:'zb-kit',title:'Kit parts'});
 const res=p=>({rootId:'assets',path:p});
 const image=await op('createItem',{boardId:'zb',item:{title:'Small picture',content:{kind:'image',resource:res('small.png')}},placement:{x:0,y:0,width:420,height:320,presentation:{mode:'panel'}}});
 const doc=await op('createItem',{boardId:'zb',item:{title:'Short note',content:{kind:'markdown',resource:res('note.md')}},placement:{x:480,y:0,width:360,height:260}});
 const owner=await op('createItem',{boardId:'zb',item:{title:'Starter kit',childBoardId:'zb-kit',content:{kind:'markdown',resource:res('note.md')}},placement:{x:900,y:0,width:360,height:260}});
 const [imageId,docId,ownerId]=[image,doc,owner].map(r=>r.placementIds[0]);
 server=await listen(config,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
 const page=await (await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'})).newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const plane=()=>page.evaluate(()=>{const m=new DOMMatrix(getComputedStyle(document.getElementById('reader-plane')).transform);return {zoom:m.a,x:Math.round(m.e),y:Math.round(m.f)};});
 const isOpen=()=>page.locator('#reader-dialog').evaluate(d=>d.open);
 const name=()=>page.locator('#reader-name').textContent().then(t=>t.trim());
 const card=id=>page.locator(`#world .workspace-card[data-placement="${id}"]`);
 const ready=()=>page.waitForFunction(()=>{const f=document.querySelector('#active-reader');const d=f?.contentDocument?.querySelector('iframe')?.contentDocument||f?.contentDocument;return d&&d.readyState==='complete'&&(d.querySelector('.image-stage img')?.complete||d.querySelector('.markdown p'));},null,{timeout:10000}).then(()=>page.waitForTimeout(200));
 const board=async()=>{await page.goto(`${base}/boards/zb/`,{waitUntil:'load'});await card(imageId).waitFor();await page.waitForTimeout(300);};
 // The board's view: the plane's pan and the world's zoom.
 const boardView=()=>page.evaluate(()=>({plane:getComputedStyle(document.getElementById('plane')).transform,world:getComputedStyle(document.getElementById('world')).transform}));
 const boardZoom=()=>page.evaluate(()=>new DOMMatrix(getComputedStyle(document.getElementById('world')).transform).a);
 let opened=null;  // the board view the reader was last opened from
 const openFromBoard=async id=>{opened=await boardView();await card(id).focus();await page.keyboard.press('Enter');await page.locator('#reader-dialog[open]').waitFor();await ready();};
 const stageCentre=async()=>{const s=await page.locator('#reader-stage').boundingBox();return [s.x+s.width/2,s.y+s.height/2];};
 // A Control-wheel event of deltaY (a mouse notch is 100, clipped to the 1.35× step; a trackpad pinch sends a few units).
 const ctrlWheel=async(dy,gap=30)=>{await page.keyboard.down('Control');await page.mouse.wheel(0,dy);await page.keyboard.up('Control');await page.waitForTimeout(gap);};
 const newGesture=()=>page.waitForTimeout(400);  // longer than GESTURE_GAP
 // The opened item's leave band (inside its dialog): opacity and the top strip's scale (its width over the 12 px maximum).
 const band=()=>page.evaluate(()=>{const b=document.querySelector('#reader-dialog .leave-band');if(!b)return {opacity:0,scale:0};const top=b.querySelector('[data-edge="top"]');return {opacity:+(+getComputedStyle(b).opacity).toFixed(3),scale:+(+new DOMMatrix(getComputedStyle(top).transform).d).toFixed(3)};});
 // The landing: the board, the card selected, focused and in view. 'same': the board view she opened from, unchanged.
 // 'centred': that view's zoom, the card centred (it wasn't in that view). 'direct': no board view of hers, the board's
 // opening zoom (never above 100%), the card centred. Nothing zooms in.
 const sheetBox=()=>page.locator('#reader-window').boundingBox();
 const landed=async(id,expect,label,zoomBefore)=>{
  await page.locator('#reader-dialog').waitFor({state:'hidden'});
  await page.waitForFunction(id=>document.activeElement?.closest?.('.workspace-card')?.dataset.placement===id,id,{timeout:3000}).catch(()=>{});
  const s=await page.evaluate(id=>{const c=document.querySelector(`#world .workspace-card[data-placement="${id}"]`),r=c.getBoundingClientRect(),v=document.getElementById('viewport').getBoundingClientRect();
   return {selected:c.classList.contains('selected'),focus:document.activeElement?.closest?.('.workspace-card')?.dataset.placement||null,dx:Math.abs(r.x+r.width/2-(v.x+v.width/2)),dy:Math.abs(r.y+r.height/2-(v.y+v.height/2)),inView:r.left>=v.left-1&&r.top>=v.top-1&&r.right<=v.right+1&&r.bottom<=v.bottom+1};},id);
  ok(s.selected,`${label}: the card is selected on the board`);
  eq(s.focus,id,`${label}: focus is on the card`);
  ok(s.inView,`${label}: the card is in view`);
  if(expect==='same')eq(await boardView(),opened,`${label}: the board is the view she opened it from`);
  else{
   ok(s.dx<3&&s.dy<3,`${label}: the card is centred (${s.dx.toFixed(1)}, ${s.dy.toFixed(1)} px off)`);
   const z=await boardZoom();
   if(expect==='centred')ok(Math.abs(z-zoomBefore)<1e-3,`${label}: the zoom she opened from stays (${z.toFixed(3)})`);
   else ok(z<=1+1e-6,`${label}: the board's opening zoom, never above 100% (${z.toFixed(3)})`);
  }
 };

 // (1) Wheel: a fast Control-wheel run from 300% stops at fit; a fresh notch at fit leaves.
 await board();await openFromBoard(imageId);
 const fit=await plane();eq(Math.round(fit.zoom*100),100,'A 600 × 400 picture fits at 100%');
 const [cx,cy]=await stageCentre();await page.mouse.move(cx,cy);
 for(let i=0;i<4;i++)await ctrlWheel(-100);
 ok((await plane()).zoom>2.5,'Control-wheel zooms in');
 for(let i=0;i<12;i++)await ctrlWheel(100);
 ok(await isOpen(),'A wheel run from 300% does not leave in the same gesture');
 eq((await plane()).zoom,fit.zoom,'It stops at fit: no zoom below fit');
 eq(await page.locator('#reader-zoom-slider').evaluate(i=>i.min===i.value),true,'The slider starts at the fitted view');
 ok(await page.locator('#reader-zoom-minus').getAttribute('aria-disabled')!=='true','At fit, − is available (it goes back to the board)');
 await page.locator('#reader-zoom-toggle').click();await page.locator('#reader-zoom-menu').waitFor({state:'visible'});
 eq(await page.locator('#reader-zoom-menu [data-reader-zoom="0.5"]').getAttribute('aria-disabled'),'true','Zoom to 50% is unavailable below fit');
 await page.locator('#reader-zoom-menu [data-reader-zoom="0.5"]').click({force:true});
 ok(await isOpen()&&(await plane()).zoom===fit.zoom,'Pressing it changes nothing');
 await page.keyboard.press('Escape');await page.locator('#reader-zoom-menu').waitFor({state:'hidden'});
 await page.mouse.move(cx,cy);await newGesture();
 // The leave band: a mouse-wheel notch at fit shows it half way (one of two steps); the next notch leaves.
 eq(await band(),{opacity:0,scale:0},'No leave band above the floor or at rest');
 await ctrlWheel(100);
 ok(await isOpen(),'The first notch at fit does not leave');
 {const b=await band();ok(Math.abs(b.opacity-.6)<.01&&Math.abs(b.scale-7/12)<.01,`…it shows the leave band half way (${JSON.stringify(b)})`);}
 await ctrlWheel(100);
 await landed(imageId,'same','Wheel notch');
 // Enter opens it again: zooming out and opening are each other's reverse.
 await page.keyboard.press('Enter');await page.locator('#reader-dialog[open]').waitFor();
 eq(await name(),'Small picture','Enter on the landed card opens it again');
 await ready();
 await page.locator('#reader-stage').focus();await page.keyboard.press('Escape');await page.locator('#reader-dialog').waitFor({state:'hidden'});
 eq(await boardView(),opened,'Enter then Escape returns to the board view, not a zoomed-in one');
 await openFromBoard(imageId);

 // (2) Pinch as Control-wheel (Chrome's trackpad pinch): the band grows with the pinch, recedes when it reverses and
 // goes when it ends below the threshold; a third smaller leaves.
 await page.mouse.move(cx,cy);await newGesture();
 await ctrlWheel(8);const b1=await band();await ctrlWheel(8);const b2=await band();
 ok(await isOpen(),'A small pinch at fit (about 15%) stays');
 eq((await plane()).zoom,fit.zoom,'…and nothing moves under it');
 ok(b1.opacity>0&&b2.opacity>b1.opacity&&b2.scale>b1.scale,`The band grows with the pinch (${b1.opacity.toFixed(2)} → ${b2.opacity.toFixed(2)})`);
 await ctrlWheel(-8);const b3=await band();
 ok(b3.opacity<b2.opacity&&Math.abs(b3.opacity-b1.opacity)<.01,'Reversing the pinch makes it recede');eq((await plane()).zoom,fit.zoom,'…before anything zooms in');
 await newGesture();eq((await band()).opacity,0,'The pinch ending below the threshold drops the band');
 for(let i=0;i<5;i++)await ctrlWheel(8);
 ok(await isOpen()&&(await band()).opacity>.8,'Five pinch steps (about 33%) fill it nearly to the threshold');
 await ctrlWheel(8);
 await landed(imageId,'same','Pinch (Control-wheel)');
 eq((await band()).opacity,0,'Leaving clears the band');

 // (3) Touch pinch on the stage (pointer events) and Safari's gesture events.
 await openFromBoard(imageId);
 const pinch=(from,to)=>page.locator('#reader-stage').evaluate((el,[from,to])=>{
  const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+40;
  const send=(type,id,px)=>el.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',isPrimary:id===21,clientX:px,clientY:y,bubbles:true,cancelable:true}));
  send('pointerdown',21,x-from/2);send('pointerdown',22,x+from/2);
  for(let k=1;k<=4;k++){const d=from+(to-from)*k/4;send('pointermove',21,x-d/2);send('pointermove',22,x+d/2);}
  send('pointerup',21,x-to/2);send('pointerup',22,x+to/2);
 },[from,to]);
 await pinch(200,500);ok((await plane()).zoom>2,'Spreading two fingers zooms in');
 await pinch(500,100);
 ok(await isOpen(),'A pinch from 250% to below fit stops at fit');
 eq((await plane()).zoom,fit.zoom,'…at the fitted view');
 await newGesture();await pinch(200,180);ok(await isOpen(),'A slight pinch at fit stays');
 await newGesture();await pinch(200,150);ok(await isOpen(),'A pinch a quarter smaller stays (it takes a third)');
 eq((await band()).opacity,0,'…and lifting the fingers drops the band at once');
 await newGesture();await pinch(200,120);
 await landed(imageId,'same','Touch pinch');
 await openFromBoard(imageId);
 
 await page.locator('#reader-stage').evaluate(el=>{el.dispatchEvent(new Event('gesturestart',{cancelable:true}));const r=el.getBoundingClientRect();el.dispatchEvent(Object.assign(new Event('gesturechange',{cancelable:true}),{scale:.6,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));});
 await landed(imageId,'same','Safari pinch');

 // (4) −: a press that reaches fit stops there; at fit a press shows the band, the next leaves; a held − never leaves.
 await openFromBoard(imageId);
 await page.keyboard.press('=');await page.keyboard.press('=');
 await page.keyboard.press('-');await page.keyboard.press('-');
 ok(await isOpen(),'− back down to fit stays open');eq((await plane()).zoom,fit.zoom,'…at fit');
 await page.keyboard.press('=');await page.keyboard.press('=');
 for(let i=0;i<6;i++)await page.keyboard.down('-');await page.keyboard.up('-');
 ok(await isOpen(),'A held − stops at fit and never leaves');eq((await plane()).zoom,fit.zoom,'…at fit');
 await page.keyboard.press('-');ok(await isOpen()&&Math.abs((await band()).opacity-.6)<.01,'A press at fit shows the band half way');
 eq(await page.locator('#reader-view-announce').textContent(),'Zoom out again to go back to the board','…announced once, not replaced by a zoom readout');
 await page.keyboard.press('=');eq((await band()).opacity,0,'+ clears it');eq((await plane()).zoom,fit.zoom,'…without zooming in');
 await page.keyboard.press('-');await page.keyboard.press('-');
 await landed(imageId,'same','− key');

 // (5) The zoom control: the pill's − stops at fit, and at fit goes back to the board.
 await openFromBoard(imageId);
 await page.locator('#reader-zoom-plus').click();await page.locator('#reader-zoom-plus').click();
 await page.locator('#reader-zoom-minus').click();await page.locator('#reader-zoom-minus').click();
 ok(await isOpen(),'The − button above fit zooms to fit and stops');eq((await plane()).zoom,fit.zoom,'…at fit');
 await page.locator('#reader-zoom-minus').click();ok(await isOpen()&&(await band()).opacity>0,'A click at fit shows the band');
 await page.locator('#reader-zoom-minus').click();
 await landed(imageId,'same','− button');

 // (6) Expand: fills the stage; zooming out is unavailable and leaves nothing; the toggle and Escape turn it off.
 await openFromBoard(imageId);
 const expand=page.locator('#reader-expand');
 eq(await expand.getAttribute('aria-pressed'),'false','Expand starts off');
 eq(await page.locator('#reader-header .chrome-actions #reader-expand').count(),1,'Expand is in the Tinka actions toolbar');
 eq(await expand.getAttribute('aria-keyshortcuts'),'Shift+F','Expand declares Shift+F');
 const announced=()=>page.locator('#reader-view-announce').textContent();
 await expand.click();
 eq(await expand.getAttribute('aria-pressed'),'true','Expand is pressed');
 eq(await announced(),'Expanded: zoom out is off','Turning Expand on is announced, so it is never a silent toggle');
 const big=await plane(),stage=await page.locator('#reader-stage').boundingBox(),win=await sheetBox();
 ok(big.zoom>1.5,`Expanded, the small picture is magnified past 100% (${Math.round(big.zoom*100)}%)`);
 const pill=await page.locator('#reader-dialog .reader-footer .zoom-pill').boundingBox();
 ok(win.y+win.height<=pill.y+1,`…and stops above the zoom pill (window bottom ${Math.round(win.y+win.height)}, pill top ${Math.round(pill.y)})`);
 ok(Math.abs(win.height-(stage.height-pill.height-20))<4||Math.abs(win.width-stage.width)<4,'…filling the stage above it (the pill and its gap)');
 eq(await page.locator('#reader-zoom-minus').getAttribute('aria-disabled'),'true','Expanded at its size, − is unavailable (aria-disabled)');
 await page.mouse.move(cx,cy);await newGesture();
 for(let i=0;i<3;i++)await ctrlWheel(100);
 ok(await isOpen(),'Expanded, Control-wheel out does not leave');eq((await band()).opacity,0,'…and shows no leave band');eq((await plane()).zoom,big.zoom,'…and does not zoom out');
 await page.locator('#reader-stage').focus();
 await page.keyboard.press('-');ok(await isOpen()&&(await plane()).zoom===big.zoom,'− does nothing');
 await page.locator('#reader-zoom-minus').click({force:true});ok(await isOpen()&&(await plane()).zoom===big.zoom,'Pressing the − button does nothing');
 await page.locator('#reader-stage').evaluate(el=>{el.dispatchEvent(new Event('gesturestart',{cancelable:true}));el.dispatchEvent(Object.assign(new Event('gesturechange',{cancelable:true}),{scale:.5,clientX:700,clientY:450}));});
 ok(await isOpen()&&(await plane()).zoom===big.zoom,'A pinch does nothing');
 await page.locator('#reader-stage').focus();
 await page.keyboard.press('=');ok((await plane()).zoom>big.zoom,'Zooming in still works');
 ok(await page.locator('#reader-zoom-minus').getAttribute('aria-disabled')!=='true','…and − is available again above the expanded size');
 await page.keyboard.press('-');await page.keyboard.press('-');
 ok(await isOpen(),'− comes back down to the expanded size and stops');eq((await plane()).zoom,big.zoom,'…at the expanded size');
 await expand.click();
 eq(await expand.getAttribute('aria-pressed'),'false','The toggle again turns Expand off');
 eq(await announced(),'Expand off','Turning it off is announced');
 eq((await plane()).zoom,fit.zoom,'…back to the fitted view');
 ok(await page.locator('#reader-zoom-minus').getAttribute('aria-disabled')!=='true','…and − is available again');
 await page.locator('#reader-stage').focus();await page.keyboard.press('Shift+F');
 eq(await expand.getAttribute('aria-pressed'),'true','Shift+F turns Expand on');
 eq(await announced(),'Expanded: zoom out is off','…announced, by key as by the button');
 await page.keyboard.press('j');await page.waitForFunction(()=>document.querySelector('#reader-name').textContent.trim()!=='Small picture');
 eq(await expand.getAttribute('aria-pressed'),'true','Expand stays on while stepping');
 await page.keyboard.press('k');await page.waitForFunction(()=>document.querySelector('#reader-name').textContent.trim()==='Small picture');await ready();
 await page.locator('#reader-stage').focus();await page.keyboard.press('Escape');
 ok(await isOpen(),'Escape turns Expand off first and keeps the Tinka open');
 eq(await expand.getAttribute('aria-pressed'),'false','…Expand is off');
 eq(await announced(),'Expand off','…announced');
 // The path's exit: Up (the board crumb) leaves Expand with the reader; the next open starts unexpanded.
 await expand.click();eq(await expand.getAttribute('aria-pressed'),'true','Expand on again');
 await page.locator('#close-reader').click();await page.locator('#reader-dialog').waitFor({state:'hidden'});checks++;
 await openFromBoard(imageId);
 eq(await expand.getAttribute('aria-pressed'),'false','Leaving by the path ends Expand: the next open is not expanded');
 eq((await plane()).zoom,fit.zoom,'…and fits');
 // The path menu's rows are the path too.
 await expand.click();await page.locator('#reader-path').click();
 await page.locator('#reader-path-pop [data-path-go="up"]').click();await page.locator('#reader-dialog').waitFor({state:'hidden'});checks++;

 // (7) Stepping to a card outside the view she opened from, then zooming out: that zoom, the card centred.
 await board();
 const imageBox=await card(imageId).boundingBox();await page.mouse.move(imageBox.x+40,imageBox.y+40);
 for(let i=0;i<3;i++)await ctrlWheel(-100);await page.waitForTimeout(200);
 const zoomedBoard=await boardZoom();ok(zoomedBoard>1.3,`The board is zoomed in on the picture (${zoomedBoard.toFixed(2)})`);
 ok(await page.evaluate(id=>{const r=document.querySelector(`#world .workspace-card[data-placement="${id}"]`).getBoundingClientRect();return r.left>=innerWidth||r.right>innerWidth;},docId),'The short note is outside that view');
 await openFromBoard(imageId);
 await page.keyboard.press('j');await page.waitForFunction(()=>document.querySelector('#reader-name').textContent.trim()==='Short note');await ready();
 await page.locator('#reader-stage').focus();await page.keyboard.press('-');await page.keyboard.press('-');
 await landed(docId,'centred','After stepping',zoomedBoard);

 // (8) An item with its own board, opened in the view: the same floor, landing and Expand.
 await board();await openFromBoard(ownerId);
 ok(await page.locator('#reader-down').isVisible(),'The opened item has its own board (↓ Board)');
 await expand.click();eq(await expand.getAttribute('aria-pressed'),'true','Expand works on it');
 eq(await page.locator('#reader-zoom-minus').getAttribute('aria-disabled'),'true','…and − is unavailable');
 await page.locator('#reader-stage').focus();await page.keyboard.press('-');ok(await isOpen(),'Expanded, − does not leave it');
 await expand.click();await page.locator('#reader-stage').focus();
 await page.keyboard.press('-');await page.keyboard.press('-');
 await landed(ownerId,'same','Item with its own board');

 // (9) A direct link: zooming out lands on the item's board, on its card.
 await page.goto('about:blank');  // a fresh load, not a hash change on the board already shown
 await page.goto(`${base}/boards/zb/#items/${docId}`,{waitUntil:'load'});await page.locator('#reader-dialog[open]').waitFor();await ready();
 await page.mouse.move(cx,cy);await newGesture();
 await ctrlWheel(100);await ctrlWheel(100);
 await landed(docId,'direct','Direct link');
 ok(!new URL(page.url()).hash.startsWith('#items/'),'The address is the board again');
 await page.keyboard.press('Enter');await page.locator('#reader-dialog[open]').waitFor();
 eq(await name(),'Short note','Enter opens it again');

 eq(errors,[],'No page errors');
 console.log(`Zoom out browser checks passed: ${checks}`);
}finally{await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true});}
