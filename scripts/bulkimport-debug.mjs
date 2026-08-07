// bulkimport-debug.mjs — diagnose why Import Report doesn't render
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9850 + Math.floor(Math.random() * 100);
const PROFILE = path.join(os.tmpdir(), 'cdp-debug-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

let msgId = 0; const pending = new Map(); const consoleLog = [];

async function main() {
  let version;
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { version = await r.json(); break; } } catch {} await sleep(500); }
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      consoleLog.push('EXC: ' + (d.exception?.description || d.text || '').slice(0, 500));
    } else if (m.method === 'Runtime.consoleAPICalled') {
      const t = m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300);
      if (m.params.type === 'error' || /BulkImport|Import|Dexie|Uncaught|TypeError|ReferenceError/.test(t)) consoleLog.push(t);
    }
  };
  const send = (method, params = {}, sessionId) => { const mid = ++msgId; return new Promise((resolve) => { pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) })); }); };
  const evalJS = async (expression, sid) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid); if (r?.result?.exceptionDetails) consoleLog.push('EVAL: ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 300)); return r?.result?.result?.value; };
  const waitFor = async (expr, sid, t = 45000) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await evalJS(expr, sid); if (v) return v; await sleep(1000); } return null; };

  const { result: t } = await send('Target.createTarget', { url: 'about:blank' });
  const { result: a } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const sid = a.sessionId;
  await send('Page.enable', {}, sid); await send('Runtime.enable', {}, sid); await send('DOM.enable', {}, sid);
  await send('Page.navigate', { url: 'http://127.0.0.1:4173/' }, sid);

  await waitFor(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Admin Login')); if (!b) return false; b.click(); return true; })()`, sid, 60000);
  await waitFor(`(() => [...document.querySelectorAll('input')].length >= 2)()`, sid, 30000);
  await evalJS(`(() => { const i = [...document.querySelectorAll('input')]; const setVal = (el, v) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; setVal(i[0], '9876543210'); setVal(i[1], '1234'); const btn = [...document.querySelectorAll('button')].find(b => /Login|Sign In|Enter/i.test(b.textContent)); if (btn) btn.click(); return true; })()`, sid);
  await waitFor(`(() => { const d = document.body.innerText || ''; return d.includes('Bulk Import') && d.includes('Download Sample'); })()`, sid, 60000);
  await evalJS(`location.hash = '#/bulk-import'; true`, sid);
  await waitFor(`(() => (document.body.innerText || '').includes('Download Sample'))()`, sid, 30000);

  const csvPath = path.join(os.tmpdir(), 'dbg.csv');
  fs.writeFileSync(csvPath, ['name,mobile,address,pincode,product,source,notes', 'Ravi Kumar,9876543211,Delhi,110001,Ashwagandha,Facebook,test1', 'Priya Sharma,9876543212,Mumbai,400001,Triphala,Website,test2'].join('\n'), 'utf8');
  const { result: doc } = await send('DOM.getDocument', {}, sid);
  const { result: qr } = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' }, sid);
  await send('DOM.setFileInputFiles', { nodeId: qr.nodeId, files: [csvPath] }, sid);
  const pre = await waitFor(`(() => { const t = document.body.innerText || ''; const m = t.match(/Preview — first \\d+ rows of (\\d+)/); return m ? Number(m[1]) : null; })()`, sid, 30000);
  console.log('PREVIEW rows:', pre);

  const clicked = await evalJS(`(() => { const b = [...document.querySelectorAll('button')].find(b => /^Import \\d+ Rows$/.test(b.textContent.trim())); if (!b) return 'NOT FOUND'; b.click(); return 'CLICKED'; })()`, sid);
  console.log('IMPORT CLICK:', clicked);
  for (const wait of [3000, 5000]) {
    await sleep(wait);
    const state = await evalJS(`(() => { const t = document.body.innerText || ''; return { hasReport: t.includes('Import Report'), hasProgress: t.includes('Importing') || t.includes('Processing'), importingBar: /\\d+%/.test(t), bodyLen: t.length, tail: t.slice(-600) }; })()`, sid);
    console.log('STATE after ' + wait + 'ms:', JSON.stringify(state, null, 1));
  }
  const finalBody = await evalJS(`document.body.innerText`, sid);
  console.log('\n===== FULL BODY TEXT (tail 2000) =====');
  console.log(finalBody.slice(-2000));
  console.log('\n===== CONSOLE / EXC LOG =====');
  console.log(consoleLog.length ? consoleLog.join('\n') : '(none captured)');
  chrome.kill(); process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); chrome.kill(); process.exit(1); });
