import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist-local-test');
const PORT = 4173;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let fp = path.join(DIST_DIR, urlPath === '/' ? 'index.html' : urlPath);
  fs.readFile(fp, (err, data) => {
    if (err) { fs.readFile(path.join(DIST_DIR, 'index.html'), (e2, idx) => { if (e2) { res.writeHead(500); res.end('err'); return; } res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(idx); }); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log('LOCAL TEST SERVER on http://127.0.0.1:' + PORT));
