#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
const OUT = 'scripts/.tmp-merge-preserve.test.mjs';
try {
  execSync('npx esbuild scripts/merge-preserve-regression-entry.ts --bundle --platform=node --format=esm --outfile=' + OUT, { stdio: 'inherit', cwd: process.cwd() });
  execSync('node ' + OUT, { stdio: 'inherit', cwd: process.cwd() });
  console.log('\nMERGE-PRESERVE REGRESSION: PASS');
} catch (e) {
  console.error('\nMERGE-PRESERVE REGRESSION: FAIL', e.message || e);
  process.exitCode = 1;
} finally {
  try { rmSync(OUT); } catch {}
}
