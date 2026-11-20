/* POST /api/signup on the public host. Stores the email, the list and the time; nothing else, and never logs
   the email. The list is one of the two the sign-up forms offer (weekly, biohackathon). Signing up twice looks the
   same as signing up once, so nobody can find out who is on a list.
   Before anything touches D1: the site's own Origin, the size and shape of the request, at most 5 sign-ups a
   minute from one IP address (SIGNUP_LIMITER), and Turnstile everywhere except local mode. */

import { apiError, json, methodNotAllowed, readText } from "./http.js";
import { LIST_SIGNUP } from "../public/shared/model.js";
import { turnstileRequired, verifyTurnstile } from "./turnstile.js";
import { nowIso } from "./db.js";
import { syncSignups } from "./sheets.js";

const MAX_BYTES = 4096;
export const LISTS = LIST_SIGNUP.options.map((o) => o.v);
export const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;

export async function handleSignup(request, env, ctx, site, url) {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (request.headers.get("Origin") !== url.origin) return apiError(403, "Sign up from the CLIP website.");
  if (!/^application\/json\b/i.test(request.headers.get("Content-Type") || "")) return apiError(415, "Send the sign-up as JSON.");
  /* The rate limit comes before reading the body, so a flood costs as little as possible. Without the binding,
     refuse: it's in wrangler.jsonc, so a missing one means the Worker is misconfigured. */
  if (!env.SIGNUP_LIMITER) return apiError(503, "Online sign-up isn't available right now. Email the club instead.");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const { success } = await env.SIGNUP_LIMITER.limit({ key: "signup:" + ip });
  if (!success) return apiError(429, "Too many sign-ups from here. Wait a minute and try again.", {}, { "Retry-After": "60" });
  const raw = await readText(request, MAX_BYTES);
  if (raw === null) return apiError(413, "That sign-up is too large.");
  let body;
  try { body = JSON.parse(raw); } catch { return apiError(400, "That sign-up isn't valid JSON."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "That sign-up isn't valid.");

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return apiError(400, "Enter an email address like you@scu.edu.");
  const list = typeof body.list === "string" ? body.list : "";
  if (!LISTS.includes(list)) return apiError(400, "That sign-up list doesn't exist.");

  if (turnstileRequired(site)) {
    const check = await verifyTurnstile(body.token, env, request.headers.get("CF-Connecting-IP") || "");
    if (!check.ok) return apiError(check.status, check.message);
  }

  const res = await env.DB.prepare("INSERT OR IGNORE INTO signups (email, list, created_at) VALUES (?, ?, ?)").bind(email, list, nowIso()).run();
  /* A new sign-up goes to the Google Sheet in the background, so the answer doesn't wait (and is the same either way). */
  if (res.meta.changes) ctx.waitUntil(syncSignups(env));
  return json({ ok: true });
}
