# Going live

Everything here needs the club's Cloudflare account. None of it has been done; this repo has only ever run locally.

## 1. Cloudflare resources
- [ ] Add `scuclip.com` to Cloudflare (DNS on Cloudflare).
- [ ] `wrangler d1 create clip-website`, then put the real `database_id` in `wrangler.jsonc` (it's a placeholder now).
- [ ] `wrangler r2 bucket create clip-website-photos`.
- [ ] `wrangler d1 migrations apply DB --remote` to create the tables and the seed content. The seed uses `INSERT OR IGNORE`, so running it again never overwrites edits.

## 2. Editor sign-in (Cloudflare Access)
- [ ] Zero Trust → Access → Applications: add a self-hosted app for `admin.scuclip.com`, with a policy allowing only the board's emails.
- [ ] Copy the team domain (`<team>.cloudflareaccess.com`) into `ACCESS_TEAM_DOMAIN` and the app's Audience (AUD) tag into `ACCESS_AUD` in `wrangler.jsonc`.
- [ ] Check that https://admin.scuclip.com asks for sign-in, and that the editor shows your email.

## 3. Sign-up protection (Turnstile)
- [ ] Create a Turnstile widget for `scuclip.com` (managed mode).
- [ ] Put the site key in `TURNSTILE_SITE_KEY` in `wrangler.jsonc`.
- [ ] `wrangler secret put TURNSTILE_SECRET` with the widget's secret key. Never commit it.
- [ ] Sign up on the live site and check the address shows in the editor's Site tab.

## 4. Deploy
- [ ] `npm ci && npm run check`.
- [ ] `wrangler deploy`. The custom domains in `wrangler.jsonc` are created on first deploy.
- [ ] Check `https://scuclip.com` and every page, the 404 page, HTTP → HTTPS, and the response headers (CSP, HSTS).

## Left for later
- `@cloudflare/vitest-pool-workers` has been renamed to `@cloudflare/vitest-plugin`. 0.23.0 still works with vitest 4; switch when convenient (`npx @cloudflare/codemods vitest:pool-workers-to-vitest-plugin`).
- `www.scuclip.com`: add a redirect rule to `scuclip.com` if people type it.
- A WAF rate-limit rule on `POST /api/signup` if spam gets through Turnstile.
- Consider HSTS `includeSubDomains` and preload once every subdomain is HTTPS-only.
