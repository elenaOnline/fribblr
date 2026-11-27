import {spawn} from 'node:child_process';
import {access,mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertSlug} from './paths.mjs';

// `board overview` saves one PNG of a whole board, as the board itself renders
// it at its saved geometry, so an agent can send a single picture to someone who
// cannot open a board link. It drives an existing Chrome-family browser in
// headless mode over the DevTools pipe; fribblr adds no browser dependency.

const BROWSERS={
  darwin:[
    'Google Chrome.app/Contents/MacOS/Google Chrome',
    'Chromium.app/Contents/MacOS/Chromium',
    'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'Brave Browser.app/Contents/MacOS/Brave Browser'
  ].flatMap(app=>[path.join('/Applications',app),path.join(os.homedir(),'Applications',app)]),
  linux:['google-chrome','google-chrome-stable','chromium','chromium-browser','microsoft-edge','brave-browser']
};
// Executables inside one browser folder of a Playwright-style browsers directory
// (`<folder>/chromium_headless_shell-1194/chrome-mac/headless_shell` and the like).
// Headless shells first: they never show a window or a Dock icon.
const SHELLS=[
  'chrome-mac/headless_shell','chrome-headless-shell-mac-arm64/chrome-headless-shell','chrome-headless-shell-mac-x64/chrome-headless-shell',
  'chrome-linux/headless_shell','chrome-headless-shell-linux64/chrome-headless-shell'
];
const FULL=[
  'chrome-mac/Chromium.app/Contents/MacOS/Chromium','chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing','chrome-linux/chrome','chrome-linux64/chrome'
];
const executable=file=>access(file,constants.X_OK).then(()=>true,()=>false);

// The machine-wide place for a browser fribblr may use, on this computer only.
export function browsersFolder({platform=process.platform,env=process.env,home=os.homedir()}={}){
  if(platform==='darwin')return path.join(home,'Library/Application Support/fribblr/browsers');
  return path.join(env.XDG_DATA_HOME&&path.isAbsolute(env.XDG_DATA_HOME)?env.XDG_DATA_HOME:path.join(home,'.local/share'),'fribblr/browsers');
}
function playwrightFolders({platform,env,home}){
  const folders=[];
  if(env.PLAYWRIGHT_BROWSERS_PATH&&path.isAbsolute(env.PLAYWRIGHT_BROWSERS_PATH))folders.push(env.PLAYWRIGHT_BROWSERS_PATH);
  folders.push(platform==='darwin'?path.join(home,'Library/Caches/ms-playwright'):path.join(home,'.cache/ms-playwright'));
  return folders;
}
// Newest revision first within a kind: chromium_headless_shell-1194 before -1100.
const revision=name=>Number(/-(\d+)$/.exec(name)?.[1]||0);
async function inFolder(folder){
  let names;
  try{names=(await readdir(folder,{withFileTypes:true})).filter(entry=>entry.isDirectory()||entry.isSymbolicLink()).map(entry=>entry.name);}catch{return null;}
  names.sort((a,b)=>revision(b)-revision(a)||a.localeCompare(b));
  for(const list of [SHELLS,FULL])for(const name of names)for(const relative of list){
    const file=path.join(folder,name,relative);
    if(await executable(file))return file;
  }
  return null;
}

// Search order, first match wins:
//   1. CHROMIUM_EXECUTABLE (environment)
//   2. "browser" in this instance's config.json
//   3. the fribblr browsers folder (browsersFolder(): on macOS
//      ~/Library/Application Support/fribblr/browsers)
//   4. Playwright's browsers (PLAYWRIGHT_BROWSERS_PATH, then its default cache)
//   5. an installed Chrome, Chromium, Edge or Brave
// A path named in 1 or 2 that is not an executable file is an error, not a skip.
let configuredBrowser=null;
// The server process has one config; its "browser" setting applies to every
// render it makes (pointing crops call findBrowser() with no arguments).
export function useConfiguredBrowser(file){configuredBrowser=file||null;}
export async function findBrowser({env=process.env,platform=process.platform,config,home=os.homedir()}={}){
  if(env.CHROMIUM_EXECUTABLE){
    if(!await executable(env.CHROMIUM_EXECUTABLE))throw new Error(`CHROMIUM_EXECUTABLE is not an executable file: ${env.CHROMIUM_EXECUTABLE}`);
    return env.CHROMIUM_EXECUTABLE;
  }
  const configured=config?config.browser:configuredBrowser;
  if(configured){
    if(!await executable(configured))throw new Error(`The config's "browser" is not an executable file: ${configured}`);
    return configured;
  }
  for(const folder of [browsersFolder({platform,env,home}),...playwrightFolders({platform,env,home})]){
    const found=await inFolder(folder);
    if(found)return found;
  }
  for(const candidate of BROWSERS[platform]||[]){
    if(path.isAbsolute(candidate)){if(await executable(candidate))return candidate;continue;}
    for(const directory of (env.PATH||'').split(path.delimiter).filter(Boolean)){
      const file=path.join(directory,candidate);
      if(await executable(file))return file;
    }
  }
  return null;
}
// What to say when no browser is found, for item shot and board overview.
export function noBrowserMessage(fallback){
  return `No Chrome-family browser was found for the headless render. Put a headless shell in ${browsersFolder()}, set "browser" in this instance's config.json or set CHROMIUM_EXECUTABLE (see docs/INSTALL.md), or ${fallback}`;
}

// Minimal DevTools protocol client over --remote-debugging-pipe: JSON messages
// separated by NUL bytes, written to the browser's fd 3 and read from its fd 4.
function devtools(child,what){
  let next=0,buffer=Buffer.alloc(0),closed=null;
  const waiting=new Map();
  child.stdio[4].on('data',chunk=>{
    buffer=Buffer.concat([buffer,chunk]);
    for(let end=buffer.indexOf(0);end>=0;end=buffer.indexOf(0)){
      const message=JSON.parse(buffer.subarray(0,end).toString('utf8'));
      buffer=buffer.subarray(end+1);
      const entry=message.id!==undefined&&waiting.get(message.id);
      if(!entry)continue;
      waiting.delete(message.id);
      if(message.error)entry.reject(new Error(`${entry.method}: ${message.error.message}`));
      else entry.resolve(message.result);
    }
  });
  const fail=error=>{closed=error;for(const entry of waiting.values())entry.reject(error);waiting.clear();};
  child.once('exit',()=>fail(new Error(`The headless browser exited before the ${what} was saved.`)));
  child.stdio[3].on('error',fail);
  return (method,params={},sessionId)=>new Promise((resolve,reject)=>{
    if(closed){reject(closed);return;}
    const id=++next;
    waiting.set(id,{method,resolve,reject});
    child.stdio[3].write(`${JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})}\0`);
  });
}

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Resolves to `fallback` after ms; clear() releases the timer so it never keeps
// the CLI process alive.
function timer(ms,fallback){let handle;const promise=new Promise(resolve=>{handle=setTimeout(()=>resolve(fallback),ms);});return {promise,clear:()=>clearTimeout(handle)};}
async function settled(call,deadline){
  for(;;){
    const {result}=await call('Runtime.evaluate',{expression:'document.documentElement.dataset.overview||""',returnByValue:true});
    if(['ready','partial','error'].includes(result.value))return result.value;
    if(Date.now()>deadline)return 'timeout';
    await pause(200);
  }
}
async function measure(call){
  const {result}=await call('Runtime.evaluate',{expression:'(()=>{const d=document.documentElement.dataset,e=document.getElementById("board-error");return JSON.stringify({aspect:Number(d.overviewAspect)||0,width:Number(d.overviewWidth)||0,chrome:Number(d.overviewChrome)||0,items:Number(d.overviewItems)||0,error:e&&!e.hidden?e.textContent.trim():""});})()',returnByValue:true});
  return JSON.parse(result.value);
}
// fitBoard keeps a 24px margin on each side and never zooms past 125%.
const MARGIN=48,MAX_ZOOM=1.25,MAX_PIXELS=16000;
export function overviewSize({width,aspect,contentWidth,chrome}){
  const shape=aspect>0?aspect:0.625;
  const fitted=contentWidth>0?Math.min(width,Math.max(400,Math.ceil(contentWidth*MAX_ZOOM)+MARGIN)):width;
  const height=Math.round((fitted-MARGIN)*shape+MARGIN+chrome);
  return {width:fitted,height:Math.min(MAX_PIXELS,Math.round(fitted*3),Math.max(Math.round(fitted*0.3),height))};
}

// Runs `render(call)` in a fresh headless browser with a throwaway profile and
// saves the PNG it returns as base64 `data`. One deadline bounds every browser
// call, so a browser that stops answering cannot hang the command. Never
// overwrites an existing file; saves nothing if rendering fails. Shared by
// `board overview` and `item shot`.
export async function headlessCapture({browser,out,timeout=45000,what='overview'},render){
  const profile=await mkdtemp(path.join(os.tmpdir(),'tinka-overview-'));
  const child=spawn(browser,[
    '--headless=new','--remote-debugging-pipe',`--user-data-dir=${profile}`,
    '--no-first-run','--no-default-browser-check','--disable-extensions','--disable-sync',
    '--disable-background-networking','--disable-component-update','--hide-scrollbars',
    '--use-mock-keychain','--password-store=basic',
    '--mute-audio','--force-color-profile=srgb','about:blank'
  ],{stdio:['ignore','ignore','pipe','pipe','pipe']});
  let log='';
  child.stderr.on('data',chunk=>{if(log.length<4000)log+=chunk;});
  const started=new Promise((_resolve,reject)=>child.once('error',error=>reject(new Error(`Could not start ${browser}: ${error.message}`))));
  const deadline=Date.now()+timeout;
  const late=new Error(`The headless browser did not finish the ${what} within ${Math.round(timeout/1000)} s. Nothing was saved.`);
  const bounded=promise=>{const limit=timer(Math.max(0,deadline-Date.now()),late);return Promise.race([promise,limit.promise.then(error=>{throw error;})]).finally(limit.clear);};
  try{
    const rendering=(async()=>{
      const send=devtools(child,what);
      const {targetId}=await bounded(send('Target.createTarget',{url:'about:blank'}));
      const {sessionId}=await bounded(send('Target.attachToTarget',{targetId,flatten:true}));
      return render((method,params)=>bounded(send(method,params,sessionId)),{deadline,late});
    })();
    // Whichever loses the race must not surface later as an unhandled rejection.
    rendering.catch(()=>{});started.catch(()=>{});
    const result=await Promise.race([rendering,started]);
    await writeFile(out,Buffer.from(result.data,'base64'),{flag:'wx'});
    return result;
  }catch(error){
    if(/exited/.test(error.message)&&log.trim())error.message+=`\n${log.trim().split('\n').slice(-3).join('\n')}`;
    throw error;
  }finally{
    if(child.exitCode===null&&child.signalCode===null){
      const exited=new Promise(resolve=>child.once('exit',()=>resolve(true)));
      child.kill();
      const grace=timer(5000,false);
      if(!await Promise.race([exited,grace.promise])){child.kill('SIGKILL');const last=timer(2000,false);await Promise.race([exited,last.promise]);last.clear();}
      grace.clear();
    }
    for(const stream of child.stdio)stream?.destroy();
    // The image is already saved; a leftover temporary profile is not a failure.
    await rm(profile,{recursive:true,force:true,maxRetries:3}).catch(()=>{});
  }
}

// Fits the board to at most `width` pixels (a small board is not enlarged past
// 125%) in the light or dark appearance, shapes the image to the board (0.3 to 3
// times as tall as it is wide), waits for on-screen previews to load, then saves
// the PNG. Never overwrites an existing file; saves nothing if the page fails.
export async function saveOverview({url,boardId,out,width=2400,appearance='light',browser,timeout=45000}){
  return headlessCapture({browser,out,timeout,what:'overview'},async(call,{deadline,late})=>{
    let size={width,height:Math.round(width*0.625)};
    await call('Emulation.setDeviceMetricsOverride',{...size,deviceScaleFactor:1,mobile:false});
    await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:appearance}]});
    const navigation=await call('Page.navigate',{url:`${url}boards/${encodeURIComponent(boardId)}/?overview&appearance=${encodeURIComponent(appearance)}`});
    if(navigation.errorText)throw new Error(`The board page did not load (${navigation.errorText}). Nothing was saved.`);
    let state=await settled(call,deadline);
    const first=await measure(call);
    if(state==='error')throw new Error(`${first.error||'The board could not be loaded.'} Nothing was saved.`);
    if(state==='timeout')throw late;
    const next=overviewSize({width,aspect:first.aspect,contentWidth:first.width,chrome:first.chrome});
    if(next.width!==size.width||Math.abs(next.height-size.height)>2){
      size=next;
      await call('Runtime.evaluate',{expression:'delete document.documentElement.dataset.overview'});
      await call('Emulation.setDeviceMetricsOverride',{...size,deviceScaleFactor:1,mobile:false});
      state=await settled(call,deadline);
      if(state==='error'||state==='timeout')state='partial';
    }
    const {data}=await call('Page.captureScreenshot',{format:'png'});
    return {data,state,...size,items:first.items};
  });
}

export async function boardOverview(config,boardId,options,{running,find=()=>findBrowser({config}),save=saveOverview}={}){
  assertSlug(boardId);
  if(!options.out)throw new Error('Provide --out /absolute/overview.png.');
  const out=path.resolve(options.out);
  if(path.extname(out).toLowerCase()!=='.png')throw new Error('--out must name a .png file.');
  if(await access(out).then(()=>true,()=>false))throw new Error(`${out} already exists. Choose a new file name or remove the old one.`);
  const width=options.width===undefined?2400:Number(options.width);
  if(!Number.isInteger(width)||width<400||width>8000)throw new Error('--width must be a whole number of pixels from 400 to 8000.');
  const appearance=options.appearance||'light';
  if(!['light','dark'].includes(appearance))throw new Error('--appearance must be light or dark.');
  const instance=await running(config);
  if(!instance)throw new Error(`This project's fribblr is not running. Start it first: node ${path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))),'cli.mjs')} start --config ${config.configPath}`);
  const response=await fetch(`${instance.url}api/boards/${encodeURIComponent(boardId)}`,{cache:'no-store'});
  await response.body?.cancel();
  if(response.status===404||response.status===400)throw new Error(`Board ${boardId} not found.`);
  if(!response.ok)throw new Error(`Board ${boardId} could not be read (${response.status}).`);
  const browser=await find();
  if(!browser)throw new Error(noBrowserMessage(`open ${instance.url}boards/${boardId}/?overview in a browser and save a screenshot.`));
  const result=await save({url:instance.url,boardId,out,width,appearance,browser});
  const note=result.state==='ready'?'':' Some previews had not finished loading; check the image.';
  return `Saved an overview of ${boardId} (${result.items} ${result.items===1?'item':'items'}, ${result.width} × ${result.height}) to ${out}.${note}`;
}
