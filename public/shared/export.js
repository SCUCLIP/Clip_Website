/* A whole public page, the way the Worker serves it. The page markup itself comes from render.js (the prototype's
   render code). This file adds only what the static export in prototype/static/ added around it:
   - the <head> (title, and the page's first intro paragraph as its description),
   - the drawings sprite from the prototype's <body>,
   - clean links (#about -> /about, #join -> /#join),
   - the browser's way of writing HTML out: <use ...></use> instead of <use .../>, and ' instead of &#39;.
   The result matches prototype/static/*.html apart from links and asset paths (test/node/render.test.mjs). */

import { PAGES, VIEW_IDS, pageLabel, str } from "./model.js";
import { headerHTML, pageMain, footerHTML, xyOrder } from "./render.js";
import { SPRITE } from "./sprite.js";

/** The page each id is served at. */
export const pagePath = (id) => (id === "home" ? "/" : "/" + id);

/** A stored link as the public site writes it: #about -> /about, #home -> /, #join -> /#join, and https links as they are. */
export function cleanUrl(href) {
  const h = str(href);
  if (!h.startsWith("#")) return h;
  const id = h.slice(1);
  return VIEW_IDS.includes(id) ? pagePath(id) : "/" + h;
}

/** What a browser writes when it serializes the DOM the prototype built (the static export was made that way). */
export function domSerialize(html) {
  return html
    .replace(/<(use|path|rect|circle|line|ellipse|polyline|polygon)\b([^>]*?)\/>/g, "<$1$2></$1>")
    .replace(/&#39;/g, "'")
    .replace(/ style="([^"]*)"/g, (m, s) => ` style="${s.replace(/;\s+/g, ";")}"`)
    .replace(/ novalidate>/g, ' novalidate="">');
}

const HEAD_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
const headEsc = (s) => str(s).replace(/[&<>"']/g, (c) => HEAD_ESC[c]);

export const SITE_NAME = "CLIP at Santa Clara University";
export function pageTitle(id) {
  if (id === "home") return "CLIP · Connecting Leaders in Innovation and Pharma at Santa Clara University";
  return `${pageLabel(id)} · ${SITE_NAME}`;
}
/** The page's first intro paragraph, in reading order. */
export function pageDescription(doc) {
  for (const s of doc.sections) {
    const lede = xyOrder(s.elements).find((e) => e.type === "text" && e.kind === "lede" && str(e.text).trim());
    if (lede) return str(lede.text).replace(/\s+/g, " ").trim();
  }
  return "CLIP (Connecting Leaders in Innovation and Pharma), a student club at Santa Clara University.";
}

/**
 * A whole public page.
 * @param {Record<string, object>} C  normalized published docs: the page, "data" and "settings"
 * @param {string} id  the page id
 * @param {{ turnstileSiteKey?: string, current?: string, title?: string, description?: string, link?: (href: string) => string }} [opts]
 */
export function renderPage(C, id, opts = {}) {
  const X = { C, edit: false, idp: "", editor: false, animate: false, exp: true, link: opts.link || cleanUrl };
  const current = opts.current ?? id;
  const title = opts.title ?? pageTitle(id);
  const description = opts.description ?? pageDescription(C[id]);
  const ts = opts.turnstileSiteKey ? `\n<meta name="turnstile-sitekey" content="${headEsc(opts.turnstileSiteKey)}">` : "";
  const site = domSerialize(`<div class="site" id="site"><div class="page">${headerHTML(X, current)}\n${pageMain(X, id)}\n<div class="wrap">${footerHTML(X)}</div></div></div>`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${headEsc(title)}</title>
<meta name="description" content="${headEsc(description)}">${ts}
<link rel="icon" type="image/png" href="/assets/clip-mark.png">
<link rel="stylesheet" href="/fonts/fonts.css">
<link rel="stylesheet" href="/assets/site.css">
</head>
<body>
${SPRITE}
${site}
<script type="module" src="/assets/site.js"></script>
</body>
</html>
`;
}

/** The 404 page: the site's shell around a short note. */
const NOT_FOUND = {
  v: 5,
  sections: [{
    id: "s404", h: 420, mh: 520, bg: "none", elements: [
      { id: "e404eyb", type: "text", text: "Error 404 · Sample not found", hl: "", kind: "eyebrow", color: "", fs: 0, align: "left", rule: false, d: { x: 0, y: 64, w: 600, h: 21 }, m: { x: 0, y: 40, w: 326, h: 21 }, mHide: false, r: 0 },
      { id: "e404ttl", type: "text", text: "This page isn't in the notebook", hl: "", kind: "page", color: "", fs: 0, align: "left", rule: false, d: { x: 0, y: 107, w: 900, h: 73 }, m: { x: 0, y: 83, w: 326, h: 106 }, mHide: false, r: 0 },
      { id: "e404led", type: "text", text: "The link may be old, or the page may have moved.", hl: "", kind: "lede", color: "", fs: 0, align: "left", rule: false, d: { x: 0, y: 207, w: 690.8, h: 64 }, m: { x: 0, y: 213, w: 326, h: 87 }, mHide: false, r: 0 },
      { id: "e404btn", type: "button", label: "Go to the home page", url: "#home", style: "primary", d: { x: 0, y: 295, w: 190, h: 52 }, m: { x: 0, y: 324, w: 190, h: 52 }, mHide: false, r: 0 },
    ],
  }],
};
export function renderNotFound(C, opts = {}) {
  return renderPage({ ...C, 404: NOT_FOUND }, "404", {
    ...opts, current: "", title: "Page not found · " + SITE_NAME, description: "This page doesn't exist.",
  });
}

export { PAGES };
