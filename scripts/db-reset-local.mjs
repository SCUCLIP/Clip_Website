/* npm run db:reset:local: delete the local D1 database, so the next `npm run dev` creates it again from the
   migrations (schema + seed). Only touches .wrangler/state on this computer.
   Add `-- --photos` to delete the local photos (R2) too. Stop `npm run dev` first. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const state = path.join(root, ".wrangler", "state", "v3");
const targets = [["the local database", path.join(state, "d1")]];
if (process.argv.includes("--photos")) targets.push(["the local photos", path.join(state, "r2")]);

let failed = false;
for (const [label, dir] of targets) {
  if (!fs.existsSync(dir)) { console.log(`No ${label.replace(/^the /, "")} to delete.`); continue; }
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    console.log(`Deleted ${label} (${path.relative(root, dir)}).`);
  } catch (err) {
    failed = true;
    console.error(`Couldn't delete ${label}: ${err.code || err.message}. Stop \`npm run dev\` and try again.`);
  }
}
if (!failed) console.log("Run `npm run dev` to start again from the seed content.");
process.exit(failed ? 1 : 0);
