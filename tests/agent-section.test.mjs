import './helpers/offline.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cp,mkdtemp,realpath,readFile,readdir,writeFile,rm,access,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {main as cli} from '../cli.mjs';
import {FRIBBLR_SECTION,FRIBBLR_START,FRIBBLR_END,fribblrBlock} from '../lib/project.mjs';
import {DEFAULT_PORT} from '../lib/config.mjs';
import {DEFAULT_PORT as INSTALLER_PORT} from '../scripts/install.mjs';

const BLOCK=fribblrBlock();
const OLD=`${FRIBBLR_START}\n## fribblr\n\nAn older text.\n${FRIBBLR_END}`;
const crlf=text=>text.replaceAll('\n','\r\n');
const exists=file=>access(file).then(()=>true,()=>false);
async function project(files,{pinned=true}={}){
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'fribblr-agent-section-')));
  // A minimal existing portable pin, as an installed project has.
  if(pinned){await mkdir(path.join(root,'fribblr'));await writeFile(path.join(root,'fribblr/project.json'),JSON.stringify({schemaVersion:1,version:'1.4.0',projectLabel:path.basename(root),boards:'design/boards',repo:'elenaOnline/fribblr'}));}
  for(const [name,content] of Object.entries(files)){await mkdir(path.dirname(path.join(root,name)),{recursive:true});await writeFile(path.join(root,name),content);}
  return {root,init:(...extra)=>cli(['project','init','--project',root,...extra]),instructions:()=>cli(['project','instructions','--project',root]),
    read:name=>readFile(path.join(root,name),'utf8'),done:()=>rm(root,{recursive:true,force:true})};
}
async function tree(directory){
  const out={};
  async function walk(dir,prefix=''){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file,`${prefix}${entry.name}/`);else out[prefix+entry.name]=createHash('sha256').update(await readFile(file)).digest('hex');}}
  await walk(directory);return out;
}

test('the managed block routes visual work to boards in a few lines',()=>{
  assert.equal(BLOCK,`${FRIBBLR_START}\n${FRIBBLR_SECTION}\n${FRIBBLR_END}`);
  assert.match(FRIBBLR_START,/^<!-- fribblr:start .*-->$/);
  assert.equal(FRIBBLR_END,'<!-- fribblr:end -->');
  assert(FRIBBLR_SECTION.split('\n').length<=14);
  assert.match(FRIBBLR_SECTION,/^## fribblr\n/);
  assert.match(FRIBBLR_SECTION,/add it to a board as well as showing\nit the way you otherwise would/);
  assert.match(FRIBBLR_SECTION,/give the user the fribblr link to exactly what you added or changed \(the `link` in each tool\nresult\)/);
  assert.match(FRIBBLR_SECTION,/\(`item shot` or `board overview`/);
  assert.match(FRIBBLR_SECTION,/another board app, each app has its own boards/);
  assert.match(FRIBBLR_SECTION,/\[FRIBBLR\.md\]\(FRIBBLR\.md\)/);
  assert.doesNotMatch(FRIBBLR_SECTION,/tinka/i);
});

test('setup adds the block to AGENTS.md only; CLAUDE.md is never written',async()=>{
  const agentsOnly=await project({'AGENTS.md':'# Product rules\n\nSee FRIBBLR.md later.\n'});
  const neither=await project({});
  const claudeOnly=await project({'CLAUDE.md':'# Claude rules\n\nKeep these.'});
  try{
    await agentsOnly.init();
    assert.equal(await agentsOnly.read('AGENTS.md'),`# Product rules\n\nSee FRIBBLR.md later.\n\n${BLOCK}\n`);
    await neither.init();
    assert.equal(await neither.read('AGENTS.md'),`${BLOCK}\n`);
    assert(!await exists(path.join(neither.root,'CLAUDE.md')));
    const message=await claudeOnly.init();
    assert.equal(await claudeOnly.read('AGENTS.md'),`${BLOCK}\n`);
    assert.equal(await claudeOnly.read('CLAUDE.md'),'# Claude rules\n\nKeep these.');
    assert.match(message,/Commit FRIBBLR\.md, AGENTS\.md, fribblr\/project\.json,/);
  }finally{for(const fixture of [agentsOnly,neither,claudeOnly])await fixture.done();}
});

test('the block between markers is replaced, all else stays byte-identical',async()=>{
  const before='# Rules\n\nKeep this.\n\n',after='\n\n## Later\n\nAlso keep this.\n';
  const marked=await project({'AGENTS.md':`${before}<!-- fribblr:start old note -->\n## fribblr\n\nHand edits inside.\n${FRIBBLR_END}${after}`});
  const own=await project({'AGENTS.md':`${before}## fribblr\n\nOur own board rules.\n`});
  const broken=await project({'AGENTS.md':`${before}${FRIBBLR_START}\n## fribblr\n`});
  try{
    assert.match(await marked.instructions(),/^Updated the fribblr section in AGENTS\.md\.$/);
    assert.equal(await marked.read('AGENTS.md'),`${before}${BLOCK}${after}`);
    // A hand-written section outside the markers is the project's own: kept, block appended.
    assert.match(await own.instructions(),/^Added the fribblr section to AGENTS\.md\.$/);
    assert.equal(await own.read('AGENTS.md'),`${before}## fribblr\n\nOur own board rules.\n\n${BLOCK}\n`);
    assert.match(await broken.instructions(),/unmatched fribblr marker; left unchanged/);
    assert.equal(await broken.read('AGENTS.md'),`${before}${FRIBBLR_START}\n## fribblr\n`);
    for(const fixture of [marked,own]){
      const text=await fixture.read('AGENTS.md');
      assert.equal(await fixture.instructions(),'fribblr project instructions are current.');
      await fixture.init();
      assert.equal(await fixture.read('AGENTS.md'),text);
    }
  }finally{for(const fixture of [marked,own,broken])await fixture.done();}
});

test('CRLF instruction files keep their line endings',async()=>{
  const fresh=await project({'AGENTS.md':crlf('# Windows rules\n\nKeep this.')});
  const marked=await project({'AGENTS.md':crlf(`# Windows rules\n\n${OLD}\n\n## After\n`)});
  try{
    await fresh.init();
    assert.equal(await fresh.read('AGENTS.md'),crlf(`# Windows rules\n\nKeep this.\n\n${BLOCK}\n`));
    await marked.init();
    assert.equal(await marked.read('AGENTS.md'),crlf(`# Windows rules\n\n${BLOCK}\n\n## After\n`));
    for(const fixture of [fresh,marked]){
      const text=await fixture.read('AGENTS.md');
      await fixture.init();
      assert.equal(await fixture.read('AGENTS.md'),text);
    }
  }finally{for(const fixture of [fresh,marked])await fixture.done();}
});

test('project instructions requires a fribblr project',async()=>{
  const plain=await project({'AGENTS.md':`${OLD}\n`},{pinned:false});
  try{
    await assert.rejects(plain.instructions(),/No fribblr\/project\.json/);
    assert.equal(await plain.read('AGENTS.md'),`${OLD}\n`);
  }finally{await plain.done();}
});

test('a new FRIBBLR.md says how to start, share the direct link and work comments; an existing one is kept',async()=>{
  const fresh=await project({},{pinned:false});
  const custom=await project({'FRIBBLR.md':'# Our own fribblr notes\n'},{pinned:false});
  try{
    await fresh.init();await custom.init();
    const text=await fresh.read('FRIBBLR.md');
    assert.match(text,/node fribblr\/app\/cli\.mjs start --config fribblr\/local\/config\.json/);
    assert.match(text,/## Share what you add or change\n\nGive the user the fribblr link to exactly what you added or changed\. Tool results\nthat change a board carry it as `link`/);
    assert.match(text,/node fribblr\/app\/cli\.mjs item shot ITEM_ID --config fribblr\/local\/config\.json --out \/absolute\/shot\.png/);
    assert.match(text,/node fribblr\/app\/cli\.mjs board overview BOARD_ID --config fribblr\/local\/config\.json --out/);
    assert.match(text,/## Comments for you\n/);assert.match(text,/node fribblr\/app\/cli\.mjs inbox --config fribblr\/local\/config\.json/);assert.match(text,/Never resolve\na person's comment/);
    assert.match(text,/`update status` prints the exact command/);
    assert.match(text,/Do not copy version numbers or checksums into this file: `fribblr\/project\.json`\nis the record\./);
    // Only the metadata folder keeps its name (.tinka is the boards' format).
    assert.doesNotMatch(text.replaceAll('.tinka',''),/tinka/i);
    assert.match(text,/`design\/boards\/\.tinka`, so a\nproject folder `design\/mockups` is `\.\.\/\.\.\/mockups`/);
    assert.match(text,/tools call board\.create --config fribblr\/local\/config\.json/);
    assert.equal(await custom.read('FRIBBLR.md'),'# Our own fribblr notes\n');
  }finally{await fresh.done();await custom.done();}
});

// An upstream Tinka 1.4 install, as files: its folder, guide and AGENTS.md block
// (the block is upstream's own text). Kept as a fixture so the rebrand never edits it.
const UPSTREAM=fileURLToPath(new URL('./fixtures/upstream-tinka/',import.meta.url));
const BROKEN_UPSTREAM_MARKER=fileURLToPath(new URL('./fixtures/upstream-tinka-broken-marker.md',import.meta.url));
async function upstreamProject(){
  const fixture=await project({},{pinned:false});
  await cp(UPSTREAM,fixture.root,{recursive:true});
  await mkdir(path.join(fixture.root,'design','boards','sketches'),{recursive:true});
  await writeFile(path.join(fixture.root,'design','boards','sketches','board.json'),'{"schemaVersion":1,"title":"Sketches"}\n');
  return fixture;
}
// Every file of the upstream install except AGENTS.md, with the boards it uses.
async function upstreamFiles(root){
  const files={};
  for(const [name,digest] of Object.entries(await tree(UPSTREAM)))if(name!=='AGENTS.md')files[name]=digest;
  const actual=await tree(root),kept={};
  for(const name of Object.keys(files))kept[name]=actual[name];
  return {expected:files,kept,boards:await tree(path.join(root,'design','boards'))};
}

test('fribblr sits beside an install of upstream Tinka without reading or changing it',async()=>{
  assert.equal(DEFAULT_PORT,INSTALLER_PORT);
  assert.notEqual(DEFAULT_PORT%100,43821%100,'fribblr ports are never on the upstream Tinka port sequence');
  const upstreamAgents=await readFile(path.join(UPSTREAM,'AGENTS.md'),'utf8');
  const beta=await upstreamProject();
  try{
    const before=await upstreamFiles(beta.root);
    assert.deepEqual(before.kept,before.expected);
    const message=await beta.init();
    // design/boards is taken, so fribblr's boards get their own folder.
    assert.match(message,/design\/fribblr-boards\//);
    const pin=JSON.parse(await beta.read('fribblr/project.json'));
    assert.equal(pin.boards,'design/fribblr-boards');assert.equal(pin.repo,'elenaOnline/fribblr');
    const config=JSON.parse(await beta.read('fribblr/local/config.json'));
    assert.equal(config.port,DEFAULT_PORT);assert.equal(config.portMode,'auto');
    assert.equal(config.boardsRoot,path.join(beta.root,'design/fribblr-boards'));
    assert.equal(await beta.read('AGENTS.md'),`${upstreamAgents}\n${BLOCK}\n`);
    assert(await exists(path.join(beta.root,'FRIBBLR.md')));
    const after=await upstreamFiles(beta.root);
    assert.deepEqual(after.kept,before.expected);assert.deepEqual(after.boards,before.boards);
    // Again, with the upstream block rewritten meanwhile: fribblr's block stays, the other is not touched.
    const rewritten=upstreamAgents.replace('where it can be found again','where it can be found again, newer text');
    assert.notEqual(rewritten,upstreamAgents);
    await writeFile(path.join(beta.root,'AGENTS.md'),`${rewritten}\n${BLOCK}\n`);
    await beta.init();
    assert.equal(await beta.read('AGENTS.md'),`${rewritten}\n${BLOCK}\n`);
    // An unmatched upstream marker is not fribblr's to fix; fribblr still manages its own block.
    const broken=await readFile(BROKEN_UPSTREAM_MARKER,'utf8');
    await writeFile(path.join(beta.root,'AGENTS.md'),`${broken}${OLD}\n`);
    assert.match(await beta.instructions(),/^Updated the fribblr section/);
    assert.equal(await beta.read('AGENTS.md'),`${broken}${BLOCK}\n`);
  }finally{await beta.done();}
  // Without anything in design/boards, fribblr uses design/boards.
  const alpha=await project({},{pinned:false});
  try{await alpha.init('--port','47901');assert.equal(JSON.parse(await alpha.read('fribblr/project.json')).boards,'design/boards');const config=JSON.parse(await alpha.read('fribblr/local/config.json'));assert.deepEqual([config.port,config.portMode],[47901,'fixed']);}
  finally{await alpha.done();}
});
