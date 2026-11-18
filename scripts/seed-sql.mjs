/* npm run seed:sql: turn content/seed/*.json into migrations/0002_seed.sql.
   Every doc goes into both `published` and `drafts` with INSERT OR IGNORE and updated_by = 'seed'.
   `--check` only reports whether the file is up to date (used by npm run check).

   A migration runs once per database. To load changed seed content into your local database, run
   `npm run db:reset:local` and then `npm run dev`. */

import fs from "node:fs";
import path from "node:path";
import { buildSeedSql, SEED_SQL, ROOT } from "./lib/seed.mjs";

const out = buildSeedSql();
const rel = path.relative(ROOT, SEED_SQL);
const current = fs.existsSync(SEED_SQL) ? fs.readFileSync(SEED_SQL, "utf8") : null;
if (process.argv.includes("--check")) {
  if (current !== out) { console.error(`${rel} is out of date. Run npm run seed:sql.`); process.exit(1); }
  console.log(`${rel} is up to date.`);
} else if (current === out) {
  console.log(`${rel} is already up to date.`);
} else {
  fs.writeFileSync(SEED_SQL, out);
  console.log(`Wrote ${rel} (${out.length} bytes).`);
}
