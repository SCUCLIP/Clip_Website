/* Text helpers shared by the Worker (rendering, validation) and the editor.

   Content has two kinds of text:
   - plain: stored as typed. Escaped when rendered.
   - rich: a small HTML fragment. Only these tags survive: <br>, <b>, <i>, <sub>, <sup> and <span class="hl">.
     Everything else is escaped, so it shows as text and never as markup.
   In both, a part in [square brackets] is a placeholder for content nobody has written yet. It renders as
   <span class="ph">[…]</span>, and Ask CLIP says "(not posted yet)" instead of reading it out. */

const TEXT_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const ATTR_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const HEAD_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };

/** Escape text for an element's content. */
export const escapeText = (s) => String(s ?? "").replace(/[&<>]/g, (c) => TEXT_ESC[c]);
/** Escape text for a double-quoted attribute value. */
export const escapeAttr = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ATTR_ESC[c]);
/** Escape the page title and meta description (also escapes apostrophes, like the original export). */
export const escapeHead = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => HEAD_ESC[c]);

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** Decode the entities an HTML fragment is likely to hold. Unknown entities are left as they are. */
export function decodeEntities(s) {
  return String(s ?? "").replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,6});/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : m;
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/* Control characters (other than tab and newline) never belong in content. */
const CONTROL = new RegExp("[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]", "g");
export const stripControl = (s) => String(s ?? "").replace(/\r\n?/g, "\n").replace(CONTROL, "");

const OPEN = { b: "<b>", i: "<i>", sub: "<sub>", sup: "<sup>", hl: '<span class="hl">' };
const CLOSE = { b: "</b>", i: "</i>", sub: "</sub>", sup: "</sup>", hl: "</span>" };

/** Turn any string into the canonical rich-text form. Idempotent: sanitizeRich(sanitizeRich(x)) === sanitizeRich(x). */
export function sanitizeRich(input) {
  const s = stripControl(input).replace(/\n/g, "<br>");
  const re = /<[^<>]*>/g;
  const stack = [];
  let out = "", last = 0, m;
  while ((m = re.exec(s))) {
    out += escapeText(decodeEntities(s.slice(last, m.index)));
    last = re.lastIndex;
    const tag = m[0].toLowerCase().replace(/\s+/g, " ").replace(/'/g, '"');
    let t;
    if (/^<br ?\/?>$/.test(tag)) { out += "<br>"; continue; }
    if ((t = /^<(b|i|sub|sup)>$/.exec(tag))) { if (stack.length < 8) { stack.push(t[1]); out += OPEN[t[1]]; } continue; }
    if (tag === '<span class="hl">') { if (stack.length < 8) { stack.push("hl"); out += OPEN.hl; } continue; }
    if ((t = /^<\/(b|i|sub|sup|span)>$/.exec(tag))) {
      const name = t[1] === "span" ? "hl" : t[1];
      const at = stack.lastIndexOf(name);
      if (at !== -1) while (stack.length > at) out += CLOSE[stack.pop()];
      continue;
    }
    out += escapeText(decodeEntities(m[0]));
  }
  out += escapeText(decodeEntities(s.slice(last)));
  while (stack.length) out += CLOSE[stack.pop()];
  /* Drop empty pairs like <b></b> so the same text always has one form. */
  let prev;
  do { prev = out; out = out.replace(/<(b|i|sub|sup)><\/\1>|<span class="hl"><\/span>/g, ""); } while (out !== prev);
  return out;
}

/** Rich text to plain text (tags removed, entities decoded, line breaks become spaces). */
export function richToPlain(html) {
  return decodeEntities(String(html ?? "").replace(/<br>/g, " ").replace(/<[^<>]*>/g, ""));
}

/** Wrap [placeholders] in an already-escaped HTML fragment. */
export const wrapPlaceholders = (html) => String(html).replace(/\[[^\[\]<>]*\]/g, (p) => `<span class="ph">${p}</span>`);

/** Render a plain field as HTML content. */
export const plainHtml = (s) => wrapPlaceholders(escapeText(s));
/** Render a rich field as HTML content. Sanitizes again, so render never trusts its input. */
export const richHtml = (s) => wrapPlaceholders(sanitizeRich(s));
/** True when the text is empty or only a [placeholder]. */
export const isPlaceholder = (s) => /^\s*(\[[^\]]*\]\s*)*$/.test(String(s ?? ""));
