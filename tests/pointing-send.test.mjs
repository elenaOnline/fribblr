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
import {listFeedback} from '../lib/feedback.mjs';
import {feedbackInbox} from '../lib/inbox.mjs';
import {addPointingComment,renderQueue} from '../lib/pointing-send.mjs';
import {decodeCropDataUrl,pointingRoot} from '../lib/pointing-files.mjs';
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
  assert.match(read,/\[1\].*Now \(card\): moved and resized since \(was x 0, y 0, 300×200; now x 600, y 40, 360×200, in board coordinates; her region is still the same part of the object\)\./);
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
  const response=await post(operation(f,message(f)));
  assert.equal(response.status,200,await response.clone().text());
  const marks=(await threadOf(f)).pointing.marks;
  for(const mark of marks){
    assert.ok(mark.crop,`mark ${mark.n} has a crop: ${mark.cropNote}`);
    const bytes=await readFile(mark.crop.path);
    assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.readUInt32BE(16),mark.crop.width);assert.ok(mark.crop.width>50);
    assert.ok(mark.crop.box&&mark.crop.box.w>0);
  }
});
