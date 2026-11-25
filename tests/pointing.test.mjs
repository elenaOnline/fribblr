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
import {rectHits,pathHits,pointTarget,closedLoop,simplify,clipPolygon,polygonArea} from '../public/pointing-geometry.js';

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

test('a click: a small thing whole, a big one at the spot clicked',()=>{
  assert.equal(pointTarget(card('a',0,0),{x:50,y:50},{zoom:1}).whole,true);
  const big=pointTarget(card('m',0,0,1000,800),{x:500,y:400},{zoom:1});
  assert.equal(big.whole,false);assert.deepEqual(big.region,{x:.476,y:.47,w:.048,h:.06});
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
