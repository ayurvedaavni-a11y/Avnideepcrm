// netproof.mjs — Production Network-tab proof for the login request.
// Opens the deployed GitHub Pages frontend in headless Chrome, drives the
// login form, and prints every request that matches auth/login, workers.dev,
// localhost, 127.0.0.1 or :8787 — exactly like a manual Network tab check.
//
// Usage: node scripts/netproof.mjs [deployed-url]

import { spawn } from 'node:child_process';

const DEPLOYED_URL =
  process.argv[2] || 'https://ayurvedaavni-a11y.github.io/Avnideepcrm/';
const CHROME =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const PROFILE = 'C:\\Users\\ayurv\\AppData\\Local\\Temp\\cdp-netproof-' + Date.now();

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
  // 1) Wait for the CDP endpoint
  let version;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) { version = await r.json(); break; }
    } catch { /* not up yet */ }
    await sleep(500);
  }
  if (!version) {
    console.error('FATAL: Chrome DevTools endpoint not reachable');
    chrome.kill();
    process.exit(1);
  }

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) {
      eventLog.push(msg);
    }
  };

  const send = (method, params = {}, sessionId) => {
    const mid = ++msgId;
    return new Promise((resolve) => {
      pending.set(mid, resolve);
      ws.send(
        JSON.stringify({
          id: mid,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        })
      );
    });
  };

  const evalJS = async (expression, sessionId) => {
    const r = await send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      sessionId
    );
    return r?.result?.result?.value;
  };

  // 2) Create a page target and enable domains
  const { result: t } = await send('Target.createTarget', { url: 'about:blank' });
  const { result: a } = await send('Target.attachToTarget', {
    targetId: t.targetId,
    flatten: true,
  });
  const sid = a.sessionId;
  await send('Page.enable', {}, sid);
  await send('Network.enable', {}, sid);
  await send('Runtime.enable', {}, sid);

  console.log('\n=== NETWORK PROOF — production frontend login ===');
  console.log('Deployed URL:', DEPLOYED_URL);

  // 3) Navigate to the deployed app
  await send('Page.navigate', { url: DEPLOYED_URL }, sid);
  await sleep(9000); // let the SPA boot

  // 4) Step 1: pick the Admin role card
  const roleRes = await evalJS(
    `(() => {
       const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Admin Login'));
       if (!b) return 'ROLE-BUTTON-NOT-FOUND: ' + [...document.querySelectorAll('button')].map(x=>x.textContent.trim().slice(0,30)).join(' | ');
       b.click();
       return 'clicked Admin role card';
     })()`,
    sid
  );
  console.log('role step:', roleRes);
  await sleep(1500);

  // 5) Step 2: fill mobile + PIN (React-safe value setter) and submit
  const formRes = await evalJS(
    `(() => {
       const setNative = (el, v) => {
         const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
         setter.call(el, v);
         el.dispatchEvent(new Event('input', { bubbles: true }));
       };
       const inputs = [...document.querySelectorAll('input')];
       const tel = inputs.find(i => i.type === 'tel');
       const pwd = inputs.find(i => i.type === 'password');
       if (!tel || !pwd) return 'inputs missing: tel=' + !!tel + ' pwd=' + !!pwd;
       setNative(tel, '9999999999');
       setNative(pwd, '123456');
       const form = document.querySelector('form');
       if (!form) return 'form missing';
       form.requestSubmit();
       return 'submitted mobile=9999999999 pin=123456';
     })()`,
    sid
  );
  console.log('form step:', formRes);

  // 6) Wait for the login fetch to complete
  await sleep(10000);

  // 7) Collect proof from CDP network events (the real Network tab data)
  const seen = new Map();
  const statusById = new Map();
  for (const ev of eventLog) {
    if (ev.sessionId !== sid) continue;
    if (ev.method === 'Network.requestWillBeSent') {
      seen.set(ev.params.requestId, {
        url: ev.params.request.url,
        method: ev.params.request.method,
      });
    } else if (ev.method === 'Network.responseReceived') {
      statusById.set(ev.params.requestId, ev.params.response.status);
    }
  }

  const filter = (u) =>
    /auth\/login|workers\.dev|localhost|127\.0\.0\.1|8787/.test(u);

  console.log('\n--- CDP Network.requestWillBeSent (Network tab equivalent) ---');
  let anyLocalhost = false;
  let loginHits = 0;
  for (const req of seen.values()) {
    if (!filter(req.url)) continue;
    if (/localhost|127\.0\.0\.1|8787/.test(req.url) && !/workers\.dev/.test(req.url)) {
      anyLocalhost = true;
    }
    if (req.url.includes('/api/auth/login')) loginHits++;
    console.log(`${req.method}  ${req.url}`);
  }

  // 8) Cross-check via performance entries (same data the DevTools console would show)
  const perf = await evalJS(
    `performance.getEntriesByType('resource').map(e => e.name).filter(u => /auth\\/login|workers\\.dev|localhost|127\\.0\\.0\\.1|8787/.test(u))`,
    sid
  );
  console.log('\n--- performance.getEntriesByType(resource) cross-check ---');
  console.log(JSON.stringify(perf, null, 2));

  console.log('\n=== VERDICT ===');
  const workerHits = [...seen.values()].filter((r) => r.url.includes('workers.dev'));
  console.log('login POST hits  :', loginHits);
  console.log('worker.dev requests:', workerHits.length);
  console.log('any localhost/127.0.0.1/:8787 request:', anyLocalhost ? 'YES (BUG!)' : 'NO — clean');
  console.log(
    'login request target:',
    [...seen.values()].find((r) => r.url.includes('/api/auth/login'))?.url || '(no login request captured)'
  );

  ws.close();
  chrome.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error('netproof error:', e);
  chrome.kill();
  process.exit(1);
});
