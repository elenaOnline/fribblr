// The pixel snap source's worker (pointing-snap-pixels.js): decodes same-origin pictures once and answers proposals
// off the main thread, so pixel work never sits on the pointer's path.
import {PixelPicture, proposePixels, decodePicture} from './pointing-snap-pixels.js';

const pictures = new Map(); // url -> Promise<PixelPicture>

function load(url) {
  if (!pictures.has(url)) {
    const job = decodePicture(url).then(d => new PixelPicture(d.data, d.w, d.h, d.nw, d.nh));
    job.catch(() => pictures.delete(url));
    pictures.set(url, job);
    // keep the last few pictures only (each is ~1.3× its RGBA at ≤ 1600 px a side)
    while (pictures.size > 12) pictures.delete(pictures.keys().next().value);
  }
  return pictures.get(url);
}

self.onmessage = async e => {
  const {id, type, url} = e.data;
  try {
    if (type === 'prepare') { const t = performance.now(); const pic = await load(url); self.postMessage({id, result: {nw: pic.nw, nh: pic.nh, bytes: pic.bytes(), ms: performance.now() - t}}); }
    else if (type === 'propose') { const pic = await load(url); const t = performance.now(); const result = proposePixels(pic, e.data.kind, e.data.geometry, {threshold: e.data.threshold}); if (result) result.ms = Math.round((performance.now() - t) * 10) / 10; self.postMessage({id, result}); }
    else if (type === 'forget') { pictures.delete(url); self.postMessage({id, result: true}); }
  } catch (err) { self.postMessage({id, error: String(err?.message || err)}); }
};
