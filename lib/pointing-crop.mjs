import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {findBrowser,headlessCapture,overviewSize} from './overview.mjs';
import {shotSource,READY,FLOW,MEASURE,imageSize} from './shot.mjs';
import {getItemSnapshot} from './workspace.mjs';

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
  // The wand's area: the centre line's bounds, half the band's width all round.
  if(shape.kind==='swath'&&finite(shape.width)&&Array.isArray(shape.points)&&shape.points.length){
    const xs=shape.points.map(p=>p[0]).filter(finite),ys=shape.points.map(p=>p[1]).filter(finite);
    if(!xs.length||!ys.length)return null;
    const r=shape.width/2,x=Math.min(...xs)-r,y=Math.min(...ys)-r;
    return {x,y,w:Math.max(...xs)+r-x,h:Math.max(...ys)+r-y};
  }
  return null;
}
// What the crop is framed by: the snapped outline when the reference was tidied to something, else what she drew.
export const framingShape=mark=>mark.snap?.shape||mark.shape;
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
  const box=shapeBox(framingShape(mark));
  if(!box)return null;
  // A board she picked with @ is not a card on this board: there is nothing of it to find in the layout.
  const hit=(mark.targets||[]).filter(t=>t.kind!=='board').map(t=>layout.get(`${t.kind}:${t.id}`)).filter(Boolean);
  // A laser's targets are what it dwelt on or circled: show them whole with the pass.
  if((mark.tool==='laser'||mark.tool==='wand')&&!mark.snap&&hit.length&&!box.point){
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

// The gesture itself (lasso or wand outline, or the marquee), drawn over the page for the shot only, so the crop shows
// the exact shape she drew, or the outline it snapped to; and, for a click, a small dot at the spot. Flat, one colour
// (the board's mark red), no glow; removed before the next mark. `layers`: [{points, closed, opacity, dash, width}],
// `dots`: [{at: [x, y], opacity}], in the coordinates of `fixed` (CSS px of the page: viewport-fixed, or, with
// `absolute`, document coordinates).
const outlineScript=(layers,dots,color,{absolute=null}={})=>`(()=>{const ns='http://www.w3.org/2000/svg',s=document.createElementNS(ns,'svg');s.id='pointing-crop-outline';
s.setAttribute('style',${JSON.stringify(absolute?`position:absolute;left:0;top:0;width:${absolute.width}px;height:${absolute.height}px;pointer-events:none;z-index:2147483647;overflow:visible`:'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;overflow:visible')});
for(const l of ${JSON.stringify(layers)}){const p=document.createElementNS(ns,l.closed?'polygon':'polyline');p.setAttribute('points',l.points.map(([x,y])=>x.toFixed(1)+','+y.toFixed(1)).join(' '));
p.setAttribute('style','fill:none;stroke:${color};stroke-width:'+(l.width||2)+';stroke-opacity:'+(l.opacity??1)+';stroke-dasharray:'+(l.dash||'6 4')+';vector-effect:non-scaling-stroke');s.append(p);}
for(const d of ${JSON.stringify(dots)}){const c=document.createElementNS(ns,'circle');c.setAttribute('cx',d.at[0].toFixed(1));c.setAttribute('cy',d.at[1].toFixed(1));c.setAttribute('r',d.r||${DOT});c.setAttribute('style','fill:${color};fill-opacity:'+(d.opacity??1)+';stroke:none');s.append(c);}
document.body.append(s);return true;})()`;
// The board's own mark red for this appearance, as the page computes it from tokens.css.
const MARK_RED=`getComputedStyle(document.documentElement).getPropertyValue('--mark-red').trim()`;
const REMOVE_OUTLINE=`document.getElementById('pointing-crop-outline')?.remove();document.getElementById('pointing-crop-glitter')?.remove()`;

// ---- the wand's glitter, drawn by the app's own code (public/pointing-wand.js, loaded into the rendered page) ----
// The page gets the module (from a blob, so it works on any origin the item lives on) and the glitter's tones, read
// from the app's own tokens.css and pointing.css in a hidden frame so the page's own styles cannot change them.
const APP_ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let assetText=null;
const assets=()=>assetText||=Promise.all(['pointing-wand.js','tokens.css','pointing.css'].map(name=>readFile(path.join(APP_ROOT,'public',name),'utf8'))).then(([wand,tokens,pointing])=>({wand,css:`${tokens}\n${pointing}`.replace(/@import[^;]*;/g,'')}));
const WAND_CELLS_ACROSS=14;   // the default band (56 px) is 14 flecks' sites wide on her screen (pitch 4)
const wandSetup=async(appearance)=>{
  const {wand,css}=await assets();
  return `(async()=>{
    window.__pointingWand=await import(URL.createObjectURL(new Blob([${JSON.stringify(wand)}],{type:'text/javascript'})));
    const f=document.createElement('iframe');f.style.cssText='position:fixed;left:-9999px;top:0;width:10px;height:10px;visibility:hidden;border:0';
    f.srcdoc='<!doctype html><html data-appearance="${appearance}"${appearance==='dark'?' data-theme="night"':''}><head><style>'+${JSON.stringify(css)}+'</style></head><body><span></span></body></html>';
    document.documentElement.append(f);await new Promise(r=>{f.onload=r;setTimeout(r,3000);});
    const sp=f.contentDocument.querySelector('span'),read=n=>{sp.style.color='var('+n+')';return f.contentWindow.getComputedStyle(sp).color;};
    window.__pointingTones=[read('--wand-ink'),read('--wand-ink'),read('--wand-pale'),read('--wand-star')];f.remove();
    return window.__pointingTones[0];})()`;
};
// Draws `shapes` ([{kind:'swath'|'region', shape, alpha}]) as glitter onto a canvas that exactly covers the clip, at the
// clip's pixel density: the same SwathField / paintField the board draws with. `origin` is the clip's top left in the
// shapes' own coordinates, `k` device px per unit of them, `cell` the size of one fleck site in those units.
const glitterScript=({css,origin,k,cell,shapes,absolute})=>`(()=>{const w=window.__pointingWand;if(!w)return false;
const c=document.createElement('canvas');c.id='pointing-crop-glitter';c.width=${Math.max(1,Math.ceil(css.w*css.scale))};c.height=${Math.max(1,Math.ceil(css.h*css.scale))};
c.style.cssText='position:${absolute?'absolute':'fixed'};left:${css.x}px;top:${css.y}px;width:${css.w}px;height:${css.h}px;pointer-events:none;z-index:2147483646';
const ctx=c.getContext('2d'),cell=${cell},dpr=${k*cell/4};
for(const {kind,shape,alpha} of ${JSON.stringify(shapes)}){const f=kind==='swath'?w.SwathField.fromShape(shape,cell):w.SwathField.fromRegion(shape,cell,cell*7/4);
ctx.globalAlpha=alpha;w.paintField(ctx,f,{ox:${origin.x},oy:${origin.y},k:${k}},{tones:window.__pointingTones,dpr,size:2,rim:0.7});}
document.body.append(c);return true;})()`;
// What a crop of this mark shows besides outlines: the glitter shapes (a wand's area; a snapped wand shows the outline
// it snapped to filled, with her own sweep faint), and the cell size they are drawn at.
export function glitterOf(mark,minCell=0){
  if(mark.tool!=='wand'||mark.shape?.kind!=='swath')return null;
  const cell=Math.max(minCell,mark.shape.width/WAND_CELLS_ACROSS);
  const shapes=mark.snap?[{kind:'region',shape:mark.snap.shape,alpha:1},{kind:'swath',shape:mark.shape,alpha:0.4}]:[{kind:'swath',shape:mark.shape,alpha:1}];
  return {cell,shapes};
}
const polygon=shape=>shape?.kind==='rect'?[[shape.x,shape.y],[shape.x+shape.w,shape.y],[shape.x+shape.w,shape.y+shape.h],[shape.x,shape.y+shape.h]]:shape?.kind==='path'?shape.points:null;
// The outlines and dots of a mark, in the mark's own coordinates: what she drew (dashed), or, when it snapped, the
// outline it snapped to (dashed, full) with her raw gesture faint; a click's dot; a ring for a point on empty space.
export function layersOf(mark,{ring=false}={}){
  const raw=mark.shape,layers=[],dots=[];
  const closedRaw=mark.tool==='lasso'||raw.kind==='rect';
  if(mark.snap){
    const snapped=polygon(mark.snap.shape);
    if(snapped)layers.push({points:snapped,closed:true,opacity:1});
    const poly=polygon(raw);
    if(poly)layers.push({points:poly,closed:closedRaw,opacity:0.4,dash:'2 4',width:1.5});
    if(raw.kind==='point')dots.push({at:[raw.x,raw.y],opacity:0.55});
    return {layers,dots};
  }
  if(raw.kind==='point'){
    if(ring)layers.push({points:Array.from({length:24},(_,k)=>{const a=k/24*Math.PI*2;return [raw.x+14*Math.cos(a),raw.y+14*Math.sin(a)];}),closed:true,opacity:1});
    else dots.push({at:[raw.x,raw.y],opacity:1});
  }else if(raw.kind==='path')layers.push({points:raw.points,closed:closedRaw,opacity:1});
  else if(raw.kind==='rect'&&mark.tool!=='point')layers.push({points:polygon(raw),closed:true,opacity:1});
  return {layers,dots};
}

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


// What the crop says about what is drawn on it (the `from` text). The phrases the round-1 tests and agents know stay.
function describeDrawing(mark,{layers,dots,empty,glitter,ink}){
  const bits=[];
  const solid=layers.filter(l=>l.opacity===1),faint=layers.length-solid.length;
  if(mark.snap)bits.push(`; snapped to ${mark.snap.label}: the outline it snapped to drawn dashed${ink?` in red (${ink})`:''}${glitter?', filled with glitter':''}${faint||dots.length?`, her own gesture faint (dotted${glitter?', glitter at low density':''})`:glitter?', her own sweep faint':''}`);
  else{
    if(dots.length)bits.push('; the spot she clicked marked with a dot');
    if(solid.length)bits.push(empty?'; the point she marked ringed, dashed':'; her gesture drawn dashed');
    if(bits.length&&ink)bits.push(` in red (${ink})`);
    if(glitter)bits.push(`; the wand's area drawn as glitter, as she saw it${ink?` (red ${ink})`:''}`);
  }
  return bits.join('');
}
async function cropBoardMarks({url,boardId,marks,appearance='light',browser,find=findBrowser,timeout=45000,outline=null,timing=null}){
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
      let glittered=false;
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
          // A click on a whole object: the object whole, a dot where she clicked. A point on empty space: a ring.
          const {layers,dots}=ink?layersOf(mark,{ring:empty}):{layers:[],dots:[]};
          const screenLayers=layers.map(l=>({...l,points:l.points.map(toScreen)})),screenDots=dots.map(d=>({...d,at:toScreen(d.at)}));
          const glitter=ink?glitterOf(mark,3/(transform.scale*scale)):null;
          if(screenLayers.length||screenDots.length)await evaluate(outlineScript(screenLayers,screenDots,ink));
          if(glitter){
            if(!glittered){glittered=true;await evaluate(await wandSetup(appearance)).catch(()=>{});}
            await evaluate(glitterScript({css:{x:clip.x,y:clip.y,w:clip.width,h:clip.height,scale},origin:{x:box.x,y:box.y},k:transform.scale*scale,cell:glitter.cell,shapes:glitter.shapes,absolute:false}));
          }
          const {data}=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{...clip,scale}});
          await evaluate(REMOVE_OUTLINE);
          const png=Buffer.from(data,'base64');
          results[i]={png,width:png.readUInt32BE(16),height:png.readUInt32BE(20),
            from:`board render: ${boardId} as saved, ${appearance}, fresh headless load${state==='ready'?'':' (some previews still loading)'}; board box x ${Math.round(box.x)} y ${Math.round(box.y)} w ${Math.round(box.w)} h ${Math.round(box.h)} at ${(transform.scale*scale).toFixed(2)} px per board unit${describeDrawing(mark,{layers,dots:screenDots,empty,glitter,ink})}${pdfs?'; PDF pages show as a placeholder in this render (no PDF viewer)':''}`,
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

// ---- marks inside an opened item ----
// The item itself is rendered, as `item shot` does (lib/shot.mjs): an HTML page at her frame's size, zoom and scroll, the
// version she looked at; an image at its own pixels; a document as the reader draws it, without the reader's controls.
// Her gesture, what it snapped to and the element's box are drawn on that, in the item's own coordinates. What no render
// can bring back is said in `from`: text typed into the page, state a script built up, a running app's session.
const ITEM_PAD=24,ITEM_MIN=240;
const docSizeScript=`(()=>{const d=document.documentElement,b=document.body;return JSON.stringify({w:Math.ceil(Math.max(d.scrollWidth,b?b.scrollWidth:0)),h:Math.ceil(Math.max(d.scrollHeight,b?b.scrollHeight:0)),x:scrollX,y:scrollY});})()`;
const matchVersion=(stack,wanted)=>stack?.versions?.find(v=>String(v.id)===String(wanted)||Number.isInteger(wanted)&&v.version===wanted);
const clampBox=(b,w,h)=>{const x=Math.max(0,Math.min(b.x,w-1)),y=Math.max(0,Math.min(b.y,h-1));return {x,y,w:Math.max(1,Math.min(b.w,w-x)),h:Math.max(1,Math.min(b.h,h-y))};};
const toHex=color=>{const m=/^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color||'');return m?`#${[m[1],m[2],m[3]].map(v=>Number(v).toString(16).padStart(2,'0')).join('').toUpperCase()}`:color||null;};
const shotNote=(item,what)=>`No crop: ${what} The reference is exact.`;

// Which file or page the render loads for this mark's place: {source, title, versionNote, itemKind} or {note}.
export async function itemRenderSource({config,url,mark,appearance}){
  const place=mark.place;
  let item;
  try{item=await getItemSnapshot(config,place.itemId);}catch{item=null;}
  if(!item)return {note:shotNote(null,`the item ${place.itemId} she had open is deleted or cannot be read, so nothing can be drawn of it.`)};
  const title=item.title||item.id;
  let versionNote='';
  if(place.version!==undefined){
    const found=matchVersion(item.versionStack,place.version);
    if(!found)return {note:shotNote(null,`version ${place.version} of "${title}" is not among its saved versions now, and a render of another version would show something she did not look at.`)};
    item={...item,content:found.content};versionNote=`version ${place.version}, file ${found.content.resource?.path||found.name}`;
  }else if(item.versionStack?.versions?.length>1)versionNote='the item\'s current file (the message names no version)';
  const kind=item.content?.kind||'card';
  if(['pdf','video','audio'].includes(kind))return {note:shotNote(null,`the server cannot draw ${kind} content (a headless browser has no ${kind==='pdf'?'PDF viewer':'player'}), so a picture would show something other than what she saw.`)};
  const source=shotSource(item,url,{appearance});
  if(source.board)return {note:shotNote(null,`"${title}" is a board, not a page; marks inside an opened board are made on that board.`)};
  if(source.remote!==undefined)return {note:shotNote(null,`"${title}" shows a remote page, which the server does not load.`)};
  if(source.what==='saved preview'||source.what==='saved preview image')return {note:shotNote(null,`"${title}" has only a saved preview image, not the page she had open, so its coordinates would not line up.`)};
  return {source,title,versionNote,kind};
}

async function cropItemMarks({config,url,marks,appearance='light',browser,find=findBrowser,timeout=45000,outline=null,timing=null}){
  const results=marks.map(()=>({note:'No crop: the render did not reach this mark.'}));
  const resolved=await Promise.all(marks.map(mark=>itemRenderSource({config,url,mark,appearance})));
  const jobs=new Map();
  resolved.forEach((r,i)=>{
    if(r.note){results[i]={note:r.note};return;}
    const v=marks[i].place.view,key=[marks[i].place.itemId,marks[i].place.version??'',r.source.url,v.width,v.height,v.zoom].join('|');
    if(!jobs.has(key))jobs.set(key,{source:r,indexes:[]});
    jobs.get(key).indexes.push(i);
  });
  if(!jobs.size)return results;
  const executable=browser||await find().catch(()=>null);
  if(!executable){for(const {indexes} of jobs.values())for(const i of indexes)results[i]={note:'No crop: no Chrome-family browser was found for the server-side render (set CHROMIUM_EXECUTABLE). The reference is exact; there is no picture.'};return results;}
  const dir=await mkdtemp(path.join(os.tmpdir(),'tinka-pointing-crop-'));
  try{
    await headlessCapture({browser:executable,out:path.join(dir,'unused.png'),timeout,what:'crop'},async(call,{deadline,late})=>{
      const evaluate=async expression=>(await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}))?.result?.value;
      await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:appearance}]});
      for(const {source:{source,title,versionNote,kind},indexes} of jobs.values()){
        const view0=marks[indexes[0]].place.view;
        const layoutWidth=Math.max(200,Math.round(view0.width/view0.zoom)),layoutHeight=Math.max(120,Math.round(view0.height/view0.zoom));
        try{
          const image=source.kind==='image';
          await call('Emulation.setDeviceMetricsOverride',{width:layoutWidth,height:layoutHeight,deviceScaleFactor:1,mobile:false});
          const navigation=await call('Page.navigate',{url:source.url});
          if(navigation.errorText)throw new Error(source.app?`its app at ${source.url} is not answering (${navigation.errorText}); start it to get a picture.`:`the item did not load (${navigation.errorText}).`);
          const state=await evaluate(READY)||'partial';
          if(source.tinkaPage)await evaluate(FLOW);
          const measured=JSON.parse(await evaluate(MEASURE)||'{}');
          if(image){
            const size=imageSize(measured);
            if(!size)throw new Error('the image did not load.');
            await call('Emulation.setDeviceMetricsOverride',{...size,deviceScaleFactor:1,mobile:false});
          }
          const wand=await wandSetup(appearance);
          const tone=await evaluate(wand).catch(()=>null);
          const ink=outline===false?null:outline||toHex(tone)||'#B33830';
          for(const i of indexes){
            const mark=marks[i],place=mark.place,view=place.view,fraction=view.unit==='fraction';
            try{
              await evaluate(`scrollTo(${view.scrollX},${view.scrollY})`);
              const doc=JSON.parse(await evaluate(docSizeScript));
              // Coordinates in the item's own terms: page px, image px, or fractions of the rendered document.
              const toPage=fraction?([x,y])=>[x*doc.w,y*doc.h]:p=>p;
              const mapShape=shape=>!shape?shape:shape.kind==='rect'?(()=>{const [x,y]=toPage([shape.x,shape.y]),[x2,y2]=toPage([shape.x+shape.w,shape.y+shape.h]);return {kind:'rect',x,y,w:x2-x,h:y2-y};})()
                :shape.kind==='point'?(([x,y])=>({kind:'point',x,y}))(toPage([shape.x,shape.y]))
                :shape.kind==='swath'?{kind:'swath',width:fraction?shape.width*doc.w:shape.width,points:shape.points.map(toPage)}:{kind:'path',points:shape.points.map(toPage)};
              const own={...mark,shape:mapShape(mark.shape),...(mark.snap?{snap:{...mark.snap,shape:mapShape(mark.snap.shape)}}:{})};
              const elementTarget=(mark.targets||[]).find(t=>t.element);
              const element=elementTarget?.element;
              const gestureBox=shapeBox(framingShape(own));
              if(!gestureBox&&!element){results[i]={note:'No crop: the mark has no usable shape.'};continue;}
              // Her frame (as she saw it), unless the mark is an element (that box, with context) or is not inside her frame.
              const frame={x:doc.x,y:doc.y,w:view.width/view.zoom,h:view.height/view.zoom};
              const inside=b=>b.x>=frame.x-2&&b.y>=frame.y-2&&b.x+b.w<=frame.x+frame.w+2&&b.y+b.h<=frame.y+frame.h+2;
              let crop,framing;
              if(image){
                const b=gestureBox||element.box;
                crop=clampBox(grow(b,padFor(b),ITEM_MIN),doc.w,doc.h);framing='the part of the image around the mark';
              }else if(own.snap||element){
                // A snapped mark is framed by what it snapped to; an element mark by the element's box.
                const b=own.snap?gestureBox:element.box;
                crop=clampBox(grow(b,Math.min(PAD_MAX,Math.max(ITEM_PAD,0.25*Math.max(b.w,b.h))),ITEM_MIN),doc.w,doc.h);framing=own.snap?'the snapped outline with context around it':'the element\'s box with context around it';
              }else if(inside(gestureBox)){crop=clampBox(frame,doc.w,doc.h);framing='her frame as she saw it';}
              else{crop=clampBox(grow(gestureBox,padFor(gestureBox),ITEM_MIN),doc.w,doc.h);framing='the mark (it lay outside her frame)';}
              const long=Math.max(crop.w,crop.h);
              const scale=framing==='her frame as she saw it'?Math.min(MAX_SCALE,Math.max(MIN_SCALE,view.zoom,1)):Math.max(MIN_SCALE,Math.min(MAX_SCALE,TARGET_LONG/long,MAX_LONG/long));
              const {layers,dots}=ink?layersOf(own,{ring:false}):{layers:[],dots:[]};
              const drawn=[...layers];
              // The element's box is outlined too when nothing snapped to it (a click that took the element, say).
              if(ink&&element&&!own.snap)drawn.push({points:polygon({kind:'rect',...element.box}),closed:true,opacity:0.9,dash:'3 3',width:1.5});
              const glitter=ink?glitterOf(own,3/scale):null;
              if(drawn.length||dots.length)await evaluate(outlineScript(drawn,dots,ink,{absolute:{width:doc.w,height:doc.h}}));
              if(glitter)await evaluate(glitterScript({css:{x:crop.x,y:crop.y,w:crop.w,h:crop.h,scale},origin:{x:crop.x,y:crop.y},k:scale,cell:glitter.cell,shapes:glitter.shapes,absolute:true}));
              const {data}=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:crop.x,y:crop.y,width:crop.w,height:crop.h,scale}});
              await evaluate(REMOVE_OUTLINE);
              const png=Buffer.from(data,'base64');
              const unit=image?'px of the image':fraction?'px of the rendered document (her fractions times its size)':'px of the page';
              const sizeText=image?`at its own size (${doc.w}×${doc.h} px)`:`laid out ${layoutWidth} px wide (her frame ${Math.round(view.width)}×${Math.round(view.height)} px at zoom ${Math.round(view.zoom*100)} %)`;
              const scrollText=image?'':(Math.abs(doc.x-view.scrollX)>2||Math.abs(doc.y-view.scrollY)>2?`; she was scrolled to x ${Math.round(view.scrollX)}, y ${Math.round(view.scrollY)} but this render's page only scrolls to x ${Math.round(doc.x)}, y ${Math.round(doc.y)}`:`; scrolled to x ${Math.round(doc.x)}, y ${Math.round(doc.y)} as she was`);
              const readerPage=source.tinkaPage;
              const cannot=source.app?`This is the running app at ${source.url}, loaded fresh: her session, signed-in state, typed text and data may differ.`
                :readerPage?'fribblr\'s reader page with its controls hidden (its title strip stays); positions given as fractions are fractions of that page, so they are approximate; notes and annotations she typed are not drawn.'
                :'Not reproduced: text she typed into the page, menus she opened, state its scripts built up after load, anything that changed since.';
              results[i]={png,width:png.readUInt32BE(16),height:png.readUInt32BE(20),
                from:`item render, not a screenshot of her screen: "${title}" (${source.what}${versionNote?`, ${versionNote}`:''}), ${appearance}, fresh headless load${state==='ready'?'':' (some content still loading)'}, ${sizeText}${scrollText}; shows ${framing}: x ${Math.round(crop.x)}–${Math.round(crop.x+crop.w)}, y ${Math.round(crop.y)}–${Math.round(crop.y+crop.h)} ${unit}, at ${scale.toFixed(2)} px per unit${describeDrawing(own,{layers,dots,empty:false,glitter,ink})}${element&&!own.snap&&ink?'; the element\'s box outlined dotted':''}. ${cannot}`,
                box:crop};
            }catch(error){results[i]={note:`No crop: ${error.message}`};}
          }
        }catch(error){for(const i of indexes)results[i]={note:`No crop: ${error.message}`};}
      }
      return {data:''};
    });
  }catch(error){
    const failed=`No crop: the server-side render failed (${error.message.split('\n')[0]}).`;
    for(let i=0;i<results.length;i++)if(!results[i].png&&/did not reach/.test(results[i].note))results[i]={note:failed};
  }finally{await rm(dir,{recursive:true,force:true}).catch(()=>{});}
  return results;
}

// One result per mark, in order: marks on the board are rendered from the board page, marks inside an opened item
// from the item itself (see above).
export async function cropMarks(options){
  const {marks}=options;
  if(!Array.isArray(marks)||!marks.length)return [];
  const inItem=marks.map(mark=>mark.place?.kind==='item');
  const pick=flag=>marks.filter((_,i)=>inItem[i]===flag);
  // One browser at a time.
  const board=pick(false).length?await cropBoardMarks({...options,marks:pick(false)}):[];
  const item=pick(true).length?await cropItemMarks({...options,marks:pick(true)}):[];
  const queues={false:[...board],true:[...item]};
  return marks.map((_,i)=>queues[inItem[i]].shift());
}
