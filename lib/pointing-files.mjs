// Crop files for pointing messages (team/pointing/CONTRACT.md § Crops): checking the pixels a client sends, and where
// crops live. A crop is a file under the workspace store, beside threads/ and drawxide/, never in the repo:
//   <workspaceRoot>/pointing/<threadId>/<n>.png|jpg
// Threads store the path relative to the workspace root; `feedback.list` shows it absolute.
import {lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {storeError,workspaceRoot,assertId} from './store.mjs';

export const CROP_MAX_BYTES=2*1024*1024;
export const CROP_PATH=/^pointing\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})\/([1-9]|1\d|20)\.(png|jpg)$/;
const MAX_SIDE=20_000;

function pngSize(bytes){
  const signature=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  if(bytes.length<33||!bytes.subarray(0,8).equals(signature)||bytes.toString('latin1',12,16)!=='IHDR')return null;
  return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
}
function jpegSize(bytes){
  if(bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8||bytes[2]!==0xff)return null;
  let i=2;
  while(i+9<bytes.length){
    if(bytes[i]!==0xff){i++;continue;}
    const marker=bytes[i+1];
    if(marker===0xff){i++;continue;}
    if(marker===0xd8||marker===0x01||marker>=0xd0&&marker<=0xd7){i+=2;continue;}
    const length=bytes.readUInt16BE(i+2);
    // Start-of-frame markers (not DHT 0xC4, JPG 0xC8, DAC 0xCC) carry the size.
    if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker))return {height:bytes.readUInt16BE(i+5),width:bytes.readUInt16BE(i+7)};
    if(marker===0xda)return null;
    i+=2+length;
  }
  return null;
}
// A client's crop pixels: a PNG or JPEG data URL of at most 2 MB whose bytes really are that image.
export function decodeCropDataUrl(dataUrl){
  const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(typeof dataUrl==='string'?dataUrl:'');
  if(!match)throw storeError(400,'A pointing crop must be a PNG or JPEG data URL.');
  const bytes=Buffer.from(match[2],'base64');
  if(bytes.length>CROP_MAX_BYTES)throw storeError(400,'A pointing crop is at most 2 MB.');
  const type=match[1],size=type==='png'?pngSize(bytes):jpegSize(bytes);
  if(!size||!(size.width>0&&size.width<=MAX_SIDE&&size.height>0&&size.height<=MAX_SIDE))throw storeError(400,`The pointing crop's bytes are not a valid ${type.toUpperCase()}.`);
  return {bytes,extension:type==='png'?'png':'jpg',width:size.width,height:size.height};
}
export const pointingRoot=config=>path.join(workspaceRoot(config),'pointing');
export const cropPathFor=(threadId,n,extension)=>`pointing/${threadId}/${n}.${extension}`;
// The absolute file of a stored crop path, or null when it is not a crop path of this form.
export function cropAbsolute(config,relative){
  if(typeof relative!=='string'||!CROP_PATH.test(relative))return null;
  return path.join(workspaceRoot(config),...relative.split('/'));
}
// The file behind GET /api/pointing/<threadId>/<n>: only a regular file of that name, inside this thread's own folder.
export async function findCrop(config,threadId,n){
  assertId(threadId);
  if(!/^(?:[1-9]|1\d|20)$/.test(String(n)))throw storeError(404,'Crop not found.');
  const root=pointingRoot(config);
  for(const extension of ['png','jpg']){
    const file=path.join(root,threadId,`${n}.${extension}`);
    try{
      const details=await lstat(file);
      if(!details.isFile()||details.isSymbolicLink())continue;
      const [real,base]=await Promise.all([realpath(file),realpath(root)]);
      if(!real.startsWith(base+path.sep))continue;
      return {file:real,type:extension==='png'?'image/png':'image/jpeg',size:details.size};
    }catch{/* try the next extension */}
  }
  throw storeError(404,'Crop not found.');
}
