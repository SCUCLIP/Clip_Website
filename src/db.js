/* D1 access for content docs. Bodies are stored as JSON text. */

export const nowIso = () => new Date().toISOString();

/** An audit_log row, as a statement to run on its own or inside a batch. */
export const auditStmt = (env, at, actor, action, target) =>
  env.DB.prepare("INSERT INTO audit_log (at, actor, action, target) VALUES (?, ?, ?, ?)").bind(at, actor, action, String(target).slice(0, 500));
export const audit = (env, actor, action, target) => auditStmt(env, nowIso(), actor, action, target).run();

const parse = (s) => (s === null || s === undefined ? null : JSON.parse(s));

function shape(row) {
  return {
    draft: parse(row.draft),
    version: row.version,
    published: parse(row.published),
    draftUpdatedAt: row.draft_at,
    draftUpdatedBy: row.draft_by,
    publishedAt: row.published_at ?? null,
    publishedBy: row.published_by ?? null,
  };
}

const SELECT_DOCS = `SELECT d.id, d.body AS draft, d.version, d.updated_at AS draft_at, d.updated_by AS draft_by,
  p.body AS published, p.updated_at AS published_at, p.updated_by AS published_by
  FROM drafts d LEFT JOIN published p ON p.id = d.id`;

/** One doc with its draft and published versions, or null. */
export async function getDoc(env, id) {
  const row = await env.DB.prepare(`${SELECT_DOCS} WHERE d.id = ?`).bind(id).first();
  return row ? shape(row) : null;
}

/** Every doc, keyed by id. */
export async function getAllDocs(env) {
  const { results } = await env.DB.prepare(SELECT_DOCS).all();
  const docs = {};
  for (const row of results) docs[row.id] = shape(row);
  return docs;
}

/** Published docs for these ids, keyed by id (missing ones are left out). */
export async function getPublished(env, ids) {
  const { results } = await env.DB.prepare(`SELECT id, body FROM published WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
  const out = {};
  for (const r of results) out[r.id] = JSON.parse(r.body);
  return out;
}

export async function draftVersion(env, id) {
  const row = await env.DB.prepare("SELECT version FROM drafts WHERE id = ?").bind(id).first();
  return row ? row.version : null;
}

/**
 * Save a draft if `version` is still current.
 * @returns {Promise<{ok: true, version: number} | {ok: false, current: number | null}>}
 */
export async function saveDraft(env, id, version, doc, by) {
  const res = await env.DB.prepare(
    "UPDATE drafts SET body = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND version = ?",
  ).bind(JSON.stringify(doc), nowIso(), by, id, version).run();
  if (res.meta.changes === 1) return { ok: true, version: version + 1 };
  return { ok: false, current: await draftVersion(env, id) };
}

/**
 * Copy these drafts to published in one transaction. Each draft must still be at the given version,
 * or nothing is published (the publish_guard CHECK aborts the batch).
 * @param {Record<string, number>} versions
 * @returns {Promise<{ok: true, at: string} | {ok: false, stale: Record<string, number | null>}>}
 */
export async function publishDrafts(env, versions, by) {
  const at = nowIso();
  const stmts = [];
  for (const [id, v] of Object.entries(versions)) {
    stmts.push(env.DB.prepare("INSERT INTO publish_guard (ok) SELECT COUNT(*) FROM drafts WHERE id = ? AND version = ?").bind(id, v));
    stmts.push(env.DB.prepare(
      `INSERT INTO published (id, body, updated_at, updated_by) SELECT id, body, ?, ? FROM drafts WHERE id = ?
       ON CONFLICT (id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).bind(at, by, id));
  }
  stmts.push(auditStmt(env, at, by, "publish", Object.keys(versions).join(",")));
  stmts.push(env.DB.prepare("DELETE FROM publish_guard"));
  try {
    await env.DB.batch(stmts);
    return { ok: true, at };
  } catch (err) {
    if (!/CHECK constraint failed/i.test(String(err?.message ?? err))) throw err;
    const stale = {};
    for (const [id, v] of Object.entries(versions)) {
      const cur = await draftVersion(env, id);
      if (cur !== v) stale[id] = cur;
    }
    return { ok: false, stale };
  }
}

/**
 * Reset these drafts to their published docs in one transaction. Each draft must still be at the given version and
 * have a published doc, or nothing changes (the publish_guard CHECK aborts the batch).
 * @param {Record<string, number>} versions
 * @returns {Promise<{ok: true, at: string} | {ok: false, stale: Record<string, number | null>}>}
 */
export async function discardDrafts(env, versions, by) {
  const at = nowIso();
  const stmts = [];
  for (const [id, v] of Object.entries(versions)) {
    stmts.push(env.DB.prepare(
      "INSERT INTO publish_guard (ok) SELECT COUNT(*) FROM drafts d JOIN published p USING (id) WHERE d.id = ? AND d.version = ?",
    ).bind(id, v));
    stmts.push(env.DB.prepare(
      "UPDATE drafts SET body = (SELECT body FROM published WHERE id = ?1), version = version + 1, updated_at = ?2, updated_by = ?3 WHERE id = ?1",
    ).bind(id, at, by));
  }
  stmts.push(auditStmt(env, at, by, "discard", Object.keys(versions).join(",")));
  stmts.push(env.DB.prepare("DELETE FROM publish_guard"));
  try {
    await env.DB.batch(stmts);
    return { ok: true, at };
  } catch (err) {
    if (!/CHECK constraint failed/i.test(String(err?.message ?? err))) throw err;
    const stale = {};
    for (const [id, v] of Object.entries(versions)) {
      const cur = await draftVersion(env, id);
      if (cur !== v) stale[id] = cur;
    }
    return { ok: false, stale };
  }
}
