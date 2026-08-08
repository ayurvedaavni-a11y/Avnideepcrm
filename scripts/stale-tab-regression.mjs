#!/usr/bin/env node
/* ============================================================================
 * STALE-OPEN-TAB REGRESSION — driver
 *
 * Bundles scripts/stale-tab-regression-entry.ts (the REAL src/db/onlineSync
 * engine + REAL Dexie on fake-indexeddb) with esbuild and runs it in Node
 * against a simulated Cloudflare D1 server (fetch stub).
 *
 * Scenario under test (production bug report):
 *   - Tab A already open, server has 1 lead.
 *   - Deploy + import → server gains 10 more leads.
 *   - Tab A (NO manual refresh) must converge to the server count via the
 *     visibility/focus/online full-pull handler, incremental cursor pulls,
 *     and stuck-cursor self-heal.
 * ==========================================================================*/
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const OUT = 'scripts/.tmp-stale-tab.test.mjs';

try {
  // 1) Bundle the real source so we test exactly what ships in production.
  execSync(
    `npx esbuild scripts/stale-tab-regression-entry.ts --bundle --platform=node --format=esm --outfile=${OUT}`,
    { stdio: 'inherit', cwd: process.cwd() }
  );

  // 2) Run it.
  execSync(`node ${OUT}`, { stdio: 'inherit', cwd: process.cwd() });
  console.log('\nSTALE-OPEN-TAB REGRESSION: PASS');
} catch (e) {
  console.error('\nSTALE-OPEN-TAB REGRESSION: FAIL', e.message || e);
  process.exitCode = 1;
} finally {
  try { rmSync(OUT); } catch { /* ignore */ }
}
