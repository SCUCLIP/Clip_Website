/* Page markup, shared by the Worker (public pages) and the editor (its canvas). Ported from the "Rendering" part of
   prototype/clip-website.html, kept as close to the original as possible.

   X is the render context: { C: docs by id, edit, idp: id prefix, editor, animate, link?, exp? }.
   - edit: the editor's canvas. Editable text gets data-f="<ref>" and list items get their tools.
   - link: a function that turns a stored link (#about, #join, or an https link) into the address the page uses.
   - exp: the public pages' extra markup from the static export (data-d and data-m, one element per line).
   Changes from the prototype: logos are under /assets/, and links go through X.link. */

import {
  CLUB_EMAIL, esc, str, arr, fmt, safeHref, isExternal, blobSrc, initials, PAGES, pageNum, FIGURES, SYMS, ARROW_PATH,
  KINDS, fontPx, LISTS,
} from "./model.js";

const svgI = (w, d) => `<svg width="${w}" height="${w}" viewBox="0 0 16 16" aria-hidden="true">${d}</svg>`;
const SL = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const ICON = {
  up: svgI(14, `<path d="M8 13V3M4 7L8 3L12 7" ${SL}/>`),
  down: svgI(14, `<path d="M8 3V13M4 9L8 13L12 9" ${SL}/>`),
  left: svgI(13, `<path d="M10 3L5 8L10 13" ${SL}/>`),
  right: svgI(13, `<path d="M6 3L11 8L6 13" ${SL}/>`),
  dup: svgI(14, `<rect x="5" y="5" width="8.5" height="8.5" rx="1.5" ${SL}/><path d="M3 10.5V3.5C3 2.95 3.45 2.5 4 2.5H10.5" ${SL}/>`),
  trash: svgI(14, `<path d="M3 4.5H13M6.5 4.5V3H9.5V4.5M4.5 4.5L5.2 13H10.8L11.5 4.5" ${SL}/>`),
  gear: svgI(14, `<circle cx="8" cy="8" r="2.4" ${SL}/><path d="M8 1.5V3.5M8 12.5V14.5M1.5 8H3.5M12.5 8H14.5M3.4 3.4L4.8 4.8M11.2 11.2L12.6 12.6M3.4 12.6L4.8 11.2M11.2 4.8L12.6 3.4" ${SL}/>`),
  front: svgI(14, `<rect x="2.5" y="2.5" width="7" height="7" rx="1" ${SL}/><rect x="6.5" y="6.5" width="7" height="7" rx="1" fill="currentColor" stroke="currentColor" stroke-width="1.6"/>`),
  back: svgI(14, `<rect x="6.5" y="6.5" width="7" height="7" rx="1" ${SL}/><rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="currentColor" stroke="currentColor" stroke-width="1.6"/>`),
  phoneOff: svgI(14, `<rect x="4.5" y="1.5" width="7" height="13" rx="1.5" ${SL}/><path d="M2 2L14 14" ${SL}/>`),
  phone: svgI(14, `<rect x="4.5" y="1.5" width="7" height="13" rx="1.5" ${SL}/><path d="M7 12H9" ${SL}/>`),
  plus: svgI(14, `<path d="M8 3V13M3 8H13" ${SL}/>`),
  pen: svgI(14, `<path d="M3 13L3.5 10.5L10.5 3.5L12.5 5.5L5.5 12.5Z" ${SL}/>`),
  photo: svgI(14, `<rect x="2" y="3.5" width="12" height="9" rx="1.5" ${SL}/><circle cx="6" cy="7" r="1.2" ${SL}/><path d="M3 12L7 9L10 11L14 8" ${SL}/>`),
  chev: '<svg class="adm-chev" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M5 3L9.5 7L5 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  undo: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4L2.5 7L5.5 10M3 7H10C12 7 13.5 8.5 13.5 10.5S12 14 10 14H8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  redo: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 4L13.5 7L10.5 10M13 7H6C4 7 2.5 8.5 2.5 10.5S4 14 6 14H8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};
const ARROW = '<svg width="30" height="14" aria-hidden="true"><use href="#arrow-right"/></svg>';
const TICK = '<svg class="tick" width="32" height="32" aria-hidden="true"><use href="#tick"/></svg>';
const MASCOT = (label) => `<div class="mascot"><svg width="96" height="108" role="img" aria-label="CLIP's flask mascot in a lab coat"><use href="#flask"/></svg>${label}</div>`;
const emailOf = (X) => str(X.C.settings.contactEmail).trim() || CLUB_EMAIL;
const er = (s, e) => `E.${s.id}.${e.id}`;
const out = (X, href) => (X.link ? X.link(href) : href);
const extAttrs = (href) => (isExternal(href) ? ' target="_blank" rel="noopener noreferrer"' : "");

/* One piece of text. In the editor it carries data-f (its address in the content) and becomes editable on double-click. */
function tf(X, tag, cls, ref, value, o) {
  o = o || {};
  const v = str(value);
  if (!v.trim() && o.optional) return "";
  const c = cls ? ` class="${cls}"` : "";
  if (!X.edit) return `<${tag}${c}${o.attrs || ""}>${fmt(v)}</${tag}>`;
  return `<${tag}${c}${o.attrs || ""} data-f="${ref}"${o.multi ? ' data-multi="1"' : ""} data-ph="${esc(o.ph || "Add text")}">${fmt(v)}</${tag}>`;
}
function linkHTML(X, cls, ref, label, url) {
  const href = safeHref(url), text = str(label).trim();
  if (!text && !href) return "";
  const inner = X.edit ? tf(X, "span", "", ref, label, { ph: "Link text" }) : fmt(text || "Learn more");
  if (href) return `<a class="${cls}" href="${X.edit ? "#" : esc(out(X, href))}"${X.edit ? ' tabindex="-1"' : extAttrs(href)}>${inner}</a>`;
  return `<span class="placeholder">${inner}</span>`;
}
function contactLine(X, eid, lead, leadRef, style) {
  const mail = emailOf(X), id = `${X.idp}addr-${eid}`;
  return `<p class="contact-line"${style ? ` style="${style}"` : ""}>${str(lead).trim() ? tf(X, "span", "", leadRef, lead) + " " : ""}${tf(X, "span", "addr", "G.contactEmail", mail, { attrs: ` id="${id}"`, ph: "Club email" })}<button class="copy-btn" type="button" data-copy="${esc(mail)}" data-copy-target="${id}"${X.edit ? ' tabindex="-1"' : ""}>Copy</button></p>`;
}
/* List items know their list, so the editor can move, copy and delete them */
const itemAttrs = (X, ref, list) => (X.edit ? ` data-item="${ref}" data-list="${list}"` : "");
const iTools = (X, what) => (X.edit ? `<span class="ce-itools"><button type="button" data-act="item-prev" aria-label="Move this ${what} earlier" tabindex="-1">${ICON.left}</button><button type="button" data-act="item-next" aria-label="Move this ${what} later" tabindex="-1">${ICON.right}</button><button type="button" data-act="item-dup" aria-label="Duplicate this ${what}" tabindex="-1">${ICON.dup}</button><button type="button" data-act="item-del" aria-label="Delete this ${what}" tabindex="-1">${ICON.trash}</button></span>` : "");
function photoInner(X, ref, id, fallback) {
  const src = blobSrc(id);
  return `${src ? `<img src="${src}" alt="" loading="lazy">` : fallback}${X.edit ? `<button type="button" class="ce-photo-btn" data-act="photo" data-ref="${ref}" tabindex="-1">${src ? "Replace photo" : "Add photo"}</button>` : ""}`;
}
function eventCard(X, e, i, showLink) {
  const r = `D.events.${i}`;
  const meta = [["time", e.time], ["location", e.location]].filter((p) => str(p[1]).trim()).map((p) => tf(X, "span", "", `${r}.${p[0]}`, p[1])).join("<br>");
  return `<article class="event"${itemAttrs(X, r, "D.events")}>${iTools(X, "event")}
      <div class="date">${tf(X, "span", "m", r + ".month", e.month, { ph: "Mon" })}${tf(X, "span", "d", r + ".day", e.day, { ph: "00" })}</div>
      <div class="event-body">${tf(X, "h3", "", r + ".name", e.name, { ph: "Event name" })}${meta ? `<p class="meta">${meta}</p>` : ""}${tf(X, "p", "desc", r + ".description", e.description, { optional: true, multi: true, ph: "One line on what happens" })}${showLink ? linkHTML(X, "text-link", r + ".linkLabel", e.linkLabel, e.linkUrl) : ""}</div>
    </article>`;
}
function polaroid(X, s, i) {
  const r = `D.speakers.${i}`;
  const line = [["role", s.role], ["topic", s.topic]].filter((p) => str(p[1]).trim()).map((p) => tf(X, "span", "", `${r}.${p[0]}`, p[1])).join(" · ");
  return `<figure class="polaroid"${itemAttrs(X, r, "D.speakers")}>${iTools(X, "speaker")}
      <span class="${i % 3 === 1 ? "tape yellow" : "tape"}" aria-hidden="true"></span>
      <div class="photo">${photoInner(X, r + ".photo", s.photo, '<span aria-hidden="true">Photo</span>')}</div>
      <figcaption>${tf(X, "span", "name", r + ".name", s.name, { ph: "Name" })}${tf(X, "span", "role", r + ".when", s.when, { optional: true, ph: "When" })}${line ? `<span class="sp-line">${line}</span>` : ""}</figcaption>
    </figure>`;
}
function memberHTML(X, m, i) {
  const r = `D.members.${i}`;
  return `<li class="member"${itemAttrs(X, r, "D.members")}>${iTools(X, "member")}<div class="photo">${photoInner(X, r + ".photo", m.photo, `<span aria-hidden="true">${esc(initials(m.name))}</span>`)}</div><div class="member-text">${tf(X, "span", "name", r + ".name", m.name, { ph: "Name" })}${tf(X, "span", "role", r + ".role", m.role, { ph: "Role" })}</div></li>`;
}
function listHTML(X, s, e) {
  const L = LISTS[e.src], r = er(s, e);
  const lr = L.shared ? `D.${e.src}` : `${r}.items`;
  let items = L.shared ? arr(X.C.data[e.src]) : arr(e.items);
  if (e.limit && e.limit !== "all") items = items.slice(0, +e.limit || items.length);
  const ir = (i) => `${lr}.${i}`;
  if (!items.length && !(e.src === "chips" && e.more)) {
    if (str(e.empty).trim()) return `<p class="note-empty">${tf(X, "span", "", r + ".empty", e.empty)}</p>`;
    return X.edit ? '<p class="note-empty ce-only">This list is empty. Add items in Settings.</p>' : "";
  }
  switch (e.src) {
    case "events": return `<div class="grid-3">${items.map((ev, i) => eventCard(X, ev, i, e.showLinks)).join("")}</div>`;
    case "past": return `<ul class="log-list">${items.map((p, i) => `<li${itemAttrs(X, ir(i), lr)}>${iTools(X, "entry")}${tf(X, "span", "when", ir(i) + ".when", p.when, { ph: "When" })}${tf(X, "span", "what", ir(i) + ".what", p.what, { ph: "What happened" })}</li>`).join("")}</ul>`;
    case "speakers": return `<div class="grid-photos">${items.map((sp, i) => polaroid(X, sp, i)).join("")}</div>`;
    case "members": return `<ul class="grid-board">${items.map((m, i) => memberHTML(X, m, i)).join("")}</ul>`;
    case "highlights": return `<ul class="does">${items.map((p, i) => `<li${itemAttrs(X, ir(i), lr)}>${iTools(X, "highlight")}${TICK}<div>${tf(X, "h3", "", ir(i) + ".title", p.title, { ph: "Heading" })}${tf(X, "p", "", ir(i) + ".body", p.body, { optional: true, multi: true, ph: "A line about it" })}</div></li>`).join("")}</ul>`;
    case "faq": return `<dl class="faq">${items.map((q, i) => `<div${itemAttrs(X, ir(i), lr)}>${iTools(X, "question")}${tf(X, "dt", "", ir(i) + ".q", q.q, { ph: "Question" })}${tf(X, "dd", "", ir(i) + ".a", q.a, { multi: true, ph: "Answer" })}</div>`).join("")}</dl>`;
    case "roles": return `<dl class="roles">${items.map((x, i) => `<div${itemAttrs(X, ir(i), lr)}>${iTools(X, "role")}${tf(X, "dt", "", ir(i) + ".title", x.title, { ph: "Role" })}${tf(X, "dd", "", ir(i) + ".duties", x.duties, { multi: true, ph: "What they do" })}</div>`).join("")}</dl>`;
    case "cards": return `<div class="grid-cards">${items.map((k, i) => `<article class="index-card"${itemAttrs(X, ir(i), lr)}>${iTools(X, "card")}${tf(X, "h3", "", ir(i) + ".title", k.title, { ph: "Card title" })}${tf(X, "p", "", ir(i) + ".body", k.body, { optional: true, multi: true, ph: "A line or two" })}${linkHTML(X, "text-link", ir(i) + ".linkLabel", k.linkLabel, k.linkUrl)}</article>`).join("")}</div>`;
    case "status": return `<div class="grid-2">${items.map((c, i) => `<article class="pending-card${c.state === "ready" ? " is-ready" : ""}"${itemAttrs(X, ir(i), lr)}>${iTools(X, "card")}<div class="pending-top">${tf(X, "h3", "", ir(i) + ".title", c.title, { ph: "Heading" })}<span class="tag">${c.state === "ready" ? "Confirmed" : "Pending"}</span></div>${tf(X, "p", "", ir(i) + ".body", c.body, { optional: true, multi: true, ph: "Details" })}</article>`).join("")}</div>`;
    case "steps": return `<ol class="pipeline">${items.map((x, i) => `<li${itemAttrs(X, ir(i), lr)}><span class="stage${i === items.length - 1 ? " last" : ""}"><span class="n">${String(i + 1).padStart(2, "0")}</span>${tf(X, "span", "t", ir(i) + ".t", x.t, { ph: "Step" })}</span>${i < items.length - 1 ? ARROW : ""}${iTools(X, "step")}</li>`).join("")}</ol>`;
    case "chips": return `<ul class="chips">${items.map((x, i) => `<li${itemAttrs(X, ir(i), lr)}>${iTools(X, "chip")}${tf(X, "span", "", ir(i) + ".t", x.t, { ph: "Chip" })}</li>`).join("")}${str(e.more).trim() ? `<li class="more">${tf(X, "span", "", r + ".more", e.more, { ph: "and beyond" })}</li>` : ""}</ul>`;
  }
  return "";
}

const RX = {
  text(X, s, e) {
    const K = KINDS[e.kind], r = er(s, e);
    const cls = `tx k-${e.kind}${e.color ? " c-" + e.color : ""}${e.align !== "left" ? " al-" + e.align : ""}${e.rule ? " has-rule" : ""}`;
    const body = X.edit ? `<span data-f="${r}.text" data-multi="1" data-ph="Write something">${fmt(e.text)}</span>` : fmt(e.text);
    const hl = str(e.hl).trim() ? " " + (X.edit ? `<span class="hl" data-f="${r}.hl" data-ph="highlight">${fmt(e.hl)}</span>` : `<span class="hl">${fmt(e.hl)}</span>`) : "";
    return `<${K.tag} class="${cls}" style="--fs:${fontPx(e, "d")}px;--mfs:${fontPx(e, "m")}px"${K.tag === "h1" ? ' tabindex="-1"' : ""}>${body}${hl}</${K.tag}>`;
  },
  image(X, s, e) {
    const r = er(s, e), logo = e.src === "logo";
    const src = logo ? "/assets/clip-logo.png" : blobSrc(e.src);
    const alt = logo ? str(e.alt).trim() || "CLIP logo, Connecting Leaders in Innovation and Pharma" : str(e.alt).trim();
    const img = src ? `<img src="${src}" alt="${esc(alt)}"${logo ? ' width="359" height="371"' : ' loading="lazy"'}>` : '<span aria-hidden="true">Photo</span>';
    const btn = X.edit ? `<button type="button" class="ce-photo-btn" data-act="photo" data-ref="${r}.src" tabindex="-1">${src ? "Replace photo" : "Add photo"}</button>` : "";
    return `<figure class="im f-${e.frame}">${e.tape ? '<span class="tape" aria-hidden="true"></span>' : ""}<div class="photo${logo ? " is-logo" : ""}">${img}${btn}</div>${tf(X, "figcaption", "", r + ".caption", e.caption, { optional: true, ph: "Caption" })}</figure>`;
  },
  button(X, s, e) {
    const href = safeHref(e.url), cls = `btn ${e.style === "secondary" ? "btn-secondary" : "btn-primary"}`;
    const inner = tf(X, "span", "", er(s, e) + ".label", e.label, { ph: "Button" });
    if (X.edit) return `<a class="${cls}" href="#" tabindex="-1">${inner}</a>`;
    return href ? `<a class="${cls}" href="${esc(out(X, href))}"${extAttrs(href)}>${inner}</a>` : `<span class="${cls}">${inner}</span>`;
  },
  link(X, s, e) {
    const href = safeHref(e.url), inner = tf(X, "span", "", er(s, e) + ".label", e.label, { ph: "Link" }) + ARROW;
    if (X.edit) return `<a class="more-link" href="#" tabindex="-1">${inner}</a>`;
    return href ? `<a class="more-link" href="${esc(out(X, href))}"${extAttrs(href)}>${inner}</a>` : `<span class="more-link">${inner}</span>`;
  },
  doodle(X, s, e) {
    const d = SYMS[e.sym] || SYMS.benzene;
    return `<svg class="dd" viewBox="0 0 ${d.vb[0]} ${d.vb[1]}">${e.sym === "arrow" ? ARROW_PATH : `<use href="#${e.sym}" width="${d.vb[0]}" height="${d.vb[1]}"/>`}</svg>`;
  },
  note(X, s, e) { return `<div class="nt nt-${e.color}">${tf(X, "p", "", er(s, e) + ".text", e.text, { multi: true, ph: "Write a note" })}</div>`; },
  stamp(X, s, e) { return tf(X, "p", "stamp", er(s, e) + ".text", e.text, { multi: true, ph: "Stamp" }); },
  figure(X, s, e) { const f = FIGURES[e.fig] || FIGURES.aspirin; return `<figure class="fig">${f.html}<figcaption>${f.cap}</figcaption></figure>`; },
  entry(X, s, e, ctx) {
    const r = er(s, e);
    const pg = e.pg === "this" ? `<span class="pg">p. ${pageNum(ctx.page)}</span>` : e.pg ? `<a class="pg" href="${X.edit ? "#" : esc(out(X, "#" + e.pg))}"${X.edit ? ' tabindex="-1"' : ""}>See p. ${pageNum(e.pg)}</a>` : "";
    return `<div class="entry-head">${tf(X, "b", "", r + ".tag", e.tag, { ph: "Entry" })}${tf(X, "span", "", r + ".label", e.label, { ph: "Label" })}${pg}</div>`;
  },
  contact(X, s, e) { return contactLine(X, e.id, e.lead, er(s, e) + ".lead"); },
  line(X, s, e) { return `<div class="ln ln-${e.style}" role="presentation"></div>`; },
  signup(X, s, e) {
    const P = X.idp, r = er(s, e), inert = X.edit ? ' tabindex="-1" readonly' : "";
    return `<div class="sticky-note"><span class="tape" aria-hidden="true" style="width: 120px; height: 28px; margin-left: -60px; transform: rotate(-2deg)"></span>
        ${tf(X, "p", "eyebrow", r + ".eyebrow", e.eyebrow, { optional: true, ph: "Small line" })}
        ${tf(X, "h2", "h-section", r + ".title", e.title, { ph: "Title" })}
        ${tf(X, "p", "body-lg", r + ".body", e.body, { optional: true, multi: true, ph: "Text" })}
        <form class="signup" data-list="${e.list}" data-ok="${esc(e.okText || "You're on the list.")}" novalidate>
          <div class="field"><label for="${P}em-${e.id}">SCU email</label><input class="input" id="${P}em-${e.id}" name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@scu.edu" aria-describedby="${P}st-${e.id}"${inert}></div>
          <button class="btn btn-primary" type="submit"${X.edit ? ' tabindex="-1"' : ""}>${tf(X, "span", "", r + ".buttonLabel", e.buttonLabel || "Sign up", { ph: "Button" })}</button>
          <p class="form-status" id="${P}st-${e.id}" role="status" aria-live="polite"></p>
        </form>
        ${contactLine(X, e.id, e.contact, r + ".contact")}
      </div>`;
  },
  form(X, s, e) {
    const P = X.idp, r = er(s, e), inert = X.edit ? ' tabindex="-1" readonly' : "";
    return `<form class="signup notify" data-list="${e.list}" data-ok="${esc(e.okText || "Got it.")}" novalidate>
        <div class="field" style="flex-basis: 260px">${tf(X, "label", "", r + ".label", e.label || "Your email", { ph: "Label", attrs: ` for="${P}em-${e.id}"` })}<input class="input" id="${P}em-${e.id}" name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@scu.edu" aria-describedby="${P}st-${e.id}"${inert}></div>
        <button class="btn btn-primary" type="submit"${X.edit ? ' tabindex="-1"' : ""}>${tf(X, "span", "", r + ".buttonLabel", e.buttonLabel || "Notify me", { ph: "Button" })}</button>
        <p class="form-status" id="${P}st-${e.id}" role="status" aria-live="polite"></p>
      </form>`;
  },
  callout(X, s, e) {
    const r = er(s, e);
    return `<div class="teaser"${e.color === "yellow" ? ' style="background: var(--sticky)"' : ""}><span class="tape yellow" aria-hidden="true"></span><div class="teaser-copy">${tf(X, "h2", "h-sub", r + ".title", e.title, { ph: "Title" })}${e.showEmail ? contactLine(X, e.id, e.body, r + ".body", "font-size: 16px") : tf(X, "p", "muted", r + ".body", e.body, { optional: true, ph: "One line" })}</div></div>`;
  },
  list: listHTML
};

function boxStyle(e, z) {
  const d = e.d, m = e.m;
  let v = `--x:${d.x};--y:${d.y};--w:${d.w};--z:${z}`;
  if (m) v += `;--mx:${m.x};--my:${m.y};--mw:${m.w}`;
  if (e.r) v += `;--r:${e.r}`;
  if (e.k != null) v += `;--k:${e.k}`;
  if (e.mk != null) v += `;--mk:${e.mk}`;
  if (e.type === "image") v += `;--ar:${e.ar}`;
  return v;
}
const boxAttr = (b) => [b.x, b.y, b.w, b.h].join(",");
const boxAttrs = (e) => ` data-d="${boxAttr(e.d)}"${e.m ? ` data-m="${boxAttr(e.m)}"` : ""}`;
function elHTML(X, s, e, z, ctx) {
  const cls = `el el-${e.type}${e.type === "list" ? " ls-" + e.src : ""}${e.mHide ? " m-hide" : ""}${e.m ? "" : " m-auto"}${e.type === "doodle" && e.faint ? " is-faint" : ""}`;
  let id = "";
  if (e.type === "signup" && e.list === "weekly" && ctx && !ctx.weekly) { ctx.weekly = true; id = ` id="${X.idp}join"`; }
  return `<div class="${cls}"${id} data-eid="${e.id}"${X.exp ? boxAttrs(e) : ""} style="${boxStyle(e, z)}"${e.type === "doodle" ? ' aria-hidden="true"' : ""}>${RX[e.type](X, s, e, ctx)}</div>`;
}
/* Reading order for screen readers and the keyboard: columns and rows of the desktop layout, top to bottom
   and left to right. Doodles are decoration and go last. */
function xyOrder(els) {
  const items = els.filter((e) => e.type !== "doodle").map((e) => ({ e, a: { x0: e.d.x, x1: e.d.x + e.d.w, y0: e.d.y, y1: e.d.y + Math.max(1, e.d.h) } }));
  const cut = (list, depth) => {
    if (list.length <= 1 || depth > 16) return list;
    for (const ax of ["y", "x"]) {
      const lo = ax + "0", hi = ax + "1";
      const groups = [];
      let cur = [], end = -Infinity;
      list.slice().sort((p, q) => p.a[lo] - q.a[lo]).forEach((it) => {
        if (cur.length && it.a[lo] >= end - 2) { groups.push(cur); cur = []; end = -Infinity; }
        cur.push(it);
        end = Math.max(end, it.a[hi]);
      });
      if (cur.length) groups.push(cur);
      if (groups.length > 1) return groups.flatMap((g) => cut(g, depth + 1));
    }
    return list.slice().sort((p, q) => p.a.y0 - q.a.y0 || p.a.x0 - q.a.x0);
  };
  return cut(items, 0).map((it) => it.e).concat(els.filter((e) => e.type === "doodle"));
}
function sectionHTML(X, s, ctx) {
  const z = new Map(s.elements.map((e, i) => [e.id, i + 1]));
  const els = xyOrder(s.elements).map((e) => elHTML(X, s, e, z.get(e.id), ctx));
  if (X.exp) return `<section class="fsec bg-${s.bg}" data-sid="${s.id}" style="--h: ${s.h};--mh: ${s.mh}"><div class="fsec-inner">\n${els.map((h) => "  " + h + "\n").join("")}</div></section>`;
  return `<section class="fsec bg-${s.bg}" data-sid="${s.id}" style="--h:${s.h};--mh:${s.mh}"><div class="fsec-inner">${els.join("")}</div></section>`;
}
function pageMain(X, page) {
  const list = X.C[page].sections, ctx = { page, weekly: false };
  const empty = X.edit && !list.length ? '<div class="wrap"><p class="ce-hint">This page is empty. Add a section from the Add panel.</p></div>' : "";
  const nl = X.exp ? "\n" : "";
  return `<main id="${X.idp}view-${page}" class="view is-free${X.animate ? " view-in" : ""}">${nl}${list.map((s) => sectionHTML(X, s, ctx)).join(nl)}${empty}${nl}</main>`;
}
function headerHTML(X, view) {
  const P = X.idp, ti = X.edit ? ' tabindex="-1"' : "";
  const nav = PAGES.slice(1).map((p) => `<a href="${esc(out(X, "#" + p.id))}"${ti}${p.id === view ? ' aria-current="page"' : ""}>${p.label}</a>`).join("");
  return `<header class="site-header">
  <div class="header-inner">
    <a class="brand" href="${esc(out(X, "#home"))}"${ti}><img src="/assets/clip-mark.png" alt="CLIP home" width="60" height="44"></a>
    <nav class="nav" id="${P}site-nav" aria-label="Pages">${nav}</nav>
    <a class="btn btn-primary btn-sm header-cta" href="${esc(out(X, "#join"))}"${ti}>Join CLIP</a>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="${P}site-nav"${ti}>
      <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true"><path d="M1 2H17M1 7H17M1 12H17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <span>Menu</span>
    </button>
  </div>
</header>`;
}
function instaHTML(X) {
  const raw = str(X.C.settings.instagram).trim();
  if (X.edit) return raw ? tf(X, "span", "", "G.instagram", raw, { ph: "Instagram handle" }) : "";
  if (!raw) return "";
  const m = raw.match(/^@?([A-Za-z0-9._]{1,30})$/);
  if (m) return `<a href="https://www.instagram.com/${m[1]}/" target="_blank" rel="noopener noreferrer">Instagram @${esc(m[1])}</a>`;
  return `<span>Instagram ${fmt(raw)}</span>`;
}
function footerHTML(X) {
  const s = X.C.settings;
  return `<footer class="site-footer">
  <div class="foot-brand">
    <img src="/assets/clip-mark.png" alt="CLIP" width="55" height="40">
    ${tf(X, "p", "", "G.footerBlurb", s.footerBlurb, { optional: true, multi: true, ph: "Footer text" })}
  </div>
  <div class="foot-contact">
    ${tf(X, "span", "addr", "G.contactEmail", emailOf(X), { ph: "Club email" })}
    ${instaHTML(X)}
    ${X.editor ? '<a class="foot-edit" href="#admin">Edit site</a>' : ""}
  </div>
  <p class="foot-page"><svg width="34" height="17" aria-hidden="true"><use href="#capsule"/></svg><svg width="16" height="16" aria-hidden="true"><use href="#tablet"/></svg>${tf(X, "span", "", "G.footerNote", s.footerNote, { optional: true, ph: "Corner label" })}</p>
</footer>`;
}
const shellHTML = (X, view, body) => `<div class="page">${headerHTML(X, view)}${body}<div class="wrap">${footerHTML(X)}</div></div>`;

export { svgI, SL, ICON, ARROW, TICK, MASCOT, emailOf, er, tf, linkHTML, contactLine, listHTML, RX, boxStyle, elHTML, xyOrder, sectionHTML, pageMain, headerHTML, instaHTML, footerHTML, shellHTML };
