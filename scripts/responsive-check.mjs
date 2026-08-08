// RESPONSIVE VERIFICATION — 3 viewports × all routes, horizontal-overflow test
import puppeteer from 'puppeteer';
const APP = process.env.APP_URL || 'http://127.0.0.1:5173';
const EXE = process.env.CHROME_EXE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROUTES = [
  '/', '/leads', '/followups', '/orders', '/customers', '/logistics', '/invoices',
  '/analytics', '/team', '/settings', '/backup', '/inventory', '/payments',
  '/gst-reports', '/bulk-import', '/delivered-list', '/undelivered-list',
  '/courier-analytics', '/ndr', '/db-health', '/whatsapp', '/performance',
];
const VIEWPORTS = [
  { name: 'mobile-375', width: 375, height: 667 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];

const results = [];
const log = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

(async () => {
  console.log('\n════════ RESPONSIVE VERIFICATION ════════\n');
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();

  // Login once (admin)
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(APP + '/login', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(2000);
  await page.type('input[type="tel"], input[type="text"]', '9876543210').catch(async () => {
    // find mobile input
    await page.evaluate(() => {
      const inp = [...document.querySelectorAll('input')].find((i) => i.placeholder?.toLowerCase().includes('mobile') || i.type === 'tel');
      if (inp) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(inp, '9876543210'); inp.dispatchEvent(new Event('input', { bubbles: true })); }
    });
  });
  await page.evaluate(() => {
    const inp = [...document.querySelectorAll('input')].find((i) => i.type === 'password' || i.placeholder?.toLowerCase().includes('pin'));
    if (inp) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(inp, '1234'); inp.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await sleep(300);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /login|sign in|enter/i.test(x.textContent || ''));
    b && b.click();
  });
  await sleep(4000);
  const afterLogin = await page.evaluate(() => location.pathname);
  console.log('  login →', afterLogin);

  // Test each route at each viewport
  for (const vp of VIEWPORTS) {
    await page.setViewport({ width: vp.width, height: vp.height });
    for (const route of ROUTES) {
      await page.goto(APP + route, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await sleep(1800); // let layout settle
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const over = de.scrollWidth - de.clientWidth;
        return {
          over,
          scrollW: de.scrollWidth,
          clientW: de.clientWidth,
          bodyLen: document.body.innerText.length,
          isLogin: location.pathname === '/login' || !document.body.innerText.includes('AVNIDEEP') && document.body.innerText.length < 200,
        };
      });
      // ignore if redirect to login (auth not loaded yet) — count only app pages
      if (m.isLogin && route !== '/') continue;
      const ok = m.over <= 1; // 1px tolerance
      const key = `${vp.name} ${route}`;
      if (!ok) {
        // find the offending elements
        const offenders = await page.evaluate(() => {
          const out = [];
          const w = document.documentElement.clientWidth;
          document.querySelectorAll('*').forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.right > w + 2 && r.width > 40) {
              out.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 50)} right=${Math.round(r.right)}`);
            }
          });
          return out.slice(0, 6);
        });
        log(key, false, `overflow=${m.over}px | ${offenders.join(' | ')}`);
      } else {
        log(key, true);
      }
    }
  }

  await browser.close();
  console.log('\n=== SUMMARY ===');
  const passed = results.filter((r) => r.ok).length;
  results.forEach((r) => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`));
  console.log(`\nRESPONSIVE: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
