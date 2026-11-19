import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildSeedSql, readSeedDocs, SEED_SQL, SEED_DIR } from "../../scripts/lib/seed.mjs";
import { norm, canon, DOC_IDS } from "../../public/shared/model.js";

test("migrations/0002_seed.sql is up to date with content/seed (run npm run seed:sql)", () => {
  assert.equal(fs.readFileSync(SEED_SQL, "utf8"), buildSeedSql());
});

test("every seed doc exists and is already in canonical form", () => {
  for (const id of DOC_IDS) {
    const raw = JSON.parse(fs.readFileSync(path.join(SEED_DIR, id + ".json"), "utf8"));
    assert.equal(canon(norm(id, raw)), canon(raw), `content/seed/${id}.json changes when normalized`);
  }
});

test("the seed inserts every doc into published and drafts without overwriting", () => {
  const sql = buildSeedSql();
  for (const { id } of readSeedDocs()) {
    assert.ok(sql.includes(`INSERT OR IGNORE INTO published (id, body, updated_at, updated_by) VALUES ('${id}', `), id);
    assert.ok(sql.includes(`INSERT OR IGNORE INTO drafts (id, body, version, updated_at, updated_by) VALUES ('${id}', `), id);
  }
  const statements = sql.split("\n").filter((l) => l && !l.startsWith("--"));
  assert.equal(statements.length, DOC_IDS.length * 2);
  for (const s of statements) {
    assert.match(s, /^INSERT OR IGNORE INTO (published|drafts) /);
    assert.match(s, /'seed'\);$/);
  }
});

test("seed statements fit D1's 100 KB statement limit", () => {
  for (const line of buildSeedSql().split("\n")) assert.ok(Buffer.byteLength(line) < 100_000);
});
