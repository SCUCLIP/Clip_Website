/* Cloudflare Access check for the editor (off localhost).

   Access sits in front of admin.scuclip.com and adds a signed token (a JWT) to every request it lets through,
   in the Cf-Access-Jwt-Assertion header. The Worker doesn't trust that Access is in front: it checks the token
   itself on every editor request:
   - RS256 signature, against the public keys at https://<team>.cloudflareaccess.com/cdn-cgi/access/certs
   - aud includes ACCESS_AUD (the editor app's Audience tag)
   - iss is https://<team>.cloudflareaccess.com
   - not expired, not used before nbf
   If ACCESS_TEAM_DOMAIN or ACCESS_AUD is missing, every request is refused (503). */

const KEY_TTL_MS = 10 * 60 * 1000;
const REFETCH_GAP_MS = 30 * 1000;
const LEEWAY_S = 30;
let cache = { team: "", keys: new Map(), fetchedAt: 0 };

/** For tests: forget cached signing keys. */
export function resetAccessKeys() { cache = { team: "", keys: new Map(), fetchedAt: 0 }; }

const enc = new TextEncoder();
function b64urlBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

async function loadKeys(team) {
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Access certs: HTTP ${res.status}`);
  const body = await res.json();
  const keys = new Map();
  for (const jwk of body.keys ?? []) {
    if (jwk.kty !== "RSA" || typeof jwk.kid !== "string") continue;
    const key = await crypto.subtle.importKey(
      "jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
    );
    keys.set(jwk.kid, key);
  }
  cache = { team, keys, fetchedAt: Date.now() };
}

async function keyFor(team, kid) {
  const age = Date.now() - cache.fetchedAt;
  if (cache.team !== team || age > KEY_TTL_MS || (!cache.keys.has(kid) && age > REFETCH_GAP_MS)) await loadKeys(team);
  return cache.keys.get(kid) ?? null;
}

const deny = (message) => ({ ok: false, status: 403, message });

/**
 * @returns {Promise<{ok: true, email: string} | {ok: false, status: number, message: string}>}
 */
export async function verifyAccess(request, env, now = Date.now()) {
  const team = String(env.ACCESS_TEAM_DOMAIN || "").trim().toLowerCase();
  const aud = String(env.ACCESS_AUD || "").trim();
  if (!team || !aud || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team)) {
    return { ok: false, status: 503, message: "The editor's sign-in isn't set up yet (ACCESS_TEAM_DOMAIN and ACCESS_AUD)." };
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return { ok: false, status: 401, message: "Sign in through Cloudflare Access to use the editor." };

  const parts = token.split(".");
  if (parts.length !== 3) return deny("The sign-in token is malformed.");
  let header, payload;
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]); } catch { return deny("The sign-in token is malformed."); }
  if (header?.alg !== "RS256" || typeof header.kid !== "string") return deny("The sign-in token uses an unexpected algorithm.");

  let key;
  try { key = await keyFor(team, header.kid); } catch { return { ok: false, status: 503, message: "Couldn't reach Cloudflare Access to check the sign-in." }; }
  if (!key) return deny("The sign-in token was signed by an unknown key.");
  let valid = false;
  try { valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), enc.encode(parts[0] + "." + parts[1])); } catch { valid = false; }
  if (!valid) return deny("The sign-in token's signature is invalid.");

  const nowS = Math.floor(now / 1000);
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return deny("The sign-in token is for a different app.");
  if (payload.iss !== `https://${team}`) return deny("The sign-in token comes from a different team.");
  if (typeof payload.exp !== "number" || payload.exp + LEEWAY_S < nowS) return deny("The sign-in has expired. Reload the page.");
  if (typeof payload.nbf === "number" && payload.nbf - LEEWAY_S > nowS) return deny("The sign-in token isn't valid yet.");
  const email = typeof payload.email === "string" && payload.email ? payload.email
    : typeof payload.common_name === "string" && payload.common_name ? "service:" + payload.common_name : "";
  if (!email) return deny("The sign-in token doesn't say who you are.");
  return { ok: true, email: email.slice(0, 254) };
}
