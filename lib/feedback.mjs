// Independent feedback documents use the same lock, journal and revision as graph edits.
import {randomUUID,createHash} from 'node:crypto';
import {lstat,mkdir,readFile,writeFile,rename,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import {assertId,storeError,withStore,withScopedTransaction,readStoreDocument,listStoreDocumentIds,readStoreSnapshot} from './store.mjs';
import {documentAnchorState,validReanchorHistory} from './document-anchors.mjs';
import {resolveCommentPoint} from '../public/feedback-geometry.js';
import {CROP_PATH,pointingRoot,removeCrops} from './pointing-files.mjs';
import {pointingRead} from './pointing-read.mjs';
const types=new Set(['addComment','replyComment','resolveComment','vote','setCommentStatus','editComment','deleteComment','repinComment']);
// Comment tool (1.1): thread status with history, an addressee, structured references and
// changes, a target label snapshot, and author-only edit/delete that keep history.
export const COMMENT_STATUSES=['open','sent','working','addressed','question','resolved'];
const REF_KINDS=['item','placement','decoration','board'];
const fail=message=>{throw storeError(400,message);};
const object=(value,name)=>{if(!value||typeof value!=='object'||Array.isArray(value))fail(`${name} must be an object.`);return value;};
function keys(value,allowed,name){object(value,name);for(const key of Object.keys(value))if(!allowed.includes(key))fail(`Unknown ${name} field: ${key}.`);}
function text(value,name,max,{empty=false,what}={}){
  // `what` names the thing in the words a person reads (the app shows the refusal after "Not sent:").
  if(what&&typeof value==='string'&&value.length>max)fail(`${what} can be at most ${max.toLocaleString('en-US')} characters.`);
  if(what&&typeof value==='string'&&!empty&&!value.trim())fail(`${what} cannot be empty.`);
  if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())||value.includes('\0'))fail(`Invalid ${name}.`);return value;
}
function actor(value){keys(value,['id','label','kind'],'actor');assertId(value.id);text(value.label,'actor label',120);if(!['human','agent'].includes(value.kind))fail('Actor kind must be human or agent.');return structuredClone(value);}
function addressee(value){keys(value,['kind','id'],'addressee');if(!['agent','human'].includes(value.kind))fail('Addressee kind must be agent or human.');if(value.id!==undefined)assertId(value.id);return structuredClone(value);}
function references(value,name,{change=false}={}){
  if(!Array.isArray(value)||value.length>20)fail(change?'A reply can list at most 20 changes.':'A message can have at most 20 references.');
  for(const entry of value){
    keys(entry,['kind','id','boardId','label',...(change?['note']:[])],name);if(!REF_KINDS.includes(entry.kind))fail(`Unknown ${name} kind.`);assertId(entry.id);
    if(entry.boardId!==undefined)assertId(entry.boardId);if(['placement','decoration'].includes(entry.kind)&&entry.boardId===undefined)fail(`A ${entry.kind} reference needs boardId.`);
    text(entry.label,`${name} label`,120);if(change&&entry.note!==undefined)text(entry.note,'change note',500,{empty:true});
  }
  return structuredClone(value);
}
// A pointing message (team/pointing/CONTRACT.md, version 1): her words and marks in reading order, each mark with
// what it hit and when. Validated and cleaned here. Two forms:
//   input  (an operation): a mark may carry crop:{dataUrl,from?,box?} pixels from the client; nothing here keeps pixels.
//   stored (a thread file): crop:{path,width,height,from,box?} or crop:null with a cropNote; targets may carry `placed`,
//          the object's box when the message was sent (set by the server, so a later move can be told).
// `crops` (from lib/pointing-send.mjs, which has already written the files) maps mark number to {crop}|{note}; without
// it every mark gets crop:null and a note saying no picture was made. Returns the clean record.
const POINTING_TOOLS=['marquee','lasso','laser','point','keyboard','wand','click'],POINTING_TARGETS=['placement','decoration','board'];
// Round 2 (CONTRACT § Round 2): a click names the active tool in `via`; the wand's `swath` shape; `snap`, the outline a
// reference was tidied to (its shape a rect or path).
const POINTING_VIA=['marquee','lasso','wand','point'],POINTING_SNAP=['object','dom','pixels'];
function pointingPath(points,name){if(!Array.isArray(points)||points.length<2||points.length>400)fail(`A ${name} can have 2 to 400 points.`);for(const point of points){if(!Array.isArray(point)||point.length!==2)fail(`Invalid ${name} point.`);coordinate(point[0]);coordinate(point[1]);}}
function pointingSnap(value){
  object(value,'pointing snap');keys(value,['source','label','shape'],'pointing snap');
  if(!POINTING_SNAP.includes(value.source))fail('Unknown pointing snap source.');text(value.label,'pointing snap label',120);
  const shape=value.shape;object(shape,'pointing snap shape');
  if(shape.kind==='rect'){keys(shape,['kind','x','y','w','h'],'pointing snap rect');for(const k of ['x','y','w','h'])coordinate(shape[k]);if(shape.w<0||shape.h<0)fail('Invalid pointing snap rect.');}
  else if(shape.kind==='path'){keys(shape,['kind','points'],'pointing snap path');pointingPath(shape.points,'snapped outline');if(shape.points.length<3)fail('A snapped outline has at least 3 points.');}
  else fail('A pointing snap shape is a rect or a path.');
  return structuredClone(value);
}
// Round 2 (CONTRACT § Round 2): where a mark was made, what element of a page it was on, what text it covered.
const LOOPBACK_HOSTS=new Set(['127.0.0.1','localhost','[::1]']);
function frameUrl(value){
  text(value,'pointing frame address',2000);
  if(value.startsWith('/')&&!value.startsWith('//')&&!value.includes('\\'))return value;
  try{const url=new URL(value);if(['http:','https:'].includes(url.protocol)&&LOOPBACK_HOSTS.has(url.hostname))return value;}catch{/* refused below */}
  fail('A pointing element\'s frame must be a page of this app or a loopback address.');
}
function pointingElement(value,name='pointing element'){
  object(value,name);keys(value,['tag','role','name','text','id','selector','path','box','frameUrl'],name);
  text(value.tag,`${name} tag`,40);if(!/^[a-zA-Z][a-zA-Z0-9:_-]*$/.test(value.tag))fail(`Invalid ${name} tag.`);
  if(value.role!==undefined)text(value.role,`${name} role`,60);
  if(value.name!==undefined)text(value.name,`${name} name`,200,{empty:true});
  if(value.text!==undefined)text(value.text,`${name} text`,300,{empty:true});
  if(value.id!==undefined)text(value.id,`${name} id`,200);
  text(value.selector,`${name} selector`,600);text(value.path,`${name} path`,600);
  object(value.box,`${name} box`);keys(value.box,['x','y','w','h'],`${name} box`);for(const k of ['x','y','w','h'])coordinate(value.box[k]);if(value.box.w<0||value.box.h<0)fail(`Invalid ${name} box.`);
  if(value.frameUrl!==undefined)frameUrl(value.frameUrl);
  return structuredClone(value);
}
function pointingText(value){
  object(value,'pointing text range');keys(value,['quote','prefix','suffix','start','end'],'pointing text range');
  text(value.quote,'pointing text quote',20_000);
  for(const key of ['prefix','suffix'])if(value[key]!==undefined)text(value[key],`pointing text ${key}`,2000,{empty:true});
  if((value.start===undefined)!==(value.end===undefined))fail('Pointing text offsets need both start and end.');
  if(value.start!==undefined&&(!Number.isSafeInteger(value.start)||value.start<0||!Number.isSafeInteger(value.end)||value.end<=value.start||value.end>2_000_000))fail('Invalid pointing text offsets.');
  return structuredClone(value);
}
function pointingPlace(value,boardId){
  object(value,'pointing place');
  if(value.kind==='board'){keys(value,['kind','boardId'],'pointing place');assertId(value.boardId);if(value.boardId!==boardId)fail('A mark\'s place names the board the mark is on.');return structuredClone(value);}
  if(value.kind!=='item')fail('A pointing place is the board or an opened item.');
  keys(value,['kind','itemId','boardId','placementId','version','view'],'pointing place');
  assertId(value.itemId);assertId(value.boardId);if(value.boardId!==boardId)fail('A mark\'s place names the board the mark is on.');
  if(value.placementId!==undefined)assertId(value.placementId);
  if(value.version!==undefined&&!(Number.isSafeInteger(value.version)&&value.version>=0)){text(value.version,'pointing version',80);}
  const view=value.view;object(view,'pointing view');keys(view,['zoom','scrollX','scrollY','width','height','unit'],'pointing view');
  const within=(v,min,max,name)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail(`Invalid pointing view ${name}.`);};
  within(view.zoom,0.05,64,'zoom');within(view.scrollX,0,10_000_000,'scroll');within(view.scrollY,0,10_000_000,'scroll');within(view.width,1,20_000,'width');within(view.height,1,20_000,'height');
  if(view.unit!==undefined)text(view.unit,'pointing view unit',20);
  return structuredClone(value);
}
const NO_CROP_NOTE='No crop: this message did not come through the running app, so no picture was made. The region and objects are exact.';
// `content`: where she pointed in the item's own coordinates (px of the page or image, or fractions of its content area).
function contentRegion(value){
  keys(value,['x','y','w','h','unit','of'],'pointing content');
  if(!['px','fraction'].includes(value.unit))fail('Pointing content is in px or fraction.');
  const limit=value.unit==='fraction'?1:10_000_000;
  for(const k of ['x','y','w','h']){const v=value[k];if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>limit)fail(`Pointing content ${k} must be between 0 and ${limit}.`);}
  if(value.unit==='fraction'&&(value.x+value.w>1.000001||value.y+value.h>1.000001))fail('Pointing content must lie inside the content area.');
  text(value.of,'pointing content name',80);
}
function pointingRecord(value,{stored=false,crops=null,threadId=null,placed=null}={}){
  keys(value,['v','source','startedAt','sentAt','appearance','parts','marks'],'pointing');
  if(value.v!==1)fail('Unsupported pointing version.');if(!['typed','voice'].includes(value.source))fail('Unknown pointing source.');
  if(value.appearance!==undefined&&!['light','dark'].includes(value.appearance))fail('Pointing appearance is light or dark.');
  timestamp(value.startedAt,'pointing start');timestamp(value.sentAt,'pointing sent time');
  const ms=(v,name)=>{if(!Number.isSafeInteger(v)||v<0||v>86_400_000)fail(`Invalid pointing ${name}.`);return v;};
  const unit=(v,name)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)fail(`Pointing ${name} must be between 0 and 1.`);return v;};
  const box=(v,name)=>{keys(v,['x','y','w','h'],name);for(const k of ['x','y','w','h'])coordinate(v[k]);if(v.w<0||v.h<0)fail(`Invalid ${name}.`);return {x:v.x,y:v.y,w:v.w,h:v.h};};
  if(!Array.isArray(value.marks)||value.marks.length>20)fail('A message can have at most 20 marks.');
  if(!Array.isArray(value.parts)||value.parts.length>60)fail('A message can have at most 60 parts: pieces of her words and marks.');
  const numbers=new Set();
  const marks=value.marks.map(mark=>{
    object(mark,'pointing mark');keys(mark,['n','tool','via','at','end','boardId','place','shape','snap','targets','crop','cropNote'],'pointing mark');
    if(!Number.isSafeInteger(mark.n)||mark.n<1||mark.n>20||numbers.has(mark.n))fail('Pointing marks are numbered 1 to 20, once each.');numbers.add(mark.n);
    if(!POINTING_TOOLS.includes(mark.tool))fail('Unknown pointing tool.');
    if(mark.via!==undefined&&(mark.tool!=='click'||!POINTING_VIA.includes(mark.via)))fail('Only a click names the tool it was made with (via).');
    const snap=mark.snap===undefined?undefined:pointingSnap(mark.snap);ms(mark.at,'time');ms(mark.end,'time');if(mark.end<mark.at)fail('A pointing mark ends after it starts.');
    assertId(mark.boardId);
    const place=mark.place===undefined?undefined:pointingPlace(mark.place,mark.boardId);
    const shape=mark.shape;object(shape,'pointing shape');
    if(shape.kind==='rect'){keys(shape,['kind','x','y','w','h'],'pointing rect');for(const k of ['x','y','w','h'])coordinate(shape[k]);if(shape.w<0||shape.h<0)fail('Invalid pointing rect.');}
    else if(shape.kind==='path'){keys(shape,['kind','points'],'pointing path');if(!Array.isArray(shape.points)||shape.points.length<3||shape.points.length>400)fail('A drawn mark can have 3 to 400 points.');for(const point of shape.points){if(!Array.isArray(point)||point.length!==2)fail('Invalid pointing path point.');coordinate(point[0]);coordinate(point[1]);}}
    else if(shape.kind==='point'){keys(shape,['kind','x','y'],'pointing point');coordinate(shape.x);coordinate(shape.y);}
    else if(shape.kind==='swath'){keys(shape,['kind','width','points'],'pointing swath');coordinate(shape.width);if(!(shape.width>0))fail('A wand swath has a width.');pointingPath(shape.points,'wand swath');}
    else fail('Unknown pointing shape.');
    if(!Array.isArray(mark.targets)||mark.targets.length>12)fail('A mark can point at most 12 things.');
    const targets=mark.targets.map(target=>{
      object(target,'pointing target');keys(target,['kind','id','boardId','itemId','itemKind','title','whole','region','spot','content','element','elements','text',...(stored?['placed']:[])],'pointing target');
      if(!POINTING_TARGETS.includes(target.kind))fail('Unknown pointing target kind.');assertId(target.id);assertId(target.boardId);if(target.itemId!==undefined)assertId(target.itemId);
      text(target.itemKind,'pointing item kind',40);text(target.title,'pointing title',120,{empty:true});
      if(typeof target.whole!=='boolean')fail('A pointing target says whether it is whole.');
      if(target.whole&&target.region!==undefined)fail('A whole pointing target has no region.');
      if(target.region!==undefined){keys(target.region,['x','y','w','h'],'pointing region');for(const k of ['x','y','w','h'])unit(target.region[k],'region');}
      if(target.spot!==undefined){keys(target.spot,['x','y'],'pointing spot');for(const k of ['x','y'])unit(target.spot[k],'spot');}
      if(target.content!==undefined)contentRegion(target.content);
      if(target.element!==undefined)pointingElement(target.element);
      if(target.elements!==undefined){
        if(target.element===undefined)fail('A union of elements names the element that holds them.');
        if(!Array.isArray(target.elements)||target.elements.length<2||target.elements.length>12)fail('A union of elements lists 2 to 12 elements.');
        target.elements.forEach(entry=>pointingElement(entry,'pointing union element'));
      }
      if(target.text!==undefined)pointingText(target.text);
      const kept=structuredClone(target);delete kept.placed;
      const was=stored?target.placed:placed?.(target);
      if(was!==undefined)kept.placed=box(was,'pointing placed box');
      return kept;
    });
    let crop=null,cropNote;
    if(stored){
      if(mark.crop!==undefined&&mark.crop!==null){
        object(mark.crop,'pointing crop');keys(mark.crop,['path','width','height','from','box'],'pointing crop');
        const match=CROP_PATH.exec(mark.crop.path);
        if(!match||match[2]!==String(mark.n)||threadId!==null&&match[1]!==threadId)fail('Invalid pointing crop path.');
        if(!Number.isSafeInteger(mark.crop.width)||!Number.isSafeInteger(mark.crop.height)||mark.crop.width<1||mark.crop.height<1)fail('Invalid pointing crop size.');
        text(mark.crop.from,'pointing crop source',1600);
        crop={path:mark.crop.path,width:mark.crop.width,height:mark.crop.height,from:mark.crop.from,...(mark.crop.box!==undefined?{box:box(mark.crop.box,'pointing crop box')}:{})};
      }
      if(mark.cropNote!==undefined)cropNote=text(mark.cropNote,'pointing crop note',400);
      if(!crop&&cropNote===undefined)cropNote=NO_CROP_NOTE;
    }else{
      if(mark.crop!==undefined&&mark.crop!==null){
        object(mark.crop,'pointing crop');keys(mark.crop,['dataUrl','from','box'],'pointing crop');
        if(typeof mark.crop.dataUrl!=='string'||mark.crop.dataUrl.length>2_800_000)fail('Invalid pointing crop.');
        if(mark.crop.from!==undefined)text(mark.crop.from,'pointing crop source',400);if(mark.crop.box!==undefined)box(mark.crop.box,'pointing crop box');
      }
      if(mark.cropNote!==undefined)text(mark.cropNote,'pointing crop note',300);
      const made=crops?.get(mark.n);
      if(made?.crop)crop=made.crop;else cropNote=made?.note||mark.cropNote||NO_CROP_NOTE;
    }
    return {n:mark.n,tool:mark.tool,...(mark.via!==undefined?{via:mark.via}:{}),at:mark.at,end:mark.end,boardId:mark.boardId,...(place?{place}:{}),shape:structuredClone(shape),...(snap?{snap}:{}),targets,crop,...(cropNote!==undefined?{cropNote}:{})};
  });
  const parts=value.parts.map(part=>{
    object(part,'pointing part');
    if(Object.hasOwn(part,'mark')){keys(part,['mark'],'pointing part');if(!numbers.has(part.mark))fail('A pointing part names a mark that is not there.');return {mark:part.mark};}
    keys(part,['text','at','end'],'pointing part');text(part.text,'pointing text',20_000,{empty:true,what:'A message'});ms(part.at,'time');ms(part.end,'time');
    return {text:part.text,at:part.at,end:part.end};
  });
  return {v:1,source:value.source,startedAt:value.startedAt,sentAt:value.sentAt,...(value.appearance?{appearance:value.appearance}:{}),parts,marks};
}
function statusValue(value){if(!COMMENT_STATUSES.includes(value))fail('Unknown comment status.');return value;}
function timestamp(value,name){if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))fail(`Invalid ${name}.`);}
function messageHistory(value,name){
  for(const key of ['editedAt','deletedAt'])if(value[key]!==undefined)timestamp(value[key],key);
  if(value.deletedBy!==undefined)actor(value.deletedBy);if((value.deletedAt===undefined)!==(value.deletedBy===undefined))fail(`Invalid ${name} deletion.`);
  if(value.editHistory!==undefined){if(!Array.isArray(value.editHistory)||value.editHistory.length>50)fail(`Invalid ${name} edit history.`);for(const entry of value.editHistory){keys(entry,['body','refs','at'],'edit');text(entry.body,'edited body',20_000);if(entry.refs!==undefined)references(entry.refs,'reference');timestamp(entry.at,'edit time');}}
}
export const threadStatus=thread=>thread.status??(thread.resolved?'resolved':'open');
// Newest message that is not deleted, else the root author.
export function lastAuthor(thread){for(let i=thread.replies.length-1;i>=0;i--)if(!thread.replies[i].deletedAt)return thread.replies[i].author;return thread.author;}
function coordinate(value){if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>10_000_000)fail('Invalid point coordinate.');return value;}
function anchor(value,itemId){
  object(value,'anchor');
  if(value.kind==='point'){
    keys(value,['kind','x','y','placementId','decorationId','relative'],'point anchor');coordinate(value.x);coordinate(value.y);
    if(value.placementId!==undefined)assertId(value.placementId);
    if(value.decorationId!==undefined)assertId(value.decorationId);
    if(value.placementId&&value.decorationId)fail('Point anchors select at most one target.');
    if(value.relative!==undefined){
      if(!value.placementId&&!value.decorationId)fail('Relative points require a target.');
      keys(value.relative,['x','y'],'relative point');
      for(const axis of ['x','y'])if(typeof value.relative[axis]!=='number'||!Number.isFinite(value.relative[axis])||value.relative[axis]<0||value.relative[axis]>1)fail('Relative point coordinates must be between 0 and 1.');
    }
  }else if(value.kind==='decoration'){
    // An arrow anchor rides along a line decoration; x/y is the creation fallback.
    keys(value,['kind','decorationId','along','offset','x','y'],'arrow anchor');assertId(value.decorationId);coordinate(value.x);coordinate(value.y);
    if(typeof value.along!=='number'||!(value.along>=0&&value.along<=1))fail('along must be between 0 and 1.');
    if(value.offset!==undefined&&(typeof value.offset!=='number'||!Number.isFinite(value.offset)||Math.abs(value.offset)>10000))fail('Invalid arrow anchor offset.');
  }else if(value.kind==='text'){
    keys(value,['kind','quote','prefix','suffix','start','end','sourceRevision','textModel'],'text anchor');
    if(!itemId)fail('Text anchors require itemId.');text(value.quote,'anchor quote',20_000);
    for(const key of ['prefix','suffix'])if(value[key]!==undefined)text(value[key],key,2000,{empty:true});
    if((value.start===undefined)!==(value.end===undefined))fail('Text offsets require both start and end.');
    if(value.start!==undefined&&(!Number.isSafeInteger(value.start)||value.start<0||!Number.isSafeInteger(value.end)||value.end<=value.start||value.end>2_000_000))fail('Invalid text offsets.');
    if(value.sourceRevision!==undefined)text(value.sourceRevision,'source revision',256);
    if(value.textModel!==undefined)text(value.textModel,'text model',80);
  }else fail('Unknown anchor kind.');
  return structuredClone(value);
}
function validateThread(value){
  keys(value,['id','boardId','itemId','anchor','author','body','createdAt','updatedAt','replies','resolved','reanchored','status','statusHistory','to','refs','targetLabel','editedAt','editHistory','deletedAt','deletedBy','updatedRevision','anchorHistory','pointing'],'thread');
  if(value.pointing!==undefined)pointingRecord(value.pointing,{stored:true,threadId:value.id});
  if(value.anchorHistory!==undefined){if(!Array.isArray(value.anchorHistory)||value.anchorHistory.length>50)fail('Invalid anchor history.');for(const entry of value.anchorHistory){keys(entry,['anchor','targetLabel','actor','at'],'anchor history entry');if(entry.anchor!==null)anchor(entry.anchor,value.itemId||'history');if(entry.targetLabel!==undefined)text(entry.targetLabel,'target label',120);actor(entry.actor);timestamp(entry.at,'re-pin time');}}
  if(!validReanchorHistory(value.reanchored)||value.reanchored&&value.anchor?.kind!=='text')fail('Invalid thread re-anchor history.');
  assertId(value.id);assertId(value.boardId);if(value.itemId!==undefined)assertId(value.itemId);
  actor(value.author);text(value.body,'comment body',20_000);if(value.anchor)anchor(value.anchor,value.itemId);
  if(!Array.isArray(value.replies)||value.replies.length>500||typeof value.resolved!=='boolean')fail('Invalid thread replies or resolution.');
  const ids=new Set();
  if(value.status!==undefined&&(statusValue(value.status)==='resolved')!==value.resolved)fail('Thread status and resolved disagree.');
  if(value.statusHistory!==undefined){if(!Array.isArray(value.statusHistory)||value.statusHistory.length>200)fail('Invalid status history.');for(const entry of value.statusHistory){keys(entry,['status','actor','at','note'],'status entry');statusValue(entry.status);if(entry.actor!==undefined)actor(entry.actor);timestamp(entry.at,'status time');if(entry.note!==undefined)text(entry.note,'status note',500,{empty:true});}}
  if(value.to!==undefined)addressee(value.to);if(value.refs!==undefined)references(value.refs,'reference');if(value.targetLabel!==undefined)text(value.targetLabel,'target label',120);
  if(value.updatedRevision!==undefined&&(!Number.isSafeInteger(value.updatedRevision)||value.updatedRevision<0))fail('Invalid thread revision.');
  messageHistory(value,'comment');
  for(const reply of value.replies){keys(reply,['id','author','body','createdAt','refs','changes','editedAt','editHistory','deletedAt','deletedBy'],'reply');if(reply.refs!==undefined)references(reply.refs,'reference');if(reply.changes!==undefined)references(reply.changes,'change',{change:true});messageHistory(reply,'reply');assertId(reply.id);if(ids.has(reply.id))fail('Duplicate reply ID.');ids.add(reply.id);actor(reply.author);text(reply.body,'reply body',20_000);if(!Number.isFinite(Date.parse(reply.createdAt)))fail('Invalid reply timestamp.');}
  for(const key of ['createdAt','updatedAt'])if(!Number.isFinite(Date.parse(value[key])))fail('Invalid thread timestamp.');
  if(Buffer.byteLength(JSON.stringify(value))>1_000_000)fail('Thread has reached its size limit. Start a new thread.');
  return value;
}
function validateOperation(operation){
  const fields={addComment:['boardId','id','itemId','anchor','author','body','to','refs','targetLabel','status','pointing'],replyComment:['threadId','id','author','body','refs','changes','status'],resolveComment:['threadId','resolved','actor'],vote:['itemId','actor','value'],
    setCommentStatus:['threadId','actor','status','to','note'],repinComment:['threadId','actor','anchor','targetLabel'],editComment:['threadId','messageId','actor','body','refs'],deleteComment:['threadId','messageId','actor']}[operation?.type];
  if(!fields)fail('Unknown feedback operation.');keys(operation,['type','expectedRevision','operationId',...fields],'operation');
  for(const key of ['boardId','itemId','threadId','id'])if(operation[key]!==undefined)assertId(operation[key]);
  if(['addComment','replyComment'].includes(operation.type)){actor(operation.author);text(operation.body,'comment body',20_000,{what:'A message'});}
  if(operation.type==='addComment'){assertId(operation.boardId);if(operation.pointing!==undefined)pointingRecord(operation.pointing);if(operation.anchor)anchor(operation.anchor,operation.itemId);if(operation.anchor?.textModel!==undefined&&operation.anchor.textModel!=='markdown-v2')fail('Unsupported text model for a new comment.');}
  if(['replyComment','resolveComment','setCommentStatus','editComment','deleteComment','repinComment'].includes(operation.type))assertId(operation.threadId);
  if(operation.type==='repinComment'){actor(operation.actor);if(!['point','decoration'].includes(operation.anchor?.kind))fail('Re-pin to a point or arrow anchor.');anchor(operation.anchor,'re-pin');}
  if(operation.messageId!==undefined)assertId(operation.messageId);
  if(['setCommentStatus','editComment','deleteComment'].includes(operation.type)||operation.type==='resolveComment'&&operation.actor!==undefined)actor(operation.actor);
  if(operation.type==='editComment')text(operation.body,'comment body',20_000,{what:'A message'});
  if(operation.refs!==undefined)references(operation.refs,'reference');if(operation.changes!==undefined)references(operation.changes,'change',{change:true});
  if(operation.to!==undefined&&!(operation.type==='setCommentStatus'&&operation.to===null))addressee(operation.to);
  if(operation.targetLabel!==undefined)text(operation.targetLabel,'target label',120);if(operation.note!==undefined)text(operation.note,'status note',500,{empty:true});
  if(operation.status!==undefined)statusValue(operation.status);
  if(operation.type==='addComment'&&operation.status!==undefined&&!['open','sent'].includes(operation.status))fail('A new comment starts open or sent.');
  if(operation.type==='addComment'&&operation.status==='sent'&&operation.to?.kind!=='agent')fail('A comment sent at once needs to:{kind:"agent"}.');
  if(operation.type==='setCommentStatus'&&operation.status===undefined&&operation.to===undefined)fail('Provide status or to.');
  if(operation.type==='resolveComment'&&typeof operation.resolved!=='boolean')fail('resolved must be boolean.');
  if(operation.type==='vote'){assertId(operation.itemId);actor(operation.actor);if(![null,'yes','no','abstain'].includes(operation.value))fail('Vote value must be yes, no, abstain or null.');}
}
export const isFeedbackOperation=operation=>types.has(operation?.type);
export const checkFeedbackOperation=validateOperation;
// options.pointingCrops: what lib/pointing-send.mjs made for a pointing message's marks (mark number to {crop}|{note}).
// The box of a placement or drawing as it is now, for a pointing target to remember where it was when she pointed.
const targetBox=(board,target)=>{
  const found=target.kind==='placement'?board.placements?.find(entry=>entry.id===target.id):target.kind==='decoration'?board.decorations?.find(entry=>entry.id===target.id):null;
  return found&&[found.x,found.y,found.width,found.height].every(Number.isFinite)&&found.width>=0&&found.height>=0?{x:found.x,y:found.y,w:found.width,h:found.height}:undefined;
};
async function placedBoxes(tx,pointing){
  const boxes=new Map(),boards=new Map();
  for(const mark of pointing.marks||[])for(const target of mark.targets||[]){
    if(target?.kind==='board'||typeof target?.boardId!=='string')continue;
    if(!boards.has(target.boardId))boards.set(target.boardId,await tx.read('boards',target.boardId,{optional:true}).catch(()=>null));
    const board=boards.get(target.boardId),box=board&&targetBox(board,target);
    if(box)boxes.set(`${target.kind}:${target.boardId}:${target.id}`,box);
  }
  return target=>boxes.get(`${target.kind}:${target.boardId}:${target.id}`);
}
export async function applyFeedbackOperation(config,operation,options={}){
  const applied=await applyFeedback(config,operation,options);
  // Deleting a thread's first message hides the whole message from the agent; its crop pictures go with it.
  if(operation.type==='deleteComment'&&(!operation.messageId||operation.messageId===operation.threadId))await removeCrops(config,operation.threadId).catch(()=>{});
  return applied;
}
async function applyFeedback(config,operation,options={}){
  validateOperation(operation);
  // A status or addressee that would not change returns without a transaction (no revision).
  if(['setCommentStatus','resolveComment'].includes(operation.type)){
    const settled=await withStore(config,async(root,state)=>{
      if(!state)return null;
      const thread=validateThread(await readStoreDocument(root,'threads',operation.threadId)),status=operation.type==='resolveComment'?(operation.resolved?'resolved':'open'):operation.status;
      if(status!==undefined)checkStatusRule(thread,operation.actor,status);
      const same=(status===undefined||threadStatus(thread)===status)&&(operation.to===undefined||JSON.stringify(operation.to)===JSON.stringify(thread.to??null));
      return same?{revision:state.metadata.revision,result:{threadId:thread.id,resolved:thread.resolved,status:threadStatus(thread),...(thread.to?{to:thread.to}:{}),unchanged:true}}:null;
    },{metadataOnly:true});
    if(settled)return settled;
  }
  return withScopedTransaction(config,operation,async tx=>{
    const now=new Date().toISOString();
    if(operation.type==='vote'){
      const item=await tx.read('items',operation.itemId);if(item.deletedAt)throw storeError(404,'Item has been deleted.');
      const votes=structuredClone(item.review?.votes||{});
      if(operation.value===null)delete votes[operation.actor.id];
      else votes[operation.actor.id]={actor:actor(operation.actor),value:operation.value,updatedAt:now};
      if(Object.keys(votes).length>1000)fail('Item vote limit reached.');
      item.review={...item.review,votes,updatedAt:now};item.updatedAt=now;tx.write('items',item.id,item);
      return {itemId:item.id,actorId:operation.actor.id,value:operation.value,totals:voteTotals(votes)};
    }
    if(operation.type==='addComment'){
      const board=await tx.read('boards',operation.boardId);
      if(operation.itemId){const item=await tx.read('items',operation.itemId);if(item.deletedAt)throw storeError(404,'Item has been deleted.');if(!board.placements.some(p=>p.itemId===item.id&&!p.removedAt&&!p.deletedAt))fail('Comment item must belong to this board.');}
      await checkBoardAnchor(tx,board,operation.anchor,operation.itemId);
      const id=operation.id||`comment-${randomUUID()}`;
      if(await tx.read('threads',id,{optional:true}))throw storeError(409,'Comment ID already exists.');
      const status=operation.status||'open',author=actor(operation.author),label=operation.targetLabel??await targetLabelFor(tx,board,operation);
      const thread={id,boardId:board.id,...(operation.itemId?{itemId:operation.itemId}:{}),...(operation.anchor?{anchor:anchor(operation.anchor,operation.itemId)}:{}),author,body:operation.body,createdAt:now,updatedAt:now,replies:[],resolved:false,
        status,statusHistory:[{status,actor:author,at:now}],...(operation.to?{to:addressee(operation.to)}:{}),...(operation.refs?.length?{refs:references(operation.refs,'reference')}:{}),...(label?{targetLabel:label}:{}),...(operation.pointing?{pointing:pointingRecord(operation.pointing,{crops:options.pointingCrops,threadId:id,placed:await placedBoxes(tx,operation.pointing)})}:{}),updatedRevision:tx.metadata.revision+1};
      validateThread(thread);tx.write('threads',id,thread);return {threadId:id,status};
    }
    const thread=validateThread(await tx.read('threads',operation.threadId)),write=()=>{thread.updatedAt=now;thread.updatedRevision=tx.metadata.revision+1;validateThread(thread);tx.write('threads',thread.id,thread);};
    if(operation.type==='replyComment'){
      const id=operation.id||`reply-${randomUUID()}`;
      if(thread.replies.some(reply=>reply.id===id))throw storeError(409,'Reply ID already exists.');
      const author=actor(operation.author);
      if(operation.status!==undefined)checkStatusRule(thread,author,operation.status);
      thread.replies.push({id,author,body:operation.body,createdAt:now,...(operation.refs?.length?{refs:references(operation.refs,'reference')}:{}),...(operation.changes?.length?{changes:references(operation.changes,'change',{change:true})}:{})});
      // A person answering the agent's question or addressed note hands the thread back to it.
      const next=operation.status??(author.kind==='human'&&thread.to?.kind==='agent'&&['question','addressed'].includes(threadStatus(thread))?'sent':undefined);
      if(next!==undefined)moveStatus(thread,next,author,now);
      write();return {threadId:thread.id,replyId:id,status:threadStatus(thread)};
    }
    if(operation.type==='resolveComment'||operation.type==='setCommentStatus'){
      const who=operation.actor?actor(operation.actor):undefined,status=operation.type==='resolveComment'?(operation.resolved?'resolved':'open'):operation.status;
      let changed=false;
      if(status!==undefined){checkStatusRule(thread,who,status);changed=moveStatus(thread,status,who,now,operation.note)||changed;}
      if(operation.to!==undefined&&JSON.stringify(operation.to)!==JSON.stringify(thread.to??null)){if(operation.to===null)delete thread.to;else thread.to=addressee(operation.to);changed=true;}
      if(changed)write();
      return {threadId:thread.id,resolved:thread.resolved,status:threadStatus(thread),...(thread.to?{to:thread.to}:{}),...(changed?{}:{unchanged:true})};
    }
    if(operation.type==='repinComment'){
      // A person may re-pin any thread; an agent only threads it wrote. Earlier anchors are kept.
      const who=actor(operation.actor);
      if(who.kind==='agent'&&(thread.author.kind!=='agent'||thread.author.id!==who.id))throw storeError(403,'An agent may re-pin only comments it wrote.');
      if(thread.anchor?.kind==='text')fail('Text comments follow their document; they are not re-pinned.');
      const board=await tx.read('boards',thread.boardId),next=structuredClone(operation.anchor);
      await checkBoardAnchor(tx,board,next,undefined);
      const placement=next.kind==='point'&&next.placementId?board.placements.find(p=>p.id===next.placementId):null;
      const label=operation.targetLabel??await targetLabelFor(tx,board,{anchor:next,itemId:placement?.itemId});
      thread.anchorHistory=[...(thread.anchorHistory||[]),{anchor:thread.anchor??null,...(thread.targetLabel?{targetLabel:thread.targetLabel}:{}),actor:who,at:now}].slice(-50);
      thread.anchor=next;if(placement)thread.itemId=placement.itemId;else delete thread.itemId;
      if(label)thread.targetLabel=label;else delete thread.targetLabel;
      write();return {threadId:thread.id,anchor:thread.anchor,...(thread.targetLabel?{targetLabel:thread.targetLabel}:{})};
    }
    // editComment / deleteComment: the message's own author only; earlier versions are kept.
    const messageId=operation.messageId&&operation.messageId!==thread.id?operation.messageId:null,message=messageId?thread.replies.find(reply=>reply.id===messageId):thread;
    if(!message)throw storeError(404,'Comment message not found.');
    const who=actor(operation.actor);
    if(message.author.id!==who.id||message.author.kind!==who.kind)throw storeError(403,'Only the author can edit or delete this comment.');
    if(message.deletedAt)throw storeError(409,'This comment has been deleted.');
    if(operation.type==='editComment'){
      message.editHistory=[...(message.editHistory||[]),{body:message.body,...(message.refs?{refs:message.refs}:{}),at:message.editedAt||message.createdAt}].slice(-50);
      message.body=operation.body;if(operation.refs!==undefined){if(operation.refs.length)message.refs=references(operation.refs,'reference');else delete message.refs;}message.editedAt=now;
    }else{message.deletedAt=now;message.deletedBy=who;}
    write();
    return {threadId:thread.id,messageId:messageId||thread.id,...(operation.type==='deleteComment'?{threadDeleted:threadHidden(thread)}:{})};
  });
}
// A deleted root with no live replies hides the whole thread from default listings.
export const threadHidden=thread=>!!thread.deletedAt&&thread.replies.every(reply=>reply.deletedAt);
// The agent never resolves or reopens a person's comment; it replies and sets addressed.
function checkStatusRule(thread,who,status){
  if(who?.kind==='agent'&&thread.author.kind==='human'&&['resolved','open'].includes(status))throw storeError(403,'An agent cannot resolve or reopen a person\'s comment. Reply with what changed and set it to addressed; the author resolves it.');
}
function moveStatus(thread,status,who,at,note){
  if(threadStatus(thread)===status)return false;
  thread.status=status;thread.resolved=status==='resolved';
  thread.statusHistory=[...(thread.statusHistory||[]),{status,...(who?{actor:who}:{}),at,...(note?{note}:{})}].slice(-200);
  return true;
}
// The name of what a comment was placed on, kept so a pin can say what it was on after a delete.
// A point or arrow anchor must name a live target on this board.
async function checkBoardAnchor(tx,board,a,itemId){
  if(a?.kind==='decoration'){if(!(board.decorations||[]).some(d=>d.id===a.decorationId&&d.type==='line'))fail('An arrow anchor needs a line on this board.');if(itemId)fail('An arrow anchor has no item.');return;}
  if(a?.kind!=='point')return;
  if(a.placementId&&!board.placements.some(p=>p.id===a.placementId&&!p.removedAt&&!p.deletedAt&&!p.archivedAt))fail('Point placement must belong to this board.');
  if(a.decorationId&&!(board.decorations||[]).some(d=>d.id===a.decorationId))fail('Point decoration must belong to this board.');
  if(itemId&&a.placementId&&!board.placements.some(p=>p.id===a.placementId&&p.itemId===itemId))fail('Point placement does not match comment item.');
  if(a.relative){
    const placement=board.placements.find(p=>p.id===a.placementId);
    const item=placement?await tx.read('items',placement.itemId):null;
    const point=resolveCommentPoint(a,{...board,...(item?{items:{[item.id]:item}}:{})});
    if(point.detached)fail('Relative point target geometry is unavailable.');
  }
}
async function targetLabelFor(tx,board,operation){
  const a=operation.anchor,label=value=>String(value||'').replace(/\s+/g,' ').trim().slice(0,120)||undefined;
  if((a?.kind==='point'||a?.kind==='decoration')&&a.decorationId){const d=(board.decorations||[]).find(entry=>entry.id===a.decorationId);if(!d)return undefined;return label(d.text?.split('\n')[0].slice(0,60))||({text:'Text',region:'Shape',line:'Arrow'}[d.type]||'Drawing');}
  const placementId=a?.kind==='point'?a.placementId:undefined,placement=placementId&&board.placements.find(p=>p.id===placementId);
  const itemId=placement?.itemId||operation.itemId;if(!itemId)return undefined;
  const item=await tx.read('items',itemId,{optional:true});return label(item?.title);
}
export function voteTotals(votes={}){const totals={yes:0,no:0,abstain:0};for(const vote of Object.values(votes))if(Object.hasOwn(totals,vote.value))totals[vote.value]++;return totals;}
function compare(a,b){return a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id);}
function summary(thread){return {id:thread.id,boardId:thread.boardId,...(thread.itemId?{itemId:thread.itemId}:{}),...(thread.anchor?{anchor:thread.anchor}:{}),author:thread.author,excerpt:thread.deletedAt?'':thread.body.slice(0,240),createdAt:thread.createdAt,updatedAt:thread.updatedAt,replyCount:thread.replies.filter(reply=>!reply.deletedAt).length,resolved:thread.resolved,
  status:threadStatus(thread),...(thread.to?{to:thread.to}:{}),...(thread.refs&&!thread.deletedAt?{refs:thread.refs}:{}),...(thread.targetLabel?{targetLabel:thread.targetLabel}:{}),lastAuthor:lastAuthor(thread),updatedRevision:thread.updatedRevision??0,...(threadHidden(thread)?{deleted:true}:{})};}
// Rebuildable derived summaries, sharded across 32 files. Source stat identities
// are checked under the existing lock, including across fresh CLI processes.
const feedbackIndexes=new Map();
const bucketFor=id=>(parseInt(createHash('sha256').update(id).digest('hex').slice(0,2),16)%32).toString(16).padStart(2,'0');
function validateSummary(value){
  keys(value,['id','boardId','itemId','anchor','author','excerpt','createdAt','updatedAt','replyCount','resolved','status','to','refs','targetLabel','lastAuthor','updatedRevision','deleted'],'feedback summary');
  if(value.status===undefined||value.lastAuthor===undefined||value.updatedRevision===undefined)fail('Feedback summary predates comment status.');
  assertId(value.id);assertId(value.boardId);if(value.itemId!==undefined)assertId(value.itemId);actor(value.author);text(value.excerpt,'excerpt',240,{empty:true});
  if(value.anchor)anchor(value.anchor,value.itemId);
  if(typeof value.resolved!=='boolean'||!Number.isSafeInteger(value.replyCount)||value.replyCount<0||value.replyCount>500||!Number.isFinite(Date.parse(value.createdAt))||!Number.isFinite(Date.parse(value.updatedAt)))fail('Invalid feedback summary.');
}
async function indexDirectory(root){
  const directory=path.join(root,'feedback-index');
  try{await mkdir(directory);}catch(error){if(error.code!=='EEXIST')throw error;}
  if((await lstat(directory)).isSymbolicLink()||await realpath(directory)!==directory)throw storeError(403,'Feedback index must stay in workspace metadata.');
  try{await writeFile(path.join(directory,'.gitignore'),'*\n',{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
  return directory;
}
// The derived index is written only by commits that touch threads and by explicit rebuilds
// (persist:true, under the workspace lock). Reads use it read-only: one directory listing keeps
// membership current, then only the threads the query can return (a board's or an item's, or
// all) have their file identity checked; a missing or stale summary is computed in memory and
// never written. So many document cards on a big board each check only their own threads.
async function feedbackIndex(root,workspaceId,{read=(collection,id,options)=>readStoreDocument(root,collection,id,options),list=collection=>listStoreDocumentIds(root,collection),pending=false,persist=false,scope=null}={}){
  let cache=feedbackIndexes.get(root);
  if(!cache||cache.workspaceId!==workspaceId){
    cache={workspaceId,records:new Map(),boards:new Map(),items:new Map(),loaded:false,diskDirty:new Set()};feedbackIndexes.set(root,cache);
  }
  while(feedbackIndexes.size>8)feedbackIndexes.delete(feedbackIndexes.keys().next().value);
  let directory=path.join(root,'feedback-index');
  if(persist){try{directory=await indexDirectory(root);}catch{directory=null;/* Derived-cache failure never changes canonical ownership. */}}
  if(!cache.loaded){
    for(let number=0;number<32;number++){
      const bucket=number.toString(16).padStart(2,'0'),file=path.join(directory||'',`${bucket}.json`);
      try{
        if(!directory)throw Error('No index');
        const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8_000_000)throw Error('Invalid bucket');
        const saved=JSON.parse(await readFile(file,'utf8'));
        if(saved.schemaVersion!==2||saved.workspaceId!==workspaceId||!Array.isArray(saved.records)||saved.recordsDigest!==createHash('sha256').update(JSON.stringify(saved.records)).digest('hex'))throw Error('Stale or damaged bucket');
        const entries=[];
        for(const entry of saved.records){keys(entry,['fingerprint','summary'],'index entry');if(typeof entry.fingerprint!=='string'||entry.fingerprint.length>256)throw Error('Bad fingerprint');validateSummary(entry.summary);if(bucketFor(entry.summary.id)!==bucket)throw Error('Wrong bucket');entries.push([entry.summary.id,entry]);}
        for(const [id,entry] of entries)cache.records.set(id,entry);
      }catch{cache.diskDirty.add(bucket);}
    }
    cache.loaded=true;
  }
  const threadsDir=path.join(root,'threads'),ids=await list('threads'),current=new Set(ids);
  if(ids.length>100000)throw storeError(400,'Feedback index limit reached.');
  let changed=cache.boards.size===0&&cache.records.size>0;
  for(const id of cache.records.keys())if(!current.has(id)){cache.records.delete(id);cache.diskDirty.add(bucketFor(id));changed=true;}
  const rebuildMaps=()=>{cache.boards.clear();cache.items.clear();for(const {summary:record} of cache.records.values()){if(!cache.boards.has(record.boardId))cache.boards.set(record.boardId,[]);cache.boards.get(record.boardId).push(record);if(record.itemId){if(!cache.items.has(record.itemId))cache.items.set(record.itemId,[]);cache.items.get(record.itemId).push(record);}}};
  if(changed){rebuildMaps();changed=false;}
  const scoped=scope?.itemId!==undefined?(cache.items.get(scope.itemId)||[]).map(entry=>entry.id):scope?.boardId!==undefined?(cache.boards.get(scope.boardId)||[]).map(entry=>entry.id):null;
  const check=scoped?new Set([...scoped,...ids.filter(id=>!cache.records.has(id))]):current;
  for(const id of check){
    if(!current.has(id))continue;
    let fingerprint;
    try{const stat=await lstat(path.join(threadsDir,`${id}.json`),{bigint:true});if(!stat.isFile()||stat.isSymbolicLink())throw storeError(403,'Feedback must be a regular metadata file.');fingerprint=[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':');}
    catch(error){if(error.status)throw error;fingerprint='pending';}
    // A thread inside an unrecovered journal is always re-read through it.
    if(pending)fingerprint=`pending:${fingerprint}`;
    if(cache.records.get(id)?.fingerprint===fingerprint&&!fingerprint.startsWith('pending'))continue;
    const thread=validateThread(await read('threads',id));cache.records.set(id,{fingerprint,summary:summary(thread)});cache.diskDirty.add(bucketFor(id));changed=true;
  }
  if(changed)rebuildMaps();
  if(persist&&directory)for(const bucket of [...cache.diskDirty]){
    const file=path.join(directory,`${bucket}.json`),temporary=`${file}.${randomUUID()}.tmp`;
    try{
      // Only derived summaries are published, never authoritative message bodies.
      const records=[...cache.records.values()].filter(entry=>bucketFor(entry.summary.id)===bucket&&!entry.fingerprint.startsWith('pending'));
      await writeFile(temporary,JSON.stringify({schemaVersion:2,workspaceId,recordsDigest:createHash('sha256').update(JSON.stringify(records)).digest('hex'),records}),{flag:'wx',mode:0o600});await rename(temporary,file);cache.diskDirty.delete(bucket);
    }catch{/* This cache is optional; canonical feedback remains usable. */}
    finally{await rm(temporary,{force:true}).catch(()=>{});}
  }
  return cache;
}
// Called by commitStore after a commit that wrote threads, and by explicit rebuilds, under the
// workspace lock: brings the on-disk index up to date. Failures never fail the commit.
export async function persistFeedbackIndex(root,{rebuild=false}={}){
  const metadata=JSON.parse(await readFile(path.join(root,'workspace.json'),'utf8'));
  if(rebuild){feedbackIndexes.delete(root);await rm(path.join(root,'feedback-index'),{recursive:true,force:true});}
  await feedbackIndex(root,metadata.id,{persist:true});
}
// Listing helpers read through a lock-free snapshot reader (or a root path under the lock).
const reading=(store,collection,id,options)=>typeof store==='string'?readStoreDocument(store,collection,id,options):store.read(collection,id,options);
// Anchor state for a listed thread: {anchorStatus} plus currentAnchor when a text anchor relocates.
async function anchorState(root,thread,context){const state=await anchorStatus(root,thread,context);return typeof state==='string'?{anchorStatus:state}:{anchorStatus:state.status,...(state.currentAnchor?{currentAnchor:state.currentAnchor}:{})};}
async function anchorStatus(root,thread,{config,resourceRoots,documentSources}={}){
  if(!thread.anchor)return 'general';
  const board=await reading(root,'boards',thread.boardId,{optional:true});
  if(!board)return 'detached';
  if(thread.anchor.kind==='point'||thread.anchor.kind==='decoration')return (await pointLocation(root,thread)).anchorPoint.detached?'detached':'point';
  const item=await reading(root,'items',thread.itemId,{optional:true});
  if(!item||item.deletedAt)return 'detached';
  return documentAnchorState(config,item,thread.anchor,{resourceRoots,documentSources});
}
async function pointLocation(root,thread){
  if(thread.anchor?.kind!=='point'&&thread.anchor?.kind!=='decoration')return {};
  const board=await reading(root,'boards',thread.boardId,{optional:true});
  const placement=board?.placements.find(p=>p.id===thread.anchor.placementId);
  if(placement){const item=await reading(root,'items',placement.itemId,{optional:true});board.items={[placement.itemId]:item||{deletedAt:true}};}
  return {anchorPoint:resolveCommentPoint(thread.anchor,board)};
}
// Text-anchored threads on one item, from the derived index. Call only under withStore.
export async function textThreadIds(root,workspaceId,itemId){const cache=await feedbackIndex(root,workspaceId);return (cache.items.get(itemId)||[]).filter(summary=>summary.anchor?.kind==='text').map(summary=>summary.id);}
export {validateThread};
// References report whether their target still exists, its state and its current name.
const memoRead=(root,memo,collection,id)=>{const key=collection+'/'+id;if(!memo.has(key))memo.set(key,reading(root,collection,id,{optional:true}).catch(()=>null));return memo.get(key);};
async function referenceState(root,ref,memo){
  const read=(collection,id)=>memoRead(root,memo,collection,id);
  const named=value=>{const text=String(value||'').replace(/\s+/g,' ').trim();return text?{currentLabel:text.slice(0,120)}:{};};
  let state='missing',extra={};
  if(ref.kind==='board'){const board=await read('boards',ref.id);if(board){state=board.deletedAt?'deleted':board.archivedAt?'archived':'active';extra=named(board.title);}}
  else if(ref.kind==='item'){const item=await read('items',ref.id);if(item){state=item.deletedAt?'deleted':'active';extra=named(item.title);}}
  else{
    const board=await read('boards',ref.boardId);
    if(board&&ref.kind==='placement'){const placement=board.placements.find(entry=>entry.id===ref.id);if(placement){state=placement.deletedAt?'deleted':placement.removedAt?'removed':placement.archivedAt?'archived':'active';const item=await read('items',placement.itemId);extra=named(item?.title);}}
    if(board&&ref.kind==='decoration'){const decoration=(board.decorations||[]).find(entry=>entry.id===ref.id);if(decoration){state='active';extra=named(String(decoration.text||'').split('\n')[0])||{currentLabel:{text:'Text',region:'Shape',line:'Arrow'}[decoration.type]||'Drawing'};}}
  }
  return {...ref,exists:state==='active'||state==='archived',state,...extra};
}
const withReferenceStates=async(root,list,memo)=>list?Promise.all(list.map(ref=>referenceState(root,ref,memo))):list;
// A listed message: deleted bodies and edit history only with includeHistory.
function shownMessage(message,includeHistory){
  const shown={...message};
  if(!includeHistory){delete shown.editHistory;if(message.deletedAt){shown.body='';shown.refs=[];if(shown.changes)shown.changes=[];}}
  return shown;
}
// A pointing message as an agent reads it: crops as absolute files (and the app's own URL), each target with its state
// now (and its box now, so a move since shows), and `read`, the plain-text rendering (lib/pointing-read.mjs).
async function presentPointing(root,thread,{memo,config}){
  const folder=pointingRoot(config),base=path.dirname(folder);
  const marks=await Promise.all(thread.pointing.marks.map(async mark=>({...mark,
    ...(mark.crop?{crop:{...mark.crop,path:path.join(base,...mark.crop.path.split('/')),url:`/api/pointing/${encodeURIComponent(thread.id)}/${mark.n}`}}:{}),
    targets:await Promise.all(mark.targets.map(async target=>{
      const state=await referenceState(root,target.kind==='board'?{kind:'board',id:target.id,label:target.title||target.id}:{kind:target.kind,id:target.id,boardId:target.boardId,label:target.title||target.id},memo);
      let at;
      if(state.state==='active'&&target.kind!=='board'){const board=await memoRead(root,memo,'boards',target.boardId);at=board&&targetBox(board,target);}
      return {...target,now:{state:state.state,exists:state.exists,...(state.currentLabel?{currentLabel:state.currentLabel}:{}),...(at?{at}:{})}};
    }))})));
  const view={...thread.pointing,marks};
  return {...view,read:pointingRead(view)};
}
async function presentThread(root,thread,{includeHistory,memo,config}){
  const shown=shownMessage(thread,includeHistory);
  if(thread.pointing&&!thread.deletedAt)shown.pointing=await presentPointing(root,thread,{memo,config});else if(thread.deletedAt)delete shown.pointing;
  shown.status=threadStatus(thread);shown.statusHistory=thread.statusHistory||[];shown.lastAuthor=lastAuthor(thread);
  if(shown.refs)shown.refs=await withReferenceStates(root,shown.refs,memo);
  if(Array.isArray(thread.replies))shown.replies=await Promise.all(thread.replies.map(async reply=>{const r=shownMessage(reply,includeHistory);if(r.refs)r.refs=await withReferenceStates(root,r.refs,memo);if(r.changes)r.changes=await withReferenceStates(root,r.changes,memo);return r;}));
  return shown;
}
const sinceToken=(revision,id)=>Buffer.from(JSON.stringify({r:revision,id})).toString('base64url');
function readSince(value){
  if(value==='')return {r:-1,id:''};
  try{if(typeof value!=='string'||value.length>512)throw Error();const token=JSON.parse(Buffer.from(value,'base64url'));if(!Number.isSafeInteger(token.r)||typeof token.id!=='string')throw Error();return token;}catch{fail('Invalid since token.');}
}
const afterToken=(entry,token)=>entry.updatedRevision>token.r||entry.updatedRevision===token.r&&entry.id>token.id;
const bySince=(a,b)=>a.updatedRevision-b.updatedRevision||(a.id<b.id?-1:a.id>b.id?1:0);
export async function listFeedback(config,input={}){
  keys(input,['boardId','itemId','threadId','resolved','limit','cursor','includeBodies','status','to','toId','authorKind','updatedAfter','since','includeHistory','includeDeleted'],'feedback query');
  for(const key of ['boardId','itemId','threadId','toId'])if(input[key]!==undefined)assertId(input[key]);
  for(const key of ['resolved','includeBodies','includeHistory','includeDeleted'])if(input[key]!==undefined&&typeof input[key]!=='boolean')fail(`${key} must be boolean.`);
  const statuses=input.status===undefined?null:(Array.isArray(input.status)?input.status:String(input.status).split(',')).map(value=>statusValue(String(value).trim()));
  if(statuses&&(!statuses.length||statuses.length>6))fail('Provide one to six statuses.');
  if(input.to!==undefined&&!['agent','human'].includes(input.to))fail('to must be agent or human.');
  if(input.authorKind!==undefined&&!['agent','human'].includes(input.authorKind))fail('authorKind must be agent or human.');
  if(input.updatedAfter!==undefined)timestamp(input.updatedAfter,'updatedAfter');
  if(input.since!==undefined&&input.cursor!==undefined)fail('Use since or cursor, not both.');
  const since=input.since===undefined?null:readSince(input.since);
  const limit=input.limit??50;if(!Number.isSafeInteger(limit)||limit<1||limit>100)fail('Feedback limit must be 1–100.');
  const filter={boardId:input.boardId??null,itemId:input.itemId??null,resolved:input.resolved??null,includeBodies:input.includeBodies??false,status:statuses,to:input.to??null,toId:input.toId??null,authorKind:input.authorKind??null,updatedAfter:input.updatedAfter??null,includeHistory:input.includeHistory??false,includeDeleted:input.includeDeleted??false};
  const fingerprint=createHash('sha256').update(JSON.stringify(filter)).digest('hex');
  let cursor;
  if(input.cursor!==undefined){try{if(typeof input.cursor!=='string'||input.cursor.length>1024)throw Error();cursor=JSON.parse(Buffer.from(input.cursor,'base64url'));}catch{fail('Invalid feedback cursor.');}if(cursor.fingerprint!==fingerprint||!Number.isSafeInteger(cursor.revision)||typeof cursor.id!=='string'||typeof cursor.createdAt!=='string')fail('Cursor does not match this query.');}
  const after=input.updatedAfter===undefined?null:Date.parse(input.updatedAfter);
  const matches=entry=>(input.itemId===undefined||entry.itemId===input.itemId)&&(input.resolved===undefined||entry.resolved===input.resolved)&&(!statuses||statuses.includes(entry.status??(entry.resolved?'resolved':'open')))
    &&(input.to===undefined||entry.to?.kind===input.to)&&(input.toId===undefined||entry.to?.id===input.toId)&&(input.authorKind===undefined||entry.author.kind===input.authorKind)
    &&(after===null||Date.parse(entry.updatedAt)>after)&&(input.includeDeleted||!entry.deleted);
  return readStoreSnapshot(config,async(directory,state,reader)=>{
    if(!state)return {revision:0,threads:[],nextCursor:null,...(since?{nextSince:input.since}:{})};
    const root=reader;
    const revision=state.metadata.revision,documentContext={config,resourceRoots:state.metadata.resourceRoots,documentSources:new Map()},memo=new Map(),present={includeHistory:input.includeHistory??false,memo,config};
    if(cursor&&cursor.revision!==revision)throw storeError(409,'Feedback cursor is stale. Restart the query.');
    if(input.threadId){const thread=validateThread(await reading(root,'threads',input.threadId));if(input.boardId!==undefined&&thread.boardId!==input.boardId||!matches({...summary(thread),deleted:undefined}))return {revision,threads:[],nextCursor:null};return {revision,threads:[{...await presentThread(root,thread,present),...await pointLocation(root,thread),...await anchorState(root,thread,documentContext)}],nextCursor:null};}
    const cache=await feedbackIndex(directory,state.metadata.id,{read:reader.read,list:reader.list,pending:reader.pending,scope:input.boardId!==undefined?{boardId:input.boardId}:input.itemId!==undefined?{itemId:input.itemId}:null}),selected=[],order=since?bySince:compare;
    const candidates=input.boardId!==undefined?(cache.boards.get(input.boardId)||[]):input.itemId!==undefined?(cache.items.get(input.itemId)||[]):[...cache.records.values()].map(record=>record.summary);
    for(const thread of candidates){
      if(!matches(thread))continue;
      if(cursor&&compare(thread,cursor)<=0||since&&!afterToken(thread,since))continue;
      selected.push(thread);selected.sort(order);if(selected.length>limit+1)selected.pop();
    }
    let hasMore=selected.length>limit;selected.length=Math.min(selected.length,limit);
    const threads=[];let responseBytes=0;
    for(const entry of selected){
      const thread=input.includeBodies?await presentThread(root,validateThread(await reading(root,'threads',entry.id)),present):{...entry,...(entry.refs?{refs:await withReferenceStates(root,entry.refs,memo)}:{})};
      const result={...thread,...await pointLocation(root,thread),...await anchorState(root,thread,documentContext)},bytes=Buffer.byteLength(JSON.stringify(result));
      if(threads.length&&responseBytes+bytes>2_000_000){hasMore=true;break;}
      threads.push(result);responseBytes+=bytes;
    }
    const last=threads.at(-1);
    if(since)return {revision,threads,nextCursor:null,nextSince:last?sinceToken(last.updatedRevision??0,last.id):input.since,...(hasMore?{hasMore:true}:{})};
    return {revision,threads,nextCursor:hasMore?Buffer.from(JSON.stringify({fingerprint,revision,id:last.id,createdAt:last.createdAt})).toString('base64url'):null};
  });
}
const string={type:'string'},id={type:'string',pattern:'^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$',maxLength:128};
const actorSchema={type:'object',additionalProperties:false,required:['id','label','kind'],properties:{id,label:{type:'string',minLength:1,maxLength:120},kind:{enum:['human','agent']}}};
const arrowAnchorSchema={type:'object',additionalProperties:false,required:['kind','decorationId','along','x','y'],properties:{kind:{const:'decoration'},decorationId:id,along:{type:'number',minimum:0,maximum:1},offset:{type:'number',minimum:-10000,maximum:10000},x:{type:'number',minimum:-10000000,maximum:10000000},y:{type:'number',minimum:-10000000,maximum:10000000}}};
const anchorSchema={oneOf:[arrowAnchorSchema,{type:'object',additionalProperties:false,required:['kind','x','y'],properties:{kind:{const:'point'},x:{type:'number',minimum:-10000000,maximum:10000000},y:{type:'number',minimum:-10000000,maximum:10000000},placementId:id,decorationId:id,relative:{type:'object',additionalProperties:false,required:['x','y'],properties:{x:{type:'number',minimum:0,maximum:1},y:{type:'number',minimum:0,maximum:1}}}},allOf:[{not:{required:['placementId','decorationId']}},{if:{required:['relative']},then:{oneOf:[{required:['placementId']},{required:['decorationId']}]}}]},{type:'object',additionalProperties:false,required:['kind','quote'],properties:{kind:{const:'text'},quote:{type:'string',minLength:1,maxLength:20000},prefix:{...string,maxLength:2000},suffix:{...string,maxLength:2000},start:{type:'integer',minimum:0,maximum:2000000},end:{type:'integer',minimum:1,maximum:2000000},sourceRevision:{...string,maxLength:256},textModel:{const:'markdown-v2'}}}]};
const schema=(properties,required=[])=>({type:'object',additionalProperties:false,properties,required});
const common={expectedRevision:{type:'integer',minimum:0},operationId:id};
const statusSchema={enum:['open','sent','working','addressed','question','resolved']};
const toSchema={type:'object',additionalProperties:false,required:['kind'],properties:{kind:{enum:['agent','human']},id}};
const refSchema=(change=false)=>({type:'array',maxItems:20,items:{type:'object',additionalProperties:false,required:['kind','id','label'],properties:{kind:{enum:['item','placement','decoration','board']},id,boardId:id,label:{type:'string',minLength:1,maxLength:120},...(change?{note:{type:'string',maxLength:500}}:{})}}});
export const feedbackToolDefinitions=[
  {name:'feedback.list',mutating:false,description:'List compact feedback summaries by board/item or inspect one complete thread. Filters: status (one or a list), to (agent|human), toId, authorKind, updatedAfter. Cursor binds the workspace revision; since (start with "") is an inbox position that survives unrelated writes and returns nextSince. Summaries carry status, to, refs, targetLabel and lastAuthor; refs report exists/state/currentLabel. Point results include anchorPoint. Actor names are self-reported.',inputSchema:schema({boardId:id,itemId:id,threadId:id,resolved:{type:'boolean'},status:{oneOf:[statusSchema,{type:'array',minItems:1,maxItems:6,items:statusSchema}]},to:{enum:['agent','human']},toId:id,authorKind:{enum:['agent','human']},updatedAfter:string,since:{type:'string',maxLength:512},limit:{type:'integer',minimum:1,maximum:100},cursor:string,includeBodies:{type:'boolean'},includeHistory:{type:'boolean'},includeDeleted:{type:'boolean'}})},
  {name:'feedback.comment',mutating:true,description:'Add a general, board-point, item or exact text-quote comment. Optional point relative:{x,y} fractions (0–1) require one target and follow its bounds; x/y retains the creation fallback. to:{kind:agent|human,id?} addresses it; status "sent" (with to agent) hands it to the agent at once. refs are structured @ references; targetLabel snapshots what it is on (computed when omitted). Author is a self-reported local identity.',inputSchema:schema({...common,boardId:id,id,itemId:id,anchor:anchorSchema,author:actorSchema,body:{...string,minLength:1,maxLength:20000},to:toSchema,refs:refSchema(),targetLabel:{type:'string',minLength:1,maxLength:120},status:{enum:['open','sent']}},['boardId','author','body'])},
  {name:'feedback.reply',mutating:true,description:'Append a human or agent reply to a stable feedback thread. changes lists what the reply changed ("Changed A"); status moves the thread in the same write (an agent: addressed or question; never resolved on a person\'s thread). A person replying to an agent\'s question or addressed note sends the thread back (sent).',inputSchema:schema({...common,threadId:id,id,author:actorSchema,body:{...string,minLength:1,maxLength:20000},refs:refSchema(),changes:refSchema(true),status:statusSchema},['threadId','author','body'])},
  {name:'feedback.setStatus',mutating:true,description:'Set a thread\'s status (open, sent, working, addressed, question, resolved) and/or its addressee to (null clears), recorded with the actor in statusHistory. Agents may set sent, working, addressed or question; an agent may not resolve or reopen a thread a person wrote. Same status again is a no-op.',inputSchema:schema({...common,threadId:id,actor:actorSchema,status:statusSchema,to:{oneOf:[toSchema,{type:'null'}]},note:{type:'string',maxLength:500}},['threadId','actor'])},
  {name:'feedback.resolve',mutating:true,description:'Resolve or reopen a feedback thread without losing its messages (status resolved or open). Pass actor to record who did it; an agent may not resolve or reopen a thread a person wrote.',inputSchema:schema({...common,threadId:id,resolved:{type:'boolean'},actor:actorSchema},['threadId','resolved'])},
  {name:'feedback.edit',mutating:true,description:'Edit your own comment or reply (messageId; omit for the thread\'s first comment). Only the author (same actor id and kind) may edit; the previous version is kept in editHistory.',inputSchema:schema({...common,threadId:id,messageId:id,actor:actorSchema,body:{...string,minLength:1,maxLength:20000},refs:refSchema()},['threadId','actor','body'])},
  {name:'feedback.repin',mutating:true,description:'Move a comment pin onto a new target on its board: a point anchor (optional placementId or decorationId, with relative) or an arrow anchor {kind:"decoration",decorationId,along,offset?,x,y} on a line. Text comments are not re-pinned. The previous anchor and target label go to anchorHistory. A person may re-pin any comment; an agent only comments it wrote.',inputSchema:schema({...common,threadId:id,actor:actorSchema,anchor:anchorSchema,targetLabel:{type:'string',minLength:1,maxLength:120}},['threadId','actor','anchor'])},
  {name:'feedback.delete',mutating:true,description:'Delete your own comment or reply (messageId; omit for the first comment). Only the author may delete; the message is kept with deletedAt and listed without its body. A deleted first comment with no live replies hides the thread.',inputSchema:schema({...common,threadId:id,messageId:id,actor:actorSchema},['threadId','actor'])},
  {name:'item.vote',mutating:true,description:'Set one current yes/no/abstain vote per self-reported actor on a canonical item. null clears that actor’s vote; references share votes.',inputSchema:schema({...common,itemId:id,actor:actorSchema,value:{enum:['yes','no','abstain',null]}},['itemId','actor','value'])},
];
export function dispatchFeedbackTool(config,name,input){const type={'feedback.comment':'addComment','feedback.reply':'replyComment','feedback.resolve':'resolveComment','feedback.repin':'repinComment','feedback.setStatus':'setCommentStatus','feedback.edit':'editComment','feedback.delete':'deleteComment','item.vote':'vote'}[name];if(name==='feedback.list')return listFeedback(config,input);if(!type)throw storeError(404,'Unknown feedback tool.');return applyFeedbackOperation(config,{type,...input});}
