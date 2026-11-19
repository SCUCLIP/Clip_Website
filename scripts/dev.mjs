/* npm run dev: apply pending local D1 migrations, then start the site and the editor in local mode.
     http://localhost:8787        the public site
     http://admin.localhost:8787  the editor (no sign-in in local mode)
   Needs nothing else: no .dev.vars, no Cloudflare login. Everything stays in .wrangler/state on this computer. */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
if (!fs.existsSync(wrangler)) {
  console.error("wrangler isn't installed. Run `npm ci` first.");
  process.exit(1);
}

/* Local mode only. Keep these flags in sync with CLAUDE.md ("Local mode"). */
const DEV_ARGS = [
  "dev",
  "--ip", "127.0.0.1",                 // listen on this computer only
  "--port", "8787",
  "--var", "LOCAL_MODE:on",            // local mode (it also needs a localhost hostname, see src/hosts.js)
  "--var", "ADMIN_HOST:admin.localhost", // the editor's hostname here (admin.scuclip.com when deployed)
  "--infer-origin-from-routes=false",  // keep the real Host and Origin; otherwise wrangler rewrites them to scuclip.com
];

/* No Cloudflare credentials reach wrangler from here, so nothing in this script can touch the real account.
   X_LOCAL_EXPLORER and X_LOCAL_OBSERVABILITY turn off wrangler's built-in HTTP API for reading and writing the
   local D1/R2 data (/cdn-cgi/local/explorer) and its trace log. The editor doesn't need them, and they would be
   a way into the data that skips the Worker's rules. */
const env = { ...process.env, WRANGLER_SEND_METRICS: "false", X_LOCAL_EXPLORER: "false", X_LOCAL_OBSERVABILITY: "false" };
for (const k of Object.keys(env)) if (/^(CLOUDFLARE|CF)_/i.test(k)) delete env[k];

console.log("Applying local database migrations…");
/* stdin isn't a terminal here, so wrangler applies them without asking. --local: never the real database. */
const mig = spawnSync(process.execPath, [wrangler, "d1", "migrations", "apply", "DB", "--local"], {
  cwd: root, env, stdio: ["ignore", "inherit", "inherit"],
});
if (mig.status !== 0) {
  console.error("\nCouldn't apply the local migrations. If the database is in a bad state, run `npm run db:reset:local`.");
  process.exit(mig.status ?? 1);
}

console.log("\nPublic site: http://localhost:8787\nEditor:      http://admin.localhost:8787\n");
const child = spawn(process.execPath, [wrangler, ...DEV_ARGS], { cwd: root, env, stdio: "inherit" });
const stop = (sig) => { if (!child.killed) child.kill(sig); };
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
