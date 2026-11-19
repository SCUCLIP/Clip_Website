/* The content model, shared by the Worker and the editor. Ported from prototype/clip-website.html
   (its "Platform and helpers" and "Content model" parts), kept as close to the original as possible.
   Changes from the prototype: links are https:// or #page only, and photos live at /photos/<id>.

   Page docs are { v: 5, sections: [...] }; "data" holds the shared lists and "settings" the contact and footer
   text. norm() repairs any doc into that shape and never throws, so what it returns is what gets stored. */

const CLUB_EMAIL = "connectingleaders@scu.edu";
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ESC[ch]);
const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);
const fmt = (s) => esc(str(s).trim()).replace(/\[([^\]\n]{1,80})\]/g, '<span class="ph">[$1]</span>').replace(/\n/g, "<br>");
const clone = (x) => JSON.parse(JSON.stringify(x == null ? null : x));
const uid = (p) => p + Math.random().toString(36).slice(2, 9);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1 = (v) => Math.round(v * 10) / 10;
function canon(x) {
  if (Array.isArray(x)) return "[" + x.map(canon).join(",") + "]";
  if (x && typeof x === "object") return "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + canon(x[k])).join(",") + "}";
  return JSON.stringify(x === undefined ? null : x);
}
function safeHref(u) {
  u = str(u).trim();
  if (/^#[A-Za-z][\w-]*$/.test(u)) return u;
  if (/^https:\/\/[^\s"'<>]+$/i.test(u)) return u;
  return "";
}
const isExternal = (href) => /^https?:/i.test(href);
const BLOB_RE = /^[A-Za-z0-9_-]{8,80}$/;
const blobSrc = (id) => (BLOB_RE.test(str(id)) ? "/photos/" + str(id) : "");
function initials(name) {
  const n = str(name).replace(/\[[^\]]*\]/g, "").trim();
  if (!n) return "?";
  const w = n.split(/\s+/).filter((x) => !/^(dr|prof|mr|ms|mrs)\.?$/i.test(x));
  if (!w.length) return "?";
  return ((w[0][0] || "") + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase();
}
const key = (k) => (/^\d+$/.test(k) ? +k : k);
const getPath = (obj, path) => (path === "" ? obj : path.split(".").reduce((o, k) => (o == null ? undefined : o[key(k)]), obj));
function setPath(obj, path, v) {
  const parts = path.split(".");
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) { o = o[key(parts[i])]; if (o == null) return false; }
  o[key(parts[parts.length - 1])] = v;
  return true;
}

/* ================= Content model =================
   A page is a stack of full-width sections. Each section holds freely placed elements, and every element has
   two boxes: d (desktop, inside a 1180px-wide design box) and m (phone, inside a 326px-wide box). The site
   scales the design box to fit the screen and shows the phone layout on screens narrower than 1000px.
   Heights in the boxes are measurements: text and lists grow with their content, and anything below them
   moves down by the same amount (see layoutSection). */
const DW = 1180, MW = 326, PHONE_BELOW = 1000;
const PAGES = [
  { id: "home", label: "Home" }, { id: "about", label: "About" }, { id: "events", label: "Events" },
  { id: "biohackathon", label: "Biohackathon" }, { id: "speakers", label: "Speakers" }, { id: "board", label: "Board" },
  { id: "resources", label: "Resources" }, { id: "faq", label: "FAQ" }
];
const VIEW_IDS = PAGES.map((p) => p.id);
const DOC_IDS = VIEW_IDS.concat(["data", "settings"]);
const pageLabel = (id) => (PAGES.find((p) => p.id === id) || { label: id }).label;
const pageNum = (id) => String(VIEW_IDS.indexOf(id) + 1).padStart(2, "0");
const FIGURES = {
  aspirin: { label: "Aspirin", html: '<svg width="128" height="118" role="img" aria-label="Skeletal structure of aspirin"><use href="#aspirin"/></svg>', cap: "fig. 2 · aspirin, C<sub>9</sub>H<sub>8</sub>O<sub>4</sub>" },
  chair: { label: "Cyclohexane chair", html: '<svg width="120" height="56" role="img" aria-label="Cyclohexane drawn in its chair conformation"><use href="#chair"/></svg>', cap: "fig. 3 · cyclohexane, chair" },
  tlc: { label: "TLC plate", html: '<svg width="64" height="106" role="img" aria-label="Thin-layer chromatography plate with two spots"><use href="#tlc"/></svg>', cap: "fig. 4 · TLC plate, R<sub>f</sub> 0.67 and 0.33" },
  rxn: { label: "Reaction scheme", html: '<div class="rxn" role="img" aria-label="Reaction scheme: idea, with caffeine and heat, gives a prototype"><span>idea</span><span class="rxn-arrow" aria-hidden="true"><span>+ caffeine</span><svg width="84" height="12" viewBox="0 0 84 12"><path d="M2 6H80M73 2L80 6L73 10" fill="none" stroke="#0E304C" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>heat</span></span><span>prototype</span></div>', cap: "fig. 5 · a reaction we're optimizing" },
  mortar: { label: "Mortar and pestle", html: '<svg width="84" height="74" role="img" aria-label="Mortar and pestle"><use href="#mortar"/></svg>', cap: "fig. 6 · mortar and pestle" },
  ballstick: { label: "Ball-and-stick model", html: '<svg width="112" height="68" role="img" aria-label="Ball-and-stick molecule model"><use href="#ballstick"/></svg>', cap: "fig. 7 · ball-and-stick model" },
  dose: { label: "Dose-response curve", html: '<svg width="138" height="87" role="img" aria-label="Sigmoid dose-response curve with the EC50 point marked"><use href="#dose"/></svg>', cap: "fig. 8 · dose-response curve, EC<sub>50</sub>" },
  sn2: { label: "SN2 mechanism", html: '<svg width="156" height="60" role="img" aria-label="SN2 mechanism: hydroxide attacks methyl bromide and bromide leaves"><use href="#sn2"/></svg>', cap: "fig. 9 · S<sub>N</sub>2, one step" }
};
const FIG_OPTS = Object.keys(FIGURES).map((k) => ({ v: k, l: FIGURES[k].label }));
const SYMS = {
  benzene: { label: "Benzene ring", vb: [88, 88] }, capsule: { label: "Capsule", vb: [44, 22] }, tablet: { label: "Tablet", vb: [22, 22] },
  aspirin: { label: "Aspirin", vb: [76, 70] }, chair: { label: "Chair", vb: [60, 28] }, tlc: { label: "TLC plate", vb: [40, 66] },
  mortar: { label: "Mortar", vb: [52, 46] }, ballstick: { label: "Molecule", vb: [70, 42] }, dose: { label: "Curve", vb: [92, 58] },
  sn2: { label: "SN2", vb: [104, 40] }, flask: { label: "Mascot", vb: [82, 92] }, arrow: { label: "Pen arrow", vb: [56, 44] }
};
const SYM_OPTS = Object.keys(SYMS).map((k) => ({ v: k, l: SYMS[k].label }));
const ARROW_PATH = '<path d="M52 38C36 40 18 32 10 12" fill="none" stroke="#B8343F" stroke-width="2.2" stroke-linecap="round"/><path d="M4 19L9 9L19 15" fill="none" stroke="#B8343F" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
/* Text styles. Sizes are fixed per layout so that text wraps the same way for every visitor (d: desktop, m: phone). */
const KINDS = {
  hero: { label: "Hero title", d: 85, m: 56, tag: "h1" },
  big: { label: "Huge title", d: 93, m: 60, tag: "h1" },
  page: { label: "Page title", d: 74, m: 54, tag: "h1" },
  section: { label: "Section heading", d: 56, m: 44, tag: "h2" },
  sub: { label: "Small heading", d: 42, m: 36, tag: "h2" },
  hand: { label: "Handwriting", d: 27, m: 27, tag: "p" },
  lede: { label: "Intro paragraph", d: 20, m: 18, tag: "p" },
  body: { label: "Paragraph", d: 18, m: 18, tag: "p" },
  small: { label: "Small text", d: 16, m: 16, tag: "p" },
  eyebrow: { label: "Label line", d: 13, m: 13, tag: "p" }
};
const KIND_OPTS = Object.keys(KINDS).map((k) => ({ v: k, l: KINDS[k].label }));
const COLOR_OPTS = [{ v: "", l: "Style default" }, { v: "ink", l: "Navy" }, { v: "muted", l: "Soft navy" }, { v: "pen", l: "Red pen" }, { v: "teal", l: "Teal" }];
const ALIGN_OPTS = [{ v: "left", l: "Left" }, { v: "center", l: "Center" }, { v: "right", l: "Right" }];
const BG_OPTS = [{ v: "none", l: "Graph paper" }, { v: "blue", l: "Blue wash" }, { v: "yellow", l: "Yellow wash" }];
const fontPx = (e, mode) => {
  const K = KINDS[e.kind] || KINDS.body;
  if (!e.fs) return mode === "m" ? K.m : K.d;
  return mode === "m" ? Math.round(e.fs * K.m / K.d) : e.fs;
};

/* Lists. Shared lists live in the "data" doc and feed every list element that shows them, on any page. */
const LISTS = {
  events: { shared: true, label: "Events", item: "Event", title: "name", max: 30, empty: "New events go out in the weekly email first.", fields: [
    { k: "name", t: "text", label: "Event name" },
    { k: "month", t: "text", label: "Month on the date tag", help: "Short, like Nov. For a weekly event, try Every." },
    { k: "day", t: "text", label: "Day on the date tag", help: "Like 14, or week." },
    { k: "time", t: "text", label: "Time" },
    { k: "location", t: "text", label: "Place" },
    { k: "description", t: "textarea", label: "One line on what happens", rows: 2 },
    { k: "linkLabel", t: "text", label: "Link text", help: "Like RSVP. Shows where the list has links turned on." },
    { k: "linkUrl", t: "url", label: "Link address", help: "A full link starting with https://, or a page here like #join." }
  ], make: () => ({ name: "[Event name]", month: "[Mon]", day: "[00]", time: "[Time]", location: "[Place]", description: "[One line on what happens]", linkLabel: "[RSVP link]", linkUrl: "" }) },
  past: { shared: true, label: "Past events", item: "Past event", title: "what", max: 80, empty: "Past events show up here.", fields: [
    { k: "when", t: "text", label: "When", help: "Like Sept 2026." },
    { k: "what", t: "text", label: "What happened" }
  ], make: () => ({ when: "[Month]", what: "[What happened]" }) },
  speakers: { shared: true, label: "Speakers", item: "Speaker", title: "name", max: 60, empty: "Speaker photos go up after each talk.", fields: [
    { k: "name", t: "text", label: "Name" },
    { k: "when", t: "text", label: "When they spoke", help: "Like Sept 2026." },
    { k: "role", t: "text", label: "Title and organization" },
    { k: "topic", t: "text", label: "Talk topic" },
    { k: "photo", t: "image", label: "Photo" }
  ], make: () => ({ name: "[Speaker name]", when: "[Month year]", role: "[Title, organization]", topic: "[Talk topic]", photo: "" }) },
  members: { shared: true, label: "Board members", item: "Member", title: "name", max: 20, empty: "The board goes up here.", fields: [
    { k: "name", t: "text", label: "Name" },
    { k: "role", t: "text", label: "Role" },
    { k: "photo", t: "image", label: "Photo", help: "Without a photo, the card shows initials." }
  ], make: () => ({ name: "[Name]", role: "[Role]", photo: "" }) },
  highlights: { shared: true, label: "Highlights", item: "Highlight", title: "title", max: 10, empty: "", fields: [
    { k: "title", t: "text", label: "Heading" },
    { k: "body", t: "textarea", label: "Text", rows: 2 }
  ], make: () => ({ title: "[Heading]", body: "[A line about it]" }) },
  faq: { label: "Questions", item: "Question", title: "q", max: 40, empty: "", fields: [{ k: "q", t: "text", label: "Question" }, { k: "a", t: "textarea", label: "Answer", rows: 3 }], make: () => ({ q: "[Question]", a: "[Answer]" }) },
  roles: { label: "Roles", item: "Role", title: "title", max: 16, empty: "", fields: [{ k: "title", t: "text", label: "Role" }, { k: "duties", t: "textarea", label: "What they do", rows: 3 }], make: () => ({ title: "[Role]", duties: "[What this person does]" }) },
  cards: { label: "Index cards", item: "Card", title: "title", max: 16, empty: "", fields: [{ k: "title", t: "text", label: "Title" }, { k: "body", t: "textarea", label: "Text", rows: 3 }, { k: "linkLabel", t: "text", label: "Link text" }, { k: "linkUrl", t: "url", label: "Link address" }], make: () => ({ title: "[Card title]", body: "[A line or two]", linkLabel: "", linkUrl: "" }) },
  status: { label: "Status cards", item: "Card", title: "title", max: 12, empty: "", fields: [{ k: "title", t: "text", label: "Heading" }, { k: "body", t: "textarea", label: "Text", rows: 3 }, { k: "state", t: "select", label: "Card style", options: [{ v: "pending", l: "Pending (dashed card)" }, { v: "ready", l: "Confirmed (solid card)" }] }], make: () => ({ title: "[Heading]", body: "[Details]", state: "pending" }) },
  steps: { label: "Steps", item: "Step", title: "t", max: 12, empty: "", fields: [{ k: "t", t: "text", label: "Step" }], make: () => ({ t: "[Step]" }) },
  chips: { label: "Chips", item: "Chip", title: "t", max: 30, empty: "", fields: [{ k: "t", t: "text", label: "Chip" }], make: () => ({ t: "[Chip]" }) }
};
const LIST_ORDER = ["events", "past", "speakers", "members", "highlights", "faq", "roles", "cards", "status", "steps", "chips"];
const DATA_FIELDS = LIST_ORDER.filter((k) => LISTS[k].shared).map((k) => Object.assign({ k, t: "list" }, LISTS[k]));
const SETTINGS_FIELDS = [
  { k: "contactEmail", t: "text", label: "Club email", help: "Shows in the footer and in every email line." },
  { k: "instagram", t: "text", label: "Instagram handle", help: "Like @scuclip. It turns into a link once it has no brackets." },
  { k: "footerBlurb", t: "textarea", label: "Footer text", rows: 3 },
  { k: "footerNote", t: "text", label: "Small label in the footer corner", help: "Like Notebook 2026-27." }
];
function listFields(src) {
  const L = LISTS[src];
  if (!L) return [];
  const f = [];
  if (src === "events" || src === "speakers") f.push({ k: "limit", t: "select", label: "How many to show", options: [{ v: "all", l: "All of them" }, { v: "3", l: "First 3" }, { v: "6", l: "First 6" }] });
  if (src === "events") f.push({ k: "showLinks", t: "check", label: "Show each event's link" });
  if (src === "chips") f.push({ k: "more", t: "text", label: "Dashed chip at the end", help: "Like and beyond. Leave it empty to hide it." });
  if (!L.shared) f.push({ k: "items", t: "list", label: L.label, item: L.item, title: L.title, max: L.max, fields: L.fields, make: L.make });
  if (L.empty || src === "past") f.push({ k: "empty", t: "text", label: "Message when the list is empty" });
  return f;
}
const listMake = (src) => {
  const L = LISTS[src];
  const o = { src, limit: "all", showLinks: true, more: "", empty: L.empty };
  if (!L.shared) o.items = src === "cards" || src === "steps" ? [1, 2, 3].map(() => L.make()) : [L.make()];
  return o;
};

const LINK_FIELDS = [{ k: "label", t: "text", label: "Text" }, { k: "url", t: "url", label: "Link", help: "A full link starting with https://, or a page here like #events." }];
const LIST_SIGNUP = { k: "list", t: "select", label: "Sign-up list", options: [{ v: "weekly", l: "Weekly email" }, { v: "biohackathon", l: "Biohackathon announcement" }] };
/* Element types. size: how the box sets its size. "w" sets the width and the height follows the content,
   "ar" keeps the drawing's proportions, "img" sets width and shape, "k" scales the whole thing, "auto" fits its text. */
const EL = {
  text: { label: "Text", size: "w", rot: true, minW: 24, fields: [
    { k: "text", t: "textarea", label: "Text", rows: 3 },
    { k: "hl", t: "text", label: "Highlighted words", help: "Shown after the text with the yellow marker. Leave it empty for none." },
    { k: "kind", t: "select", label: "Style", options: KIND_OPTS },
    { k: "color", t: "select", label: "Color", options: COLOR_OPTS },
    { k: "fs", t: "num", label: "Font size", min: 0, max: 240, help: "0 uses the style's own size. Phones get a matching smaller size." },
    { k: "align", t: "select", label: "Alignment", options: ALIGN_OPTS },
    { k: "rule", t: "check", label: "Dashed line above" }
  ], make: () => ({ text: "[Write something]", hl: "", kind: "body", color: "", fs: 0, align: "left", rule: false }) },
  image: { label: "Photo", size: "img", rot: true, minW: 48, fields: [
    { k: "src", t: "image", label: "Photo", logo: true },
    { k: "caption", t: "text", label: "Caption" },
    { k: "frame", t: "select", label: "Frame", options: [{ v: "polaroid", l: "White border, handwritten caption" }, { v: "card", l: "Card with a figure label" }, { v: "plain", l: "No frame" }] },
    { k: "ar", t: "ratio", label: "Shape", options: [{ v: 1.5, l: "Wide (3:2)" }, { v: 1.3333, l: "Standard (4:3)" }, { v: 1, l: "Square" }, { v: 0.75, l: "Tall (3:4)" }, { v: 1.7778, l: "Very wide (16:9)" }] },
    { k: "tape", t: "check", label: "Tape strip on top" },
    { k: "alt", t: "text", label: "Description for screen readers", help: "Say what the photo shows." }
  ], make: () => ({ src: "", caption: "[Caption]", frame: "polaroid", ar: 1.5, tape: false, alt: "" }) },
  button: { label: "Button", size: "w", rot: true, minW: 56, fields: [...LINK_FIELDS, { k: "style", t: "select", label: "Style", options: [{ v: "primary", l: "Filled" }, { v: "secondary", l: "Outline" }] }], make: () => ({ label: "Join CLIP", url: "#join", style: "primary" }) },
  link: { label: "Link", size: "auto", rot: false, fields: LINK_FIELDS, make: () => ({ label: "See all", url: "#events" }) },
  doodle: { label: "Doodle", size: "ar", rot: true, minW: 8, fields: [{ k: "sym", t: "select", label: "Drawing", options: SYM_OPTS }, { k: "faint", t: "check", label: "Faint (half see-through)" }], make: () => ({ sym: "benzene", faint: false }) },
  note: { label: "Sticky note", size: "w", rot: true, minW: 90, fields: [{ k: "text", t: "textarea", label: "Note", rows: 3 }, { k: "color", t: "select", label: "Color", options: [{ v: "yellow", l: "Yellow" }, { v: "blue", l: "Blue" }] }], make: () => ({ text: "[Write a note]", color: "yellow" }) },
  stamp: { label: "Stamp", size: "k", rot: true, fields: [{ k: "text", t: "textarea", label: "Stamp text", rows: 2 }], make: () => ({ text: "Status\nsoon" }) },
  figure: { label: "Figure", size: "k", rot: true, fields: [{ k: "fig", t: "select", label: "Figure", options: FIG_OPTS }], make: () => ({ fig: "aspirin" }) },
  entry: { label: "Entry line", size: "w", rot: false, minW: 160, fields: [
    { k: "tag", t: "text", label: "Entry number", help: "Like Entry 003." },
    { k: "label", t: "text", label: "Label" },
    { k: "pg", t: "pg", label: "Right side", help: "This page's number, or a link to another page." }
  ], make: () => ({ tag: "Entry 0XX", label: "[Label]", pg: "this" }) },
  contact: { label: "Email line", size: "w", rot: false, minW: 160, fields: [{ k: "lead", t: "text", label: "Line before the club email" }], make: () => ({ lead: "Questions?" }) },
  line: { label: "Line", size: "w", rot: true, minW: 16, fields: [{ k: "style", t: "select", label: "Style", options: [{ v: "dashed", l: "Dashed" }, { v: "solid", l: "Solid" }] }], make: () => ({ style: "dashed" }) },
  signup: { label: "Sign-up note", size: "w", rot: true, minW: 280, fields: [
    LIST_SIGNUP,
    { k: "eyebrow", t: "text", label: "Small line at the top" },
    { k: "title", t: "text", label: "Title" },
    { k: "body", t: "textarea", label: "Text", rows: 2 },
    { k: "buttonLabel", t: "text", label: "Button text" },
    { k: "okText", t: "text", label: "Message after someone signs up" },
    { k: "contact", t: "text", label: "Line before the club email" }
  ], make: () => ({ list: "weekly", eyebrow: "Sign-up sheet", title: "Get the weekly email", body: "", buttonLabel: "Sign up", okText: "You're on the list. Watch for the weekly email.", contact: "Questions?" }) },
  form: { label: "Email form", size: "w", rot: false, minW: 240, fields: [
    LIST_SIGNUP,
    { k: "label", t: "text", label: "Label above the email box" },
    { k: "buttonLabel", t: "text", label: "Button text" },
    { k: "okText", t: "text", label: "Message after someone signs up" }
  ], make: () => ({ list: "biohackathon", label: "Get the announcement", buttonLabel: "Notify me", okText: "Got it. We'll email you when the details are out." }) },
  callout: { label: "Callout note", size: "w", rot: true, minW: 240, fields: [
    { k: "title", t: "text", label: "Title" },
    { k: "body", t: "text", label: "Line before the email" },
    { k: "showEmail", t: "check", label: "Show the club email with a Copy button" },
    { k: "color", t: "select", label: "Note color", options: [{ v: "blue", l: "Blue" }, { v: "yellow", l: "Yellow" }] }
  ], make: () => ({ title: "[A question or a call to action]", body: "[One line]", showEmail: true, color: "blue" }) },
  list: { label: "List", size: "w", rot: false, minW: 160, fields: null }
};
const fieldsOf = (e) => (e.type === "list" ? listFields(e.src) : EL[e.type].fields);
const hasText = (e) => !["doodle", "line", "figure"].includes(e.type) && !(e.type === "image" && e.frame === "plain" && !e.caption);
function elName(e) {
  if (e.type === "list") return (LISTS[e.src] || { label: "List" }).label + " list";
  if (e.type === "text") return KINDS[e.kind] ? KINDS[e.kind].label : "Text";
  if (e.type === "doodle") return (SYMS[e.sym] || { label: "Doodle" }).label;
  if (e.type === "image" && e.src === "logo") return "Logo";
  return EL[e.type].label;
}
function elSnippet(e) {
  const t = str(e.text || e.title || e.label || e.caption || e.tag || e.lead || "").replace(/\[|\]/g, "").replace(/\s+/g, " ").trim();
  return t.length > 26 ? t.slice(0, 25) + "…" : t;
}

function normFields(fields, src) {
  const s = src && typeof src === "object" && !Array.isArray(src) ? src : {};
  const out = {};
  fields.forEach((f) => {
    const v = s[f.k];
    if (f.t === "list") out[f.k] = arr(v).slice(0, f.max || 40).map((it) => normFields(f.fields, typeof it === "string" ? { t: it } : it));
    else if (f.t === "select") out[f.k] = f.options.some((o) => o.v === v) ? v : f.options[0].v;
    else if (f.t === "ratio") { const n = Number(v); out[f.k] = Number.isFinite(n) ? Math.round(clamp(n, 0.25, 4) * 10000) / 10000 : f.options[0].v; }
    else if (f.t === "num") { const n = Number(v); out[f.k] = Number.isFinite(n) ? Math.round(clamp(n, f.min, f.max)) : 0; }
    else if (f.t === "check") out[f.k] = v === true;
    else if (f.t === "page") out[f.k] = VIEW_IDS.includes(v) ? v : "";
    else if (f.t === "pg") out[f.k] = v === "this" || VIEW_IDS.includes(v) ? v : "";
    else if (f.t === "image") out[f.k] = (f.logo && v === "logo") || BLOB_RE.test(str(v)) ? v : "";
    else out[f.k] = str(v).slice(0, 4000);
  });
  return out;
}
const ID_RE = /^[A-Za-z0-9]{3,24}$/;
const numIn = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? r1(clamp(v, lo, hi)) : d; };
function normBox(b, maxW) {
  if (!b || typeof b !== "object") return null;
  return { x: numIn(b.x, -400, maxW + 400, 0), y: numIn(b.y, -200, 40000, 0), w: numIn(b.w, 4, maxW + 400, 100), h: numIn(b.h, 0, 40000, 40) };
}
function normElement(e, i, seen) {
  if (!e || typeof e !== "object" || !EL[e.type]) return null;
  if (e.type === "list" && !LISTS[e.src]) return null;
  let id = ID_RE.test(str(e.id)) ? e.id : "e" + i + "x";
  while (seen.has(id)) id += "d";
  seen.add(id);
  const out = Object.assign({ id, type: e.type }, e.type === "list" ? { src: e.src } : {}, normFields(fieldsOf(e), e));
  if (e.type === "list") { if (!("limit" in out)) out.limit = "all"; if (!("empty" in out)) out.empty = ""; }
  if (e.type === "text" && !KINDS[out.kind]) out.kind = "body";
  out.d = normBox(e.d, DW) || { x: 0, y: 0, w: 200, h: 40 };
  out.m = normBox(e.m, MW);
  out.mHide = e.mHide === true;
  out.r = numIn(e.r, -180, 180, 0);
  if (EL[e.type].size === "k") {
    const k = Number(e.k), mk = e.mk == null ? NaN : Number(e.mk);
    out.k = Number.isFinite(k) ? Math.round(clamp(k, 0.2, 5) * 100) / 100 : 1;
    out.mk = Number.isFinite(mk) ? Math.round(clamp(mk, 0.2, 5) * 100) / 100 : null;
  }
  return out;
}
function normSection(s, i, seen, eseen) {
  if (!s || typeof s !== "object") return null;
  let id = ID_RE.test(str(s.id)) ? s.id : "s" + i + "x";
  while (seen.has(id)) id += "d";
  seen.add(id);
  return {
    id, h: numIn(s.h, 40, 20000, 400), mh: numIn(s.mh, 40, 40000, 400),
    bg: BG_OPTS.some((o) => o.v === s.bg) ? s.bg : "none",
    elements: arr(s.elements).slice(0, 150).map((e, j) => normElement(e, j, eseen)).filter(Boolean)
  };
}
const isPageDoc = (d) => !!d && typeof d === "object" && d.v === 5;
function norm(id, data) {
  if (id === "data") return normFields(DATA_FIELDS, data);
  if (id === "settings") return normFields(SETTINGS_FIELDS, data);
  const seen = new Set(), eseen = new Set();
  return { v: 5, sections: isPageDoc(data) ? arr(data.sections).slice(0, 60).map((s, i) => normSection(s, i, seen, eseen)).filter(Boolean) : [] };
}
const usableDoc = (id, d) => !!d && (!VIEW_IDS.includes(id) || isPageDoc(d));

export {
  CLUB_EMAIL, ESC, esc, str, arr, fmt, clone, uid, clamp, r1, canon, safeHref, isExternal, BLOB_RE, blobSrc,
  initials, key, getPath, setPath, DW, MW, PHONE_BELOW, PAGES, VIEW_IDS, DOC_IDS, pageLabel, pageNum, FIGURES,
  FIG_OPTS, SYMS, SYM_OPTS, ARROW_PATH, KINDS, KIND_OPTS, COLOR_OPTS, ALIGN_OPTS, BG_OPTS, fontPx, LISTS,
  LIST_ORDER, DATA_FIELDS, SETTINGS_FIELDS, listFields, listMake, LINK_FIELDS, LIST_SIGNUP, EL, fieldsOf,
  hasText, elName, elSnippet, normFields, ID_RE, numIn, normBox, normElement, normSection, isPageDoc, norm,
  usableDoc
};
