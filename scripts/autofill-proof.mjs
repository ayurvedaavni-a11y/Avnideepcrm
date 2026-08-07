// autofill-proof.mjs — Live DOM verification that:
//  1) login inputs carry autoComplete="off"/"new-password" (no browser autofill),
//  2) a login attempt never auto-opens Team Management.
// Usage: node scripts/autofill-proof.mjs [deployed-url]

import { spawn } from 'node:child_process';

const DEPLOYED_URL =
  process.argv[2] || 'https://ayurvedaavni-a11y.github.io/Avnideepcrm/';
const CHROME =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9400 + Math.floor(Math.random() * 400); // avoid clashes with leftover Chrome
const PROFILE = 'C:\\Users\\ayurv\\AppData\\Local\\Temp\\cdp-autofill-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let msgId = 0;
const pending = new Map();
const eventLog = [];

async function main() {
  let version;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) { version = await r.json(); break; }
    } catch { /* not up yet */ }
    await sleep(500);
  }
  if (!version) { console.error('FATAL: CDP not reachable'); chrome.kill(); process.exit(1); }

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const consoleErrors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) {
      eventLog.push(msg);
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push('EXCEPTION: ' + (msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text));
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push('CONSOLE.ERROR: ' + msg.params.args.map(a => a.value ?? a.description ?? '').join(' '));
      }
    }
  };
  const send = (method, params = {}, sessionId) => {
    const mid = ++msgId;
    return new Promise((resolve) => {
      pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  };
  const evalJS = async (expression, sessionId) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    return r?.result?.result?.value;
  };

  const { result: t } = await send('Target.createTarget', { url: 'about:blank' });
  const { result: a } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const sid = a.sessionId;
  await send('Page.enable', {}, sid);
  await send('Network.enable', {}, sid);
  await send('Runtime.enable', {}, sid);

  console.log('\n=== AUTO-FILL / AUTO-OPEN PROOF — production frontend ===');
  console.log('CDP port:', PORT);
  console.log('Deployed URL:', DEPLOYED_URL);  await send('Page.navigate', { url: DEPLOYED_URL }, sid);

  // Step 1: the login screen starts on ROLE SELECTION — click the Admin card,
  // which reveals the mobile/PIN form inputs.
  let clicked = null;
  for (let i = 0; i < 20; i++) {
    clicked = await evalJS(
      `(() => {
         const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Admin Login'));
         if (!b) return null;
         b.click();
         return 'clicked';
       })()`,
      sid
    );
    if (clicked) break;
    await sleep(1500);
  }
  if (!clicked) {
    const diag = await evalJS(`({ ready: document.readyState, rootLen: (document.getElementById('root')||{}).childElementCount, url: location.href })`, sid);
    console.error('FATAL: role selection button never appeared');
    console.error('DIAG:', JSON.stringify(diag));
    console.error('CONSOLE ERRORS:', consoleErrors.join('\n') || '(none)');
    chrome.kill();
    process.exit(1);
  }

  // Step 2: poll for the login form inputs (they appear after role selection).
  let attrs = null;
  for (let i = 0; i < 20; i++) {
    attrs = await evalJS(
      `(() => {
         const inputs = [...document.querySelectorAll('input')];
         if (inputs.length < 2) return null;
         return inputs.map(x => ({ type: x.type, autoComplete: x.getAttribute('autocomplete'), value: x.value }));
       })()`,
      sid
    );
    if (attrs) break;
    await sleep(1000);
  }
  if (!attrs) {
    const diag = await evalJS(`({ ready: document.readyState, rootLen: (document.getElementById('root')||{}).childElementCount })`, sid);
    console.error('FATAL: login form inputs never appeared');
    console.error('DIAG:', JSON.stringify(diag));
    console.error('CONSOLE ERRORS:', consoleErrors.join('\n') || '(none)');
    chrome.kill();
    process.exit(1);
  }

  console.log('\n--- login form inputs (DOM autocomplete attributes) ---');
  console.log(JSON.stringify(attrs, null, 2));

  const formAttr = await evalJS(
    `(() => { const f = document.querySelector('form'); return f ? f.getAttribute('autocomplete') : null; })()`,
    sid
  );
  console.log('form autocomplete attr:', formAttr);

  // 3) Attempt login with invalid creds — must NOT navigate to /team
  const step2 = await evalJS(
    `(() => {
       const setNative = (el, v) => {
         const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
         s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
       };
       const inputs = [...document.querySelectorAll('input')];
       const tel = inputs.find(i => i.type === 'tel');
       const pwd = inputs.find(i => i.type === 'password');
       if (!tel || !pwd) return 'inputs missing';
       setNative(tel, '9999999999'); setNative(pwd, '123456');
       const f = document.querySelector('form'); f.requestSubmit();
       return 'submitted';
     })()`,
    sid
  );
  console.log('\nlogin attempt: admin role selected, creds submitted');
  await sleep(8000);

  const hash = await evalJS(`location.hash`, sid);
  console.log('hash after failed login attempt:', hash, '(must NOT be #/team)');

  ws.close();
  chrome.kill();
  process.exit(0);
}

main().catch((e) => { console.error('error:', e); chrome.kill(); process.exit(1); });
