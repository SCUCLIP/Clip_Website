# CLIP website

Website and editor for CLIP (Connecting Leaders in Innovation and Pharma), a student club at Santa Clara University.
One Cloudflare Worker serves both:

| Host | Local mode | What |
|---|---|---|
| `scuclip.com` | http://localhost:8787 | the public site, rendered from published content |
| `admin.scuclip.com` | http://admin.localhost:8787 | the editor (behind Cloudflare Access off localhost) |

Content lives in D1 (`published` and `drafts`), photos in R2. Plain ES modules, no bundler beyond wrangler's own.

## Commands
- `npm ci`: install exactly what `package-lock.json` lists.
- `npm run dev`: apply pending local migrations, then serve the site at http://localhost:8787 and the editor at http://admin.localhost:8787 in local mode (see below). Stop it with Ctrl+C.
- `npm run check`: Node tests (render vs `prototype/static`, `norm()`, config rules, seed up to date, nothing inline in `public/`) and Worker tests (every route against local D1 and R2). Must pass before every commit.
- `npm test`: the Worker tests only.
- `npm run seed:sql`: rebuild `migrations/0002_seed.sql` from `content/seed/*.json`. A migration runs once per database, so follow it with `npm run db:reset:local` to see the change locally.
- `npm run db:reset:local`: delete the local database so the next `npm run dev` starts from the seed. `npm run db:reset:local -- --photos` also deletes local photos. Stop `npm run dev` first.
- `npm run fonts:fetch`: download the self-hosted fonts again (only needed to change them).

Never run `wrangler deploy`, `wrangler login`, `wrangler d1 execute` or anything with `--remote` from this repo during development (security rule 13).

## Layout
- `src/`: the Worker. `index.js` picks the host; `admin.js` (editor + API, behind `gate()`), `public.js` (pages, sign-up, photos), `hosts.js` (local mode), `access.js`, `turnstile.js`, `http.js` (security headers), `db.js`.
- `public/shared/`: code used by both the Worker and the browser, ported from `prototype/clip-website.html` and kept as close to it as possible: `model.js` (the content model and `norm()`), `render.js` (the only copy of the page markup), `layout.js` (push-down and the phone layout). Plus `export.js` (a whole public page, as the static export wrote it), `facts.js` (Ask CLIP) and `sprite.js`.
- `public/assets/`: the public site's CSS, `site.js` and logos. `public/fonts/`: Caveat, DM Sans, DM Mono (SIL OFL).
- `public/editor/`: the editor, served only on the admin host, ported from the prototype's `#admin` view and kept as close to it as possible. `editor.js` (everything the prototype's editor does), `catalog.js` (what the Add panel offers), `api.js` (the Worker's API, in place of the prototype's `window.claude`), `editor.css`. In the browser console, `window.clipEditor` is the editor's state.
- `content/seed/`: the starting content, one JSON file per doc. `migrations/`: D1 schema and the generated seed.
- `prototype/clip-website.html`: the working prototype, the spec for the look, the editor and the content format. `prototype/static/`: the same pages exported as plain HTML. The render must match them apart from links and asset paths.
- `docs/CONTENT-FORMAT.md`, `docs/THREAT-MODEL.md`, `docs/GO-LIVE.md`.

## Local mode
`npm run dev` runs `scripts/dev.mjs`, which:
1. applies pending local D1 migrations (`wrangler d1 migrations apply DB --local`, no prompt), then
2. runs `wrangler dev --ip 127.0.0.1 --port 8787 --var LOCAL_MODE:1 --infer-origin-from-routes=false`.

Keep every flag:
- `--ip 127.0.0.1`: listen on this computer only.
- `--var LOCAL_MODE:1`: the only place local mode is ever turned on.
- `--infer-origin-from-routes=false`: without it wrangler rewrites every request's host and `Origin` to scuclip.com, and the admin checks break.

It also clears `CLOUDFLARE_*`/`CF_*` variables and sets `X_LOCAL_EXPLORER=false` and `X_LOCAL_OBSERVABILITY=false`, which turn off wrangler's built-in HTTP API for the local data.

Local mode is on only when `LOCAL_MODE` is `"1"` **and** the hostname is `localhost` or `admin.localhost` (`src/hosts.js`). Then the editor needs no sign-in and sign-ups need no Turnstile. Everything else stays the same, including the Origin checks. Nothing needs `.dev.vars` or a Cloudflare login.

## Security rules
1. Local mode is turned on only by `npm run dev` (`--var LOCAL_MODE:1`). Never set `LOCAL_MODE` in `wrangler.jsonc`, `.dev.vars`, another script or a test helper that runs against real hostnames. A test fails if `wrangler.jsonc` mentions it.
2. Off local mode, every request to the admin host needs a valid Cloudflare Access token, checked by the Worker (`src/access.js`: RS256 signature, `aud`, `iss`, expiry). If `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` is missing, refuse everything. Never add another way in.
3. Off local mode, every sign-up needs a Turnstile token confirmed by Cloudflare (`src/turnstile.js`). If the site key or secret is missing, refuse.
4. The editor page, its files and `/api/admin/*` answer only on the admin host. The public host returns 404 for them.
5. Every admin request that can change data must carry an `Origin` equal to the editor's own origin. Every `/api/admin/*` request with a `Sec-Fetch-Site` header must say `same-origin`. `POST /api/signup` must carry the public site's own `Origin`.
6. CSP (`src/http.js`): scripts, styles, fonts, images and requests only from the site itself (plus Turnstile's script and frame when it's on). No inline scripts, no `<style>` blocks, no `eval`. Inline `style` attributes are allowed because element positions live in them. Every style and script goes in a file under `public/`.
7. Content is untrusted when rendering. Text is plain: escape everything (the prototype's `esc()` and `fmt()`), never put content into `innerHTML` unescaped. Links go through `safeHref()`: `https://…` or `#page`/`#anchor` only.
8. Every draft save goes through `norm()` (`public/shared/model.js`), and what it returns is stored. A page that isn't `v: 5` is refused.
9. Photos: PNG, JPEG, WebP or GIF, checked by their first bytes, at most 10 MB. No SVG. The editor re-encodes photos in the browser before uploading (JPEGs always), which drops location data. Random 128-bit ids. Served with `nosniff`.
10. Sign-ups store the email, list and time only: no IP address, no name, and emails are never logged. The list is `weekly` or `biohackathon`. Signing up twice looks like success.
11. No secrets in the repo. `TURNSTILE_SECRET` goes in with `wrangler secret put` at go-live. Local mode needs no secrets at all.
12. The API refuses, and the Worker tests prove each refusal:
    - wrong host (admin route on the public host, unknown hostname): 404
    - no or invalid sign-in off local mode: 401 or 403; sign-in not configured: 503
    - a write without the editor's `Origin`, or a cross-site API request: 403
    - a body that isn't JSON, or a page that isn't `v: 5`: 400
    - a body over the limit (drafts 256 KB, photos 10 MB, sign-ups 4 KB): 413
    - the wrong `Content-Type`: 415
    - a draft, publish or discard whose `version` is stale: 409
    - an unknown doc, photo, sign-up or route: 404; the wrong method: 405
    - a sign-up off localhost without a valid Turnstile token: 403 (503 when Turnstile isn't set up)
13. During development: never deploy, never push `main` (push the working branch only when the maintainer asks), never log in to Cloudflare, never use `--remote` or touch the real D1 or R2. `wrangler d1 execute` is off-limits; content gets into the database through migrations.
14. Ask before adding a dependency, and pin exact versions.

## API
Admin host only, behind `gate()`. JSON in and out unless noted.
- `GET /api/admin/session`: `{ email, local, publicOrigin, adminOrigin }`.
- `GET /api/admin/docs`: every doc, `{ docs: { [id]: { draft, version, published, draftUpdatedAt, draftUpdatedBy, publishedAt, publishedBy } } }`.
- `GET /api/admin/drafts/:id`: one doc in the same shape.
- `PUT /api/admin/drafts/:id` `{ version, doc }`: saves `norm(doc)` if `version` is current. Returns `{ version, doc }`; 409 `{ version }` if someone else saved first.
- `POST /api/admin/publish` `{ versions: { [id]: version } }`: copies those drafts to published in one transaction. 409 if any version is stale, and then nothing is published.
- `POST /api/admin/discard` `{ versions: { [id]: version } }`: resets those drafts to their published docs in one transaction. 409 if any version is stale, and then nothing changes.
- `GET /api/admin/photos`, `POST /api/admin/photos` (body is the image, `Content-Type: image/…`): returns `{ id, src }`.
- `GET /api/admin/signups`, `DELETE /api/admin/signups/:id`.

Public host:
- `GET /`, `/about`, `/events`, `/biohackathon`, `/speakers`, `/board`, `/resources`, `/faq`: rendered pages. Anything else is the 404 page. `/<page>.html` and trailing slashes redirect.
- `GET /assets/clip-facts.js`: Ask CLIP's facts, from published content.
- `GET /photos/:id`: a photo from R2 (also served on the admin host).
- `POST /api/signup` `{ email, list, token }`.

## Drafts and versions
Each draft row has a `version` that goes up by one on every save. The editor sends the version it loaded; if the row has moved on, the save is refused with 409 and the editor reloads that page and says someone else changed it. So two tabs saving the same page can't silently overwrite each other.

## Content format
The prototype's v5 format, unchanged. See `docs/CONTENT-FORMAT.md`. In short: one doc per page (`{ v: 5, sections }`), plus `data` (the shared lists) and `settings`. Pages are sections of freely placed elements with a desktop box `d` and a phone box `m` (`null` = stacked at the bottom on phones). `[Brackets]` mark unwritten content. Links are `https://…` or `#page`/`#anchor`; `#about` renders as `/about` and `#join` as `/#join`.
