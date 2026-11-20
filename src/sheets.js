/* Newsletter sign-ups to the board's Google Sheet, through the small Apps Script web app in
   apps-script/newsletter.gs (docs/NEWSLETTER.md has the setup).

   D1 stays the record of every sign-up. A sign-up's sheet_synced_at is empty until the Sheet has it:
   - right after someone signs up, the Worker sends every waiting sign-up (in the background, so the visitor
     doesn't wait),
   - a cron trigger sends anything still waiting every 15 minutes (if the Sheet was down, say),
   - the editor's Site tab shows how many are waiting and can send them now.
   When the board deletes a sign-up in the editor, it's taken off the Sheet too.

   Two Worker secrets set it up: SHEETS_URL (the web app's address, https://script.google.com/macros/s/.../exec)
   and SHEETS_SECRET (the same value as the script property SECRET). Without both, nothing is sent and sign-ups
   wait in D1. Emails are never logged. */

import { nowIso } from "./db.js";

const SCRIPT_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/;
const BATCH = 200;

/** True when both secrets are set and the address is an Apps Script web app. */
export const sheetsConfigured = (env) => SCRIPT_URL.test(String(env.SHEETS_URL || "")) && String(env.SHEETS_SECRET || "").length >= 16;

async function post(env, body) {
  const res = await fetch(env.SHEETS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: env.SHEETS_SECRET, ...body }),
    redirect: "follow",
  });
  if (!res.ok) throw new Error("the Sheet answered HTTP " + res.status);
  let data;
  try { data = await res.json(); } catch { throw new Error("the Sheet's answer wasn't JSON"); }
  if (!data || data.ok !== true) throw new Error("the Sheet refused: " + String(data && data.error).slice(0, 60));
  return data;
}

/** How many sign-ups the Sheet doesn't have yet. */
export async function waitingCount(env) {
  return (await env.DB.prepare("SELECT COUNT(*) AS n FROM signups WHERE sheet_synced_at IS NULL").first()).n;
}

/**
 * Send every sign-up the Sheet doesn't have yet (up to 200 at a time).
 * @returns {Promise<{configured: boolean, sent: number, error?: string}>}
 */
export async function syncSignups(env) {
  if (!sheetsConfigured(env)) return { configured: false, sent: 0 };
  const { results } = await env.DB.prepare("SELECT id, email, list, created_at FROM signups WHERE sheet_synced_at IS NULL ORDER BY id LIMIT ?").bind(BATCH).all();
  if (!results.length) return { configured: true, sent: 0 };
  try {
    await post(env, { action: "add", rows: results.map((r) => ({ list: r.list, email: r.email, at: r.created_at })) });
  } catch (err) {
    console.error("Sending sign-ups to the Google Sheet failed:", err.message);
    return { configured: true, sent: 0, error: err.message };
  }
  const at = nowIso();
  await env.DB.batch(results.map((r) => env.DB.prepare("UPDATE signups SET sheet_synced_at = ? WHERE id = ?").bind(at, r.id)));
  return { configured: true, sent: results.length };
}

/**
 * Take one sign-up off the Sheet (after the board deleted it in the editor).
 * @returns {Promise<"removed" | "failed" | "off">}
 */
export async function removeFromSheet(env, list, email) {
  if (!sheetsConfigured(env)) return "off";
  try {
    await post(env, { action: "remove", list, email });
    return "removed";
  } catch (err) {
    console.error("Taking a sign-up off the Google Sheet failed:", err.message);
    return "failed";
  }
}
