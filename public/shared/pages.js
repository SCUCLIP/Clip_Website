/* The site's pages and how stored links become real URLs. Shared by the Worker and the editor. */

/** Design box widths (px) and the screen width below which the phone layout is used. */
export const DW = 1180;
export const MW = 326;
export const PHONE_BELOW = 1000;

/** Every page, in nav order. "home" is served at "/", the others at "/<id>". */
export const PAGE_IDS = ["home", "about", "events", "biohackathon", "speakers", "board", "resources", "faq"];
export const PAGE_NAMES = {
  home: "Home", about: "About", events: "Events", biohackathon: "Biohackathon",
  speakers: "Speakers", board: "Board", resources: "Resources", faq: "FAQ",
};
/** Every content doc: the shared "site" doc plus one per page. */
export const DOC_IDS = ["site", ...PAGE_IDS];

export const isPageId = (id) => PAGE_IDS.includes(id);
export const pagePath = (id) => (id === "home" ? "/" : "/" + id);

/** Built-in images that content can point at (served from /assets/). */
export const ASSETS = ["clip-logo.png", "clip-mark.png"];

/* Stored links are one of:
   - "#about"  a page            -> "/about"   ("#home" -> "/")
   - "#join"   an anchor on Home -> "/#join"
   - "https://…" or "mailto:…"   -> unchanged
   Anything else is refused when a draft is saved, and renders as no link at all. */
export const HASH_LINK = /^#[a-z][a-z0-9-]{0,39}$/;

/** Turn a stored link into the URL the public site uses. Returns "" when there is no usable link. */
export function hrefFor(stored) {
  const v = String(stored ?? "").trim();
  if (!v) return "";
  if (HASH_LINK.test(v)) {
    const id = v.slice(1);
    return isPageId(id) ? pagePath(id) : "/" + v;
  }
  if (/^https:\/\/[^\s"<>]+$/i.test(v) || /^mailto:[^\s"<>]+$/i.test(v)) return v;
  return "";
}

/** Photos uploaded in the editor are stored by id and served from /photos/<id>. */
export const PHOTO_ID = /^[a-f0-9]{32}$/;
export const photoSrc = (id) => "/photos/" + id;
export const assetSrc = (name) => "/assets/" + name;
