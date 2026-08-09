#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
const OUT = 'scripts/.tmp-perf-bench.test.mjs';
try {
  execSync('npx esbuild scripts/perf-bench-entry.ts --bundle --platform=node --format=esm --outfile=' + OUT, { stdio: 'inherit', cwd: process.cwd() });
  execSync('node ' + OUT, { stdio: 'inherit', cwd: process.cwd() });
} catch (e) {
  console.error('PERF BENCH FAIL', e.message || e);
  process.exitCode = 1;
} finally {
  try { rmSync(OUT); } catch {}
}
