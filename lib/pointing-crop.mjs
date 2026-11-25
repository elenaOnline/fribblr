import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {findBrowser,headlessCapture,overviewSize} from './overview.mjs';

// Crops for pointing marks (team/pointing/CONTRACT.md § Crops), rendered on the
// server: the board page is loaded once in a headless browser in its view-only
// overview mode (?overview), fitted so the board draws at about 100 %, then one
// screenshot is clipped per mark at the mark's bounds, re-rasterised at a scale
// that makes the crop readable. Everything she pointed at is in it as the board
// draws it: cards, drawn elements, covers, empty space. What it is not: her
// screen. It is the board's saved state, freshly loaded (see `from` and
// team/pointing/spike/CROP.md for what differs).
//
//   cropMarks({url, boardId, marks, appearance}) -> [{png, width, height, from} | {note}]
//
// One result per mark, in order. Never throws for a single bad mark; a failure
// of the whole render (no browser, board missing, timeout) gives every mark a
// {note} saying so, never a fake image.

const PAD=12;              // world px of context around the gesture, at least
const PAD_SHARE=0.25;      // ... and a quarter of the gesture's larger side
const PAD_MAX=240;         // ... but never more than this, so the crop stays readable
const WHOLE_PAD_SHARE=0.04; // a whole object is cropped with only a thin edge: it is the context already
const DOT=5;               // page px: the dot marking where she clicked
const MIN_BOX=96;          // a crop is never smaller than this (world px)
const POINT_BOX={w:960,h:640}; // a point on empty space: the neighbourhood around it, with a marker at the point
const TARGET_LONG=1400;    // aim for this many pixels on the long side
const MAX_LONG=2000,MAX_SCALE=4,MIN_SCALE=0.25;
const MAX_VIEW=8000;

const finite=n=>typeof n==='number'&&Number.isFinite(n);
function shapeBox(shape){
  if(!shape)return null;
  if(shape.kind==='rect'&&[shape.x,shape.y,shape.w,shape.h].every(finite))return {x:shape.x,y:shape.y,w:shape.w,h:shape.h};
  if(shape.kind==='path'&&Array.isArray(shape.points)&&shape.points.length){
    const xs=shape.points.map(p=>p[0]).filter(finite),ys=shape.points.map(p=>p[1]).filter(finite);
    if(!xs.length||!ys.length)return null;
    const x=Math.min(...xs),y=Math.min(...ys);
    return {x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y};
  }
  if(shape.kind==='point'&&finite(shape.x)&&finite(shape.y))return {x:shape.x,y:shape.y,w:0,h:0,point:true};
  return null;
}
const MAX_ASPECT=3;        // a laser pass along a line is long and thin: keep some context across it
const padFor=(b,share=PAD_SHARE)=>Math.min(PAD_MAX,Math.max(PAD,share*Math.max(b.w,b.h)));
const grow=(b,pad,min)=>{
  let w=Math.max(min,b.w+pad*2),h=Math.max(min,b.h+pad*2);
  if(w>h*MAX_ASPECT)h=w/MAX_ASPECT;else if(h>w*MAX_ASPECT)w=h/MAX_ASPECT;
  return {x:b.x+b.w/2-w/2,y:b.y+b.h/2-h/2,w,h};
};

// Page-side: where every card and drawn element is on screen, and the board's
// own coordinates for each, so node can solve board -> screen.
const LAYOUT=`(()=>{const out=[];
for(const el of document.querySelectorAll('#world [data-placement]')){const r=el.getBoundingClientRect();out.push({kind:'placement',id:el.dataset.placement,x:r.left,y:r.top,w:r.width,h:r.height});}
for(const el of document.querySelectorAll('#world [data-decoration]')){const r=el.getBoundingClientRect();out.push({kind:'decoration',id:el.dataset.decoration,x:r.left,y:r.top,w:r.width,h:r.height});}
return JSON.stringify({elements:out,vw:innerWidth,vh:innerHeight});})()`;

const median=values=>{const s=[...values].sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:NaN;};
// Board coordinates -> CSS px of the overview page, from cards and text/region
// drawings whose saved box the board draws as is (cards have a minimum size, so
// the median keeps an outlier from moving the answer). Lines are skipped: their
// element box is not their saved box.
export function solveTransform(snapshot,elements){
  const saved=new Map();
  for(const p of snapshot.placements||[])if(!p.removedAt&&!p.deletedAt&&!p.archivedAt)saved.set(`placement:${p.id}`,p);
  for(const d of snapshot.decorations||[])if(d.type!=='line'&&[d.x,d.y,d.width,d.height].every(finite))saved.set(`decoration:${d.id}`,d);
  const pairs=elements.map(e=>[e,saved.get(`${e.kind}:${e.id}`)]).filter(([e,s])=>s&&s.width>0&&e.w>0);
  if(!pairs.length)return null;
  const scale=median(pairs.map(([e,s])=>e.w/s.width));
  const x=median(pairs.map(([e,s])=>e.x-s.x*scale)),y=median(pairs.map(([e,s])=>e.y-s.y*scale));
  const error=Math.max(...pairs.map(([e,s])=>Math.max(Math.abs(e.x-(x+s.x*scale)),Math.abs(e.y-(y+s.y*scale)))).sort((a,b)=>a-b).slice(0,Math.ceil(pairs.length*0.8)));
  return {scale,x,y,error,samples:pairs.length};
}

// The board box a mark's crop shows: the gesture's bounds; for a point, the
// things it hit (as drawn) or, on empty space, the neighbourhood around it.
export function markBox(mark,layout,transform){
  const box=shapeBox(mark.shape);
  if(!box)return null;
  // A board she picked with @ is not a card on this board: there is nothing of it to find in the layout.
  const hit=(mark.targets||[]).filter(t=>t.kind!=='board').map(t=>layout.get(`${t.kind}:${t.id}`)).filter(Boolean);
  // A laser's targets are what it dwelt on or circled: show them whole with the pass.
  if(mark.tool==='laser'&&hit.length&&!box.point){
    const sx=Math.min(...hit.map(e=>e.x)),sy=Math.min(...hit.map(e=>e.y)),ex=Math.max(...hit.map(e=>e.x+e.w)),ey=Math.max(...hit.map(e=>e.y+e.h));
    const t={x:(sx-transform.x)/transform.scale,y:(sy-transform.y)/transform.scale,w:(ex-sx)/transform.scale,h:(ey-sy)/transform.scale};
    const x=Math.min(box.x,t.x),y=Math.min(box.y,t.y);
    const all={x,y,w:Math.max(box.x+box.w,t.x+t.w)-x,h:Math.max(box.y+box.h,t.y+t.h)-y};
    return grow(all,padFor(all),MIN_BOX);
  }
  if(!box.point)return grow(box,padFor(box),MIN_BOX);
  if(hit.length){
    const sx=Math.min(...hit.map(e=>e.x)),sy=Math.min(...hit.map(e=>e.y));
    const ex=Math.max(...hit.map(e=>e.x+e.w)),ey=Math.max(...hit.map(e=>e.y+e.h));
    const whole={x:(sx-transform.x)/transform.scale,y:(sy-transform.y)/transform.scale,w:(ex-sx)/transform.scale,h:(ey-sy)/transform.scale};
    return grow(whole,padFor(whole,WHOLE_PAD_SHARE),MIN_BOX);
  }
  return {x:box.x-POINT_BOX.w/2,y:box.y-POINT_BOX.h/2,w:POINT_BOX.w,h:POINT_BOX.h};
}

// The gesture itself (lasso or laser path, or the marquee), drawn over the page
// for the shot only, so the crop shows the exact shape she drew; and, for a click
// on a whole object, a small dot at the spot. Flat, one colour (the board's mark
// red), no glow; removed before the next mark.
const outlineScript=(points,closed,color,dot=null)=>`(()=>{const ns='http://www.w3.org/2000/svg',s=document.createElementNS(ns,'svg');s.id='pointing-crop-outline';
s.setAttribute('style','position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;overflow:visible');
${points?`const p=document.createElementNS(ns,'${closed?'polygon':'polyline'}');p.setAttribute('points',${JSON.stringify(points.map(([x,y])=>`${x.toFixed(1)},${y.toFixed(1)}`).join(' '))});
p.setAttribute('style','fill:none;stroke:${color};stroke-width:2;stroke-dasharray:6 4;vector-effect:non-scaling-stroke');s.append(p);`:''}
${dot?`const c=document.createElementNS(ns,'circle');c.setAttribute('cx','${dot[0].toFixed(1)}');c.setAttribute('cy','${dot[1].toFixed(1)}');c.setAttribute('r','${DOT}');c.setAttribute('style','fill:${color};stroke:none');s.append(c);`:''}
document.body.append(s);return true;})()`;
// The board's own mark red for this appearance, as the page computes it from tokens.css.
const MARK_RED=`getComputedStyle(document.documentElement).getPropertyValue('--mark-red').trim()`;
const REMOVE_OUTLINE=`document.getElementById('pointing-crop-outline')?.remove()`;

const settledState=`document.documentElement.dataset.overview||""`;
async function waitSettled(evaluate,deadline){
  for(;;){
    const state=await evaluate(settledState);
    if(['ready','partial','error'].includes(state))return state;
    if(Date.now()>deadline)return 'timeout';
    await new Promise(r=>setTimeout(r,150));
  }
}
const measureScript=`(()=>{const d=document.documentElement.dataset,e=document.getElementById("board-error");return JSON.stringify({aspect:Number(d.overviewAspect)||0,width:Number(d.overviewWidth)||0,chrome:Number(d.overviewChrome)||0,error:e&&!e.hidden?e.textContent.trim():""});})()`;

// Saved bounds of the board's cards and drawings -> a page size that shows the
// board at about 100 % under the 44 px board header.
export function guessSize(snapshot){
  const boxes=[...(snapshot.placements||[]).filter(p=>!p.removedAt&&!p.deletedAt&&!p.archivedAt).map(p=>[p.x,p.y,p.width,p.height]),
    ...(snapshot.decorations||[]).map(d=>[d.x,d.y,d.width||0,d.height||0])].filter(b=>b.every(finite));
  if(!boxes.length)return {width:1600,height:1000};
  const x0=Math.min(...boxes.map(b=>b[0])),y0=Math.min(...boxes.map(b=>b[1]));
  const w=Math.max(...boxes.map(b=>b[0]+b[2]))-x0,h=Math.max(...boxes.map(b=>b[1]+b[3]))-y0;
  const width=Math.min(MAX_VIEW,Math.max(400,Math.ceil(w)+48));
  return {width,height:Math.min(16000,width*3,Math.max(300,Math.ceil(h)+48+44))};
}

export async function cropMarks({url,boardId,marks,appearance='light',browser,find=findBrowser,timeout=45000,outline=null,timing=null}){
  const all=note=>marks.map(()=>({note}));
  if(!Array.isArray(marks)||!marks.length)return [];
  const t0=Date.now();
  const response=await fetch(`${url}api/boards/${encodeURIComponent(boardId)}`,{cache:'no-store'}).catch(()=>null);
  if(!response?.ok)return all(`No crop: board ${boardId} could not be read for the render (${response?response.status:'no answer'}).`);
  const snapshot=await response.json();
  const executable=browser||await find().catch(()=>null);
  if(!executable)return all('No crop: no Chrome-family browser was found for the server-side render (set CHROMIUM_EXECUTABLE). The region and objects are exact; there is no picture.');
  const dir=await mkdtemp(path.join(os.tmpdir(),'tinka-pointing-crop-'));
  const results=marks.map(()=>({note:'No crop: the render did not reach this mark.'}));
  const times={find:Date.now()-t0};
  try{
    await headlessCapture({browser:executable,out:path.join(dir,'unused.png'),timeout,what:'crop'},async(call,{deadline,late})=>{
      times.launch=Date.now()-t0;
      const evaluate=async expression=>(await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}))?.result?.value;
      // First guess from the saved geometry, so one settle pass usually does:
      // the page about as large as the board's content at 100 %.
      let size=guessSize(snapshot);
      await call('Emulation.setDeviceMetricsOverride',{...size,deviceScaleFactor:1,mobile:false});
      await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:appearance}]});
      const navigation=await call('Page.navigate',{url:`${url}boards/${encodeURIComponent(boardId)}/?overview&appearance=${encodeURIComponent(appearance)}`});
      if(navigation.errorText)throw new Error(`The board page did not load (${navigation.errorText}).`);
      let state=await waitSettled(evaluate,deadline);
      const first=JSON.parse(await evaluate(measureScript));
      if(state==='error')throw new Error(first.error||'The board could not be loaded.');
      if(state==='timeout')throw late;
      // Size the page so the fitted board draws at about 100 % (overview never
      // zooms past 125 %): the clip then re-rasterises from a near-1:1 layout.
      const want=Math.min(MAX_VIEW,Math.max(400,Math.ceil(first.width)+48));
      const next=overviewSize({width:want,aspect:first.aspect,contentWidth:first.width,chrome:first.chrome});
      // Re-size only when the guess was far off (the fit then lands well below
      // 100 %); the clip re-rasterises anyway, so small misses cost nothing.
      if(Math.abs(next.width-size.width)>size.width*0.25||Math.abs(next.height-size.height)>size.height*0.25){
        times.resized=true;
        size=next;
        await evaluate('delete document.documentElement.dataset.overview');
        await call('Emulation.setDeviceMetricsOverride',{...size,deviceScaleFactor:1,mobile:false});
        state=await waitSettled(evaluate,deadline);
      }
      times.settled=Date.now()-t0;times.state=state;
      const page=JSON.parse(await evaluate(LAYOUT));
      const transform=solveTransform(snapshot,page.elements);
      if(!transform){for(let i=0;i<marks.length;i++)results[i]={note:'No crop: the board has nothing drawn to place the region by.'};return {data:''};}
      times.transform=transform;
      const layout=new Map(page.elements.map(e=>[`${e.kind}:${e.id}`,e]));
      // A headless shell has no PDF viewer: the board then draws a PDF card's
      // placeholder where her browser shows page 1. A crop of only PDFs would
      // show something she did not see, so it becomes a note; a crop that also
      // holds other things keeps the picture and says so.
      // The gesture's colour: the board's --mark-red in this appearance (an `outline` option overrides it; false draws none).
      const ink=outline===false?null:outline||await evaluate(MARK_RED)||'#B33830';
      const pdfViewer=await evaluate('navigator.pdfViewerEnabled!==false');
      times.pdfViewer=pdfViewer;
      for(const [i,mark] of marks.entries()){
        try{
          const targets=mark.targets||[];
          // Only a board she picked with @ (no card of it here): a drawn region still has a place to show; a bare point does not.
          if(targets.length&&targets.every(t=>t.kind==='board')&&mark.shape?.kind==='point'){
            const name=targets[0].title?` "${targets[0].title}"`:'';
            results[i]={note:`No crop: the board${name} she picked has no card on this board, so there is nothing here to show. The reference is exact.`};continue;
          }
          const box=markBox(mark,layout,transform);
          if(!box){results[i]={note:'No crop: the mark has no usable shape.'};continue;}
          const pdfs=pdfViewer?0:targets.filter(t=>t.itemKind==='pdf').length;
          if(pdfs&&pdfs===targets.length){results[i]={note:'No crop: the server\'s headless browser cannot draw PDF pages, so its picture would show a placeholder where you saw the first page. The region is exact.'};continue;}
          const clip={x:transform.x+box.x*transform.scale,y:transform.y+box.y*transform.scale,width:box.w*transform.scale,height:box.h*transform.scale};
          const long=Math.max(clip.width,clip.height);
          const scale=Math.max(MIN_SCALE,Math.min(MAX_SCALE,TARGET_LONG/long,MAX_LONG/long));
          const shape=mark.shape;
          const toScreen=([x,y])=>[transform.x+x*transform.scale,transform.y+y*transform.scale];
          const here=targets.filter(t=>t.kind!=='board'&&layout.has(`${t.kind}:${t.id}`));
          const empty=shape?.kind==='point'&&!here.length;
          // A click on a whole object: the object whole, a dot where she clicked.
          const dot=ink&&shape?.kind==='point'&&here.length?toScreen([shape.x,shape.y]):null;
          const drawn=ink&&shape?.kind==='path'?shape.points.map(toScreen)
            :ink&&shape?.kind==='rect'&&mark.tool!=='point'?[[shape.x,shape.y],[shape.x+shape.w,shape.y],[shape.x+shape.w,shape.y+shape.h],[shape.x,shape.y+shape.h]].map(toScreen)
            // A point on empty space: a small ring at the spot, so the picture says where.
            :ink&&empty?Array.from({length:24},(_,k)=>{const a=k/24*Math.PI*2;return toScreen([shape.x+14*Math.cos(a),shape.y+14*Math.sin(a)]);}):null;
          if(drawn||dot)await evaluate(outlineScript(drawn,mark.tool==='lasso'||shape.kind==='rect'||empty,ink,dot));
          const {data}=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{...clip,scale}});
          if(drawn||dot)await evaluate(REMOVE_OUTLINE);
          const png=Buffer.from(data,'base64');
          results[i]={png,width:png.readUInt32BE(16),height:png.readUInt32BE(20),
            from:`board render: ${boardId} as saved, ${appearance}, fresh headless load${state==='ready'?'':' (some previews still loading)'}; board box x ${Math.round(box.x)} y ${Math.round(box.y)} w ${Math.round(box.w)} h ${Math.round(box.h)} at ${(transform.scale*scale).toFixed(2)} px per board unit${dot?'; the spot she clicked marked with a dot':''}${drawn?(empty?'; the point she marked ringed, dashed':'; her gesture drawn dashed'):''}${drawn||dot?` in red (${ink})`:''}${pdfs?'; PDF pages show as a placeholder in this render (no PDF viewer)':''}`,
            box};
        }catch(error){results[i]={note:`No crop: ${error.message}`};}
      }
      times.done=Date.now()-t0;
      return {data:''};
    });
  }catch(error){
    const failed=`No crop: the server-side render failed (${error.message.split('\n')[0]}).`;
    for(let i=0;i<results.length;i++)if(!results[i].png)results[i]={note:failed};
  }finally{
    await rm(dir,{recursive:true,force:true}).catch(()=>{});
  }
  if(timing)Object.assign(timing,times,{total:Date.now()-t0});
  return results;
}
