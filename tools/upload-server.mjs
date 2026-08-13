// Tiny LAN upload server so the phone can send the original screenshots at full quality.
// Raw PUT bodies (no multipart, no re-encode) are written straight to sample/.
import { createServer } from 'node:http';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sampleDir = join(root, 'sample');
mkdirSync(sampleDir, { recursive: true });

const PAGE = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>Upload screenshots</title>
<style>body{font-family:system-ui;background:#0e0a1e;color:#ece8ff;margin:0;padding:24px;max-width:520px}
h1{font-size:1.2rem}label{display:block;margin:16px 0 4px;color:#a99fce}
input[type=file]{width:100%}button{margin-top:20px;padding:12px 18px;border:0;border-radius:8px;background:#7c5cff;color:#fff;font-size:1rem;width:100%}
#log{margin-top:16px;white-space:pre-wrap;color:#46d17a}</style>
<h1>📤 Upload the two Champions screenshots</h1>
<label>1 · Stats screen</label><input id=stats type=file accept=image/*>
<label>2 · Moves &amp; More screen</label><input id=moves type=file accept=image/*>
<button onclick=send()>Upload originals</button>
<div id=log></div>
<script>
async function put(which, file){
  const r = await fetch('/upload/'+which, {method:'PUT', headers:{'x-filename':file.name}, body:file});
  return r.ok ? (file.name+' → '+which+' OK ('+Math.round(file.size/1024)+' KB)') : ('FAILED '+which);
}
async function send(){
  const log=document.getElementById('log'); log.textContent='Uploading…';
  const s=document.getElementById('stats').files[0], m=document.getElementById('moves').files[0];
  const out=[];
  if(s) out.push(await put('stats', s));
  if(m) out.push(await put('moves', m));
  log.textContent = out.join('\\n') + '\\n\\nDone — you can close this.';
}
</script>`;

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }
  if (req.method === 'PUT' && req.url?.startsWith('/upload/')) {
    const which = req.url === '/upload/moves' ? 'moves' : 'stats';
    const ext = (req.headers['x-filename'] || '').toString().toLowerCase().endsWith('.png') ? 'png' : 'jpg';
    const dest = join(sampleDir, `${which}-original.${ext}`);
    const out = createWriteStream(dest);
    req.pipe(out);
    out.on('finish', () => {
      console.log(`saved ${dest}`);
      res.writeHead(200);
      res.end('ok');
    });
    out.on('error', () => {
      res.writeHead(500);
      res.end('error');
    });
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

server.listen(4180, '0.0.0.0', () => console.log('upload server on http://0.0.0.0:4180'));
