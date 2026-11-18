/* The editor's calls to the Worker. Same-origin only; the browser adds Origin and Sec-Fetch-Site itself. */

export class ApiError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

async function call(method, path, body, headers = {}) {
  const init = { method, headers: { ...headers }, credentials: "same-origin", cache: "no-store" };
  if (body !== undefined) {
    if (body instanceof Blob) init.body = body;
    else { init.body = JSON.stringify(body); init.headers["Content-Type"] = "application/json"; }
  }
  let res;
  try { res = await fetch(path, init); } catch { throw new ApiError(0, "Can't reach the server. Is `npm run dev` still running?"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `The server answered ${res.status}.`, data);
  return data;
}

export const api = {
  session: () => call("GET", "/api/admin/session"),
  docs: () => call("GET", "/api/admin/docs"),
  draft: (id) => call("GET", "/api/admin/drafts/" + encodeURIComponent(id)),
  save: (id, version, doc) => call("PUT", "/api/admin/drafts/" + encodeURIComponent(id), { version, doc }),
  publish: (versions) => call("POST", "/api/admin/publish", { versions }),
  discard: (id, version) => call("POST", "/api/admin/discard/" + encodeURIComponent(id), { version }),
  photos: () => call("GET", "/api/admin/photos"),
  upload: (file) => call("POST", "/api/admin/photos", file, { "Content-Type": file.type || "application/octet-stream" }),
  signups: () => call("GET", "/api/admin/signups"),
  deleteSignup: (id) => call("DELETE", "/api/admin/signups/" + encodeURIComponent(id)),
};
