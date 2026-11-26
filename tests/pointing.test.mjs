// Pointing mode: what a gesture hits (pointing-geometry.js), the laser's circle, and the server's pointing record on
// addComment (lib/feedback.mjs): accepted and stored, crops dropped with a note, limits and unknown keys refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {main} from '../cli.mjs';
import {loadConfig} from '../lib/config.mjs';
import {applyOperation,getBoardSnapshot} from '../lib/workspace.mjs';
import {listFeedback} from '../lib/feedback.mjs';
import {rectHits,pathHits,areaHits,pointTarget,closedLoop,simplify,clipPolygon,polygonArea} from '../public/pointing-geometry.js';
import {SwathField} from '../public/pointing-wand.js';
import {objectSnap,bestProposal} from '../public/pointing-snap.js';

const card=(id,x,y,w=200,h=150,extra={})=>({key:`placement:${id}`,kind:'placement',id,x,y,w,h,...extra});
const keys=hits=>hits.targets.map(t=>t.candidate.id);

test('a box hits what it covers: whole at 90 %, a part as fractions of the thing, sloppy edges ignored',()=>{
  const list=[card('a',0,0),card('b',220,0),card('c',440,0)];
  // around a and b, grazing c by 10 px
  let hits=rectHits({x:-10,y:-10,w:460,h:170},list);
  assert.deepEqual(keys(hits),['a','b']);assert.ok(hits.targets.every(t=>t.whole));
  // inside a: part of a, as fractions of a's own box
  hits=rectHits({x:20,y:30,w:100,h:60},list);
  assert.deepEqual(keys(hits),['a']);assert.equal(hits.targets[0].whole,false);
  assert.deepEqual(hits.targets[0].region,{x:.1,y:.2,w:.5,h:.4});
  // empty board
  assert.deepEqual(rectHits({x:1000,y:1000,w:50,h:50},list).targets,[]);
});

test('nesting: a part drawn on a card inside a container is the card; a container covered whole stands for its members',()=>{
  const tray={key:'decoration:tray',kind:'decoration',id:'tray',x:0,y:0,w:600,h:400,frame:true};
  const list=[tray,card('a',20,40),card('b',240,40)];
  assert.deepEqual(keys(rectHits({x:30,y:50,w:50,h:40},list)),['a']);
  assert.deepEqual(keys(rectHits({x:-5,y:-5,w:610,h:410},list)),['tray']);
});

test('arrows count only wholly inside, and only when nothing else was hit',()=>{
  const arrow={key:'decoration:l',kind:'decoration',id:'l',x:200,y:60,w:40,h:20,line:true};
  const list=[card('a',0,0),card('b',240,0),arrow];
  assert.deepEqual(keys(rectHits({x:-5,y:-5,w:450,h:160},list)).sort(),['a','b']);
  assert.deepEqual(keys(rectHits({x:195,y:55,w:50,h:30},list)),['l']);
});

test('a lasso hits by area inside the drawn shape; a closed loop simplifies without collapsing',()=>{
  const list=[card('a',0,0),card('b',300,0)];
  const ring=[];for(let a=0;a<=360;a+=10)ring.push([100+90*Math.cos(a*Math.PI/180),75+70*Math.sin(a*Math.PI/180)]);
  const loop=simplify(ring,1,400);
  assert.ok(loop.length>8,'a closed loop keeps its shape');
  const hits=pathHits(loop,list);
  assert.deepEqual(keys(hits),['a']);assert.equal(hits.targets[0].whole,false);
  assert.ok(polygonArea(clipPolygon(loop,{x:0,y:0,w:200,h:150}))>15000);
});

test('a click points at the whole thing, small or big, and carries the spot clicked',()=>{
  const small=pointTarget(card('a',0,0),{x:50,y:50});
  assert.equal(small.whole,true);assert.deepEqual(small.spot,{x:.25,y:.333});assert.equal(small.region,undefined);
  const big=pointTarget(card('m',0,0,1000,800),{x:500,y:200});
  assert.equal(big.whole,true);assert.deepEqual(big.spot,{x:.5,y:.25});
});

test('arrows go by their drawn line: crossed counts alone, enclosed counts alongside others',()=>{
  // a diagonal arrow whose box is 200 x 100 but whose line runs corner to corner
  const arrow={key:'decoration:l',kind:'decoration',id:'l',x:300,y:0,w:200,h:100,line:true,points:[[300,0],[400,50],[500,100]]};
  const list=[card('a',0,0),arrow];
  assert.deepEqual(keys(rectHits({x:380,y:20,w:40,h:60},list)),['l'],'a box across the line');
  assert.equal(rectHits({x:310,y:60,w:40,h:30},list).targets.length,0,'a box in the arrow\'s box but off its line');
  assert.deepEqual(keys(rectHits({x:-5,y:-5,w:520,h:120},list)).sort(),['a','l'],'enclosed: alongside the card');
  assert.deepEqual(keys(rectHits({x:-5,y:-5,w:420,h:160},list)),['a'],'crossed while a card is hit: the card alone');
  const ring=[];for(let d=0;d<360;d+=15)ring.push([400+30*Math.cos(d*Math.PI/180),50+30*Math.sin(d*Math.PI/180)]);
  assert.deepEqual(keys(pathHits(ring,list)),['l'],'a lasso round the middle of the line');
});

test('the laser\'s loose circle: round a thing\'s centre and over most of it is the whole thing; a lasso stays exact',()=>{
  const list=[card('s',0,0,320,220)];
  const ellipse=[];for(let d=0;d<360;d+=10)ellipse.push([160+170*Math.cos(d*Math.PI/180),110+115*Math.sin(d*Math.PI/180)]);
  assert.equal(pathHits(ellipse,list,{loose:true}).targets[0].whole,true);
  assert.equal(pathHits(ellipse,list).targets[0].whole,false);
  // off-centre: a circle over a corner is still a part
  const corner=[];for(let d=0;d<360;d+=10)corner.push([40+120*Math.cos(d*Math.PI/180),40+120*Math.sin(d*Math.PI/180)]);
  assert.equal(pathHits(corner,list,{loose:true}).targets[0].whole,false);
});

test('the laser: a circle closes a loop, a wave does not',()=>{
  const circle=[];for(let a=0,t=0;a<=400;a+=15,t+=16)circle.push([200+60*Math.cos(a*Math.PI/180),200+60*Math.sin(a*Math.PI/180),t]);
  let found=null;for(let i=5;i<=circle.length&&!found;i++)found=closedLoop(circle.slice(0,i));
  assert.ok(found,'a circle is found');
  const wave=[];for(let x=0,t=0;x<600;x+=20,t+=16)wave.push([x,100+(x%40?25:-25),t]);
  let any=null;for(let i=5;i<=wave.length&&!any;i++)any=closedLoop(wave.slice(0,i));
  assert.equal(any,null,'waving is not a circle');
  const back=[];for(let i=0,t=0;i<30;i++,t+=16)back.push([i%2?300:100,100+i*0.5,t]);
  let flat=null;for(let i=5;i<=back.length&&!flat;i++)flat=closedLoop(back.slice(0,i));
  assert.equal(flat,null,'back and forth is not a circle');
  // a deliberate circle drawn slowly (3 s) still counts
  const slow=[];for(let a=0,t=0;a<=380;a+=5,t+=40)slow.push([200+80*Math.cos(a*Math.PI/180),200+60*Math.sin(a*Math.PI/180),t]);
  let late=null;for(let i=5;i<=slow.length&&!late;i++)late=closedLoop(slow.slice(0,i));
  assert.ok(late,'a 3 s circle is found');
  // a scribble's turnaround: thin loops (a cycloid with loops about 15 x 35 px) are not circles
  const scribble=[];for(let i=0,t=0;i<60;i++,t+=16)scribble.push([800+i*6+30*Math.cos(i/3),250+30*Math.sin(i/3),t]);
  let turn=null;for(let i=5;i<=scribble.length&&!turn;i++)turn=closedLoop(scribble.slice(0,i));
  assert.equal(turn,null,'a turnaround loop is not a circle');
});

// ---- the wand (pointing-wand.js) and snapping (pointing-snap.js) ----
const sweep=(pts,width=56,cell=4)=>{const f=new SwathField({width,cell});for(const [x,y] of pts)f.add(x,y);return f;};
const waveOver=(x0,x1,y,passes=4)=>{const pts=[];for(let k=0;k<passes;k++)for(let x=0;x<=20;x++)pts.push([k%2?x1-(x1-x0)*x/20:x0+(x1-x0)*x/20,y+(k-passes/2)*4]);return pts;};
const ring=(cx,cy,rx,ry,from=0,to=380)=>{const pts=[];for(let d=from;d<=to;d+=6)pts.push([cx+rx*Math.cos(d*Math.PI/180),cy+ry*Math.sin(d*Math.PI/180)]);return pts;};
const line=(x0,x1,y)=>{const pts=[];for(let x=x0;x<=x1;x+=6)pts.push([x,y]);return pts;};

test('the wand\'s area: a band; each return of a wave makes it denser; a circle fills its inside, a wave never does',()=>{
  const once=sweep(line(0,300,100)),wave=sweep(waveOver(0,300,100,6));
  let a=0,b=0;once.forEach((i,j,s)=>{a=Math.max(a,s);});wave.forEach((i,j,s)=>{b=Math.max(b,s);});
  assert.ok(b>a+0.3,`a wave is denser than one pass (${a.toFixed(2)} vs ${b.toFixed(2)})`);
  assert.equal(once.contains([150,100]),true);assert.equal(once.contains([150,100+29]),false,'the band is 56 across');
  assert.equal(wave.loops,0,'a wave fills nothing');
  const circle=sweep(ring(300,300,120,90));
  assert.ok(circle.loops>=1);assert.equal(circle.contains([300,300]),true,'the inside of a circle is in the area');
  // a circle that ends short of where it began (no crossing) still closes
  const short=sweep(ring(300,300,120,90,0,345));
  assert.equal(short.contains([300,300]),true,'a circle closed by coming back near its start');
  // the shape rebuilds the same area
  const again=SwathField.fromShape(circle.shape(),4);
  assert.equal(again.count,circle.count);assert.equal(circle.shape().kind,'swath');assert.equal(circle.shape().width,56);
});

test('what the wand points at: a wave over a card, an underline under a heading, a circle round a sticky',()=>{
  const heading={key:'decoration:h',kind:'decoration',id:'h',x:400,y:300,w:360,h:44};
  const sticky={key:'decoration:s',kind:'decoration',id:'s',x:100,y:420,w:160,h:120};
  const list=[card('a',0,0,300,200),card('b',400,0,300,200),heading,sticky];
  let hits=areaHits(sweep(waveOver(40,260,100)),list);
  assert.deepEqual(keys(hits),['a']);
  hits=areaHits(sweep(line(395,765,356)),list);
  assert.deepEqual(keys(hits),['h'],'an underline points at the words above it');assert.ok(hits.targets[0].along>=0.75);
  hits=areaHits(sweep(ring(180,480,130,100)),list);
  assert.deepEqual(keys(hits),['s']);assert.equal(hits.targets[0].whole,true,'a circle round a thing is the whole thing');
  // travel: one quick pass across the gap between cards touches nothing enough to count
  assert.deepEqual(keys(areaHits(sweep(line(310,390,100),24),list)),[]);
});

const named=c=>`card "${c.id}"`;
test('snapping to board objects: a sloppy box, a loose lasso and an underline tidy to the thing; a part, a speck and a mix do not',()=>{
  const tray={key:'decoration:t',kind:'decoration',id:'t',x:0,y:300,w:500,h:300,frame:true};
  const list=[card('a',0,0,300,200),card('b',400,0,300,200),tray];
  // a box round most of a (85 %)
  let raw=rectHits({x:20,y:-10,w:300,h:200},list),snap=objectSnap(raw,{tool:'marquee',gestureArea:300*200,name:named});
  assert.ok(snap);assert.deepEqual(snap.shape,{kind:'rect',x:0,y:0,w:300,h:200});assert.equal(snap.label,'card "a"');assert.ok(snap.targets.every(t=>t.whole));
  // a box round two cards
  raw=rectHits({x:-10,y:-10,w:720,h:220},list);snap=objectSnap(raw,{tool:'marquee',gestureArea:720*220,name:named});
  assert.equal(snap.label,'2 objects');assert.deepEqual(snap.shape,{kind:'rect',x:0,y:0,w:700,h:200});
  // a container covered most of the way
  raw=rectHits({x:10,y:310,w:470,h:280},list);snap=objectSnap(raw,{tool:'marquee',gestureArea:470*280,name:c=>c.id});
  assert.equal(snap?.label,'t');
  // a part (a third of a card): no snap
  raw=rectHits({x:20,y:20,w:120,h:100},list);assert.equal(objectSnap(raw,{tool:'marquee',gestureArea:12000}),null);
  // a card covered whole plus another a third: no snap (it would drop something she half meant)
  raw=rectHits({x:-10,y:-10,w:520,h:220},list);assert.equal(objectSnap(raw,{tool:'marquee',gestureArea:520*220}),null);
  // a speck: a big box over empty board with a small card in its corner stays a board area
  raw=rectHits({x:-2000,y:-2000,w:2310,h:2210},[card('s',0,0,60,40)]);assert.equal(objectSnap(raw,{tool:'marquee',gestureArea:2310*2210}),null);
  // the wand: an underline along a heading snaps to it
  const heading={key:'decoration:h',kind:'decoration',id:'h',x:400,y:300,w:360,h:44};
  const f=sweep(line(395,765,356));raw=areaHits(f,[heading]);snap=objectSnap(raw,{tool:'wand',gestureArea:f.area(),name:c=>`text "${c.id}"`});
  assert.equal(snap?.label,'text "h"');assert.deepEqual(snap.shape,{kind:'rect',x:400,y:300,w:360,h:44});
  // the best proposal wins; below the floor nothing does
  assert.equal(bestProposal([{shape:{},score:.5,source:'object'},{shape:{},score:.8,source:'dom'}]).source,'dom');
  assert.equal(bestProposal([{shape:{},score:.2}]),null);
});

const robin={id:'robin',label:'Robin',kind:'human'};
async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'tinka-pointing-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const configPath=path.join(root,'local','config.json');await mkdir(path.join(root,'boards'));
  await main(['init','--config',configPath,'--boards',path.join(root,'boards'),'--label','Pointing fixture']);
  const config=await loadConfig(configPath),op=operation=>applyOperation(config,operation);
  await op({type:'createBoard',id:'landing',title:'Landing'});
  const item=(await op({type:'createItem',boardId:'landing',item:{title:'Login mock'},placement:{x:0,y:0,width:300,height:200}})).result;
  const placementId=(await getBoardSnapshot(config,'landing')).placements.find(p=>p.itemId===item.itemId).id;
  return {config,op,placementId,itemId:item.itemId};
}
const record=f=>({v:1,source:'typed',startedAt:'2026-11-24T10:00:00.000Z',sentAt:'2026-11-24T10:00:04.000Z',
  parts:[{text:'change this ',at:0,end:840},{mark:1},{text:' to look more like this ',at:1900,end:3100},{mark:2}],
  marks:[
    {n:1,tool:'marquee',at:900,end:1250,boardId:'landing',shape:{kind:'rect',x:30,y:60,w:100,h:20},
      targets:[{kind:'placement',id:f.placementId,boardId:'landing',itemId:f.itemId,itemKind:'html',title:'Login mock',whole:false,region:{x:.1,y:.3,w:.33,h:.1}}],crop:{dataUrl:'data:image/png;base64,AAAA'}},
    {n:2,tool:'point',at:3200,end:3250,boardId:'landing',shape:{kind:'point',x:900,y:900},targets:[],crop:null,cropNote:'No crop.'},
  ]});

test('addComment stores a pointing record; crops are dropped with a note; the thread lists with it',async t=>{
  const f=await fixture(t);
  await f.op({type:'addComment',id:'pt1',boardId:'landing',author:robin,body:'change this @1 Login mock to look more like this @2 Board point',
    to:{kind:'agent'},status:'sent',refs:[{kind:'placement',id:f.placementId,boardId:'landing',label:'1 Login mock'}],
    anchor:{kind:'point',x:80,y:70,placementId:f.placementId,relative:{x:.27,y:.35}},pointing:record(f)});
  const [thread]=(await listFeedback(f.config,{threadId:'pt1',includeBodies:true})).threads;
  assert.equal(thread.status,'sent');assert.deepEqual(thread.to,{kind:'agent'});
  assert.equal(thread.pointing.marks.length,2);
  assert.equal(thread.pointing.marks[0].crop,null);assert.ok(thread.pointing.marks[0].cropNote);
  assert.equal(thread.pointing.marks[1].cropNote,'No crop.');
  assert.deepEqual(thread.pointing.parts[1],{mark:1});
});

test('a pointing record is refused when it breaks the contract',async t=>{
  const f=await fixture(t);
  const add=(pointing,id)=>f.op({type:'addComment',id,boardId:'landing',author:robin,body:'x',pointing});
  const bad=[
    p=>{p.extra=1;},
    p=>{p.marks[0].targets[0].colour='red';},
    p=>{p.marks[0].tool='pen';},
    p=>{p.parts.push({mark:7});},
    p=>{p.marks[0].targets[0].region.x=1.5;},
    p=>{p.marks[1].n=1;},
    p=>{p.marks[0].shape={kind:'path',points:Array.from({length:401},(_,i)=>[i,i])};},
    p=>{p.marks=Array.from({length:21},(_,i)=>({...p.marks[1],n:i+1}));},
  ];
  for(const [i,change] of bad.entries()){const p=record(f);change(p);await assert.rejects(add(p,`bad${i}`),{status:400},`case ${i}`);}
});

test('round 2 marks: the wand\'s swath, a click with the tool it was made with, a snapped outline; malformed ones refused',async t=>{
  const f=await fixture(t);
  const p=record(f);
  p.marks[0]={...p.marks[0],tool:'wand',shape:{kind:'swath',width:56,points:[[10,10],[80,12],[150,10]]},snap:{source:'object',label:'card "Login mock"',shape:{kind:'rect',x:0,y:0,w:300,h:200}},
    targets:[{...p.marks[0].targets[0],whole:true,region:undefined}]};delete p.marks[0].targets[0].region;
  p.marks[1]={...p.marks[1],tool:'click',via:'marquee'};
  await f.op({type:'addComment',id:'r2',boardId:'landing',author:robin,body:'x',pointing:p});
  const [thread]=(await listFeedback(f.config,{threadId:'r2',includeBodies:true})).threads;
  const [m1,m2]=thread.pointing.marks;
  assert.equal(m1.tool,'wand');assert.deepEqual(m1.shape,{kind:'swath',width:56,points:[[10,10],[80,12],[150,10]]});assert.equal(m1.snap.label,'card "Login mock"');
  assert.equal(m2.tool,'click');assert.equal(m2.via,'marquee');
  const add=(pointing,id)=>f.op({type:'addComment',id,boardId:'landing',author:robin,body:'x',pointing});
  const bad=[
    q=>{q.marks[1].tool='marquee';q.marks[1].via='lasso';},               // only a click names its tool
    q=>{q.marks[1].via='pen';},
    q=>{q.marks[0].shape={kind:'swath',points:[[0,0],[1,1]]};},           // a swath has a width
    q=>{q.marks[0].snap={source:'magic',label:'x',shape:{kind:'rect',x:0,y:0,w:1,h:1}};},
    q=>{q.marks[0].snap={source:'object',label:'x',shape:{kind:'point',x:0,y:0}};},
    q=>{q.marks[0].snap.extra=1;},
  ];
  for(const [i,change] of bad.entries()){const q=structuredClone(p);change(q);await assert.rejects(add(q,`bad2${i}`),{status:400},`case ${i}`);}
});
