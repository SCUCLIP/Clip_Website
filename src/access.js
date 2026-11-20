/* Cloudflare Access check for the editor (off localhost). Ported from the original repo's src/security/access.ts.

   Access sits in front of admin.scuclip.com and adds a signed token (a JWT) to every request it lets through, in the
   Cf-Access-Jwt-Assertion header. The Worker doesn't trust that Access is in front: it checks the token itself on
   every editor request, with jose (no hand-written token code):
   - RS256 signature, against the team's public keys at <ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs
   - aud is ACCESS_AUD (the editor app's Audience tag), iss is ACCESS_TEAM_DOMAIN
   - not expired, not used before nbf
   - it names an email
   If ACCESS_TEAM_DOMAIN or ACCESS_AUD is missing or malformed, every request is refused (503). */

import { createRemoteJWKSet, jwtVerify } from "jose";

/** Like https://scuclip.cloudflareaccess.com (Zero Trust > Settings shows the team name). */
const TEAM_DOMAIN = /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/;

let keySets = new Map();
/** For tests: forget the cached key sets. */
export function resetAccessKeys() { keySets = new Map(); }

function keysFor(teamDomain) {
  let ks = keySets.get(teamDomain);
  if (!ks) {
    ks = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", teamDomain));
    keySets.set(teamDomain, ks);
  }
  return ks;
}

/* jose's codes for a token that is wrong, as opposed to keys that couldn't be fetched. */
const BAD_TOKEN = /^ERR_(JWT|JWS|JOSE_ALG|JOSE_NOT_SUPPORTED|JWKS_NO_MATCHING_KEY|JWKS_MULTIPLE_MATCHING_KEYS)/;

/**
 * @returns {Promise<{ok: true, email: string} | {ok: false, status: number, message: string}>}
 */
export async function verifyAccess(request, env) {
  const teamDomain = String(env.ACCESS_TEAM_DOMAIN || "").trim();
  const audience = String(env.ACCESS_AUD || "").trim();
  if (!TEAM_DOMAIN.test(teamDomain) || !audience) {
    return { ok: false, status: 503, message: "The editor's sign-in isn't set up yet (ACCESS_TEAM_DOMAIN and ACCESS_AUD)." };
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return { ok: false, status: 401, message: "Sign in through Cloudflare Access to use the editor." };
  let payload;
  try {
    ({ payload } = await jwtVerify(token, keysFor(teamDomain), { issuer: teamDomain, audience, algorithms: ["RS256"], clockTolerance: 30 }));
  } catch (err) {
    if (BAD_TOKEN.test(String(err && err.code))) return { ok: false, status: 403, message: "The sign-in token isn't valid. Reload the page to sign in again." };
    return { ok: false, status: 503, message: "Couldn't reach Cloudflare Access to check the sign-in." };
  }
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email) return { ok: false, status: 403, message: "The sign-in token doesn't say who you are." };
  return { ok: true, email: email.slice(0, 254) };
}
