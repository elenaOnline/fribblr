// Headless checks that the reader's path menu keeps long names inside it: a long title
// ends in an ellipsis, and every row, with its kind, stays within the menu's width.
// Uses only external fixtures.
import './helpers/offline.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from '../cli.mjs';
import {loadConfig} from '../lib/config.mjs';
import {applyOperation} from '../lib/workspace.mjs';
import {listen,closeAppServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=await mkdtemp(path.join(os.tmpdir(),'tinka-reader-path-'));
const evidence=process.env.TINKA_EVIDENCE_DIR||await mkdtemp(path.join(os.tmpdir(),'tinka-reader-path-evidence-'));await mkdir(evidence,{recursive:true});
let server,browser,checks=0;const errors=[];
const ok=(value,message)=>{assert.ok(value,message);checks++;};
try{
 const file=path.join(root,'config.json');await main(['init','--config',file,'--boards',path.join(root,'boards'),'--label','Reader path studio']);const config=await loadConfig(file);
 const op=async(type,fields)=>(await applyOperation(config,{type,...fields})).result;
 await op('createBoard',{id:'long-names',title:'A board whose title is long enough to need more than the width of the path menu'});
 const long='A rather long working title for an idea, long enough that it cannot fit on one row of the menu';
 const first=(await op('createItem',{boardId:'long-names',item:{title:long,content:{kind:'note',text:'A note.'}},placement:{x:0,y:0,width:240,height:160}})).placementIds[0];
 await op('createItem',{boardId:'long-names',item:{title:'Short',content:{kind:'note',text:'A note.'}},placement:{x:300,y:0,width:240,height:160}});
 await op('createItem',{boardId:'long-names',item:{title:`${long}, and then some more`,content:{kind:'note',text:'A note.'}},placement:{x:600,y:0,width:240,height:160}});
 server=await listen(config,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
 for(const [width,height] of [[1440,900],[390,844]]){
  const page=await browser.newPage({viewport:{width,height},colorScheme:'light',reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/boards/long-names/',{waitUntil:'load'});
  await page.locator(`[data-placement="${first}"] .workspace-preview-launch`).click();await page.locator('#reader-dialog[open]').waitFor();
  await page.locator('#reader-count').click();await page.locator('#reader-path-pop .reader-path-sibs').waitFor();
  const state=await page.locator('#reader-path-pop').evaluate(pop=>{
   const p=pop.getBoundingClientRect(),style=getComputedStyle(pop),inner={left:p.left+parseFloat(style.paddingLeft),right:p.right-parseFloat(style.paddingRight)};
   return {scrolls:pop.scrollWidth>pop.clientWidth+1,rows:[...pop.querySelectorAll('.reader-path-row')].map(row=>{
    const r=row.getBoundingClientRect(),title=row.querySelector('.reader-path-title'),kind=row.querySelector('.reader-path-kind').getBoundingClientRect();
    return {title:title.textContent,inside:r.left>=inner.left-.5&&r.right<=inner.right+.5&&kind.right<=inner.right+.5,cut:title.scrollWidth>title.clientWidth+1,ellipsis:getComputedStyle(title).textOverflow==='ellipsis'};})};});
  ok(!state.scrolls,`${width}: the path menu does not scroll sideways`);
  for(const row of state.rows)ok(row.inside,`${width}: "${row.title}" stays inside the path menu with its kind`);
  const longRows=state.rows.filter(row=>row.title.includes(long));
  ok(longRows.length>=2&&longRows.every(row=>row.cut&&row.ellipsis),`${width}: long names end in an ellipsis: ${JSON.stringify(longRows)}`);
  await page.screenshot({path:path.join(evidence,`reader-path-${width}.png`)});
  await page.close();
 }
 assert.deepEqual(errors,[]);checks++;
 console.log(JSON.stringify({passed:true,checks,evidence}));
}finally{
 await browser?.close();if(server)await closeAppServer(server);await rm(root,{recursive:true,force:true});
}
