import './helpers/offline.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,realpath,readFile,readdir,writeFile,rm,access,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {main as cli} from '../cli.mjs';
import {FRIBBLR_SECTION,FRIBBLR_START,FRIBBLR_END,fribblrBlock} from '../lib/project.mjs';
import {DEFAULT_PORT} from '../lib/config.mjs';
import {DEFAULT_PORT as INSTALLER_PORT} from '../scripts/install.mjs';

const BLOCK=fribblrBlock();
const OLD=`${FRIBBLR_START}\n## fribblr\n\nAn older text.\n${FRIBBLR_END}`;
// An upstream Tinka install's own managed block, as Tinka 1.4 writes it.
const TINKA_BLOCK='<!-- tinka:start - managed by Tinka; changes between these markers are replaced -->\n## Tinka\n\nVisual work in this project belongs on its Tinka boards.\nRead [TINKA.md](TINKA.md).\n<!-- tinka:end -->';
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
  assert.doesNotMatch(FRIBBLR_SECTION,/Tinka|tinka/);
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
    assert.doesNotMatch(text,/Tinka|tinka\//);
    assert.equal(await custom.read('FRIBBLR.md'),'# Our own fribblr notes\n');
  }finally{await fresh.done();await custom.done();}
});

test('fribblr sits beside an upstream Tinka install without reading or changing it',async()=>{
  assert.equal(DEFAULT_PORT,INSTALLER_PORT);
  assert.notEqual(DEFAULT_PORT%100,43821%100,'fribblr ports never fall on the Tinka port sequence');
  const tinkaConfig={schemaVersion:1,port:43821,portMode:'auto',projectLabel:'beta',boardsRoot:'/elsewhere/design/boards',title:'Tinka'};
  const beta=await project({
    'AGENTS.md':`# Beta rules\n\n${TINKA_BLOCK}\n`,
    'TINKA.md':'# Tinka in this project\n',
    'tinka/project.json':JSON.stringify({schemaVersion:1,version:'1.4.0',projectLabel:'beta',boards:'design/boards',repo:'bladnman/tinka'},null,2),
    'tinka/setup.mjs':'// upstream setup\n',
    'tinka/.gitignore':'/app/\n/local/\n',
    'tinka/app/package.json':JSON.stringify({name:'board-room',version:'1.4.0'}),
    'tinka/local/config.json':JSON.stringify(tinkaConfig),
    'design/boards/.tinka/workspace.json':'{"schemaVersion":2}\n',
    'design/boards/tinka-board/board.json':'{"title":"A Tinka board"}\n'
  },{pinned:false});
  try{
    const before={tree:await tree(path.join(beta.root,'tinka')),boards:await tree(path.join(beta.root,'design/boards')),guide:await beta.read('TINKA.md')};
    const message=await beta.init();
    // Tinka's boards folder is taken, so fribblr's boards get their own folder.
    assert.match(message,/design\/fribblr-boards\//);
    const pin=JSON.parse(await beta.read('fribblr/project.json'));
    assert.equal(pin.boards,'design/fribblr-boards');assert.equal(pin.repo,'elenaOnline/fribblr');
    const config=JSON.parse(await beta.read('fribblr/local/config.json'));
    assert.equal(config.port,DEFAULT_PORT);assert.equal(config.portMode,'auto');
    assert.equal(config.boardsRoot,path.join(beta.root,'design/fribblr-boards'));
    assert.equal(await beta.read('AGENTS.md'),`# Beta rules\n\n${TINKA_BLOCK}\n\n${BLOCK}\n`);
    assert(await exists(path.join(beta.root,'FRIBBLR.md')));
    assert.deepEqual(await tree(path.join(beta.root,'tinka')),before.tree);
    assert.deepEqual(await tree(path.join(beta.root,'design/boards')),before.boards);
    assert.equal(await beta.read('TINKA.md'),before.guide);
    // Again, and with Tinka's block rewritten by Tinka meanwhile: fribblr's block stays, Tinka's is not touched.
    const rewritten=TINKA_BLOCK.replace('Tinka boards.','Tinka boards, newer text.');
    await writeFile(path.join(beta.root,'AGENTS.md'),`# Beta rules\n\n${rewritten}\n\n${BLOCK}\n`);
    await beta.init();
    assert.equal(await beta.read('AGENTS.md'),`# Beta rules\n\n${rewritten}\n\n${BLOCK}\n`);
    // A broken Tinka marker is Tinka's business; fribblr still manages its own block.
    await writeFile(path.join(beta.root,'AGENTS.md'),`<!-- tinka:start -->\n## Tinka\n\n${OLD}\n`);
    assert.match(await beta.instructions(),/^Updated the fribblr section/);
    assert.equal(await beta.read('AGENTS.md'),`<!-- tinka:start -->\n## Tinka\n\n${BLOCK}\n`);
  }finally{await beta.done();}
  // Without anything in design/boards, fribblr uses design/boards.
  const alpha=await project({},{pinned:false});
  try{await alpha.init('--port','47901');assert.equal(JSON.parse(await alpha.read('fribblr/project.json')).boards,'design/boards');const config=JSON.parse(await alpha.read('fribblr/local/config.json'));assert.deepEqual([config.port,config.portMode],[47901,'fixed']);}
  finally{await alpha.done();}
});
