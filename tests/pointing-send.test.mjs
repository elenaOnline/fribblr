// Pointing messages through the server side (lib/pointing-send.mjs, pointing-files.mjs, pointing-read.mjs): crops are
// made and written before the thread, cleaned up when the thread cannot be written, a client's own pixels win, bad
// bytes are refused, the crop route stays inside a thread's folder, and an agent reads her sentence with each
// reference resolved, including targets that have moved or gone. A fake cropper stands in for the browser; one
// end-to-end render runs when CHROMIUM_EXECUTABLE is set.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,rm,stat,writeFile,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {main} from '../cli.mjs';
import {loadConfig} from '../lib/config.mjs';
import {applyOperation,getBoardSnapshot} from '../lib/workspace.mjs';
import {listFeedback,applyFeedbackOperation} from '../lib/feedback.mjs';
import {feedbackInbox} from '../lib/inbox.mjs';
import {addPointingComment,renderQueue} from '../lib/pointing-send.mjs';
import {markBox,glitterOf,layersOf,itemRenderSource,cropMarks} from '../lib/pointing-crop.mjs';
import {callTool} from '../lib/tools.mjs';
import {inflateSync} from 'node:zlib';
import {decodeCropDataUrl,pointingRoot,sweepCrops} from '../lib/pointing-files.mjs';
import {listen,closeAppServer} from '../server.mjs';

const robin={id:'robin',label:'Robin',kind:'human'};
const PNG_1X1='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const png=Buffer.from(PNG_1X1,'base64');
const pngUrl=`data:image/png;base64,${PNG_1X1}`;
function jpegBytes(width,height){
  const sof=Buffer.from([0xff,0xc0,0,11,8,height>>8,height&255,width>>8,width&255,1,1,0x11,0]);
  return Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0,0,16,0x4a,0x46,0x49,0x46,0,1,1,0,0,1,0,1,0,0]),sof,Buffer.from([0xff,0xd9])]);
}
const jpegUrl=`data:image/jpeg;base64,${jpegBytes(40,30).toString('base64')}`;
const exists=file=>stat(file).then(()=>true,()=>false);

async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'tinka-pointing-send-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const configPath=path.join(root,'local','config.json');await mkdir(path.join(root,'boards'));
  await main(['init','--config',configPath,'--boards',path.join(root,'boards'),'--label','Pointing send']);
  const config=await loadConfig(configPath),op=operation=>applyOperation(config,operation);
  await op({type:'createBoard',id:'landing',title:'Landing'});
  const make=async(title,x,kind='html')=>{
    const item=(await op({type:'createItem',boardId:'landing',item:{title},placement:{x,y:0,width:300,height:200}})).result;
    const placementId=(await getBoardSnapshot(config,'landing')).placements.find(p=>p.itemId===item.itemId).id;
    return {itemId:item.itemId,placementId,kind};
  };
  const login=await make('Login mock',0),hero=await make('Hero B',400,'image');
  return {config,op,login,hero};
}
const target=(card,title,extra)=>({kind:'placement',id:card.placementId,boardId:'landing',itemId:card.itemId,itemKind:card.kind,title,whole:true,...extra});
const message=(f,{marks}={})=>({v:1,source:'typed',startedAt:'2026-11-24T10:00:00.000Z',sentAt:'2026-11-24T10:00:04.000Z',appearance:'light',
  parts:[{text:'change this ',at:0,end:840},{mark:1},{text:' to look more like this ',at:1900,end:3100},{mark:2}],
  marks:marks||[
    {n:1,tool:'marquee',at:900,end:1250,boardId:'landing',shape:{kind:'rect',x:30,y:60,w:100,h:20},targets:[target(f.login,'Login mock',{whole:false,region:{x:.1,y:.3,w:.33,h:.1}})],crop:null},
    {n:2,tool:'point',at:3200,end:3250,boardId:'landing',shape:{kind:'point',x:500,y:80},targets:[target(f.hero,'Hero B')],crop:null},
  ]});
const operation=(f,pointing,extra={})=>({type:'addComment',id:'pt1',boardId:'landing',author:robin,body:'change this @1 Login mock to look more like this @2 Hero B',to:{kind:'agent'},status:'sent',pointing,...extra});
// A cropper that makes a PNG per mark and records what it was asked.
function fakeCropper(log=[],{during}={}){
  return async ({marks,boardId,appearance})=>{
    log.push({boardId,appearance,marks:marks.map(m=>m.n)});
    await during?.();
    return marks.map(m=>({png,width:1,height:1,from:`fake render of mark ${m.n}`,box:{x:1,y:2,w:30,h:40}}));
  };
}
const threadOf=async(f,id='pt1')=>(await listFeedback(f.config,{threadId:id,includeBodies:true})).threads[0];

test('crops are written before the thread, then the thread keeps their paths; the agent reads them absolute',async t=>{
  const f=await fixture(t),log=[],seen={};
  const cropper=fakeCropper(log,{during:async()=>{
    // (a throw here would be caught as a failed render and show up below as missing crops)
    seen.thread=(await listFeedback(f.config,{})).threads.length;seen.folder=await exists(path.join(pointingRoot(f.config),'pt1'));
  }});
  const result=await addPointingComment(f.config,operation(f,message(f)),{url:'http://127.0.0.1:1/',cropper});
  assert.equal(result.result.threadId,'pt1');
  assert.deepEqual(seen,{thread:0,folder:false},'no thread and no folder yet while rendering');
  assert.deepEqual(log,[{boardId:'landing',appearance:'light',marks:[1,2]}]);
  const folder=path.join(pointingRoot(f.config),'pt1');
  assert.deepEqual((await readdir(folder)).sort(),['1.png','2.png']);
  assert.deepEqual(await readFile(path.join(folder,'1.png')),png);
  const stored=JSON.parse(await readFile(path.join(f.config.workspaceRoot,'threads','pt1.json'),'utf8'));
  assert.deepEqual(stored.pointing.marks[0].crop,{path:'pointing/pt1/1.png',width:1,height:1,from:'fake render of mark 1',box:{x:1,y:2,w:30,h:40}});
  assert.equal(stored.pointing.marks[0].cropNote,undefined);
  assert.equal(stored.pointing.appearance,'light');
  const thread=await threadOf(f);
  assert.equal(thread.pointing.marks[0].crop.path,path.join(f.config.workspaceRoot,'pointing','pt1','1.png'));
  assert.ok(path.isAbsolute(thread.pointing.marks[1].crop.path));
  assert.equal(thread.pointing.marks[0].crop.url,'/api/pointing/pt1/1');
});

test('when the thread cannot be written the crop files are removed',async t=>{
  const f=await fixture(t);
  await assert.rejects(addPointingComment(f.config,operation(f,message(f),{id:'ghost',boardId:'nowhere'}),{url:'http://127.0.0.1:1/',cropper:fakeCropper()}),{status:404});
  assert.equal(await exists(path.join(pointingRoot(f.config),'ghost')),false);
  assert.equal((await listFeedback(f.config,{threadId:'ghost'}).catch(()=>({threads:[]}))).threads.length,0);
});

test('a reused thread id is refused without touching the first thread\'s crops',async t=>{
  const f=await fixture(t);
  await addPointingComment(f.config,operation(f,message(f)),{url:'http://127.0.0.1:1/',cropper:fakeCropper()});
  await assert.rejects(addPointingComment(f.config,operation(f,message(f)),{url:'http://127.0.0.1:1/',cropper:fakeCropper()}),{status:409});
  assert.deepEqual((await readdir(path.join(pointingRoot(f.config),'pt1'))).sort(),['1.png','2.png']);
});

test('a client\'s own pixels win over the render for that mark; the render covers the rest',async t=>{
  const f=await fixture(t),log=[];
  const pointing=message(f);pointing.marks[0].crop={dataUrl:jpegUrl,from:'the image file at full size',box:{x:5,y:6,w:7,h:8}};
  await addPointingComment(f.config,operation(f,pointing),{url:'http://127.0.0.1:1/',cropper:fakeCropper(log)});
  assert.deepEqual(log[0].marks,[2],'the cropper was asked only for mark 2');
  const [first,second]=(await threadOf(f)).pointing.marks;
  assert.equal(first.crop.width,40);assert.equal(first.crop.height,30);assert.equal(first.crop.from,'the image file at full size');assert.deepEqual(first.crop.box,{x:5,y:6,w:7,h:8});
  assert.ok(first.crop.path.endsWith('1.jpg'));assert.equal(second.crop.from,'fake render of mark 2');
  assert.equal((await readFile(first.crop.path)).length,jpegBytes(40,30).length);
});

test('bad crop pixels are refused before any render or write',async t=>{
  const f=await fixture(t),log=[];
  const refuse=async(dataUrl,why)=>{
    const pointing=message(f);pointing.marks[0].crop={dataUrl};
    await assert.rejects(addPointingComment(f.config,operation(f,pointing),{url:'http://127.0.0.1:1/',cropper:fakeCropper(log)}),{status:400},why);
  };
  await refuse(`data:image/png;base64,${Buffer.from('this is not a picture at all, just words').toString('base64')}`,'text labelled png');
  await refuse(`data:image/jpeg;base64,${PNG_1X1}`,'png bytes labelled jpeg');
  await refuse(`data:image/gif;base64,${PNG_1X1}`,'gif');
  await refuse('data:image/png;base64,not base64!','not base64');
  await refuse(`data:image/png;base64,${Buffer.concat([png.subarray(0,33),Buffer.alloc(2*1024*1024)]).toString('base64')}`,'over 2 MB');
  assert.equal(log.length,0);assert.equal(await exists(path.join(pointingRoot(f.config),'pt1')),false);
  assert.equal((await listFeedback(f.config,{})).threads.length,0);
  // the decoder itself
  assert.deepEqual({...decodeCropDataUrl(pngUrl),bytes:undefined},{bytes:undefined,extension:'png',width:1,height:1});
  assert.equal(decodeCropDataUrl(jpegUrl).extension,'jpg');
});

test('the validator: appearance, unknown keys, stored-only fields and forged crop paths are refused',async t=>{
  const f=await fixture(t);
  const send=pointing=>addPointingComment(f.config,operation(f,pointing),{url:'http://127.0.0.1:1/',cropper:fakeCropper()});
  const cases=[
    p=>{p.appearance='sepia';},
    p=>{p.marks[0].crop={path:'pointing/pt1/1.png',width:1,height:1,from:'forged'};},
    p=>{p.marks[0].crop={dataUrl:pngUrl,extra:1};},
    p=>{p.marks[0].crop={from:'no pixels'};},
    p=>{p.marks[0].targets[0].placed={x:0,y:0,w:1,h:1};},
    p=>{p.marks[0].crop={dataUrl:pngUrl,box:{x:0,y:0,w:-1,h:1}};},
  ];
  for(const [i,change] of cases.entries()){const p=message(f);change(p);await assert.rejects(send(p),{status:400},`case ${i}`);}
  assert.equal(await exists(pointingRoot(f.config)),false);
  // light and dark are both accepted, and a message with no appearance too
  for(const appearance of ['dark',undefined]){const p=message(f);if(appearance)p.appearance=appearance;else delete p.appearance;await send(p);await rm(path.join(pointingRoot(f.config),'pt1'),{recursive:true});
    await rm(path.join(f.config.workspaceRoot,'threads','pt1.json'));}
});

test('a failed render still sends the message, with the render\'s own note and no crop',async t=>{
  const f=await fixture(t);
  const note='No crop: no Chrome-family browser was found for the server-side render (set CHROMIUM_EXECUTABLE). The region and objects are exact; there is no picture.';
  await addPointingComment(f.config,operation(f,message(f)),{url:'http://127.0.0.1:1/',cropper:async({marks})=>marks.map(()=>({note}))});
  const marks=(await threadOf(f)).pointing.marks;
  assert.equal(marks[0].crop,null);assert.equal(marks[0].cropNote,note);
  assert.equal(await exists(path.join(pointingRoot(f.config),'pt1')),false,'no files, no folder');
  // a cropper that throws
  await addPointingComment(f.config,operation(f,message(f),{id:'pt2'}),{url:'http://127.0.0.1:1/',cropper:async()=>{throw new Error('browser crashed\nstack');}});
  assert.match((await threadOf(f,'pt2')).pointing.marks[0].cropNote,/render failed \(browser crashed\)/);
});

test('renders run one at a time',async t=>{
  const f=await fixture(t);let running=0,peak=0;
  const cropper=fakeCropper([],{during:async()=>{running++;peak=Math.max(peak,running);await new Promise(r=>setTimeout(r,30));running--;}});
  await Promise.all([1,2,3].map(i=>addPointingComment(f.config,operation(f,message(f),{id:`q${i}`}),{url:'http://127.0.0.1:1/',cropper})));
  assert.equal(peak,1);
  assert.equal(await renderQueue(async()=>'after'),'after');
});

test('a pointing thread written without the server (CLI, tools, an agent) has no crops and says so; client pixels are not kept',async t=>{
  const f=await fixture(t);
  const pointing=message(f);pointing.marks[0].crop={dataUrl:pngUrl};
  await f.op(operation(f,pointing));
  const marks=(await threadOf(f)).pointing.marks;
  for(const mark of marks){assert.equal(mark.crop,null);assert.match(mark.cropNote,/^No crop: .*did not come through the running app/);}
  assert.equal(await exists(pointingRoot(f.config)),false);
});

test('pointing.read: her sentence with [n], then each mark with what it hit and where that is now',async t=>{
  const f=await fixture(t);
  await addPointingComment(f.config,operation(f,message(f)),{url:'http://127.0.0.1:1/',cropper:fakeCropper()});
  let thread=await threadOf(f),read=thread.pointing.read;
  const lines=read.split('\n');
  assert.equal(lines[0],'change this [1] to look more like this [2]');assert.equal(lines[1],'');
  assert.match(lines[2],new RegExp(`^\\[1\\] marquee, 0\\.9 s, board landing: part of card "Login mock" \\(html; placement ${f.login.placementId}, item ${f.login.itemId}\\), region x 0\\.10–0\\.43, y 0\\.30–0\\.40 of the card's own box`));
  assert.match(lines[2],/Now \(card\): still there, not moved\./);
  assert.match(lines[2],new RegExp(`Crop: ${path.join(f.config.workspaceRoot,'pointing','pt1','1.png').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')} \\(1×1 px; fake render of mark 1\\)\\.$`));
  assert.match(lines[3],new RegExp(`^\\[2\\] point, 3\\.2 s, board landing: card "Hero B" \\(image; placement ${f.hero.placementId}, item ${f.hero.itemId}\\), whole\\. Now \\(card\\): still there, not moved\\.`));
  assert.match(lines.at(-1),/^Times are seconds after she began typing \(2026-11-24T10:00:00.000Z\)\. Reply in this thread with feedback\.reply\.$/);
  // later: the first card is moved and resized, the second is removed from the board
  await f.op({type:'updatePlacement',boardId:'landing',placementId:f.login.placementId,patch:{x:600,y:40,width:360}});
  await f.op({type:'remove',boardId:'landing',placementIds:[f.hero.placementId]});
  thread=await threadOf(f);read=thread.pointing.read;
  assert.match(read,/\[1\].*Now \(card\): moved and resized since \(was x 0, y 0, 300×200; now x 600, y 40, 360×200, in board coordinates; the region is stored as fractions of the box, so after a resize it may not be on the same part of the content\)\./);
  assert.match(read,/\[2\].*Now \(card\): removed from the board since/);
  assert.equal(thread.pointing.marks[0].targets[0].now.state,'active');assert.deepEqual(thread.pointing.marks[0].targets[0].now.at,{x:600,y:40,w:360,h:200});
  assert.equal(thread.pointing.marks[1].targets[0].now.state,'removed');
  // deleted for good, and renamed
  await f.op({type:'deleteItem',itemIds:[f.hero.itemId]});
  await f.op({type:'updateItem',itemId:f.login.itemId,patch:{title:'Sign-in mock'}}).catch(()=>{});
  thread=await threadOf(f);
  assert.match(thread.pointing.read,/\[2\].*Now \(card\): (deleted since|removed from the board since)/);
  if(thread.pointing.marks[0].targets[0].now.currentLabel==='Sign-in mock')assert.match(thread.pointing.read,/now titled "Sign-in mock"/);
});

test('pointing.read: empty space, several targets, a note instead of a crop',async t=>{
  const f=await fixture(t);
  const pointing=message(f,{marks:[
    {n:1,tool:'lasso',at:200,end:2600,boardId:'landing',shape:{kind:'path',points:[[0,0],[500,0],[500,300]]},targets:[target(f.login,'Login mock'),target(f.hero,'Hero B')],crop:null},
    {n:2,tool:'point',at:3000,end:3010,boardId:'landing',shape:{kind:'point',x:1500,y:900},targets:[],crop:null},
  ]});
  await addPointingComment(f.config,operation(f,pointing),{url:'http://127.0.0.1:1/',cropper:async({marks})=>[{png,width:1,height:1,from:'f',box:{x:0,y:0,w:1,h:1}},{note:'No crop: the board has nothing drawn to place the region by.'}].slice(0,marks.length)});
  const read=(await threadOf(f)).pointing.read;
  assert.match(read,/\[1\] lasso, 0\.2–2\.6 s, board landing: card "Login mock" \(html;.*\), whole\. Now \(card\): still there, not moved\. Also card "Hero B"/);
  assert.match(read,/\[2\] point, 3\.0 s, board landing: empty board space at x 1500, y 900 \(board coordinates\), nothing under it\. No crop: the board has nothing drawn/);
});

test('pointing.read: a click says where, the content region is given in the item\'s own terms, a resize says what to trust',async t=>{
  const f=await fixture(t);
  const html={x:120,y:900,w:360,h:110,unit:'px',of:'page 1280 px wide'},img={x:528,y:416,w:0,h:0,unit:'px',of:'image 1200 × 800 px'};
  const pointing=message(f,{marks:[
    {n:1,tool:'marquee',at:900,end:1250,boardId:'landing',shape:{kind:'rect',x:30,y:60,w:100,h:20},targets:[target(f.login,'Login mock',{whole:false,region:{x:.1,y:.3,w:.33,h:.1},content:html})],crop:null},
    {n:2,tool:'point',at:3200,end:3250,boardId:'landing',shape:{kind:'point',x:532,y:104},targets:[target(f.hero,'Hero B',{spot:{x:.44,y:.52},content:img})],crop:null},
  ]});
  await addPointingComment(f.config,operation(f,pointing),{url:'http://127.0.0.1:1/',cropper:fakeCropper()});
  let thread=await threadOf(f);
  assert.deepEqual(thread.pointing.marks[1].targets[0].spot,{x:.44,y:.52});assert.deepEqual(thread.pointing.marks[0].targets[0].content,html);
  assert.match(thread.pointing.read,/\[1\].*region x 0\.10–0\.43, y 0\.30–0\.40 of the card's own box \(fractions 0 to 1 from its top left\); in the page \(1280 px wide\): x 120–480 px, y 900–1010 px\./);
  assert.match(thread.pointing.read,/\[2\].*whole; she clicked at x 0\.44, y 0\.52 of it; in the image \(1200 × 800 px\): at x 528 px, y 416 px\./);
  await f.op({type:'updatePlacement',boardId:'landing',placementId:f.login.placementId,patch:{width:360}});
  thread=await threadOf(f);
  assert.match(thread.pointing.read,/resized since \(was x 0, y 0, 300×200; now x 0, y 0, 360×200, in board coordinates; the region is stored as fractions of the box, so after a resize it may not be on the same part of the content; trust the content coordinates given for it\)/);
  assert.doesNotMatch(thread.pointing.read,/still the same part/);
  await f.op({type:'updatePlacement',boardId:'landing',placementId:f.login.placementId,patch:{x:50}});
  assert.match((await threadOf(f)).pointing.read,/moved and resized since/);
  // fractions of a content area
  const frac=message(f,{marks:[{n:1,tool:'marquee',at:900,end:1250,boardId:'landing',shape:{kind:'rect',x:30,y:60,w:100,h:20},targets:[target(f.login,'Login mock',{whole:false,region:{x:.1,y:.3,w:.33,h:.1},content:{x:.1,y:.2,w:.35,h:.3,unit:'fraction',of:'content area'}})],crop:null}]});
  frac.parts=[{text:'this ',at:0,end:500},{mark:1}];
  await addPointingComment(f.config,operation(f,frac,{id:'pt2',body:'this @1 Login mock'}),{url:'http://127.0.0.1:1/',cropper:fakeCropper()});
  assert.match((await threadOf(f,'pt2')).pointing.read,/of its content area: x 0\.10–0\.45, y 0\.20–0\.50\./);
});

test('spot and content are validated; unknown keys are refused',async t=>{
  const f=await fixture(t);
  const refused=async(extra,pattern,count=1)=>{
    const pointing=message(f,{marks:[{n:1,tool:'point',at:900,end:1250,boardId:'landing',shape:{kind:'point',x:30,y:60},targets:[target(f.hero,'Hero B',extra)],crop:null}]});
    pointing.parts=[{mark:1}];
    await assert.rejects(()=>f.op(operation(f,pointing,{id:`bad${count}`})),pattern,JSON.stringify(extra));
  };
  const px={x:1,y:2,w:3,h:4,unit:'px',of:'page 1280 px wide'};
  await refused({spot:{x:1.2,y:.5}},/spot must be between 0 and 1/);
  await refused({spot:{x:.2,y:Number.NaN}},/spot must be between 0 and 1/,2);
  await refused({spot:{x:.2,y:.5,z:1}},/Unknown pointing spot field: z/,3);
  await refused({content:{...px,w:-1}},/content w must be between/,4);
  await refused({content:{...px,unit:'em'}},/px or fraction/,5);
  await refused({content:{...px,of:'x'.repeat(81)}},/Invalid pointing content name/,6);
  await refused({content:{...px,extra:1}},/Unknown pointing content field: extra/,7);
  await refused({content:{x:.8,y:0,w:.5,h:.1,unit:'fraction',of:'content area'}},/inside the content area/,8);
  await refused({content:{...px,x:Infinity}},/content x must be/,9);
  const ok=message(f,{marks:[{n:1,tool:'point',at:900,end:1250,boardId:'landing',shape:{kind:'point',x:30,y:60},targets:[target(f.hero,'Hero B',{spot:{x:0,y:1},content:{...px,w:0,h:0}})],crop:null}]});
  ok.parts=[{mark:1}];
  await f.op(operation(f,ok,{id:'fine'}));
});

test('what a person reads when a message is refused names the limit, not a field',async t=>{
  const f=await fixture(t);
  const long=message(f);long.parts[0].text='x'.repeat(20_001);
  await assert.rejects(()=>f.op(operation(f,long,{id:'a1'})),{message:'A message can be at most 20,000 characters.'});
  await assert.rejects(()=>f.op({type:'addComment',id:'a2',boardId:'landing',author:robin,body:'y'.repeat(20_001)}),{message:'A message can be at most 20,000 characters.'});
  await assert.rejects(()=>f.op({type:'addComment',id:'a3',boardId:'landing',author:robin,body:'  '}),{message:'A message cannot be empty.'});
  const refs=Array.from({length:21},(_,i)=>({kind:'item',id:`item-${i}`,label:'x'}));
  await assert.rejects(()=>f.op({type:'addComment',id:'a4',boardId:'landing',author:robin,body:'hi',refs}),{message:'A message can have at most 20 references.'});
  const marks=Array.from({length:21},(_,n)=>({n:n+1,tool:'point',at:0,end:0,boardId:'landing',shape:{kind:'point',x:1,y:1},targets:[],crop:null}));
  await assert.rejects(()=>f.op(operation(f,message(f,{marks}),{id:'a5'})),{message:'A message can have at most 20 marks.'});
});

test('crop boxes: context grows with the gesture, a whole-object click shows the object, a picked board has no card to find',()=>{
  const unit={scale:1,x:0,y:0},layout=new Map([['placement:p1',{x:1000,y:500,w:600,h:400}]]);
  const rect=(w,h)=>({n:1,tool:'marquee',shape:{kind:'rect',x:0,y:0,w,h},targets:[]});
  const small=markBox(rect(100,60),layout,unit),large=markBox(rect(400,300),layout,unit),huge=markBox(rect(4000,3000),layout,unit);
  assert.equal(small.x,-25,'a quarter of the larger side');assert.equal(small.w,150);
  assert.equal(large.x,-100);assert.equal(large.w,600);
  assert.equal(markBox(rect(40,20),layout,unit).x,-28,'at least the minimum crop (96 wide), centred');
  assert.equal(huge.x,-240,'clamped');
  // a click on a whole object: the object with a thin edge
  const click=markBox({n:1,tool:'point',shape:{kind:'point',x:1200,y:700},targets:[{kind:'placement',id:'p1'}]},layout,unit);
  assert.ok(click.x<=1000&&click.x>=1000-30&&click.w>=600&&click.w<=660,JSON.stringify(click));
  // a board she picked with @ is not found as a placement of the same id
  const picked=markBox({n:1,tool:'keyboard',shape:{kind:'point',x:50,y:50},targets:[{kind:'board',id:'p1'}]},layout,unit);
  assert.deepEqual(picked,{x:50-480,y:50-320,w:960,h:640},'the neighbourhood of the point, not the card of a placement that happens to share its id');
});

test('the inbox says a thread is a pointing message and how many references it has',async t=>{
  const f=await fixture(t);
  await addPointingComment(f.config,operation(f,message(f)),{url:'http://127.0.0.1:1/',cropper:fakeCropper()});
  await f.op({type:'addComment',id:'plain',boardId:'landing',author:robin,body:'just a note',to:{kind:'agent'},status:'sent'});
  const result=await feedbackInbox(f.config,{});
  const listed=Object.fromEntries(result.threads.map(thread=>[thread.threadId,thread]));
  assert.deepEqual(listed.pt1.pointing,{references:2});assert.equal(listed.plain.pointing,undefined);
  assert.match(listed.pt1.snippet,/^change this @1 Login mock to look more like this @2 Hero B$/);
  const configPath=f.config.configPath;
  const text=await main(['inbox','--config',configPath,'--actor','tester']);
  assert.match(text,/\(pointing message, 2 references\): ?|\(pointing message, 2 references\)/);
  assert.doesNotMatch(text.split('\n').find(line=>line.includes('just a note')),/pointing/);
});

test('the crop route serves a thread\'s own crops and nothing else',async t=>{
  const f=await fixture(t);
  await addPointingComment(f.config,operation(f,message(f)),{url:'http://127.0.0.1:1/',cropper:fakeCropper()});
  await writeFile(path.join(f.config.workspaceRoot,'secret.txt'),'secret');
  await mkdir(path.join(pointingRoot(f.config),'other'),{recursive:true});await writeFile(path.join(pointingRoot(f.config),'other','1.png'),png);
  await symlink(path.join(f.config.workspaceRoot,'secret.txt'),path.join(pointingRoot(f.config),'pt1','3.png'));
  const server=await listen(f.config,{port:0});t.after(()=>closeAppServer(server));
  const base=`http://127.0.0.1:${server.address().port}/`;
  const ok=await fetch(`${base}api/pointing/pt1/1`);
  assert.equal(ok.status,200);assert.equal(ok.headers.get('content-type'),'image/png');assert.equal(ok.headers.get('x-content-type-options'),'nosniff');
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()),png);
  const refuse=async(url,status)=>assert.equal((await fetch(base+url)).status,status,url);
  await refuse('api/pointing/pt1/9',404);
  await refuse('api/pointing/pt1/3',404);            // a symlink out of the folder
  await refuse('api/pointing/pt1/0',404);
  await refuse('api/pointing/pt1/01',404);
  await refuse('api/pointing/..%2Fthreads/1',400);
  await refuse('api/pointing/pt1%2F..%2Fother/1',400);
  await refuse('api/pointing/nobody/1',404);
  await refuse('api/pointing/pt1/1.png',404);
  await refuse('api/pointing/pt1/../../secret.txt',404);
  assert.equal((await fetch(`${base}api/pointing/pt1/1`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status>=400,true);
});

test('through the running server: a message with a client crop is written whole, and a body over 1 MB only passes for a pointing message',async t=>{
  const f=await fixture(t);
  const server=await listen(f.config,{port:0});t.after(()=>closeAppServer(server));
  const base=`http://127.0.0.1:${server.address().port}/`;
  const post=body=>fetch(`${base}api/operations`,{method:'POST',headers:{'content-type':'application/json',origin:base.slice(0,-1),'x-tinka-workspace':f.config.workspaceId},body:JSON.stringify(body)});
  // Both marks bring their own pixels, so no browser is needed here.
  const pointing=message(f);for(const mark of pointing.marks)mark.crop={dataUrl:pngUrl};
  const response=await post(operation(f,pointing));
  assert.equal(response.status,200,await response.clone().text());
  const thread=await threadOf(f);
  assert.ok(thread.pointing.marks.every(mark=>mark.crop&&mark.crop.path.endsWith('.png')));
  assert.equal((await fetch(`${base}${thread.pointing.marks[1].crop.url.slice(1)}`)).status,200);
  // 1 MB+ of anything else is refused as before
  const big=await post({type:'addComment',boardId:'landing',author:robin,body:'x'.repeat(1_100_000)});
  assert.equal(big.status,413);
});

const browser=process.env.CHROMIUM_EXECUTABLE;
test('end to end: the server renders the crops of a real board with a headless browser',{skip:!browser&&'set CHROMIUM_EXECUTABLE to run',timeout:120000},async t=>{
  const f=await fixture(t);
  const server=await listen(f.config,{port:0});t.after(()=>closeAppServer(server));
  const base=`http://127.0.0.1:${server.address().port}/`;
  const post=body=>fetch(`${base}api/operations`,{method:'POST',headers:{'content-type':'application/json',origin:base.slice(0,-1),'x-tinka-workspace':f.config.workspaceId},body:JSON.stringify(body)});
  const pointing=message(f);pointing.marks[1].targets[0].spot={x:.44,y:.5};pointing.marks[1].shape={kind:'point',x:532,y:100};
  const response=await post(operation(f,pointing));
  assert.equal(response.status,200,await response.clone().text());
  const marks=(await threadOf(f)).pointing.marks;
  assert.match(marks[0].crop.from,/her gesture drawn dashed in red \(#B33830\)/);assert.match(marks[1].crop.from,/the spot she clicked marked with a dot in red/);
  for(const mark of marks){
    assert.ok(mark.crop,`mark ${mark.n} has a crop: ${mark.cropNote}`);
    const bytes=await readFile(mark.crop.path);
    assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.readUInt32BE(16),mark.crop.width);assert.ok(mark.crop.width>50);
    assert.ok(mark.crop.box&&mark.crop.box.w>0);
  }
});


// ---- round 2: wand, snapping, elements, text ranges, pointing inside the opened item ----
const button={tag:'button',role:'button',name:'Sign in',text:'Sign in',id:'signin',selector:'button#signin',path:'main > form#login > button#signin',box:{x:132,y:1220,w:105,h:38},frameUrl:'/resources/work/login.html?tinka=off'};
const itemPlace=(f,extra={})=>({kind:'item',itemId:f.login.itemId,boardId:'landing',placementId:f.login.placementId,view:{zoom:1.5,scrollX:0,scrollY:900,width:1280,height:720,unit:'px'},...extra});
const one=(f,mark,id='pt1')=>{const p=message(f,{marks:[{n:1,at:900,end:1250,boardId:'landing',crop:null,...mark}]});p.parts=[{text:'this ',at:0,end:500},{mark:1}];return operation(f,p,{id,body:'this @1 Login mock'});};
const send2=(f,op,cropper=fakeCropper())=>addPointingComment(f.config,op,{url:'http://127.0.0.1:1/',cropper});

test('round 2 validation: place, view, element, union, text range, swath; plain refusals and unknown keys',async t=>{
  const f=await fixture(t);
  const click=extra=>({tool:'click',via:'marquee',shape:{kind:'point',x:5,y:6},targets:[target(f.login,'Login mock',extra)]});
  const good=[
    {...click({element:button}),place:itemPlace(f)},
    {...click({element:button,elements:[button,{...button,id:'x',selector:'#x'}]}),place:itemPlace(f,{version:3})},
    {...click({text:{quote:'Pick one verb',prefix:'a ',suffix:' b',start:3,end:16}}),place:itemPlace(f,{version:'v3',view:{zoom:1,scrollX:0,scrollY:0,width:500,height:480,unit:'fraction'}})},
    {...click({}),place:{kind:'board',boardId:'landing'}},
    {tool:'wand',shape:{kind:'swath',width:56,points:[[0,0],[100,10]]},snap:{source:'object',label:'card "Login mock"',shape:{kind:'rect',x:0,y:0,w:300,h:200}},targets:[target(f.login,'Login mock')]},
  ];
  for(const [i,mark] of good.entries()){await send2(f,one(f,mark,`ok${i}`));assert.ok(await threadOf(f,`ok${i}`),`good case ${i}`);}
  const stored=(await threadOf(f,'ok1')).pointing.marks[0];
  assert.equal(stored.place.version,3);assert.equal(stored.targets[0].elements.length,2);assert.equal(stored.targets[0].element.selector,'button#signin');
  const bad=[
    ['place kind',{...good[0],place:{...itemPlace(f),kind:'tab'}},/board or an opened item/],
    ['place on another board',{...good[0],place:{...itemPlace(f),boardId:'elsewhere'}},/names the board the mark is on/],
    ['place unknown key',{...good[0],place:{...itemPlace(f),extra:1}},/Unknown pointing place field/],
    ['view without zoom',{...good[0],place:itemPlace(f,{view:{scrollX:0,scrollY:0,width:1,height:1}})},/Invalid pointing view zoom/],
    ['view zoom NaN-like',{...good[0],place:itemPlace(f,{view:{zoom:0,scrollX:0,scrollY:0,width:100,height:100}})},/Invalid pointing view zoom/],
    ['negative scroll',{...good[0],place:itemPlace(f,{view:{zoom:1,scrollX:0,scrollY:-5,width:100,height:100}})},/Invalid pointing view scroll/],
    ['huge frame',{...good[0],place:itemPlace(f,{view:{zoom:1,scrollX:0,scrollY:0,width:99999,height:100}})},/Invalid pointing view width/],
    ['version object',{...good[0],place:itemPlace(f,{version:{}})},/Invalid pointing version/],
    ['element box not finite',{...click({element:{...button,box:{x:0,y:0,w:Infinity,h:1}}}),place:itemPlace(f)},/Invalid point coordinate/],
    ['element negative size',{...click({element:{...button,box:{x:0,y:0,w:-1,h:1}}}),place:itemPlace(f)},/Invalid pointing element box/],
    ['element selector too long',{...click({element:{...button,selector:'a'.repeat(601)}}),place:itemPlace(f)},/Invalid pointing element selector/],
    ['element tag',{...click({element:{...button,tag:'<script>'}}),place:itemPlace(f)},/Invalid pointing element tag/],
    ['element unknown key',{...click({element:{...button,html:'<b>'}}),place:itemPlace(f)},/Unknown pointing element field: html/],
    ['frame on another site',{...click({element:{...button,frameUrl:'https://example.org/x'}}),place:itemPlace(f)},/page of this app or a loopback address/],
    ['frame protocol-relative',{...click({element:{...button,frameUrl:'//evil.example/x'}}),place:itemPlace(f)},/page of this app or a loopback address/],
    ['union without its ancestor',{tool:'click',shape:{kind:'point',x:1,y:1},targets:[{...target(f.login,'Login mock'),elements:[button,button]}]},/names the element that holds them/],
    ['union of one',{...click({element:button,elements:[button]}),place:itemPlace(f)},/2 to 12 elements/],
    ['union of 13',{...click({element:button,elements:Array.from({length:13},()=>button)}),place:itemPlace(f)},/2 to 12 elements/],
    ['text without a quote',{...click({text:{prefix:'a'}}),place:itemPlace(f)},/Invalid pointing text quote/],
    ['text offsets half given',{...click({text:{quote:'a',start:1}}),place:itemPlace(f)},/need both start and end/],
    ['text offsets backwards',{...click({text:{quote:'a',start:5,end:2}}),place:itemPlace(f)},/Invalid pointing text offsets/],
    ['text unknown key',{...click({text:{quote:'a',x:1}}),place:itemPlace(f)},/Unknown pointing text range field/],
    ['swath without width',{tool:'wand',shape:{kind:'swath',points:[[0,0],[1,1]]},targets:[]},/Invalid point coordinate/],
    ['swath one point',{tool:'wand',shape:{kind:'swath',width:5,points:[[0,0]]},targets:[]},/2 to 400 points/],
    ['snap with a point shape',{tool:'wand',shape:{kind:'swath',width:5,points:[[0,0],[1,1]]},snap:{source:'dom',label:'x',shape:{kind:'point',x:1,y:1}},targets:[]},/rect or a path/],
  ];
  for(const [name,mark,pattern] of bad)await assert.rejects(send2(f,one(f,mark,'bad')),error=>error.status===400&&pattern.test(error.message),name);
  assert.equal(await exists(path.join(pointingRoot(f.config),'bad')),false);
});

test('round 2 pointing.read: a click on a button inside an opened, scrolled page is the whole story',async t=>{
  const f=await fixture(t);
  await send2(f,one(f,{tool:'click',via:'marquee',place:itemPlace(f,{version:3}),shape:{kind:'point',x:184,y:1239},
    snap:{source:'dom',label:'button "Sign in"',shape:{kind:'rect',x:132,y:1220,w:105,h:38}},
    targets:[target(f.login,'Login mock',{element:button,content:{x:132,y:1220,w:105,h:38,unit:'px',of:'page 853 px wide'}})]}));
  const line=(await threadOf(f)).pointing.read.split('\n')[2];
  assert.match(line,/^\[1\] click \(with marquee\), 0\.9 s, inside the opened item "Login mock" \(item \S+, on board landing, version 3; she had it scrolled to y 900 px of the page, at zoom 150 %, in a frame 1280×720 px\): /);
  assert.match(line,/Snapped to button "Sign in" \(an element of the page; x 132–237, y 1220–1258 px of the page\)\. What she did before it snapped: a click at x 184, y 1239 px of the page\./);
  assert.match(line,/On card "Login mock" \(html; placement \S+, item \S+\)\./);
  assert.doesNotMatch(line,/region x|fractions 0 to 1/,'the card\'s own fractions mean nothing inside the item');
  assert.match(line,/Element: <button> "Sign in"; id signin; selector button#signin; path main > form#login > button#signin; box x 132, y 1220, 105×38 px of the page \(document coordinates, scroll included; the page was scrolled to y 900, so it sat at y 320 in her view\); in the frame \/resources\/work\/login\.html\?tinka=off\./);
  assert.match(line,/Now \(card\): still there, not moved\. Crop: /);
});

test('round 2 pointing.read: click via, the wand and what it covered, snapping to an object, a union, a text range, mixed places',async t=>{
  const f=await fixture(t);
  const p=message(f,{marks:[
    {n:1,tool:'click',via:'lasso',at:100,end:100,boardId:'landing',shape:{kind:'point',x:20,y:20},targets:[target(f.login,'Login mock',{spot:{x:.1,y:.1}})],crop:null},
    {n:2,tool:'click',at:200,end:200,boardId:'landing',shape:{kind:'point',x:420,y:30},targets:[target(f.hero,'Hero B')],crop:null},
    {n:3,tool:'wand',at:1000,end:2500,boardId:'landing',shape:{kind:'swath',width:56,points:[[20,180],[150,190],[290,184]]},
      snap:{source:'object',label:'card "Login mock"',shape:{kind:'rect',x:0,y:0,w:300,h:200}},targets:[target(f.login,'Login mock')],crop:null},
    {n:4,tool:'wand',at:3000,end:3800,boardId:'landing',shape:{kind:'swath',width:56,points:[[420,20],[560,30],[690,24]]},targets:[target(f.hero,'Hero B',{whole:false,region:{x:.1,y:0,w:.8,h:.2}})],crop:null},
    {n:5,tool:'marquee',at:4000,end:4400,boardId:'landing',place:itemPlace(f),shape:{kind:'rect',x:132,y:1088,w:590,h:116},
      snap:{source:'dom',label:'2 form fields',shape:{kind:'rect',x:132,y:1088,w:590,h:116}},
      targets:[target(f.login,'Login mock',{element:{...button,tag:'form',role:undefined,name:undefined,text:undefined,id:'login',selector:'form#login',path:'main > form#login'},elements:[{...button,tag:'input',role:'textbox',name:'Email',id:'email',selector:'#email'},{...button,tag:'input',role:'textbox',name:'Password',id:'pw',selector:'#pw'}]})],crop:null},
    {n:6,tool:'lasso',at:5000,end:5500,boardId:'landing',place:itemPlace(f,{view:{zoom:1,scrollX:0,scrollY:0,width:500,height:480,unit:'fraction'}}),shape:{kind:'path',points:[[.1,.6],[.9,.6],[.9,.7],[.1,.7]]},
      targets:[target(f.login,'Login mock',{whole:false,region:{x:.1,y:.6,w:.8,h:.1},text:{quote:'Pick one verb and keep it everywhere',prefix:'page title says "Welcome back". ',suffix:'; the confirmation',start:318,end:354}})],crop:null},
  ]});
  for(const m of p.marks)if(m.place)m.targets.forEach(t=>{for(const k of ['role','name','text'])if(t.element&&t.element[k]===undefined)delete t.element[k];});
  p.parts=[{text:'a ',at:0,end:1},{mark:1},{mark:2},{mark:3},{mark:4},{mark:5},{mark:6}];
  await send2(f,operation(f,p,{body:'a @1 Login mock @2 Hero B @3 Login mock @4 Hero B @5 Login mock @6 Login mock'}),async({marks})=>marks.map(()=>({note:'No crop: test.'})));
  const lines=(await threadOf(f)).pointing.read.split('\n').filter(l=>l.startsWith('['));
  assert.match(lines[0],/^\[1\] click \(with lasso\), 0\.1 s, board landing: card "Login mock"/);
  assert.match(lines[1],/^\[2\] click, 0\.2 s, board landing: card "Hero B"/);
  assert.match(lines[2],/^\[3\] wand, 1\.0–2\.5 s, board landing: Snapped to card "Login mock" \(an object on the board; x 0–300, y 0–200 board units\)\. What she did before it snapped: an area swept with the wand, 56 board units wide, covering x 20–290, y 180–190 board units\. Covers card "Login mock" \(html;/);
  assert.match(lines[3],/^\[4\] wand, 3\.0–3\.8 s, board landing: Her gesture: an area swept with the wand, 56 board units wide, covering x 420–690, y 20–30 board units\. Covers part of card "Hero B"/);
  assert.match(lines[4],/^\[5\] marquee, 4\.0 s, inside the opened item "Login mock"/);
  assert.match(lines[4],/Elements \(union of 2\), held by <form>; id login; selector form#login; path main > form#login; box x 132/);
  assert.match(lines[4],/Members: <input> "Email" \(role textbox\); id email; selector #email \| <input> "Password" \(role textbox\); id pw; selector #pw\./);
  assert.match(lines[5],/^\[6\] lasso, 5\.0–5\.5 s, inside the opened item "Login mock" \(item \S+, on board landing; she had it at zoom 100 %, in a frame 500×480 px\): Her gesture: a loop of 4 points over x 0\.10–0\.90, y 0\.60–0\.70 of the content area\./);
  assert.match(lines[5],/Text: "Pick one verb and keep it everywhere" \(characters 318–354 of the document\); just before it: "…page title says "Welcome back"\."; just after it: "; the confirmation…"\./);
  assert.match(lines.join('\n'),/\[3\].*\n\[4\]/,'one line per mark');
  assert.equal(lines.filter(l=>/board landing:/.test(l)).length,4,'marks on the board say board, the others say inside the opened item');
});

test('round 2 crops: a snapped mark is framed by what it snapped to; a swath by its band; the glitter and outlines follow',()=>{
  const unit={scale:1,x:0,y:0},layout=new Map();
  const raw={kind:'rect',x:0,y:0,w:40,h:20};
  const plain=markBox({n:1,tool:'marquee',shape:raw,targets:[]},layout,unit);
  const snapped=markBox({n:1,tool:'marquee',shape:raw,snap:{source:'dom',label:'x',shape:{kind:'rect',x:500,y:500,w:400,h:300}},targets:[]},layout,unit);
  assert.ok(plain.x<10&&plain.x+plain.w<200,JSON.stringify(plain));
  assert.ok(snapped.x<=500&&snapped.x+snapped.w>=900&&snapped.y<=500&&snapped.y+snapped.h>=800,`framed by the snapped outline: ${JSON.stringify(snapped)}`);
  const swath={kind:'swath',width:60,points:[[100,100],[300,110]]};
  const band=markBox({n:1,tool:'wand',shape:swath,targets:[]},layout,unit);
  assert.ok(band.x<=70&&band.x+band.w>=330&&band.y<=70&&band.y+band.h>=140,`the band's width is inside the frame: ${JSON.stringify(band)}`);
  // glitter: only the wand's own area; a snapped wand fills the snapped outline and keeps her sweep faint
  assert.equal(glitterOf({tool:'marquee',shape:raw}),null);assert.equal(glitterOf({tool:'click',shape:{kind:'point',x:1,y:1}}),null);
  const free=glitterOf({tool:'wand',shape:swath});assert.deepEqual(free.shapes.map(s=>[s.kind,s.alpha]),[['swath',1]]);assert.equal(free.cell,60/14);
  const tied=glitterOf({tool:'wand',shape:swath,snap:{source:'object',label:'c',shape:{kind:'rect',x:0,y:0,w:9,h:9}}});assert.deepEqual(tied.shapes.map(s=>[s.kind,s.alpha]),[['region',1],['swath',0.4]]);
  // outlines: the snapped outline whole, her raw gesture faint; a bare point is a dot; empty space a ring
  const both=layersOf({tool:'marquee',shape:raw,snap:{source:'dom',label:'x',shape:{kind:'rect',x:5,y:5,w:50,h:50}}});
  assert.deepEqual(both.layers.map(l=>l.opacity),[1,0.4]);
  assert.deepEqual(layersOf({tool:'click',shape:{kind:'point',x:3,y:4},targets:[]}).dots,[{at:[3,4],opacity:1}]);
  assert.equal(layersOf({tool:'click',shape:{kind:'point',x:3,y:4}},{ring:true}).layers[0].points.length,24);
  assert.deepEqual(layersOf({tool:'wand',shape:swath}),{layers:[],dots:[]});
});

test('round 2 crops: marks inside an opened item reach the cropper with their frame, zoom, scroll and version',async t=>{
  const f=await fixture(t),log=[];
  const op=one(f,{tool:'click',via:'marquee',place:itemPlace(f,{version:3}),shape:{kind:'point',x:1,y:2},targets:[target(f.login,'Login mock')]});
  await addPointingComment(f.config,op,{url:'http://127.0.0.1:1/',cropper:async request=>{log.push(request);return request.marks.map(()=>({note:'No crop: test.'}));}});
  assert.equal(log.length,1);
  assert.equal(log[0].config,f.config,'the cropper can read the item');
  assert.deepEqual(log[0].marks[0].place.view,{zoom:1.5,scrollX:0,scrollY:900,width:1280,height:720,unit:'px'});
  assert.equal(log[0].marks[0].place.version,3);assert.equal(log[0].marks[0].place.itemId,f.login.itemId);
});

async function workFixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'tinka-pointing-item-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const configPath=path.join(root,'config.json');
  await main(['init','--config',configPath,'--boards',path.join(root,'boards'),'--label','Item crops']);
  await main(['workspace','init','--config',configPath,'--apply']);
  await mkdir(path.join(root,'work'));
  const spacer=Array.from({length:30},(_,i)=>`<p style="height:60px;margin:0">line ${i}</p>`).join('');
  await writeFile(path.join(root,'work/login.html'),`<!doctype html><title>Login</title><body style="margin:0;font:16px system-ui">${spacer}<button id="signin" style="margin:20px;padding:10px 30px">Sign in</button><div style="height:900px"></div></body>`);
  await writeFile(path.join(root,'work/login-v1.html'),'<!doctype html><title>v1</title><body><p>first</p></body>');
  await writeFile(path.join(root,'work/login-v2.html'),'<!doctype html><title>v2</title><body><p>second</p></body>');
  await writeFile(path.join(root,'work/clip.pdf'),'%PDF-1.4');
  const config=await loadConfig(configPath);
  await callTool(config,'workspace.update',{patch:{resourceRoots:{work:{path:'../../work'}}}});
  await callTool(config,'board.create',{id:'looks',title:'Looks'});
  const add=item=>callTool(config,'item.create',{boardId:'looks',item});
  const page=await add({title:'Login',content:{kind:'html',resource:{rootId:'work',path:'login.html'}}});
  const versions=await add({title:'Versions',content:{kind:'html',resource:{rootId:'work',path:'login-v2.html'}}});
  const pdf=await add({title:'Clip',content:{kind:'pdf',resource:{rootId:'work',path:'clip.pdf'}}});
  const remote=await add({title:'Remote',content:{kind:'html',url:'https://example.org/'}});
  const app=await add({title:'App',content:{kind:'html',url:'http://127.0.0.1:9/'}});
  const id=r=>r.result?.itemId||r.itemId;
  return {root,config,page:id(page),versions:id(versions),pdf:id(pdf),remote:id(remote),app:id(app)};
}
const itemMark=(itemId,view={},extra={})=>({n:1,tool:'click',boardId:'looks',place:{kind:'item',itemId,boardId:'looks',view:{zoom:1.5,scrollX:0,scrollY:900,width:1280,height:720,...view}},shape:{kind:'point',x:5,y:5},targets:[],...extra});

test('round 2 crops: what an item render loads, and the honest refusals',async t=>{
  const w=await workFixture(t),url='http://127.0.0.1:1/';
  const source=mark=>itemRenderSource({config:w.config,url,mark,appearance:'light'});
  const page=await source(itemMark(w.page));
  assert.equal(page.source.url,`${url}resources/work/login.html?tinka=off`);assert.equal(page.title,'Login');assert.equal(page.versionNote,'');
  const app=await source(itemMark(w.app));assert.equal(app.source.url,'http://127.0.0.1:9/');assert.equal(app.source.app,true);
  // a version: the file she looked at, or a plain refusal; never another version's picture
  const stack=await source(itemMark(w.versions));
  assert.match(stack.versionNote,/current file|version/);
  assert.match((await source({...itemMark(w.versions),place:{...itemMark(w.versions).place,version:'99'}})).note,/version 99 of "Versions" is not among its saved versions now, and a render of another version would show something she did not look at/);
  assert.match((await source(itemMark(w.pdf))).note,/cannot draw pdf content/);
  assert.match((await source(itemMark(w.remote))).note,/remote page/);
  assert.match((await source(itemMark('no-such-item'))).note,/deleted or cannot be read/);
});

test('round 2 crops: cropMarks keeps board and item marks in order, with notes where nothing can be drawn',async t=>{
  const w=await workFixture(t);
  // no browser needed: every mark refuses before one would start
  const marks=[itemMark(w.pdf,{},{n:1}),itemMark('no-such-item',{},{n:2})];
  const results=await cropMarks({url:'http://127.0.0.1:1/',config:w.config,boardId:'looks',marks,find:async()=>null});
  assert.equal(results.length,2);assert.match(results[0].note,/pdf/);assert.match(results[1].note,/deleted or cannot be read/);
  assert.match((await cropMarks({url:'http://127.0.0.1:1/',config:w.config,boardId:'looks',marks:[itemMark(w.page)],find:async()=>null}))[0].note,/no Chrome-family browser/);
});

test('deleting a pointing thread removes its crops; a server start sweeps folders of threads that are gone',async t=>{
  const f=await fixture(t);
  await addPointingComment(f.config,operation(f,message(f)),{url:'http://127.0.0.1:1/',cropper:fakeCropper()});
  await addPointingComment(f.config,operation(f,message(f),{id:'pt2'}),{url:'http://127.0.0.1:1/',cropper:fakeCropper()});
  const folder=id=>path.join(pointingRoot(f.config),id);
  assert.ok(await exists(folder('pt1')));
  // a reply deleted does not touch the crops; the first message deleted does
  await applyFeedbackOperation(f.config,{type:'replyComment',threadId:'pt1',id:'r1',author:{id:'agent',label:'Agent',kind:'agent'},body:'ok'});
  await applyFeedbackOperation(f.config,{type:'deleteComment',threadId:'pt1',messageId:'r1',actor:{id:'agent',label:'Agent',kind:'agent'}});
  assert.ok(await exists(folder('pt1')),'a deleted reply leaves the crops');
  await applyFeedbackOperation(f.config,{type:'deleteComment',threadId:'pt1',actor:robin});
  assert.equal(await exists(folder('pt1')),false,'the first message deleted: its crops go');
  assert.ok(await exists(folder('pt2')),'another thread\'s crops stay');
  // orphans: a folder with no thread, a folder of a deleted thread (as if the delete had been interrupted), a live thread's folder
  await mkdir(folder('orphan'),{recursive:true});await writeFile(path.join(folder('orphan'),'1.png'),png);
  await mkdir(folder('pt1'),{recursive:true});await writeFile(path.join(folder('pt1'),'1.png'),png);
  assert.deepEqual((await sweepCrops(f.config)).sort(),['orphan','pt1']);
  assert.equal(await exists(folder('orphan')),false);assert.ok(await exists(folder('pt2')));
  assert.deepEqual(await sweepCrops(f.config),[]);
});

// A small PNG reader (8-bit RGB/RGBA, not interlaced), for checking what was drawn.
function readPng(bytes){
  let offset=8,width,height,type,idat=[];
  while(offset<bytes.length){
    const length=bytes.readUInt32BE(offset),name=bytes.toString('latin1',offset+4,offset+8),data=bytes.subarray(offset+8,offset+8+length);
    if(name==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);type=data[9];}
    if(name==='IDAT')idat.push(data);
    offset+=12+length;
  }
  const channels=type===6?4:3,stride=width*channels,raw=inflateSync(Buffer.concat(idat)),pixels=Buffer.alloc(height*stride);
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)],row=raw.subarray(y*(stride+1)+1,(y+1)*(stride+1));
    for(let x=0;x<stride;x++){
      const a=x>=channels?pixels[y*stride+x-channels]:0,b=y?pixels[(y-1)*stride+x]:0,c=x>=channels&&y?pixels[(y-1)*stride+x-channels]:0;
      let v=row[x];
      if(filter===1)v+=a;else if(filter===2)v+=b;else if(filter===3)v+=Math.floor((a+b)/2);
      else if(filter===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);v+=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
      pixels[y*stride+x]=v&255;
    }
  }
  return {width,height,channels,pixels};
}
const redish=({pixels,channels,width,height})=>{let n=0;for(let i=0;i<width*height;i++){const r=pixels[i*channels],g=pixels[i*channels+1],b=pixels[i*channels+2];if(r>150&&g<110&&b<110)n++;}return n;};

const browserPath=process.env.CHROMIUM_EXECUTABLE;
test('real render, round 2: the wand\'s glitter is drawn on the board crop; a click in a scrolled item shows the render with the button outlined',{skip:!browserPath&&'set CHROMIUM_EXECUTABLE to run',timeout:180000},async t=>{
  const w=await workFixture(t);
  await callTool(w.config,'board.create',{id:'second',title:'Second'});
  const server=await listen(w.config,{port:0});t.after(()=>closeAppServer(server));
  const url=`http://127.0.0.1:${server.address().port}/`;
  const board=await getBoardSnapshot(w.config,'looks');
  const placement=board.placements.find(p=>p.itemId===w.page);
  const card=target({placementId:placement.id,itemId:w.page,kind:'html'},'Login',{});
  card.boardId='looks';
  const at={x:placement.x,y:placement.y,w:placement.width,h:placement.height};
  const swath={kind:'swath',width:56,points:[[at.x+20,at.y+at.h*0.5],[at.x+at.w*0.5,at.y+at.h*0.55],[at.x+at.w-20,at.y+at.h*0.5]]};
  const marks=[
    {n:1,tool:'wand',at:0,end:100,boardId:'looks',shape:swath,targets:[card]},
    {n:2,tool:'click',via:'marquee',at:0,end:1,boardId:'looks',shape:{kind:'point',x:at.x+10,y:at.y+10},targets:[card]},
    {...itemMark(w.page,{},{n:3,tool:'click',via:'marquee'}),shape:{kind:'point',x:60,y:1900},snap:{source:'dom',label:'button "Sign in"',shape:{kind:'rect',x:20,y:1840,w:130,h:50}},
      targets:[{...card,element:{tag:'button',name:'Sign in',selector:'#signin',path:'body > button#signin',box:{x:20,y:1840,w:130,h:50}}}]},
  ];
  const results=await cropMarks({url,config:w.config,boardId:'looks',marks,appearance:'light',timeout:90000});
  for(const [i,r] of results.entries())assert.ok(r.png,`mark ${i+1}: ${r.note}`);
  const [wand,plain,item]=results.map(r=>readPng(r.png));
  assert.match(results[0].from,/the wand's area drawn as glitter, as she saw it/);
  assert.match(results[2].from,/item render, not a screenshot of her screen: "Login" \(page\).*laid out 853 px wide \(her frame 1280×720 px at zoom 150 %\); scrolled to x 0, y 900 as she was; shows the snapped outline with context around it/);
  assert.match(results[2].from,/Not reproduced: text she typed into the page/);
  assert.ok(redish(wand)>redish(plain)+400,`glitter flecks are drawn (${redish(wand)} vs ${redish(plain)} red pixels)`);
  assert.ok(redish(item)>150,'the snapped outline is drawn on the item render');
  assert.ok(results[2].box.x<=20&&results[2].box.y<=1840,JSON.stringify(results[2].box));
});
