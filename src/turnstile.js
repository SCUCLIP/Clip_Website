/* Turnstile check for the public sign-up forms.

   Off localhost every sign-up must carry a Turnstile token, and the Worker checks it with Cloudflare before
   saving anything. TURNSTILE_SITE_KEY (a var) and TURNSTILE_SECRET (a secret, set with `wrangler secret put`)
   must both be set; if either is missing, every sign-up is refused (503).
   In local mode the check is skipped, because there are no keys and nothing leaves the computer. */

export const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** True when sign-ups on this request need a Turnstile token. */
export const turnstileRequired = (site) => !site.local;

/** The site key to put in public pages, or "" when Turnstile is off for this request. */
export const turnstileSiteKey = (site, env) => (turnstileRequired(site) ? String(env.TURNSTILE_SITE_KEY || "") : "");

/**
 * @returns {Promise<{ok: true} | {ok: false, status: number, message: string}>}
 */
export async function verifyTurnstile(token, env, ip) {
  const secret = String(env.TURNSTILE_SECRET || "");
  if (!secret || !env.TURNSTILE_SITE_KEY) return { ok: false, status: 503, message: "Online sign-up isn't set up yet. Email the club instead." };
  if (typeof token !== "string" || !token || token.length > 2048) return { ok: false, status: 403, message: "Please complete the check above the button, then try again." };
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  let data;
  try {
    const res = await fetch(SITEVERIFY, { method: "POST", body: form });
    data = await res.json();
  } catch {
    return { ok: false, status: 503, message: "Couldn't check the sign-up right now. Try again in a minute." };
  }
  if (!data?.success) return { ok: false, status: 403, message: "The check didn't pass. Reload the page and try again." };
  if (data.hostname && env.PUBLIC_HOST && data.hostname !== env.PUBLIC_HOST) return { ok: false, status: 403, message: "The check was for a different site." };
  return { ok: true };
}
