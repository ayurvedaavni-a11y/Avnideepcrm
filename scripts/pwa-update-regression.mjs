/**
 * PWA Update Flow — Regression Test (static, runs on the build output).
 *
 * Guards the production bug where the "Update" button was shown but clicking
 * it did nothing: the generated service worker lacked `clients.claim()`, so
 * after SKIP_WAITING the new SW activated without claiming the open page,
 * `controllerchange` never fired and the prompt-mode reload never ran.
 *
 * Asserts the permanent architecture:
 *   1. dist/sw.js contains the Workbox clients.claim() call.
 *   2. dist/sw.js contains the SKIP_WAITING message handler.
 *   3. dist/sw.js still imports the push handler (callback reminders).
 *   4. dist/index.html references content-hashed assets (no stale bundle refs).
 *   5. dist/sw.js precaches index.html with a revision (fresh shell per deploy).
 *   6. src/components/PwaUpdater.tsx implements the deterministic flow
 *      (SKIP_WAITING → controllerchange → guarded reload + timeout fallback).
 *
 * Run: node scripts/pwa-update-regression.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("PWA UPDATE FLOW REGRESSION");
console.log("───────────────────────────");

let sw;
try {
  sw = read("dist/sw.js");
  console.log("\n[1] dist/sw.js");
  check("Workbox clients.claim() call present", /clientsClaim\s*\(\)|clients\.claim\s*\(\)/.test(sw));
  check("SKIP_WAITING message handler present", /SKIP_WAITING/.test(sw) && /skipWaiting\s*\(\)/.test(sw));
  check("push-handler.js still imported", /importScripts\s*\(\s*["']push-handler\.js["']/.test(sw));
  check("index.html precached with revision", /"index\.html",revision:"[a-f0-9]+"/.test(sw));
  check("cleanupOutdatedCaches present", /cleanupOutdatedCaches\s*\(\)/.test(sw));
} catch {
  console.log("\n[1] dist/sw.js — MISSING (run `npm run build` first)");
  check("dist/sw.js exists", false);
}

try {
  const html = read("dist/index.html");
  console.log("\n[2] dist/index.html");
  const hashed = html.match(/assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8}\.(js|css)/g) || [];
  check("all assets content-hashed (no stale refs)", hashed.length >= 2, `found ${hashed.length}`);
  check("modulepreload/vite entry referenced", /type="module"/.test(html) && /\.js"/.test(html));
} catch {
  console.log("\n[2] dist/index.html — MISSING");
  check("dist/index.html exists", false);
}

try {
  const src = read("src/components/PwaUpdater.tsx");
  console.log("\n[3] src/components/PwaUpdater.tsx (deterministic update flow)");
  check("posts SKIP_WAITING to waiting SW", /SKIP_WAITING/.test(src) && /\.waiting/.test(src));
  check("waits for controllerchange", /controllerchange/.test(src));
  check("guarded single reload", /reloadOnce/.test(src) && /reloadStarted/.test(src));
  check("timeout fallback reload", /setTimeout/.test(src) && /waitForControllerChange\(4000\)/.test(src));
  check("build version marker (data-app-version)", /data-app-version/.test(src));
} catch {
  console.log("\n[3] src/components/PwaUpdater.tsx — MISSING");
  check("PwaUpdater.tsx exists", false);
}

try {
  const cfg = read("vite.config.ts");
  console.log("\n[4] vite.config.ts");
  check("workbox clientsClaim enabled", /clientsClaim\s*:\s*true/.test(cfg));
  check("__APP_VERSION__ define present", /__APP_VERSION__/.test(cfg) && /define\s*:/.test(cfg));
} catch {
  console.log("\n[4] vite.config.ts — MISSING");
  check("vite.config.ts exists", false);
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("FAILED:", failures.join(", "));
  process.exit(1);
}
