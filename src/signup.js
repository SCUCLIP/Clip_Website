/* POST /api/signup on the public host. Stores the email, the list and the time; nothing else, and never logs
   the email. The list is one of the two the sign-up forms offer (weekly, biohackathon). Signing up twice looks the
   same as signing up once, so nobody can find out who is on a list. */

import { apiError, json, methodNotAllowed, readText } from "./http.js";
import { LIST_SIGNUP } from "../public/shared/model.js";
import { turnstileRequired, verifyTurnstile } from "./turnstile.js";
import { nowIso } from "./db.js";

const MAX_BYTES = 4096;
export const LISTS = LIST_SIGNUP.options.map((o) => o.v);
export const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;

export async function handleSignup(request, env, site, url) {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (request.headers.get("Origin") !== url.origin) return apiError(403, "Sign up from the CLIP website.");
  if (!/^application\/json\b/i.test(request.headers.get("Content-Type") || "")) return apiError(415, "Send the sign-up as JSON.");
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

  await env.DB.prepare("INSERT OR IGNORE INTO signups (email, list, created_at) VALUES (?, ?, ?)").bind(email, list, nowIso()).run();
  return json({ ok: true });
}
