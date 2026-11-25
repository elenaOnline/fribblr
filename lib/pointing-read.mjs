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

function movedNote(was,now){
  if(!was||!now)return null;
  const moved=!same(was.x,now.x)||!same(was.y,now.y),resized=!same(was.w,now.w)||!same(was.h,now.h);
  if(!moved&&!resized)return null;
  const box=b=>`x ${round(b.x)}, y ${round(b.y)}, ${round(b.w)}×${round(b.h)}`;
  return `${moved&&resized?'moved and resized':moved?'moved':'resized'} since (was ${box(was)}; now ${box(now)}, in board coordinates; her region is still the same part of the object)`;
}
// Where the target is now, from its recorded state and the box it had when she pointed.
function stateText(target){
  const now=target.now;
  if(!now)return '';
  const noun=target.kind==='placement'?'card':target.kind==='board'?'board':'drawing';
  let state;
  switch(now.state){
    case 'active':state=movedNote(target.placed,now.at)||`still there${target.placed&&now.at?', not moved':''}`;break;
    case 'archived':state=`archived since (still exists)`;break;
    case 'deleted':state=`deleted since`;break;
    case 'removed':state=`removed from the board since (the item still exists elsewhere)`;break;
    default:state=`no longer found (deleted since)`;
  }
  const renamed=now.exists&&now.currentLabel&&target.kind!=='decoration'&&clean(now.currentLabel)!==clean(target.title)?`; now titled "${now.currentLabel}"`:'';
  return ` Now (${noun}): ${state}${renamed}.`;
}
function targetText(target){
  const title=clean(target.title),named=title?` "${title}"`:'';
  const ids=target.kind==='placement'?`${target.itemKind}; placement ${target.id}${target.itemId?`, item ${target.itemId}`:''}`
    :target.kind==='decoration'?`${target.itemKind}; decoration ${target.id}`:`board ${target.id}`;
  const noun=target.kind==='placement'?'card':target.kind==='board'?'board':{text:'text',region:'shape',line:'arrow',sticky:'sticky note',container:'container'}[target.itemKind]||'drawing';
  const r=target.region;
  const where=target.whole?'whole':r&&[r.x,r.y,r.w,r.h].every(finite)?`region x ${range(r.x,r.x+r.w)}, y ${range(r.y,r.y+r.h)} of the ${noun}'s own box (fractions 0 to 1 from its top left)`:'whole';
  return `${target.whole?'':'part of '}${noun}${named} (${ids}), ${where}.${stateText(target)}`;
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
function markLine(mark){
  const duration=mark.end-mark.at,when=duration>=500?`${seconds(mark.at)}–${seconds(mark.end)} s`:`${seconds(mark.at)} s`;
  const what=mark.targets.length?mark.targets.map(targetText).join(' Also '):(()=>{const p=spot(mark.shape);return `empty board space${p?` at x ${round(p.x)}, y ${round(p.y)} (board coordinates)`:''}, nothing under it.`;})();
  return `[${mark.n}] ${mark.tool}, ${when}, board ${mark.boardId}: ${what}${cropText(mark)}`;
}
export function pointingRead(pointing){
  const sentence=pointing.parts.map(part=>'mark' in part?`[${part.mark}]`:part.text).join('').replace(/[ \t]{2,}/g,' ').trim();
  if(!pointing.marks.length)return sentence;
  const how=pointing.source==='voice'?'speaking':'typing';
  return [sentence,'',...pointing.marks.map(markLine),'',`Times are seconds after she began ${how} (${pointing.startedAt}). Reply in this thread with feedback.reply.`].join('\n');
}
