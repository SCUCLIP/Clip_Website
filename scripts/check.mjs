/* npm run check: everything that must pass before a commit.
   1. Node tests (test/node): render vs the static export, norm(), config rules, generated files up to date.
   2. Worker tests (test/worker): every route against local D1 and R2, in workerd (vitest + the Workers pool). */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (label, args) => {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  if (r.status !== 0) {
    console.error(`\n${label} failed.`);
    process.exit(r.status ?? 1);
  }
};

const nodeTests = fs.readdirSync(path.join(root, "test/node")).filter((f) => f.endsWith(".test.mjs")).map((f) => path.join("test/node", f));
run("Node tests", ["--test", ...nodeTests]);
run("Worker tests", [path.join(root, "node_modules/vitest/vitest.mjs"), "run"]);
console.log("\nAll checks passed.");
