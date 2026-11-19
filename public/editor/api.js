/* The editor's side of the Worker's API (CLAUDE.md, "API"). The browser sends the editor's own Origin and
   Sec-Fetch-Site: same-origin by itself, which is what the Worker's gate() checks.
   A failed call throws an ApiError with the HTTP status and a short code the editor turns into a message. */

export class ApiError extends Error {
  constructor(status, code, message, body) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

const CODES = { 400: "invalid_argument", 401: "revoked", 403: "revoked", 404: "not_found", 409: "conflict", 413: "too_large", 415: "unsupported_type", 429: "resource_exhausted" };

async function call(method, path, body, type, asText) {
  const init = { method, headers: {}, credentials: "same-origin", cache: "no-store" };
  if (body !== undefined) {
    init.headers["Content-Type"] = type || "application/json";
    init.body = type ? body : JSON.stringify(body);
  }
  let res;
  try { res = await fetch(path, init); } catch (_) { throw new ApiError(0, "unavailable", "The editor's server didn't answer."); }
  if (asText && res.ok) return res.text();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, CODES[res.status] || (res.status >= 500 ? "unavailable" : "error"), data.error || "HTTP " + res.status, data);
  return data;
}

const doc = (id) => "/api/admin/drafts/" + encodeURIComponent(id);

/** { email, local, publicOrigin, adminOrigin } */
export const session = () => call("GET", "/api/admin/session");
/** { docs: { [id]: { draft, version, published, ... } } } */
export const docs = () => call("GET", "/api/admin/docs");
export const draft = (id) => call("GET", doc(id));
/** Saves norm(doc) if `version` is still current. { version, doc }; a stale version throws code "conflict". */
export const saveDraft = (id, version, body) => call("PUT", doc(id), { version, doc: body });
/** Publishes these drafts, all or nothing. */
export const publish = (versions) => call("POST", "/api/admin/publish", { versions });
/** Resets these drafts to their published docs, all or nothing. { docs: { [id]: { draft, version, ... } } } */
export const discard = (versions) => call("POST", "/api/admin/discard", { versions });
/** { id, src, ... } */
export const uploadPhoto = (blob) => call("POST", "/api/admin/photos", blob, blob.type || "application/octet-stream");
/** { signups: [{ id, email, list, createdAt }] } */
export const signups = () => call("GET", "/api/admin/signups");
/** One list as CSV text. The server records the download in the audit log. */
export const signupsCsv = (list) => call("GET", "/api/admin/signups/" + encodeURIComponent(list) + "/csv", undefined, undefined, true);
export const deleteSignup = (id) => call("DELETE", "/api/admin/signups/" + encodeURIComponent(id));
