## What changed

## Security check
- [ ] No secrets, tokens or keys in the diff
- [ ] Every new `/api/admin/*` route goes through `gate()` (Access check, Origin check), and only answers on the admin host
- [ ] Every new public write (forms, sign-ups) checks Turnstile, is rate limited and validates input before touching D1
- [ ] Database queries use `prepare(...).bind(...)`, never string building
- [ ] Text from the database is shown as text, never as HTML. Links are https:// or #page only
- [ ] No new inline scripts, no new third-party scripts or dependencies (or the reason is below)
- [ ] `npm run check` passes
