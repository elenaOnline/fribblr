// What an agent reads for a pointing message: plain text, no documentation needed. Pure: it takes the view that
// feedback.mjs builds (marks with absolute crop paths, targets with `now`, the target's state at reading time).
//
//   change this [1] to look more like this [2]
//
//   [1] marquee, 0.9 s, board b-…: part of card "Login mock" (html; placement p-…, item i-…), region x 0.12–0.48, y 0.30–0.41 of the card. Now: still there, not moved. Crop: /abs/…/1.png (…)
//   [2] point, 3.2 s, board b-…: card "Hero B" (image; …), whole. Now: moved since (…). Crop: …
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const seconds=ms=>(ms/1000).toFixed(1);
const range=(a,b)=>`${a.toFixed(2)}–${b.toFixed(2)}`;
const round=n=>Math.round(n);
const same=(a,b)=>Math.abs(a-b)<0.5;
const clean=value=>String(value??'').replace(/\s+/g,' ').trim();

// Where the reviewer pointed in the item's own terms (target.content, set by the client): px of the page or image, or
// fractions of the content area.
function contentText(target){
  const c=target.content;
  if(!c||![c.x,c.y,c.w,c.h].every(finite))return '';
  const of=clean(c.of),kind=/^(page|image)\b\s*(.*)$/.exec(of);
  const point=c.w===0&&c.h===0;
  const nums=c.unit==='px'
    ?(point?`at x ${round(c.x)} px, y ${round(c.y)} px`:`x ${round(c.x)}–${round(c.x+c.w)} px, y ${round(c.y)}–${round(c.y+c.h)} px`)
    :(point?`at x ${c.x.toFixed(2)}, y ${c.y.toFixed(2)}`:`x ${range(c.x,c.x+c.w)}, y ${range(c.y,c.y+c.h)}`);
  if(c.unit==='px'){
    const frame=kind?`the ${kind[1]}${kind[2]?` (${kind[2]})`:''}`:`its ${of}`;
    return `in ${frame}: ${nums}`;
  }
  return `${point?'':'of '}${kind?`the ${of}`:`its ${of}`}: ${nums}`.replace(/^of its content area: at /,'of its content area: ');
}
function movedNote(was,now,target){
  if(!was||!now)return null;
  const moved=!same(was.x,now.x)||!same(was.y,now.y),resized=!same(was.w,now.w)||!same(was.h,now.h);
  if(!moved&&!resized)return null;
  const box=b=>`x ${round(b.x)}, y ${round(b.y)}, ${round(b.w)}×${round(b.h)}`;
  const what=`${moved&&resized?'moved and resized':moved?'moved':'resized'} since (was ${box(was)}; now ${box(now)}, in board coordinates`;
  if(!resized)return `${what}; the region moved with it)`;
  const whole=target.whole&&!target.region;
  const spotOnly=whole&&target.spot;
  const stored=whole?(spotOnly?'where the reviewer clicked is stored as fractions of the box':null):'the region is stored as fractions of the box';
  if(!stored)return `${what})`;
  return `${what}; ${stored}, so after a resize it may not be on the same part of the content${target.content?'; trust the content coordinates given for it':''})`;
}
// Where the target is now, from its recorded state and the box it had when the reviewer pointed.
function stateText(target){
  const now=target.now;
  if(!now)return '';
  const noun=target.kind==='placement'?'card':target.kind==='board'?'board':'drawing';
  let state;
  switch(now.state){
    case 'active':state=movedNote(target.placed,now.at,target)||`still there${target.placed&&now.at?', not moved':''}`;break;
    case 'archived':state=`archived since (still exists)`;break;
    case 'deleted':state=`deleted since`;break;
    case 'removed':state=`removed from the board since (the item still exists elsewhere)`;break;
    default:state=`no longer found (deleted since)`;
  }
  const renamed=now.exists&&now.currentLabel&&target.kind!=='decoration'&&clean(now.currentLabel)!==clean(target.title)?`; now titled "${now.currentLabel}"`:'';
  return ` Now (${noun}): ${state}${renamed}.`;
}
function targetText(target,{inside=false,view=null,snapped=false,lead='On',outside=''}={}){
  const title=clean(target.title),named=title?` "${title}"`:'';
  const ids=target.kind==='placement'?`${target.itemKind}; placement ${target.id}${target.itemId?`, item ${target.itemId}`:''}`
    :target.kind==='decoration'?`${target.itemKind}; decoration ${target.id}`:`board ${target.id}`;
  const noun=target.kind==='placement'?'card':target.kind==='board'?'board':{text:'text',region:'shape',line:'arrow',sticky:'sticky note',container:'container'}[target.itemKind]||'drawing';
  const r=target.region;
  const content=contentText(target);
  // Inside an opened item the card's own fractions mean nothing: only the item's own coordinates do.
  if(inside)return `${lead} ${noun}${named} (${ids})${content&&!snapped&&!target.element?`, ${content}`:''}.${detailText(target,view)}${stateText(target)}`;
  const where=target.whole?`whole${target.spot&&[target.spot.x,target.spot.y].every(finite)?`; the reviewer clicked at x ${target.spot.x.toFixed(2)}, y ${target.spot.y.toFixed(2)} of it`:''}${content?`; ${content}`:''}`
    :r&&[r.x,r.y,r.w,r.h].every(finite)?`region x ${range(r.x,r.x+r.w)}, y ${range(r.y,r.y+r.h)} of the ${noun}'s own box (fractions 0 to 1 from its top left)${content?`; ${content}`:''}`:'whole';
  return `${outside?`${outside} `:''}${target.whole?'':'part of '}${noun}${named} (${ids}), ${where}.${detailText(target,view)}${stateText(target)}`;
}

// ---- round 2: elements, text ranges, snapping, the wand, where a mark was made ----
const cut=(value,max)=>{const v=clean(value);return v.length>max?`${v.slice(0,max-1)}…`:v;};
const count=(n,one,many=`${one}s`)=>`${n} ${n===1?one:many}`;
function elementPhrase(element){
  const name=element.name?` "${cut(element.name,80)}"`:'';
  return `<${element.tag}>${name}${element.role&&element.role!==element.tag?` (role ${element.role})`:''}`;
}
function boxText(box){return `x ${round(box.x)}, y ${round(box.y)}, ${round(box.w)}×${round(box.h)} px`;}
function elementText(element,view,unionMember=false){
  const parts=[`${elementPhrase(element)}`];
  if(element.id)parts.push(`id ${element.id}`);
  if(element.text&&!element.name)parts.push(`text "${cut(element.text,80)}"`);
  parts.push(`selector ${element.selector}`);
  if(!unionMember){
    parts.push(`path ${element.path}`);
    let at=`box ${boxText(element.box)} of the page (document coordinates, scroll included`;
    if(view&&finite(view.scrollY)&&view.scrollY>0)at+=`; the page was scrolled to y ${round(view.scrollY)}, so it sat at y ${round(element.box.y-view.scrollY)} in the reviewer's view`;
    parts.push(`${at})`);
    if(element.frameUrl)parts.push(`in the frame ${element.frameUrl}`);
  }
  return parts.join('; ');
}
function detailText(target,view=null){
  const out=[];
  if(target.element){
    if(target.elements?.length){
      out.push(` Elements (union of ${target.elements.length}), held by ${elementText(target.element,view)}. Members: ${target.elements.map(member=>elementText(member,null,true)).join(' | ')}.`);
    }else out.push(` Element: ${elementText(target.element,view)}.`);
  }
  if(target.text){
    const t=target.text,offsets=finite(t.start)&&finite(t.end)?` (characters ${t.start}–${t.end} of the document)`:'';
    out.push(` Text: "${cut(t.quote,300)}"${offsets}${t.prefix?`; just before it: "…${clean(t.prefix).slice(-40)}"`:''}${t.suffix?`; just after it: "${clean(t.suffix).slice(0,40)}…"`:''}.`);
  }
  return out.join('');
}
// Every point of a shape (a snapped path of several rings: all of them).
const pointsOf=shape=>shape?.rings?.length?shape.rings.flat():shape?.points;
function bounds(shape){
  if(!shape)return null;
  if(shape.kind==='rect')return {x:shape.x,y:shape.y,w:shape.w,h:shape.h};
  const points=pointsOf(shape);
  if(Array.isArray(points)&&points.length){
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys);
    return {x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y};
  }
  if(shape.kind==='point')return {x:shape.x,y:shape.y,w:0,h:0};
  return null;
}
const fractional=place=>place?.kind==='item'&&place.view?.unit==='fraction';
const num=(n,fraction)=>fraction?n.toFixed(2):String(round(n));
function shapeText(shape,{fraction=false,unit='board units',tool}={}){
  const b=bounds(shape);
  if(!b)return 'a shape';
  const tail=unit?` ${unit}`:'';
  const span=`x ${num(b.x,fraction)}–${num(b.x+b.w,fraction)}, y ${num(b.y,fraction)}–${num(b.y+b.h,fraction)}${tail}`;
  switch(shape.kind){
    case 'point':return `a point at x ${num(shape.x,fraction)}, y ${num(shape.y,fraction)}${tail}`;
    case 'rect':return `a rectangle ${span}`;
    case 'swath':return `an area swept with the wand, ${num(shape.width,fraction)}${tail} wide, covering ${span}`;
    default:return `${tool==='lasso'?'a loop':'a stroke'} of ${shape.points?.length??0} points over ${span}`;
  }
}
const SNAP_KIND={object:'an object on the board',dom:'an element of the page',pixels:'a region found in the picture by its edges'};
function placeText(mark,items){
  const place=mark.place;
  if(!place||place.kind!=='item')return `board ${mark.boardId}`;
  const known=items.get(place.itemId);
  const view=place.view,parts=[];
  const px=view.unit!=='fraction';
  const kind=known?.itemKind;
  const frame=kind==='image'?'the image':kind==='html'?'the page':'the document';
  if(px&&(view.scrollY>0||view.scrollX>0))parts.push(`scrolled to ${view.scrollX>0?`x ${round(view.scrollX)}, `:''}y ${round(view.scrollY)} px of ${frame}`);
  else if(px)parts.push(`at the top of ${frame}`);
  parts.push(`at zoom ${round(view.zoom*100)} %`,`in a frame ${round(view.width)}×${round(view.height)} px`);
  const version=place.version===undefined?'':`, version ${place.version}`;
  return `inside the opened item${known?.title?` "${known.title}"`:''} (item ${place.itemId}, on board ${mark.boardId}${version}; the reviewer had it ${parts.join(', ')})`;
}
function toolText(mark){
  if(mark.tool==='click')return mark.via?`click (with ${mark.via==='point'?'the point tool':mark.via})`:'click';
  return mark.tool;
}
function gestureSentence(mark,items){
  const place=mark.place,inside=place?.kind==='item';
  if(!inside&&mark.shape?.kind!=='swath'&&!mark.snap)return '';
  const fraction=fractional(place);
  const kind=inside?(mark.targets.find(t=>t.itemId===place.itemId)?.itemKind||items.get(place.itemId)?.itemKind):null;
  const unit=inside?(fraction?'of the content area':kind==='image'?'px of the image':'px of the page'):'board units';
  const point=mark.tool==='click'&&mark.shape.kind==='point';
  const own=point?`a click at x ${num(mark.shape.x,fraction)}, y ${num(mark.shape.y,fraction)} ${unit}`:shapeText(mark.shape,{fraction,unit,tool:mark.tool});
  if(!mark.snap)return ` The gesture as drawn: ${own}.`;
  const s=mark.snap,b=bounds(s.shape);
  const where=b?`x ${num(b.x,fraction)}–${num(b.x+b.w,fraction)}, y ${num(b.y,fraction)}–${num(b.y+b.h,fraction)} ${unit}`:'outline';
  const parts=s.shape?.rings?.length>1?`; ${s.shape.rings.length} separate outlines`:'';
  return ` Snapped to ${clean(s.label)} (${SNAP_KIND[s.source]}; ${where}${parts}). What was drawn before it snapped: ${own}.`;
}
function cropText(mark){
  if(mark.crop)return ` Crop: ${mark.crop.path} (${mark.crop.width}×${mark.crop.height} px; ${clean(mark.crop.from)}).`;
  const note=clean(mark.cropNote);
  return note?` ${/^no crop/i.test(note)?note:`No crop: ${note}`}`:' No crop.';
}
function spot(shape){
  if(shape?.kind==='point')return {x:shape.x,y:shape.y};
  if(shape?.kind==='rect')return {x:shape.x+shape.w/2,y:shape.y+shape.h/2};
  if(shape?.kind==='path'&&shape.points?.length)return {x:shape.points.reduce((a,p)=>a+p[0],0)/shape.points.length,y:shape.points.reduce((a,p)=>a+p[1],0)/shape.points.length};
  return null;
}
function markLine(mark,items){
  const duration=mark.end-mark.at,when=duration>=500?`${seconds(mark.at)}–${seconds(mark.end)} s`:`${seconds(mark.at)} s`;
  const inside=mark.place?.kind==='item';
  const view=inside?mark.place.view:null;
  const gesture=gestureSentence(mark,items);
  const what=mark.targets.length?`${mark.targets.map((t,i)=>{const lead=mark.tool==='wand'?'Covers':'On';return targetText(t,{inside,view,snapped:!!mark.snap,lead:i?`Also ${lead.toLowerCase()}`:lead,outside:mark.tool==='wand'?(i?'Also covers':'Covers'):i?'Also':''});}).join(' ')}`
    :(()=>{const p=spot(mark.shape);return inside?'Nothing under it.':`${gesture?'Empty':'empty'} board space${p?` at x ${round(p.x)}, y ${round(p.y)} (board coordinates)`:''}, nothing under it.`;})();
  return `[${mark.n}] ${toolText(mark)}, ${when}, ${placeText(mark,items)}:${gesture} ${what}${cropText(mark)}`;
}
export function pointingRead(pointing,{itemTitles=new Map()}={}){
  const sentence=pointing.parts.map(part=>'mark' in part?`[${part.mark}]`:part.text).join('').replace(/[ \t]{2,}/g,' ').trim();
  if(!pointing.marks.length)return sentence;
  const items=new Map();
  for(const mark of pointing.marks)for(const t of mark.targets)if(t.kind==='placement'&&t.itemId&&!items.has(t.itemId))items.set(t.itemId,{title:clean(t.title),itemKind:t.itemKind});
  // An opened item with no target of its own (an inside mark that hit nothing): its title and kind as stored now.
  for(const [id,known] of itemTitles)if(!items.get(id)?.title||!items.get(id)?.itemKind)items.set(id,{title:items.get(id)?.title||clean(known.title),itemKind:items.get(id)?.itemKind||known.itemKind});
  const how=pointing.source==='voice'?'speaking':'typing';
  return [sentence,'',...pointing.marks.map(mark=>markLine(mark,items)),'',`Times are seconds after the reviewer began ${how} (${pointing.startedAt}). Reply in this thread with feedback.reply.`].join('\n');
}
