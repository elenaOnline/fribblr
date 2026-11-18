import test from 'node:test';
import assert from 'node:assert/strict';
import {FAMILY,FAMILIES,kindOf,familyOf,kindAttributes,familyCounts,familyLabel,kindsLine} from '../public/kinds.js';
import {capLabel} from '../public/keycaps.js';
import {boardCovers} from '../lib/board-covers.mjs';

test('an item is its stored kind, a board when it owns one, an idea when empty',()=>{
  assert.equal(kindOf({content:{kind:'markdown'}}),'markdown');
  assert.equal(kindOf({content:{kind:'html'},childBoardId:'inside'}),'board');
  assert.equal(kindOf({childBoardId:'inside'}),'board');
  assert.equal(kindOf({title:'Empty'}),'idea');
  assert.equal(kindOf(null),'idea');
  // Nothing from stored data reaches markup unless it is a plain kind word.
  assert.equal(kindOf({content:{kind:'"><img src=x>'}}),'idea');
  assert.equal(kindAttributes({content:{kind:'pdf'}}),'data-kind="pdf" data-family="doc"');
});

test('every stored kind the server accepts has a family, and unknown kinds draw plain',()=>{
  for(const kind of ['html','image','markdown','video','pdf','url','text','note','audio','file','idea','board'])
    assert.ok(FAMILIES.includes(FAMILY[kind]),kind);
  assert.deepEqual([familyOf('html'),familyOf('url'),familyOf('markdown'),familyOf('pdf'),familyOf('image'),familyOf('video'),familyOf('audio'),familyOf('note'),familyOf('idea'),familyOf('board')],
    ['page','page','doc','doc','pic','pic','pic','plain','plain','board']);
  assert.equal(familyOf('something-new'),'plain');
});

test('counts gather kinds into families and the kinds line names them in legend order',()=>{
  assert.deepEqual(familyCounts({html:2,url:1,image:3,note:1,text:1,board:1,pdf:0}),{page:3,pic:3,plain:2,board:1});
  assert.deepEqual(familyCounts(['video','audio','markdown']),{pic:2,doc:1});
  assert.equal(familyLabel('pic',1),'1 picture');
  assert.equal(familyLabel('doc',2),'2 documents');
  const line=kindsLine({board:2,image:15,html:1,markdown:1});
  assert.deepEqual([...line.matchAll(/data-family="(\w+)"/g)].map(m=>m[1]),['page','doc','pic','board']);
  assert.match(line,/15 pictures/);assert.match(line,/1 page</);
  assert.equal(kindsLine({}),'');
});

test('board covers count kinds of the visible placements by the same rule as the cards',()=>{
  const items={owner:{id:'owner'},a:{id:'a',content:{kind:'html'}},b:{id:'b',content:{kind:'image'}},c:{id:'c',content:{kind:'image'}},
    d:{id:'d',childBoardId:'x',content:{kind:'note'}},e:{id:'e'},gone:{id:'gone',content:{kind:'pdf'},deletedAt:1},kept:{id:'kept',content:{kind:'pdf'}}};
  const placements=['a','b','c','d','e','gone','kept'].map(id=>({id:`p-${id}`,itemId:id}));
  placements[6].archivedAt=1;
  const cover=boardCovers({one:{ownerItemId:'owner',placements,reviewOrder:[]}},items).one;
  assert.equal(cover.count,5);
  assert.deepEqual(cover.kinds,{html:1,image:2,board:1,idea:1});
});

test('a printed keycap reads the shortcut the control declares',()=>{
  assert.equal(capLabel('F'),'F');
  assert.equal(capLabel('f'),'F');
  assert.equal(capLabel('Shift+1',true),'⇧1');
  assert.equal(capLabel('Meta+K',true),'⌘K');
  assert.equal(capLabel('Control+K',false),'Ctrl+K');
  assert.equal(capLabel('Escape'),'Esc');
  assert.equal(capLabel(''),'');
});
