/* What the Add panel offers. Each entry makes a new element (without id or position; the editor adds those).
   Sizes and font sizes follow the existing pages. Every new element goes through norm(), so missing fields
   get their defaults. */

const T = (kind, tag, fs, mfs, text, w, h, extra = {}) => ({ type: "text", kind, tag, fs, mfs, text, w, h, ...extra });
const L = (kind, items, w, h, mh) => ({ type: "list", kind, items, w, h, mh });

export const CATALOG = [
  { group: "Text", items: [
    { label: "Hero title", make: () => T("hero", "h1", 85, 56, 'A big <span class="hl">headline</span>', 660, 162) },
    { label: "Page title", make: () => T("page", "h1", 74, 54, "Page title", 700, 73) },
    { label: "Section title", make: () => T("section", "h2", 56, 44, "Section title", 500, 56) },
    { label: "Subheading", make: () => T("sub", "h2", 42, 36, "Subheading", 1180, 57, { rule: true }) },
    { label: "Eyebrow", make: () => T("eyebrow", "p", 13, 13, "Entry 000 · Label", 420, 21) },
    { label: "Lede", make: () => T("lede", "p", 20, 18, "One or two sentences that set up the section.", 690, 64) },
    { label: "Body text", make: () => T("body", "p", 18, 18, "A paragraph of body text.", 590, 58) },
    { label: "Small text", make: () => T("small", "p", 16, 16, "A short note.", 448, 26) },
    { label: "Handwriting", make: () => T("hand", "p", 27, 27, "a handwritten note", 340, 28, { color: "pen" }) },
  ] },
  { group: "Buttons and links", items: [
    { label: "Primary button", make: () => ({ type: "button", label: "Join CLIP", href: "#join", style: "primary", w: 136, h: 52 }) },
    { label: "Secondary button", make: () => ({ type: "button", label: "Read more", href: "#about", style: "secondary", w: 170, h: 52 }) },
    { label: "Arrow link", make: () => ({ type: "link", label: "See more", href: "#events", w: 150, h: 44 }) },
    { label: "Entry header", make: () => ({ type: "entry", num: "Entry 000", label: "Label", page: "See p. 00", href: "", w: 1180, h: 30 }) },
  ] },
  { group: "Photos", items: [
    { label: "Photo, card", make: () => ({ type: "image", frame: "card", tape: "blue", caption: "Fig. 0 · caption", alt: "", ar: 1.5, w: 340, h: 300 }) },
    { label: "Photo, polaroid", make: () => ({ type: "image", frame: "polaroid", tape: "yellow", caption: "a caption", alt: "", ar: 1, w: 260, h: 330 }) },
    { label: "Photo, plain", make: () => ({ type: "image", frame: "plain", caption: "", alt: "", ar: 1.5, w: 360, h: 240 }) },
    { label: "CLIP logo", make: () => ({ type: "image", frame: "card", tape: "blue", logo: true, asset: "clip-logo.png", iw: 359, ih: 371, ar: 0.9677, alt: "CLIP logo, Connecting Leaders in Innovation and Pharma", caption: "Fig. 1 · our logo", w: 330, h: 371 }) },
  ] },
  { group: "Notes", items: [
    { label: "Yellow note", make: () => ({ type: "note", color: "yellow", text: "a sticky note", w: 200, h: 80 }) },
    { label: "Blue note", make: () => ({ type: "note", color: "blue", text: "a sticky note", w: 200, h: 80 }) },
    { label: "Stamp", make: () => ({ type: "stamp", text: "Status<br>planning", k: 1, w: 200, h: 99, r: -8 }) },
    { label: "Dashed line", make: () => ({ type: "line", solid: false, w: 600, h: 14 }) },
    { label: "Solid line", make: () => ({ type: "line", solid: true, w: 600, h: 14 }) },
  ] },
  { group: "Drawings", items: [
    ...["flask", "flask-mini", "benzene", "capsule", "tablet", "tick", "arrow"].map((art) => ({
      label: { flask: "Flask mascot", "flask-mini": "Small flask", benzene: "Benzene ring", capsule: "Capsule", tablet: "Tablet", tick: "Tick", arrow: "Curly arrow" }[art],
      make: () => ({ type: "doodle", art, w: { flask: 96, "flask-mini": 60, benzene: 104, capsule: 48, tablet: 26, tick: 32, arrow: 56 }[art], h: 60 }),
    })),
    ...[["aspirin", "Aspirin", "Skeletal structure of aspirin"], ["chair", "Cyclohexane", "Cyclohexane drawn in its chair conformation"],
      ["tlc", "TLC plate", "Thin-layer chromatography plate"], ["mortar", "Mortar and pestle", "Mortar and pestle"],
      ["ballstick", "Ball and stick", "Ball-and-stick molecule model"], ["dose", "Dose-response", "Sigmoid dose-response curve"],
      ["sn2", "SN2", "SN2 mechanism"]].map(([art, label, alt]) => ({
      label: "Figure: " + label, make: () => ({ type: "figure", art, alt, caption: "fig. 0 · " + label.toLowerCase(), k: 1, w: 200, h: 120, r: -2 }),
    })),
    { label: "Figure: reaction", make: () => ({ type: "figure", art: "rxn", alt: "Reaction scheme", from: "idea", above: "+ caffeine", below: "heat", to: "prototype", caption: "fig. 0 · a reaction", k: 1, w: 276, h: 65, r: -2 }) },
  ] },
  { group: "Lists", items: [
    { label: "Highlights", make: () => L("highlights", [{ title: "A highlight", text: "One line about it." }, { title: "Another", text: "One line about it." }], 537, 240, 300) },
    { label: "Chips", make: () => L("chips", [{ text: "Biology" }, { text: "Chemistry" }, { text: "and beyond", more: true }], 577, 81, 120) },
    { label: "Cards", make: () => L("cards", [{ title: "Card", text: "A sentence or two." }, { title: "Card", text: "A sentence or two." }, { title: "Card", text: "A sentence or two." }], 1180, 184, 528) },
    { label: "Events", make: () => L("events", [{ month: "[Mon]", day: "[00]", name: "[Event name]", time: "[Time]", location: "[Location]", desc: "[One line on what happens]", linkLabel: "[RSVP link]" }], 1180, 174, 260) },
    { label: "Speakers", make: () => L("speakers", [{ name: "[Speaker name]", when: "[Month year]", title: "[Title, organization]", topic: "[Talk topic]" }], 1180, 394, 400) },
    { label: "Board members", make: () => L("members", [{ name: "First Last", role: "[Role]" }, { name: "First Last", role: "[Role]" }, { name: "First Last", role: "[Role]" }], 1180, 291, 480) },
    { label: "Roles", make: () => L("roles", [{ title: "Role", text: "What this role does." }], 1180, 90, 180) },
    { label: "Steps", make: () => L("steps", [{ text: "First" }, { text: "Second" }, { text: "Third" }], 1180, 67, 140) },
    { label: "Past events", make: () => L("past", [{ when: "[Month]", what: "[What happened]" }], 1180, 60, 100) },
    { label: "FAQ", make: () => L("faq", [{ q: "A question?", a: "Its answer." }], 1180, 70, 140) },
    { label: "Status cards", make: () => L("status", [{ title: "Part", tag: "Pending", text: "[Details]" }, { title: "Part", tag: "Pending", text: "[Details]" }], 1180, 130, 300) },
  ] },
  { group: "Forms and contact", items: [
    { label: "Sign-up sheet", make: () => ({ type: "signup", eyebrow: "Sign-up sheet · Newsletter", title: "Get the weekly email", body: "Event announcements, industry talks and research spotlights, once a week.", label: "SCU email", placeholder: "you@scu.edu", button: "Sign up", list: "weekly", ok: "You're on the list. Watch for the weekly email.", contact: "Questions?", w: 820, h: 408, mh: 595, r: -1 }) },
    { label: "Sign-up form", make: () => ({ type: "form", label: "Get the announcement", placeholder: "you@scu.edu", button: "Notify me", list: "weekly", ok: "Got it. We'll email you.", w: 560, h: 89, mh: 153 }) },
    { label: "Contact line", make: () => ({ type: "contact", text: "Email the board:", w: 1180, h: 36, mh: 64 }) },
    { label: "Callout", make: () => ({ type: "callout", title: "Know someone we should invite?", text: "Send us their name and what they work on.", w: 1180, h: 162, mh: 253 }) },
  ] },
];
