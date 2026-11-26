import './helpers/offline.mjs';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {cp,mkdir,mkdtemp,readFile,readdir,realpath,rm,writeFile,access} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {test} from 'node:test';

// One command adds fribblr to a project from a checkout: it installs that
// checkout's app files as a release would pack them, writes the project's
// instructions and starts its own instance. A second project gets its own.
const exec=promisify(execFile);
const node=process.execPath;
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const exists=file=>access(file).then(()=>true,()=>false);
async function freePort(){const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));return port;}
const health=async port=>(await fetch(`http://127.0.0.1:${port}/api/health`)).json();

test('installing from a checkout gives each project its own fribblr, beside an upstream Tinka, and updates from the checkout',async t=>{
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'fribblr-checkout-install-')));
  const checkout=path.join(root,'fribblr-checkout');
  await mkdir(checkout);
  for(const file of ['README.md','LICENSE','AGENTS.md','IMPLEMENTATION_CONTRACT.md','package.json','cli.mjs','server.mjs','public','lib','docs','examples','scripts','skill'])await cp(path.resolve(file),path.join(checkout,file),{recursive:true});
  const installer=path.join(checkout,'scripts/install.mjs');
  const alpha=path.join(root,'alpha'),beta=path.join(root,'beta');
  await mkdir(alpha);await mkdir(beta);
  // beta already has upstream Tinka: its folder, guide, AGENTS.md block and boards.
  const tinkaBlock='<!-- tinka:start - managed by Tinka; changes between these markers are replaced -->\n## Tinka\n\nTinka text.\n<!-- tinka:end -->';
  await mkdir(path.join(beta,'tinka/local'),{recursive:true});await mkdir(path.join(beta,'design/boards/sketches'),{recursive:true});
  await writeFile(path.join(beta,'tinka/project.json'),'{"schemaVersion":1,"version":"1.4.0","projectLabel":"beta","boards":"design/boards","repo":"bladnman/tinka"}\n');
  await writeFile(path.join(beta,'tinka/local/config.json'),'{"schemaVersion":1,"port":43821,"portMode":"auto","projectLabel":"beta","boardsRoot":"/elsewhere","title":"Tinka"}\n');
  await writeFile(path.join(beta,'TINKA.md'),'# Tinka in this project\n');
  await writeFile(path.join(beta,'AGENTS.md'),`# Beta\n\n${tinkaBlock}\n`);
  await writeFile(path.join(beta,'design/boards/sketches/board.json'),'{"title":"Sketches"}\n');
  const tinkaBefore=await readFile(path.join(beta,'tinka/local/config.json'),'utf8');
  const [alphaPort,betaPort]=[await freePort(),await freePort()];
  const configs={alpha:path.join(alpha,'fribblr/local/config.json'),beta:path.join(beta,'fribblr/local/config.json')};
  t.after(async()=>{
    for(const [name,project] of [['alpha',alpha],['beta',beta]])await exec(node,[path.join(project,'fribblr/app/cli.mjs'),'stop','--config',configs[name]]).catch(()=>{});
    await rm(root,{recursive:true,force:true});
  });

  const first=(await exec(node,[installer,'--project',alpha,'--port',String(alphaPort)])).stdout;
  assert.match(first,new RegExp(`^Installed fribblr \\d+\\.\\d+ from the checkout ${checkout.replaceAll('.','\\.')} at ${path.join(alpha,'fribblr/app').replaceAll('.','\\.')}\\.`));
  assert.match(first,/Added the fribblr section to AGENTS\.md\./);
  assert.match(first,new RegExp(`fribblr / alpha started on http://127\\.0\\.0\\.1:${alphaPort}/`));
  const receipt=await json(path.join(alpha,'fribblr/app/INSTALLATION.json'));
  assert.equal(receipt.source.kind,'checkout');assert.equal(receipt.source.path,checkout);
  const pin=await json(path.join(alpha,'fribblr/project.json'));
  assert.deepEqual([pin.boards,pin.repo,pin.source],['design/boards','elenaOnline/fribblr','checkout']);
  assert.equal((await json(configs.alpha)).port,alphaPort);
  assert(await exists(path.join(alpha,'FRIBBLR.md')));
  assert(await exists(path.join(alpha,'fribblr/app/public/drawxide/index.html')),'the whiteboard page ships with the app');
  const a=await health(alphaPort);assert.equal(a.app,'fribblr');assert.equal(a.projectLabel,'alpha');
  // The browser's update view: installed from a checkout, nothing to install from here.
  const view=await (await fetch(`http://127.0.0.1:${alphaPort}/api/update`)).json();
  assert.equal(view.installed,false);assert.equal(view.checkout.path,checkout);assert.equal(view.latest,null);
  assert.equal(view.agentCommand,'node fribblr/app/cli.mjs update --config fribblr/local/config.json');

  const second=(await exec(node,[installer,'--project',beta,'--port',String(betaPort)])).stdout;
  assert.match(second,new RegExp(`fribblr / beta started on http://127\\.0\\.0\\.1:${betaPort}/`));
  assert.equal((await json(path.join(beta,'fribblr/project.json'))).boards,'design/fribblr-boards');
  assert.equal(await readFile(path.join(beta,'tinka/local/config.json'),'utf8'),tinkaBefore);
  assert.equal(await readFile(path.join(beta,'TINKA.md'),'utf8'),'# Tinka in this project\n');
  assert(!(await readdir(path.join(beta,'tinka'))).includes('app'));
  assert.deepEqual(await readdir(path.join(beta,'design/boards')),['sketches']);
  assert((await readFile(path.join(beta,'AGENTS.md'),'utf8')).startsWith(`# Beta\n\n${tinkaBlock}\n\n<!-- fribblr:start`));
  // Two independent instances: stopping one leaves the other.
  await exec(node,[path.join(alpha,'fribblr/app/cli.mjs'),'stop','--config',configs.alpha]);
  assert.equal((await health(betaPort)).projectLabel,'beta');

  // Running the install again from an unchanged checkout replaces nothing and starts it.
  const again=(await exec(node,[installer,'--project',alpha])).stdout;
  assert.match(again,/already matches the checkout .*; nothing to replace\./);
  assert.match(again,/fribblr \/ alpha started/);
  // After the checkout changes, the same command replaces the app and restarts it.
  await writeFile(path.join(checkout,'docs/AGENT.md'),`${await readFile(path.join(checkout,'docs/AGENT.md'),'utf8')}\nA later line.\n`);
  const updated=(await exec(node,[installer,'--project',alpha])).stdout;
  assert.match(updated,/^Installed fribblr .* Backup: .* Managed service restarted\./);
  assert.match(updated,/fribblr \/ alpha already running/);
  assert((await readFile(path.join(alpha,'fribblr/app/docs/AGENT.md'),'utf8')).endsWith('A later line.\n'));
  assert.equal((await health(alphaPort)).projectLabel,'alpha');

  // The updater knows where the app came from and never looks for releases.
  const cli=path.join(alpha,'fribblr/app/cli.mjs');
  for(const action of ['status','now','check']){
    const message=(await exec(node,[cli,'update',action,'--config',configs.alpha])).stdout;
    assert.match(message,new RegExp(`installed from the checkout ${checkout.replaceAll('.','\\.')}\\. It updates from that checkout, not from releases`));
    assert(message.includes(`node '${installer}' --project '${alpha}'`));
  }
  assert(!await exists(path.join(alpha,'fribblr/local/updates.json')),'no update state, no release check');

  // A clone on another computer: setup says to install from a checkout.
  await exec(node,[cli,'stop','--config',configs.alpha]);
  await rm(path.join(alpha,'fribblr/app'),{recursive:true});await rm(path.join(alpha,'fribblr/local'),{recursive:true});
  await assert.rejects(exec(node,[path.join(alpha,'fribblr/setup.mjs')]),/installed from a fribblr checkout, and setup has no release to restore it from\. Install it from a checkout: git clone https:\/\/github\.com\/elenaOnline\/fribblr\.git/);
  const restored=(await exec(node,[installer,'--project',alpha,'--port',String(alphaPort)])).stdout;
  assert.match(restored,/fribblr \/ alpha started/);
});
