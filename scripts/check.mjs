/* npm run check: everything that must pass before a commit (and what CI runs).
   1. Node tests (test/node): render vs the static export, norm(), the editor's catalog, config rules, the demo build,
      generated files up to date.
   2. Worker tests (test/worker): every route against local D1 and R2, in workerd (vitest + the Workers plugin).
   3. A Worker build (wrangler deploy --dry-run): bundles the Worker the way a deploy would, and uploads nothing.
   No Cloudflare credentials reach any of these: CLOUDFLARE_* and CF_* variables are removed first. */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };
for (const k of Object.keys(env)) if (/^(CLOUDFLARE|CF)_/i.test(k)) delete env[k];

const run = (label, args) => {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", env });
  if (r.status !== 0) {
    console.error(`\n${label} failed.`);
    process.exit(r.status ?? 1);
  }
};

const nodeTests = fs.readdirSync(path.join(root, "test/node")).filter((f) => f.endsWith(".test.mjs")).map((f) => path.join("test/node", f));
run("Node tests", ["--test", ...nodeTests]);
run("Worker tests", [path.join(root, "node_modules/vitest/vitest.mjs"), "run"]);
run("Worker build (dry run, nothing is uploaded)", [path.join(root, "node_modules/wrangler/bin/wrangler.js"), "deploy", "--dry-run", "--outdir", "dist/worker"]);
console.log("\nAll checks passed.");
