// Drawxide proof of concept: storage for whiteboard documents drawn with the
// Iron Drawxide engine (compiled to wasm, page in public/drawxide/).
//
// GET  /api/drawxide/docs/:id  -> the saved document JSON, or 404
// PUT  /api/drawxide/docs/:id  -> saves the body (a JSON snapshot the engine wrote)
//
// Documents live in the workspace metadata folder, under drawxide/<id>.json,
// outside the replaceable app. The server never interprets them.

import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {HttpError} from './paths.mjs';

const ID=/^[a-z0-9][a-z0-9-]{0,63}$/;
const LIMIT=32_000_000;

const docPath=(config,id)=>{
  if(!ID.test(id))throw new HttpError(400,'Whiteboard ids are lowercase letters, digits and dashes.');
  return path.join(config.workspaceRoot,'drawxide',`${id}.json`);
};

async function body(req){
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw new HttpError(415,'Content-Type must be application/json.');
  let total=0;const chunks=[];
  for await(const chunk of req){total+=chunk.length;if(total>LIMIT)throw new HttpError(413,'Whiteboard too large.');chunks.push(chunk);}
  const text=Buffer.concat(chunks).toString('utf8');
  try{JSON.parse(text);}catch{throw new HttpError(400,'Invalid JSON.');}
  return text;
}

/** Handles /api/drawxide/docs/:id. Returns true when it answered. */
export async function handleDrawxide({req,res,pathname,method,config,checkWrite,sendJson}){
  const match=/^\/api\/drawxide\/docs\/([^/]+)$/.exec(pathname);
  if(!match)return false;
  const file=docPath(config,match[1]);
  if(method==='GET'){
    let text;
    try{text=await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT'){sendJson(res,404,{error:'No whiteboard saved yet.'});return true;}throw error;}
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(text);
    return true;
  }
  if(method==='PUT'){
    await checkWrite();
    const text=await body(req);
    await mkdir(path.dirname(file),{recursive:true});
    const temp=`${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp,text);
    await rename(temp,file);
    sendJson(res,200,{saved:true,bytes:Buffer.byteLength(text)});
    return true;
  }
  throw new HttpError(405,'Method not allowed.');
}
