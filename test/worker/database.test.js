/* The schema and the seed migration, against local D1. */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const DOC_IDS = ["site", "home", "about", "events", "biohackathon", "speakers", "board", "resources", "faq"];
const seedMigration = () => env.TEST_MIGRATIONS.find((m) => m.name.startsWith("0002_"));
const runSeedAgain = () => env.DB.batch(seedMigration().queries.map((q) => env.DB.prepare(q)));

describe("seed", () => {
  it("puts every doc in published and drafts, by 'seed', at version 1", async () => {
    const pub = await env.DB.prepare("SELECT id, updated_by FROM published ORDER BY id").all();
    const drafts = await env.DB.prepare("SELECT id, version, updated_by FROM drafts ORDER BY id").all();
    expect(pub.results.map((r) => r.id).sort()).toEqual([...DOC_IDS].sort());
    expect(drafts.results.map((r) => r.id).sort()).toEqual([...DOC_IDS].sort());
    for (const r of [...pub.results, ...drafts.results]) expect(r.updated_by).toBe("seed");
    for (const r of drafts.results) expect(r.version).toBe(1);
  });

  it("stores the same doc in both tables, as JSON", async () => {
    const row = await env.DB.prepare("SELECT p.body AS p, d.body AS d FROM published p JOIN drafts d USING (id) WHERE id = 'home'").first();
    expect(row.p).toBe(row.d);
    expect(JSON.parse(row.p).sections.length).toBe(5);
  });

  it("never overwrites later edits when it runs again", async () => {
    await env.DB.prepare("UPDATE drafts SET body = '{\"edited\":true}', version = 7, updated_by = 'editor@scu.edu' WHERE id = 'about'").run();
    await env.DB.prepare("UPDATE published SET body = '{\"edited\":true}', updated_by = 'editor@scu.edu' WHERE id = 'about'").run();
    await runSeedAgain();
    const d = await env.DB.prepare("SELECT body, version, updated_by FROM drafts WHERE id = 'about'").first();
    const p = await env.DB.prepare("SELECT body, updated_by FROM published WHERE id = 'about'").first();
    expect(d).toEqual({ body: '{"edited":true}', version: 7, updated_by: "editor@scu.edu" });
    expect(p).toEqual({ body: '{"edited":true}', updated_by: "editor@scu.edu" });
  });

  it("fills in a doc that's missing without touching the others", async () => {
    await env.DB.prepare("DELETE FROM drafts WHERE id = 'faq'").run();
    await env.DB.prepare("UPDATE drafts SET version = 3 WHERE id = 'home'").run();
    await runSeedAgain();
    expect((await env.DB.prepare("SELECT version FROM drafts WHERE id = 'faq'").first()).version).toBe(1);
    expect((await env.DB.prepare("SELECT version FROM drafts WHERE id = 'home'").first()).version).toBe(3);
  });
});

describe("schema", () => {
  it("keeps draft versions at 1 or more", async () => {
    await expect(env.DB.prepare("UPDATE drafts SET version = 0 WHERE id = 'home'").run()).rejects.toThrow(/CHECK/);
  });

  it("rolls back a whole batch when the publish guard fails", async () => {
    const before = await env.DB.prepare("SELECT body FROM published WHERE id = 'home'").first();
    await expect(env.DB.batch([
      env.DB.prepare("UPDATE published SET body = 'changed' WHERE id = 'home'"),
      env.DB.prepare("INSERT INTO publish_guard (ok) SELECT COUNT(*) FROM drafts WHERE id = 'home' AND version = 99"),
    ])).rejects.toThrow(/CHECK/);
    expect(await env.DB.prepare("SELECT body FROM published WHERE id = 'home'").first()).toEqual(before);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM publish_guard").first()).n).toBe(0);
  });

  it("keeps one sign-up per email and list", async () => {
    const ins = (email, list) => env.DB.prepare("INSERT OR IGNORE INTO signups (email, list, created_at) VALUES (?, ?, ?)").bind(email, list, "2026-11-18T00:00:00Z").run();
    await ins("a@scu.edu", "weekly");
    await ins("a@scu.edu", "weekly");
    await ins("a@scu.edu", "biohackathon");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM signups").first()).n).toBe(2);
  });
});
