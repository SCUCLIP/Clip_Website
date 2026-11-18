import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { vi } from "vitest";
import worker from "../../src/index.js";

export const LOCAL_ADMIN = "http://admin.localhost:8787";
export const LOCAL_PUBLIC = "http://localhost:8787";
export const PROD_ADMIN = "https://admin.scuclip.com";
export const PROD_PUBLIC = "https://scuclip.com";
export const TEAM = "clip-test.cloudflareaccess.com";
export const AUD = "test-aud-0123456789";

/** Local mode, as `npm run dev` sets it. */
export const LOCAL_ENV = { LOCAL_MODE: "1" };
/** A deployed Worker with Access configured. */
export const PROD_ENV = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, TURNSTILE_SITE_KEY: "site-key", TURNSTILE_SECRET: "secret" };

/** Call the Worker directly with a request and env overrides. */
export async function call(url, init = {}, envOverrides = {}) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(url, init), { ...env, ...envOverrides }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** A same-origin request from the local editor (what the browser sends for fetch() from the editor page). */
export function fromEditor(method, body, base = LOCAL_ADMIN, headers = {}) {
  const init = { method, headers: { "Sec-Fetch-Site": "same-origin", ...headers } };
  if (method !== "GET" && method !== "HEAD") init.headers.Origin = base;
  if (body !== undefined) {
    if (body instanceof Uint8Array || body instanceof ArrayBuffer) init.body = body;
    else { init.body = JSON.stringify(body); init.headers["Content-Type"] = "application/json"; }
  }
  return init;
}

/* ---------- Cloudflare Access test tokens ---------- */
const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (o) => b64url(enc.encode(JSON.stringify(o)));

let keyPair, publicJwk;
export const KID = "test-kid-1";
async function keys() {
  if (!keyPair) {
    keyPair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"],
    );
    publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  }
  return { keyPair, publicJwk };
}

/** Make an Access JWT. `claims` override the defaults; `signWith` lets a test sign with a different key. */
export async function accessToken(claims = {}, { kid = KID, alg = "RS256", signWith } = {}) {
  const { keyPair } = await keys();
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlJson({ alg, kid, typ: "JWT" });
  const payload = b64urlJson({ aud: [AUD], iss: `https://${TEAM}`, email: "editor@scu.edu", iat: now, nbf: now - 5, exp: now + 600, ...claims });
  const key = signWith ?? keyPair.privateKey;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(header + "." + payload));
  return `${header}.${payload}.${b64url(sig)}`;
}

/** Answer Access's certs URL with the test key, and Turnstile's siteverify with `turnstile` (or fail if unset). */
export async function stubNetwork({ turnstile } = {}) {
  const { publicJwk } = await keys();
  const calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    if (url === `https://${TEAM}/cdn-cgi/access/certs`) {
      return Response.json({ keys: [{ ...publicJwk, kid: KID, alg: "RS256", use: "sig" }] });
    }
    if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify" && turnstile) return Response.json(turnstile);
    throw new Error("Unexpected network request in a test: " + url);
  });
  return calls;
}

export async function otherKeyPair() {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"],
  );
}
