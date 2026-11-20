/* Responses and the security headers every response gets. */

/** Content-Security-Policy: scripts, styles, fonts, images and requests only from the site itself. No inline
 *  scripts and no <style> blocks. Inline style *attributes* are allowed, because every element's position is
 *  stored as style="--x:…;--y:…" in the markup. Turnstile's script and frame are allowed only when it's on. */
export function csp({ turnstile = false } = {}) {
  return [
    "default-src 'none'",
    `script-src 'self'${turnstile ? " https://challenges.cloudflare.com" : ""}`,
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self'",
    "connect-src 'self'",
    turnstile ? "frame-src https://challenges.cloudflare.com" : "",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].filter(Boolean).join("; ");
}

/** Copy a response (asset and fetch responses have immutable headers) and add the security headers. */
export function secure(res, site, { turnstile = false } = {}) {
  const out = new Response(res.body, res);
  const h = out.headers;
  h.set("Content-Security-Policy", csp({ turnstile }));
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", site?.kind === "admin" ? "same-origin" : "strict-origin-when-cross-origin");
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Resource-Policy", "same-origin");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  if (site?.production) h.set("Strict-Transport-Security", "max-age=31536000");
  if (site?.kind === "admin") {
    h.set("X-Robots-Tag", "noindex, nofollow");
    h.set("Cache-Control", "no-store");
  }
  return out;
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });

/** An API error. The message is safe to show to the editor or the visitor. */
export const apiError = (status, message, extra = {}, headers = {}) => json({ error: message, ...extra }, status, headers);

export const text = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...headers } });

export const html = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...headers } });

export const redirect = (location, status = 301) => new Response(null, { status, headers: { Location: location } });

export const methodNotAllowed = (allow) => new Response(JSON.stringify({ error: "Method not allowed" }), {
  status: 405, headers: { Allow: allow, "Content-Type": "application/json; charset=utf-8" },
});

/** Read a request body as text, refusing anything over `limit` bytes. Returns null when it's too big. */
export async function readText(request, limit) {
  const len = Number(request.headers.get("Content-Length") || "0");
  if (len > limit) return null;
  const buf = await readBytes(request, limit);
  return buf === null ? null : new TextDecoder().decode(buf);
}

/** Read a request body as bytes, refusing anything over `limit` bytes. Returns null when it's too big. */
export async function readBytes(request, limit) {
  const len = Number(request.headers.get("Content-Length") || "0");
  if (len > limit) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}
