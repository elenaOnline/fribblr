// Sending a pointing message through the running server (team/pointing/CONTRACT.md § Crops): the crops are made and
// written to disk first, then the thread is written, so an agent never reads half a message.
//   1. refuse a bad message before any work (the same validator the thread goes through);
//   2. pre-generate the thread id; a client's own pixels (parts of image items) are checked and kept;
//   3. every other mark is rendered by the server's headless browser (lib/pointing-crop.mjs), one render at a time,
//      outside the store lock (it takes 1–3 s);
//   4. the files go to <workspace>/pointing/<threadId>/<n>.png|jpg, then the thread transaction runs;
//      if it fails the files are removed.
// A pointing thread written any other way (the CLI, tools, an agent) has no crops: applyFeedbackOperation alone gives
// crop:null and a plain note.
import {randomUUID} from 'node:crypto';
import {mkdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {applyFeedbackOperation,checkFeedbackOperation} from './feedback.mjs';
import {storeError} from './store.mjs';
import {cropMarks,renderFailed} from './pointing-crop.mjs';
import {cropPathFor,decodeCropDataUrl,pointingRoot} from './pointing-files.mjs';

// One render at a time: a browser launch is heavy and a burst of sends should queue, not pile up.
let queue=Promise.resolve();
export const renderQueue=task=>{const run=queue.then(task,task);queue=run.catch(()=>{});return run;};

const CLIENT_FROM='the image item\'s own file, cropped in the browser at full resolution';

export async function addPointingComment(config,operation,{url,cropper=cropMarks,timeout=30000}={}){
  checkFeedbackOperation(operation);
  if(operation.type!=='addComment'||!operation.pointing)return applyFeedbackOperation(config,operation);
  const id=operation.id||`comment-${randomUUID()}`,pointing=operation.pointing,appearance=pointing.appearance||'light';
  const directory=path.join(pointingRoot(config),id);
  // The client's pixels first: bad bytes refuse the whole message before any render.
  const crops=new Map(),files=new Map(),wanted=[];
  for(const mark of pointing.marks){
    if(mark.crop?.dataUrl){
      const decoded=decodeCropDataUrl(mark.crop.dataUrl);
      files.set(mark.n,{bytes:decoded.bytes,extension:decoded.extension});
      crops.set(mark.n,{crop:{path:cropPathFor(id,mark.n,decoded.extension),width:decoded.width,height:decoded.height,from:mark.crop.from||CLIENT_FROM,...(mark.crop.box?{box:mark.crop.box}:{})}});
    }else wanted.push(mark);
  }
  if(wanted.length){
    if(!url)for(const mark of wanted)crops.set(mark.n,{note:'No crop: the server could not reach its own board page to render it.'});
    else{
      const boards=new Map();
      for(const mark of wanted){if(!boards.has(mark.boardId))boards.set(mark.boardId,[]);boards.get(mark.boardId).push(mark);}
      for(const [boardId,marks] of boards){
        let results;
        try{results=await renderQueue(()=>cropper({url,boardId,marks,appearance,timeout,config}));}
        catch(error){const note=renderFailed(error);results=marks.map(()=>({note}));}
        marks.forEach((mark,i)=>{
          const made=results?.[i];
          if(made?.png){
            files.set(mark.n,{bytes:made.png,extension:'png'});
            crops.set(mark.n,{crop:{path:cropPathFor(id,mark.n,'png'),width:made.width,height:made.height,from:made.from,...(made.box?{box:{x:made.box.x,y:made.box.y,w:made.box.w,h:made.box.h}}:{})}});
          }else crops.set(mark.n,{note:made?.note||'No crop: the render made nothing for this mark.'});
        });
      }
    }
  }
  if(!files.size)return applyFeedbackOperation(config,{...operation,id},{pointingCrops:crops});
  // The folder is this thread's alone: refuse a reused id rather than write over (or later delete) another thread's crops.
  await mkdir(path.dirname(directory),{recursive:true});
  try{await mkdir(directory);}catch(error){if(error.code==='EEXIST')throw storeError(409,'Comment ID already exists.');throw error;}
  try{
    for(const [n,file] of files)await writeFile(path.join(directory,`${n}.${file.extension}`),file.bytes,{mode:0o600});
    return await applyFeedbackOperation(config,{...operation,id},{pointingCrops:crops});
  }catch(error){
    await rm(directory,{recursive:true,force:true}).catch(()=>{});
    throw error;
  }
}
