# Clip_Website

Website and editor for CLIP (Connecting Leaders in Innovation and Pharma), a student organization at Santa Clara
University.

- **scuclip.com**: the public site.
- **admin.scuclip.com**: the board's drag-and-drop editor, behind Cloudflare Access.

One Cloudflare Worker serves both, with D1 (content and sign-ups) and R2 (photos). The working prototype, which is
the spec for the look, the editor and the content format, is `prototype/clip-website.html`. The content is in
`content/seed/`. The site isn't live yet: for now it runs on a laptop with no sign-in (local mode, see
[CLAUDE.md](CLAUDE.md)).

```
npm ci
npm run dev      # site at http://localhost:8787, editor at http://admin.localhost:8787, no login
npm run check    # tests: the render against prototype/static, norm(), every API route
```

## Demo
A static demo runs on GitHub Pages (`.github/workflows/pages.yml`), published from `main`: the site's pages and the
real editor, where every edit, photo, publish and sign-up stays in the visitor's own browser. Nothing is sent
anywhere, and **Reset** starts again from the original content. To try it locally: `npm run demo:build`, then
`npm run demo:serve` and open http://127.0.0.1:8790.

## More
- Content format: [docs/CONTENT-FORMAT.md](docs/CONTENT-FORMAT.md)
- Going live: [docs/GO-LIVE.md](docs/GO-LIVE.md)
- Security design: [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md)
- Notes for Claude Code: [CLAUDE.md](CLAUDE.md)
