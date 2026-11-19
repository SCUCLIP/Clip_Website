/* Photos: uploaded in the editor, stored in R2 under photos/<id>, served at /photos/<id> on both hosts.
   Only PNG, JPEG, WebP and GIF, checked by their first bytes (never trusting the declared type alone), at most
   10 MB. No SVG: it can carry scripts. The editor shrinks and re-encodes photos before uploading them. */

import { nowIso } from "./db.js";

export const PHOTO_ID = /^[a-f0-9]{32}$/;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** The image type these bytes really are, or null. */
export function sniffImage(b) {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "image/gif";
  return null;
}

/** Width and height from the image header, or nulls if they can't be read. */
export function imageSize(b, type) {
  const u16be = (i) => (b[i] << 8) | b[i + 1];
  const u16le = (i) => b[i] | (b[i + 1] << 8);
  const u32be = (i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const none = { width: null, height: null };
  try {
    if (type === "image/png" && b.length >= 24) return { width: u32be(16), height: u32be(20) };
    if (type === "image/gif" && b.length >= 10) return { width: u16le(6), height: u16le(8) };
    if (type === "image/webp" && b.length >= 30) {
      const fmt = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (fmt === "VP8 ") return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
      if (fmt === "VP8L") { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
      if (fmt === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    }
    if (type === "image/jpeg") {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        const len = u16be(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: u16be(i + 7), height: u16be(i + 5) };
        i += 2 + len;
      }
    }
  } catch { /* fall through */ }
  return none;
}

export function newPhotoId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate and store an upload.
 * @returns {Promise<{ok: true, photo: object} | {ok: false, status: number, message: string}>}
 */
export async function storePhoto(env, bytes, declaredType, by) {
  const declared = String(declaredType || "").split(";")[0].trim().toLowerCase();
  if (!PHOTO_TYPES.includes(declared)) return { ok: false, status: 415, message: "Photos must be PNG, JPEG, WebP or GIF." };
  if (!bytes.length) return { ok: false, status: 400, message: "The photo is empty." };
  const real = sniffImage(bytes);
  if (!real) return { ok: false, status: 415, message: "That file isn't a PNG, JPEG, WebP or GIF image." };
  if (real !== declared) return { ok: false, status: 415, message: `That file is really ${real.slice(6).toUpperCase()}, not ${declared.slice(6).toUpperCase()}.` };
  const { width, height } = imageSize(bytes, real);
  const id = newPhotoId();
  await env.PHOTOS.put("photos/" + id, bytes, { httpMetadata: { contentType: real, cacheControl: "public, max-age=31536000, immutable" } });
  const created = nowIso();
  await env.DB.prepare("INSERT INTO photos (id, content_type, size, width, height, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, real, bytes.length, width, height, created, by).run();
  return { ok: true, photo: { id, src: "/photos/" + id, contentType: real, size: bytes.length, width, height, createdAt: created } };
}

export async function listPhotos(env) {
  const { results } = await env.DB.prepare("SELECT id, content_type, size, width, height, created_at FROM photos ORDER BY created_at DESC LIMIT 500").all();
  return results.map((r) => ({ id: r.id, src: "/photos/" + r.id, contentType: r.content_type, size: r.size, width: r.width, height: r.height, createdAt: r.created_at }));
}

/** GET /photos/<id> */
export async function servePhoto(env, request, id) {
  if (!PHOTO_ID.test(id)) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const obj = await env.PHOTOS.get("photos/" + id);
  if (!obj) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const type = PHOTO_TYPES.includes(obj.httpMetadata?.contentType) ? obj.httpMetadata.contentType : "application/octet-stream";
  const headers = {
    "Content-Type": type,
    "Content-Length": String(obj.size),
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Disposition": "inline",
    ETag: obj.httpEtag,
  };
  if (request.headers.get("If-None-Match") === obj.httpEtag) return new Response(null, { status: 304, headers: { ETag: obj.httpEtag, "Cache-Control": headers["Cache-Control"] } });
  return new Response(request.method === "HEAD" ? null : obj.body, { headers });
}
