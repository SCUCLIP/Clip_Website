/* Render content docs to HTML. The only copy of the page markup: the Worker uses it for the public pages and the
   editor uses it for its canvas. With { editor: true } it adds data-f="<field path>" to every text that can be
   typed into, and nothing else changes.

   Output matches prototype/static/*.html apart from links and asset paths (see test/node/render.test.mjs). */

import { SPRITE } from "./sprite.js";
import { PAGE_IDS, hrefFor, pagePath, photoSrc, assetSrc } from "./pages.js";
import { escapeAttr, escapeHead, escapeText, plainHtml, richHtml, richToPlain, isPlaceholder } from "./rich.js";

const num = (n) => String(n);
const box = (b) => b.map(num).join(",");

/* ---------- Drawings ---------- */
const ARROW_RIGHT = '<svg width="30" height="14" aria-hidden="true"><use href="#arrow-right"></use></svg>';
export const FIGURES = {
  aspirin: [128, 118], chair: [120, 56], tlc: [64, 106], mortar: [84, 74],
  ballstick: [112, 68], dose: [138, 87], sn2: [156, 60],
};
export const DOODLES = {
  flask: ["0 0 82 92", 82, 92], "flask-mini": ["0 0 82 92", 82, 92], benzene: ["0 0 88 88", 88, 88],
  capsule: ["0 0 44 22", 44, 22], tablet: ["0 0 22 22", 22, 22], tick: ["0 0 30 30", 30, 30],
  arrow: ["0 0 56 44"],
};
const DOODLE_ARROW = '<path d="M52 38C36 40 18 32 10 12" fill="none" stroke="#B8343F" stroke-width="2.2" stroke-linecap="round"></path><path d="M4 19L9 9L19 15" fill="none" stroke="#B8343F" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path>';

/* ---------- Helpers ---------- */
function ctx(opts) {
  const ed = !!opts.editor;
  return {
    ed,
    email: opts.site?.email || "",
    f: (path) => (ed ? ` data-f="${escapeAttr(path)}"` : ""),
  };
}
const href = (stored) => escapeAttr(hrefFor(stored));
function aOrSpan(label, stored, cls, c, path) {
  const h = hrefFor(stored);
  if (h) return `<a class="${cls}" href="${escapeAttr(h)}"${c.f(path + "Label")}>${plainHtml(label)}</a>`;
  if (label) return `<span class="placeholder"${c.f(path + "Label")}>${plainHtml(label)}</span>`;
  return "";
}
function initials(name) {
  const words = String(name || "").replace(/\[[^\]]*\]/g, "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const a = words[0][0], b = words.length > 1 ? words[words.length - 1][0] : "";
  return (a + b).toUpperCase();
}
function contactLine(text, email, id, c, style) {
  const a = escapeText(email), at = escapeAttr(email);
  return `<p class="contact-line"${style ? ` style="${style}"` : ""}><span${c.f("text")}>${plainHtml(text)}</span> <span class="addr" id="addr-${id}">${a}</span><button class="copy-btn" type="button" data-copy="${at}" data-copy-target="addr-${id}">Copy</button></p>`;
}
function emailField(el, id, c, style) {
  return `<div class="field"${style ? ` style="${style}"` : ""}><label for="em-${id}"${c.f("label")}>${plainHtml(el.label)}</label><input class="input" id="em-${id}" name="email" type="email" autocomplete="email" inputmode="email" placeholder="${escapeAttr(el.placeholder)}" aria-describedby="st-${id}"></div>`;
}

/* ---------- Lists ---------- */
const LISTS = {
  highlights: (items, c) => `<ul class="does">${items.map((it, i) => `<li><svg class="tick" width="32" height="32" aria-hidden="true"><use href="#tick"></use></svg><div><h3${c.f(`items.${i}.title`)}>${plainHtml(it.title)}</h3><p${c.f(`items.${i}.text`)}>${plainHtml(it.text)}</p></div></li>`).join("")}</ul>`,
  chips: (items, c) => `<ul class="chips">${items.map((it, i) => `<li${it.more ? ' class="more"' : ""}><span${c.f(`items.${i}.text`)}>${plainHtml(it.text)}</span></li>`).join("")}</ul>`,
  cards: (items, c) => `<div class="grid-cards">${items.map((it, i) => `<article class="index-card"><h3${c.f(`items.${i}.title`)}>${plainHtml(it.title)}</h3><p${c.f(`items.${i}.text`)}>${plainHtml(it.text)}</p>${aOrSpan(it.linkLabel, it.linkHref, "text-link", c, `items.${i}.link`)}</article>`).join("")}</div>`,
  events: (items, c) => `<div class="grid-3">${items.map((it, i) => `<article class="event">
      <div class="date"><span class="m"${c.f(`items.${i}.month`)}>${plainHtml(it.month)}</span><span class="d"${c.f(`items.${i}.day`)}>${plainHtml(it.day)}</span></div>
      <div class="event-body"><h3${c.f(`items.${i}.name`)}>${plainHtml(it.name)}</h3><p class="meta"><span${c.f(`items.${i}.time`)}>${plainHtml(it.time)}</span><br><span${c.f(`items.${i}.location`)}>${plainHtml(it.location)}</span></p><p class="desc"${c.f(`items.${i}.desc`)}>${plainHtml(it.desc)}</p>${aOrSpan(it.linkLabel, it.linkHref, "text-link", c, `items.${i}.link`)}</div>
    </article>`).join("")}</div>`,
  speakers: (items, c) => `<div class="grid-photos">${items.map((it, i) => `<figure class="polaroid">
      <span class="tape${i % 2 ? " yellow" : ""}" aria-hidden="true"></span>
      <div class="photo">${it.photo ? `<img src="${photoSrc(it.photo)}" alt="${escapeAttr(isPlaceholder(it.name) ? "" : it.name)}">` : '<span aria-hidden="true">Photo</span>'}</div>
      <figcaption><span class="name"${c.f(`items.${i}.name`)}>${plainHtml(it.name)}</span><span class="role"${c.f(`items.${i}.when`)}>${plainHtml(it.when)}</span><span class="sp-line"><span${c.f(`items.${i}.title`)}>${plainHtml(it.title)}</span> · <span${c.f(`items.${i}.topic`)}>${plainHtml(it.topic)}</span></span></figcaption>
    </figure>`).join("")}</div>`,
  members: (items, c) => `<ul class="grid-board">${items.map((it, i) => `<li class="member"><div class="photo">${it.photo ? `<img src="${photoSrc(it.photo)}" alt="">` : `<span aria-hidden="true">${escapeText(initials(it.name))}</span>`}</div><div class="member-text"><span class="name"${c.f(`items.${i}.name`)}>${plainHtml(it.name)}</span><span class="role"${c.f(`items.${i}.role`)}>${plainHtml(it.role)}</span></div></li>`).join("")}</ul>`,
  roles: (items, c) => `<dl class="roles">${items.map((it, i) => `<div><dt${c.f(`items.${i}.title`)}>${plainHtml(it.title)}</dt><dd${c.f(`items.${i}.text`)}>${plainHtml(it.text)}</dd></div>`).join("")}</dl>`,
  steps: (items, c) => `<ol class="pipeline">${items.map((it, i) => {
    const last = i === items.length - 1;
    return `<li><span class="stage${last ? " last" : ""}"><span class="n">${String(i + 1).padStart(2, "0")}</span><span class="t"${c.f(`items.${i}.text`)}>${plainHtml(it.text)}</span></span>${last ? "" : ARROW_RIGHT}</li>`;
  }).join("")}</ol>`,
  past: (items, c) => `<ul class="log-list">${items.map((it, i) => `<li><span class="when"${c.f(`items.${i}.when`)}>${plainHtml(it.when)}</span><span class="what"${c.f(`items.${i}.what`)}>${plainHtml(it.what)}</span></li>`).join("")}</ul>`,
  faq: (items, c) => `<dl class="faq">${items.map((it, i) => `<div><dt${c.f(`items.${i}.q`)}>${plainHtml(it.q)}</dt><dd${c.f(`items.${i}.a`)}>${plainHtml(it.a)}</dd></div>`).join("")}</dl>`,
  status: (items, c) => `<div class="grid-2">${items.map((it, i) => `<article class="pending-card"><div class="pending-top"><h3${c.f(`items.${i}.title`)}>${plainHtml(it.title)}</h3><span class="tag"${c.f(`items.${i}.tag`)}>${plainHtml(it.tag)}</span></div><p${c.f(`items.${i}.text`)}>${plainHtml(it.text)}</p></article>`).join("")}</div>`,
};

/* ---------- Elements ---------- */
const INNER = {
  text(el, c) {
    const cls = ["tx", "k-" + el.kind];
    if (el.color) cls.push("c-" + el.color);
    if (el.align) cls.push("al-" + el.align);
    if (el.rule) cls.push("has-rule");
    const t = el.tag;
    return `<${t} class="${cls.join(" ")}" style="--fs:${num(el.fs)}px;--mfs:${num(el.mfs)}px"${t === "h1" ? ' tabindex="-1"' : ""}${c.f("text")}>${richHtml(el.text)}</${t}>`;
  },
  button: (el, c) => `<a class="btn btn-${el.style}"${hrefAttr(el.href)}><span${c.f("label")}>${plainHtml(el.label)}</span></a>`,
  link: (el, c) => `<a class="more-link"${hrefAttr(el.href)}><span${c.f("label")}>${plainHtml(el.label)}</span>${ARROW_RIGHT}</a>`,
  entry(el, c) {
    const h = hrefFor(el.href);
    const pg = h ? `<a class="pg" href="${escapeAttr(h)}"${c.f("page")}>${plainHtml(el.page)}</a>` : `<span class="pg"${c.f("page")}>${plainHtml(el.page)}</span>`;
    return `<div class="entry-head"><b${c.f("num")}>${plainHtml(el.num)}</b><span${c.f("label")}>${plainHtml(el.label)}</span>${pg}</div>`;
  },
  figure(el, c) {
    let art;
    if (el.art === "rxn") {
      art = `<div class="rxn" role="img" aria-label="${escapeAttr(el.alt)}"><span${c.f("from")}>${plainHtml(el.from)}</span><span class="rxn-arrow" aria-hidden="true"><span${c.f("above")}>${plainHtml(el.above)}</span><svg width="84" height="12" viewBox="0 0 84 12"><path d="M2 6H80M73 2L80 6L73 10" fill="none" stroke="#0E304C" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg><span${c.f("below")}>${plainHtml(el.below)}</span></span><span${c.f("to")}>${plainHtml(el.to)}</span></div>`;
    } else {
      const [w, h] = FIGURES[el.art];
      art = `<svg width="${w}" height="${h}" role="img" aria-label="${escapeAttr(el.alt)}"><use href="#${el.art}"></use></svg>`;
    }
    return `<figure class="fig">${art}<figcaption${c.f("caption")}>${richHtml(el.caption)}</figcaption></figure>`;
  },
  doodle(el) {
    const [vb, w, h] = DOODLES[el.art];
    const inner = el.art === "arrow" ? DOODLE_ARROW : `<use href="#${el.art}" width="${w}" height="${h}"></use>`;
    return `<svg class="dd" viewBox="${vb}">${inner}</svg>`;
  },
  image(el, c) {
    const src = el.photo ? photoSrc(el.photo) : el.asset ? assetSrc(el.asset) : "";
    const tape = el.tape ? `<span class="tape${el.tape === "yellow" ? " yellow" : ""}" aria-hidden="true"></span>` : "";
    const size = el.iw && el.ih ? ` width="${num(el.iw)}" height="${num(el.ih)}"` : "";
    const photo = src
      ? `<div class="photo${el.logo ? " is-logo" : ""}"><img src="${escapeAttr(src)}" alt="${escapeAttr(el.alt)}"${size}></div>`
      : '<div class="photo"><span aria-hidden="true">Photo</span></div>';
    const cap = el.caption || c.ed ? `<figcaption${c.f("caption")}>${richHtml(el.caption)}</figcaption>` : "";
    return `<figure class="im f-${el.frame}">${tape}${photo}${cap}</figure>`;
  },
  note: (el, c) => `<div class="nt nt-${el.color}"><p${c.f("text")}>${richHtml(el.text)}</p></div>`,
  line: (el) => `<div class="ln${el.solid ? " ln-solid" : ""}"></div>`,
  stamp: (el, c) => `<p class="stamp"${c.f("text")}>${richHtml(el.text)}</p>`,
  signup(el, c) {
    const id = el.id;
    return `<div class="sticky-note"><span class="tape" aria-hidden="true" style="width: 120px;height: 28px;margin-left: -60px;transform: rotate(-2deg)"></span>
        <p class="eyebrow"${c.f("eyebrow")}>${plainHtml(el.eyebrow)}</p>
        <h2 class="h-section"${c.f("title")}>${plainHtml(el.title)}</h2>
        <p class="body-lg"${c.f("body")}>${plainHtml(el.body)}</p>
        <form class="signup" data-list="${escapeAttr(el.list)}" data-ok="${escapeAttr(el.ok)}" novalidate="">
          ${emailField(el, id, c)}
          <button class="btn btn-primary" type="submit"><span${c.f("button")}>${plainHtml(el.button)}</span></button>
          <p class="form-status" id="st-${id}" role="status" aria-live="polite"></p>
        </form>
        ${contactLine(el.contact, c.email, id, { f: (p) => c.f(p === "text" ? "contact" : p) })}
      </div>`;
  },
  form(el, c) {
    const id = el.id;
    return `<form class="signup notify" data-list="${escapeAttr(el.list)}" data-ok="${escapeAttr(el.ok)}" novalidate="">
        ${emailField(el, id, c, "flex-basis: 260px")}
        <button class="btn btn-primary" type="submit"><span${c.f("button")}>${plainHtml(el.button)}</span></button>
        <p class="form-status" id="st-${id}" role="status" aria-live="polite"></p>
      </form>`;
  },
  contact: (el, c) => contactLine(el.text, c.email, el.id, c),
  callout: (el, c) => `<div class="teaser"><span class="tape yellow" aria-hidden="true"></span><div class="teaser-copy"><h2 class="h-sub"${c.f("title")}>${plainHtml(el.title)}</h2>${contactLine(el.text, c.email, el.id, c, "font-size: 16px")}</div></div>`,
  list: (el, c) => LISTS[el.kind](el.items, c),
};
function hrefAttr(stored) {
  const h = hrefFor(stored);
  return h ? ` href="${escapeAttr(h)}"` : "";
}

/** The element's wrapper <div> with its position, plus its content. */
export function renderElement(el, opts = {}) {
  const c = ctx(opts);
  const cls = ["el", "el-" + el.type];
  if (el.type === "list") cls.push("ls-" + el.kind);
  if (el.mHide) cls.push("m-hide");
  if (!el.m) cls.push("m-auto");
  if (el.faint) cls.push("is-faint");
  const [x, y, w] = el.d;
  let style = `--x:${num(x)};--y:${num(y)};--w:${num(w)};--z:${num(el.z)}`;
  if (el.m) style += `;--mx:${num(el.m[0])};--my:${num(el.m[1])};--mw:${num(el.m[2])}`;
  if (el.r) style += `;--r:${num(el.r)}`;
  if (el.k !== undefined) style += `;--k:${num(el.k)}`;
  if (el.mk !== undefined) style += `;--mk:${num(el.mk)}`;
  if (el.type === "image") style += `;--ar:${num(el.ar)}`;
  let open = `<div class="${cls.join(" ")}"`;
  if (el.anchor) open += ` id="${escapeAttr(el.anchor)}"`;
  open += ` data-eid="${escapeAttr(el.id)}" data-d="${box(el.d)}"`;
  if (el.m) open += ` data-m="${box(el.m)}"`;
  open += ` style="${style}"`;
  if (el.type === "doodle") open += ' aria-hidden="true"';
  return `${open}>${INNER[el.type](el, c)}</div>`;
}

export function renderSection(sec, opts = {}) {
  const els = sec.els.map((el) => "  " + renderElement(el, opts) + "\n").join("");
  return `<section class="fsec bg-${sec.bg}" data-sid="${escapeAttr(sec.id)}" style="--h: ${num(sec.h)};--mh: ${num(sec.mh)}"><div class="fsec-inner">\n${els}</div></section>`;
}

/** The page's <main>. */
export function renderMain(page, opts = {}) {
  return `<main id="view-${page.id}" class="view is-free">\n${page.sections.map((s) => renderSection(s, opts)).join("\n")}\n</main>`;
}

function renderHeader(site, current) {
  const nav = site.nav.map((n) => `<a href="${pagePath(n.page)}"${n.page === current ? ' aria-current="page"' : ""}>${plainHtml(n.label)}</a>`).join("");
  return `<header class="site-header">
  <div class="header-inner">
    <a class="brand" href="/"><img src="/assets/clip-mark.png" alt="CLIP home" width="60" height="44"></a>
    <nav class="nav" id="site-nav" aria-label="Pages">${nav}</nav>
    <a class="btn btn-primary btn-sm header-cta"${hrefAttr(site.cta.href)}>${plainHtml(site.cta.label)}</a>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-nav">
      <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true"><path d="M1 2H17M1 7H17M1 12H17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>
      <span>Menu</span>
    </button>
  </div>
</header>`;
}

function instagramHtml(handle) {
  const h = String(handle || "");
  if (/^@[A-Za-z0-9._]{1,30}$/.test(h)) return `<a href="https://www.instagram.com/${h.slice(1)}/">${escapeText(h)}</a>`;
  return plainHtml(h);
}

function renderFooter(site) {
  return `<div class="wrap"><footer class="site-footer">
  <div class="foot-brand">
    <img src="/assets/clip-mark.png" alt="CLIP" width="55" height="40">
    <p>${plainHtml(site.footer)}</p>
  </div>
  <div class="foot-contact">
    <span class="addr">${escapeText(site.email)}</span>
    <span>Instagram ${instagramHtml(site.instagram)}</span>${"\n    " /* a line with four spaces, as in the export */}
  </div>
  <p class="foot-page"><svg width="34" height="17" aria-hidden="true"><use href="#capsule"></use></svg><svg width="16" height="16" aria-hidden="true"><use href="#tablet"></use></svg><span>${plainHtml(site.notebook)}</span></p>
</footer></div>`;
}

function renderChat(site) {
  const chips = site.chat.suggestions.map((q) => `      <button class="chip-btn" type="button">${escapeText(q)}</button>\n`).join("");
  return `<button class="chat-launcher" id="chat-launcher" type="button" aria-expanded="false" aria-controls="chat-panel">
  <span class="av" aria-hidden="true"><svg width="36" height="40"><use href="#flask-mini"/></svg></span>
  <span>Ask CLIP</span>
</button>

<section class="chat-panel" id="chat-panel" role="dialog" aria-label="Ask CLIP" hidden>
  <div class="chat-head">
    <span class="av" aria-hidden="true"><svg width="32" height="36"><use href="#flask-mini"/></svg></span>
    <div class="chat-title"><h2>Ask CLIP</h2><p>Club questions, any time</p></div>
    <button class="icon-btn" id="chat-close" type="button" aria-label="Close chat"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 3L15 15M15 3L3 15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
  </div>
  <div class="chat-log" id="chat-log" role="log" aria-live="polite">
    <p class="msg bot">${escapeText(site.chat.greeting)}</p>
${chips ? `    <div class="chat-suggest" id="chat-suggest">\n${chips}    </div>\n` : ""}  </div>
  <form class="chat-form" id="chat-form" novalidate>
    <label class="sr-only" for="chat-input">Ask a question</label>
    <input class="chat-input" id="chat-input" type="text" autocomplete="off" maxlength="500" placeholder="Ask about CLIP">
    <button class="icon-btn send-btn" id="chat-send" type="submit" aria-label="Send"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path id="chat-send-icon" d="M3 9H15M10 4L15 9L10 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  </form>
  <p class="chat-foot" id="chat-mode">${escapeText(site.chat.foot)}</p>
</section>`;
}

/**
 * A whole public page.
 * @param {object} site  the published "site" doc
 * @param {object} page  the published page doc
 * @param {{ turnstileSiteKey?: string, current?: string }} [opts]
 */
export function renderPage(site, page, opts = {}) {
  const current = opts.current ?? page.id;
  const ts = opts.turnstileSiteKey ? `\n<meta name="turnstile-sitekey" content="${escapeAttr(opts.turnstileSiteKey)}">` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHead(page.title)}</title>
<meta name="description" content="${escapeHead(page.description)}">${ts}
<link rel="icon" type="image/png" href="/assets/clip-mark.png">
<link rel="stylesheet" href="/fonts/fonts.css">
<link rel="stylesheet" href="/assets/site.css">
</head>
<body>
${SPRITE}
<div class="site" id="site"><div class="page">${renderHeader(site, current)}
${renderMain(page, { site })}
${renderFooter(site)}</div></div>
${renderChat(site)}
<script src="/assets/clip-facts.js"></script>
<script type="module" src="/assets/site.js"></script>
</body>
</html>
`;
}

/** The 404 page: the site's shell around a short note. */
export function renderNotFound(site) {
  const page = {
    id: "404", title: "Page not found · CLIP at Santa Clara University", description: "This page doesn't exist.",
    sections: [{
      id: "s404", bg: "none", h: 420, mh: 520, els: [
        { id: "e404eyb", type: "text", d: [0, 64, 600, 21], m: [0, 40, 326, 21], z: 1, tag: "p", kind: "eyebrow", color: "", align: "", rule: false, fs: 13, mfs: 13, text: "Error 404 · Sample not found" },
        { id: "e404ttl", type: "text", d: [0, 107, 900, 73], m: [0, 83, 326, 106], z: 2, tag: "h1", kind: "page", color: "", align: "", rule: false, fs: 74, mfs: 54, text: "This page isn't in the notebook" },
        { id: "e404led", type: "text", d: [0, 207, 690.8, 64], m: [0, 213, 326, 87], z: 3, tag: "p", kind: "lede", color: "", align: "", rule: false, fs: 20, mfs: 18, text: "The link may be old, or the page may have moved." },
        { id: "e404btn", type: "button", d: [0, 295, 190, 52], m: [0, 324, 190, 52], z: 4, label: "Go to the home page", href: "#home", style: "primary" },
      ],
    }],
  };
  return renderPage(site, page, { current: "" });
}

/** Plain-text version of a rich field, for Ask CLIP. */
export const plainText = richToPlain;
export { PAGE_IDS };
