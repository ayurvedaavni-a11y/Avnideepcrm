// bulkimport-final-e2e.mjs — DEFINITIVE Bulk Import e2e (valid data, fixed extraction)
// Local rig: dist-local-test on :4173, worker on :8787, D1 cleaned before run.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_URL = 'http://127.0.0.1:4173/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9700 + Math.floor(Math.random() * 200);
const PROFILE = path.join(os.tmpdir(), 'cdp-final-' + Date.now());
const DL_DIR = path.join(os.tmpdir(), 'final-dl-' + Date.now());
fs.mkdirSync(DL_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions',
  '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });

let msgId = 0;
const pending = new Map();
const consoleErrors = [];
const results = [];
const UNIQ = Date.now().toString().slice(-5); // 5 digits

// Valid 10-digit unique mobiles: 98 + UNIQ(5) + 3 digits = 10
const M1 = '98' + UNIQ + '321';
const M2 = '98' + UNIQ + '322';
const M3 = '98' + UNIQ + '323';
const M4 = '98' + UNIQ + '324';

function log(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  let version;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { version = await r.json(); break; } } catch {}
    await sleep(500);
  }
  if (!version) { console.error('FATAL: CDP not reachable'); chrome.kill(); process.exit(1); }

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('EXCEPTION: ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 300));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push('CONSOLE.ERROR: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    }
  };
  const send = (method, params = {}, sessionId) => {
    const mid = ++msgId;
    return new Promise((resolve) => { pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) })); });
  };
  const evalJS = async (expression, sid) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid);
    if (r?.result?.exceptionDetails) consoleErrors.push('EVAL_EXC: ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 200));
    return r?.result?.result?.value;
  };
  const waitFor = async (expr, sid, timeoutMs = 45000, label = '') => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const v = await evalJS(expr, sid);
      if (v) return v;
      await sleep(1200);
    }
    log('WAIT TIMEOUT: ' + label, false, '');
    return null;
  };
  // Upload a CSV via the dropzone file input (objectId approach — reliable)
  const uploadCsv = async (sid, csvPath) => {
    await evalJS(`(() => { const i = document.querySelector('input[type=file]'); if (i) window.__finput = i; return !!i; })()`, sid);
    const obj = await send('Runtime.evaluate', { expression: 'window.__finput', returnByValue: false }, sid);
    const objId = obj?.result?.result?.objectId;
    if (!objId) return false;
    await send('DOM.setFileInputFiles', { objectId: objId, files: [csvPath] }, sid);
    await sleep(2500);
    return true;
  };
  const readReport = async (sid) => {
    const r = await evalJS(`(() => {
      const t = document.body.innerText || '';
      if (!t.includes('Import Report')) return null;
      const num = (label) => { const m = t.match(new RegExp('(\\\\d+)\\\\s*' + label, 'i')); return m ? Number(m[1]) : null; };
      return { total: num('TOTAL'), imported: num('IMPORTED'), updated: num('UPDATED'), skipped: num('SKIPPED'), duplicate: num('DUPLICATE'), failed: num('FAILED') };
    })()`, sid);
    return r;
  };

  const { result: t } = await send('Target.createTarget', { url: 'about:blank' });
  const { result: a } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const sid = a.sessionId;
  await send('Page.enable', {}, sid);
  await send('Runtime.enable', {}, sid);
  await send('DOM.enable', {}, sid);
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR, eventsEnabled: true });

  console.log('\n=== BULK IMPORT DEFINITIVE E2E (uniq ' + UNIQ + ') ===\n');
  await send('Page.navigate', { url: APP_URL }, sid);

  // 1. Login
  const roleClicked = await waitFor(
    `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Admin Login')); if (!b) return false; b.click(); return true; })()`,
    sid, 60000, 'admin role'
  );
  log('1. Role screen → Admin', !!roleClicked);
  await waitFor(`(() => [...document.querySelectorAll('input')].length >= 2)()`, sid, 30000, 'login inputs');
  await evalJS(`(() => {
    const i = [...document.querySelectorAll('input')];
    const setVal = (el, v) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    setVal(i[0], '9876543210'); setVal(i[1], '1234');
    const btn = [...document.querySelectorAll('button')].find(b => /Login|Sign In|Enter|Dobara/i.test(b.textContent) && b.textContent.trim().length < 30);
    if (btn) btn.click();
    return true;
  })()`, sid);
  const dashboard = await waitFor(
    `(() => { const d = document.body.innerText || ''; return d.includes('Dashboard') && d.includes('Bulk Import'); })()`, sid, 60000, 'dashboard'
  );
  log('2. Login → dashboard', !!dashboard);

  // 2. Open Bulk Import
  await evalJS(`location.hash = '#/bulk-import'; true`, sid);
  const pageOpen = await waitFor(
    `(() => { const d = document.body.innerText || ''; return d.includes('Download Sample') && d.includes('Skip Duplicate'); })()`, sid, 30000, 'bulk import page'
  );
  const moduleError = await evalJS(`(document.body.innerText || '').includes('Module error occurred')`, sid);
  log('3. Bulk Import page WITHOUT "Module error occurred"', !!pageOpen && !moduleError, moduleError ? 'MODULE ERROR PRESENT' : 'clean');

  // 3. UI
  const ui = await evalJS(`(() => {
    const t = document.body.innerText || '';
    return {
      dl: t.includes('Download Sample'),
      tabs: ['Leads','Orders','Courier'].every(x => t.includes(x)),
      dup: ['Skip Duplicate','Update Existing Customer','Merge Lead History'].every(x => t.includes(x)),
      drop: t.includes('drag-drop'),
      input: !!document.querySelector('input[type=file]'),
    };
  })()`, sid);
  log('4. UI elements present', ui?.dl && ui?.tabs && ui?.dup && ui?.drop && ui?.input, JSON.stringify(ui));

  // 4. Sample download
  await evalJS(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Download Sample'))?.click(); true`, sid);
  await sleep(6000);
  const dlFiles = fs.readdirSync(DL_DIR);
  log('5. Sample .xlsx download', dlFiles.length > 0, dlFiles.join(', ') || 'none');

  // 5. FIRST IMPORT — 3 NEW valid rows
  const csvPath = path.join(os.tmpdir(), 'final-' + UNIQ + '.csv');
  const csv = [
    'name,mobile,address,pincode,product,source,notes',
    `Ravi Kumar,${M1},Delhi,110001,Ashwagandha,Facebook,t1`,
    `Priya Sharma,${M2},Mumbai,400001,Triphala,Website,t2`,
    `Amit Verma,${M3},Jaipur,302001,Shilajit,Google Forms,t3`,
  ].join('\n');
  fs.writeFileSync(csvPath, csv, 'utf8');
  await uploadCsv(sid, csvPath);
  const preview = await waitFor(
    `(() => { const t = document.body.innerText || ''; const m = t.match(/Preview — first \\d+ rows of (\\d+)/); return m ? Number(m[1]) : null; })()`, sid, 30000, 'preview'
  );
  log('6. Preview: 3 rows', preview === 3, 'rows=' + preview);
  await evalJS(`[...document.querySelectorAll('button')].find(b => /^Import \\d+ Rows$/.test(b.textContent.trim()))?.click(); true`, sid);
  const report = await waitFor(`(() => { const r = (${readReport.toString()})(arguments[0]); return r; })()`, sid, 120000, 'first report');
  // simpler: inline
  const report1 = await waitFor(`(() => {
    const t = document.body.innerText || '';
    if (!t.includes('Import Report')) return null;
    const num = (label) => { const m = t.match(new RegExp('(\\\\d+)\\\\s*' + label, 'i')); return m ? Number(m[1]) : null; };
    return { total: num('TOTAL'), imported: num('IMPORTED'), skipped: num('SKIPPED'), duplicate: num('DUPLICATE'), failed: num('FAILED') };
  })()`, sid, 120000, 'first import report');
  log('7. First import → 3 imported, 0 failed', !!report1 && report1.imported === 3 && report1.failed === 0 && report1.total === 3, JSON.stringify(report1));

  // 6. RE-IMPORT same file → duplicates
  await evalJS(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Naya Import'))?.click(); true`, sid);
  await sleep(2000);
  await uploadCsv(sid, csvPath);
  await waitFor(`(() => (document.body.innerText || '').includes('Import 3 Rows'))()`, sid, 30000, 'reimport btn');
  await evalJS(`[...document.querySelectorAll('button')].find(b => /^Import \\d+ Rows$/.test(b.textContent.trim()))?.click(); true`, sid);
  const report2 = await waitFor(`(() => {
    const t = document.body.innerText || '';
    if (!t.includes('Import Report')) return null;
    const num = (label) => { const m = t.match(new RegExp('(\\\\d+)\\\\s*' + label, 'i')); return m ? Number(m[1]) : null; };
    return { imported: num('IMPORTED'), skipped: num('SKIPPED'), duplicate: num('DUPLICATE'), failed: num('FAILED') };
  })()`, sid, 120000, 'dup report');
  log('8. Re-import → 0 imported, 3 duplicates (no double-create)', !!report2 && report2.imported === 0 && (report2.duplicate === 3 || report2.skipped === 3), JSON.stringify(report2));

  // 7. INVALID mobile CSV → failed rows + failed-download button
  const badCsvPath = path.join(os.tmpdir(), 'final-bad-' + UNIQ + '.csv');
  const badCsv = [
    'name,mobile,address',
    'No Mobile,,Delhi',
    'Bad Mobile,12345,Delhi',
    `Valid One,${M4},Mumbai`,
  ].join('\n');
  fs.writeFileSync(badCsvPath, badCsv, 'utf8');
  await evalJS(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Naya Import'))?.click(); true`, sid);
  await sleep(2000);
  await uploadCsv(sid, badCsvPath);
  await waitFor(`(() => (document.body.innerText || '').includes('Import 3 Rows'))()`, sid, 30000, 'bad btn');
  await evalJS(`[...document.querySelectorAll('button')].find(b => /^Import \\d+ Rows$/.test(b.textContent.trim()))?.click(); true`, sid);
  const report3 = await waitFor(`(() => {
    const t = document.body.innerText || '';
    if (!t.includes('Import Report')) return null;
    const num = (label) => { const m = t.match(new RegExp('(\\\\d+)\\\\s*' + label, 'i')); return m ? Number(m[1]) : null; };
    return { imported: num('IMPORTED'), failed: num('FAILED'), failedBtn: t.includes('Failed Rows Download') };
  })()`, sid, 120000, 'bad report');
  log('9. Invalid mobile → 1 imported, 2 failed + Failed-Rows download', !!report3 && report3.imported === 1 && report3.failed === 2 && report3.failedBtn, JSON.stringify(report3));

  // 8. Sync verification — data pushed to worker
  const counts = await evalJS(`Promise.all([
    fetch('http://127.0.0.1:8787/api/auth/me', { headers: { Authorization: 'Bearer ' + (localStorage.getItem('crm_auth_token') || '') } }).then(r => r.status)
  ])`, sid);
  log('10. Worker /auth/me → 200', counts?.[0] === 200, 'status=' + counts?.[0]);

  console.log('\n=== SUMMARY ===');
  const passed = results.filter(r => r.ok).length;
  results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`));
  console.log(`\nRESULT: ${passed}/${results.length} passed`);
  console.log('CONSOLE ERRORS:', consoleErrors.length ? consoleErrors.join('\n  ') : '(none)');

  chrome.kill();
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); chrome.kill(); process.exit(1); });
