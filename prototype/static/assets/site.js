/* CLIP website, static pages.
   Each page's content is already in its HTML. This script does the rest:
   - scales the layout to the screen and switches to the phone layout below 1000px wide,
   - moves things down when text renders taller than designed (different fonts or browsers),
   - runs the phone menu, the Copy buttons, the sign-up forms and the Ask CLIP chat (FAQ answers). */
(() => {
  "use strict";
  const DW = 1180, MW = 326, PHONE_BELOW = 1000;
  const site = document.getElementById("site");
  const F = Object.assign({ email: "connectingleaders@scu.edu", faqs: [], members: [], speakers: [], events: [], hackLede: "", boardNote: "" }, window.CLIP_FACTS || {});
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const boxOf = (v) => (v ? v.split(",").map(Number) : null);

  /* ---------- Layout ---------- */
  /* Every element stores a desktop box (data-d) and a phone box (data-m) as x,y,width,height in design pixels.
     Desktop boxes sit in a 1180px-wide design box, phone boxes in a 326px one. CSS scales the box by --s. */
  function fit() {
    const W = site.clientWidth || window.innerWidth || DW;
    const mode = W < PHONE_BELOW ? "m" : "d";
    const g = clamp(W * 0.06, 32, 72);
    const s = Math.max(0.2, mode === "d" ? Math.min(1, (W - 2 * g) / DW) : Math.min(1.25, (W - 2 * g) / MW));
    site.classList.toggle("is-m", mode === "m");
    site.style.setProperty("--s", String(Math.round(s * 10000) / 10000));
    return mode;
  }
  function layout(mode) {
    $$(".fsec", site).forEach((sec) => {
      const H = parseFloat(sec.style.getPropertyValue(mode === "m" ? "--mh" : "--h")) || 0;
      const items = [], auto = [];
      $$(":scope > .fsec-inner > .el", sec).forEach((el) => {
        el.style.removeProperty("--py");
        if (mode === "m" && el.classList.contains("m-hide")) return;
        const b = boxOf(mode === "m" ? el.dataset.m : el.dataset.d);
        if (!b) { auto.push(el); return; }
        items.push({ el, x: b[0], y: b[1], h: b[3], ah: el.offsetHeight, aw: el.offsetWidth });
      });
      items.sort((a, b) => a.y - b.y || a.x - b.x);
      items.forEach((it, i) => {
        it.push = 0;
        for (let j = 0; j < i; j++) {
          const a = items[j];
          if (a.y + a.h > it.y + 2) continue;
          if (a.x >= it.x + it.aw - 1 || it.x >= a.x + a.aw - 1) continue;
          it.push = Math.max(it.push, a.push + Math.max(0, a.ah - a.h));
        }
      });
      let stored = 0, bottom = 0;
      items.forEach((it) => {
        if (it.push) it.el.style.setProperty("--py", it.push + "px");
        stored = Math.max(stored, it.y + it.h);
        bottom = Math.max(bottom, it.y + it.push + it.ah);
      });
      let rh = Math.max(H + Math.max(0, bottom - stored), bottom);
      if (auto.length) {
        let y = bottom ? bottom + 24 : 32;
        auto.forEach((el) => { el.style.setProperty("--mx", 0); el.style.setProperty("--my", y); el.style.setProperty("--mw", MW); y += el.offsetHeight + 24; });
        rh = Math.max(rh, y + 16);
      }
      sec.style.setProperty("--rh", String(Math.round(rh * 10) / 10));
    });
  }
  let mode = null;
  function relayout(force) {
    const m = fit();
    if (force || m !== mode) { mode = m; layout(m); }
  }
  relayout(true);
  if (window.ResizeObserver) new ResizeObserver(() => relayout(false)).observe(site);
  else window.addEventListener("resize", () => relayout(false));
  const toHash = () => { if (location.hash.length > 1) { const t = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (t) t.scrollIntoView({ behavior: "instant" }); } };
  if (document.fonts) {
    document.fonts.ready.then(() => { relayout(true); toHash(); });
    if (document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", () => relayout(true));
  }
  toHash();

  /* ---------- Phone menu ---------- */
  function closeMenu() {
    const hd = $(".site-header", site);
    if (!hd) return;
    hd.classList.remove("is-open");
    const b = $(".menu-btn", hd);
    if (b) b.setAttribute("aria-expanded", "false");
  }
  site.addEventListener("click", (ev) => {
    const mb = ev.target.closest(".menu-btn");
    if (!mb) return;
    const hd = mb.closest(".site-header"), open = !hd.classList.contains("is-open");
    hd.classList.toggle("is-open", open);
    mb.setAttribute("aria-expanded", open ? "true" : "false");
  });
  site.addEventListener("keydown", (ev) => {
    const hd = ev.key === "Escape" && $(".site-header.is-open", site);
    if (hd) { closeMenu(); $(".menu-btn", hd).focus(); }
  });

  /* ---------- Copy buttons ---------- */
  document.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-copy]");
    if (!btn) return;
    const text = btn.getAttribute("data-copy") || "";
    const label = btn.dataset.label || btn.textContent;
    btn.dataset.label = label;
    const flash = (msg) => { btn.textContent = msg; clearTimeout(btn._t); btn._t = setTimeout(() => { btn.textContent = label; }, 1600); };
    const selectTarget = () => {
      const el = document.getElementById(btn.getAttribute("data-copy-target") || "");
      if (!el) return flash("Copy failed");
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      flash("Selected");
    };
    try { navigator.clipboard.writeText(text).then(() => flash("Copied"), selectTarget); } catch (_) { selectTarget(); }
  });

  /* ---------- Sign-up forms (no server behind these pages yet) ---------- */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  site.addEventListener("input", (ev) => {
    const input = ev.target;
    if (input.getAttribute("aria-invalid") !== "true") return;
    input.removeAttribute("aria-invalid");
    const status = $(".form-status", input.closest("form.signup"));
    if (status) { status.textContent = ""; status.className = "form-status"; }
  });
  site.addEventListener("submit", (ev) => {
    const form = ev.target.closest("form.signup");
    if (!form) return;
    ev.preventDefault();
    const input = $('input[type="email"]', form), status = $(".form-status", form);
    if (!EMAIL_RE.test(input.value.trim())) {
      input.setAttribute("aria-invalid", "true");
      status.textContent = "Enter an email address like you@scu.edu.";
      status.className = "form-status error";
      input.focus();
      return;
    }
    status.textContent = "Online sign-up opens when the site goes live. Until then, email " + F.email + " and the board will add you.";
    status.className = "form-status";
  });

  /* ---------- Ask CLIP (answers from the FAQ) ---------- */
  const launcher = $("#chat-launcher"), panel = $("#chat-panel");
  if (!launcher || !panel) return;
  const log = $("#chat-log"), suggest = $("#chat-suggest"), form = $("#chat-form"), input = $("#chat-input");
  const clean = (s) => String(s || "").replace(/\[[^\]]*\]/g, "(not posted yet)").replace(/\s+/g, " ").trim();
  const STOP = new Set("the and are for you can how what when where who why does with about your this that have from will there their them they our out any".split(" "));
  const stems = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 4));
  function answer(q) {
    const t = q.toLowerCase(), mail = F.email;
    if (/hack/.test(t)) return clean(F.hackLede || "We're planning a biohackathon.") + " Leave your email on the Biohackathon page to get the announcement.";
    if (/\b(board|officer|officers|president|treasurer|secretary|vice)\b/.test(t) && F.members.length)
      return clean("This year's board: " + F.members.map((m) => m.name + (m.role && !/^\[/.test(m.role.trim()) ? " (" + m.role + ")" : "")).join(", ") + ". " + F.boardNote);
    if (/\b(contact|email|reach|instagram)\b/.test(t)) return "Email " + mail + ", or catch a board member at a weekly general meeting.";
    if (/\b(speaker|speakers|visited|guest)\b/.test(t)) {
      const named = F.speakers.filter((s) => !/^\[/.test(String(s.name).trim())).map((s) => s.name + (s.when ? " (" + clean(s.when) + ")" : ""));
      if (named.length) return "Past speakers include " + named.join(", ") + ". The Speakers page has the full list.";
    }
    const qs = new Set(stems(q));
    let best = null, score = 0;
    F.faqs.forEach((it) => { const s = stems(it.q).reduce((n, w) => n + (qs.has(w) ? 2 : 0), 0) + stems(it.a).reduce((n, w) => n + (qs.has(w) ? 1 : 0), 0); if (s > score) { score = s; best = it; } });
    if (best && score >= 2) return clean(best.a);
    if (/\b(event|events|calendar|talk|talks|workshop)/.test(t)) {
      const e = F.events[0];
      return e ? clean("Next on the calendar: " + [e.name, [e.month, e.day].join(" "), e.time, e.location].filter((x) => String(x || "").trim()).join(", ") + ". The Events page has the rest.") : "New events go out in the weekly email first. Sign up at the bottom of the home page.";
    }
    return "I can answer questions about meetings, joining, the board and the Biohackathon. For anything else, email " + mail + ".";
  }
  function addMsg(kind, text) { const p = document.createElement("p"); p.className = "msg " + kind; p.textContent = text; log.appendChild(p); log.scrollTop = log.scrollHeight; }
  function ask(q) {
    q = q.trim();
    if (!q) return;
    if (suggest && suggest.isConnected) suggest.remove();
    addMsg("user", q);
    addMsg("bot", answer(q));
  }
  const openChat = () => { panel.hidden = false; launcher.setAttribute("aria-expanded", "true"); input.focus(); };
  const closeChat = () => { if (panel.hidden) return; panel.hidden = true; launcher.setAttribute("aria-expanded", "false"); launcher.focus(); };
  launcher.addEventListener("click", () => (panel.hidden ? openChat() : closeChat()));
  $("#chat-close").addEventListener("click", closeChat);
  panel.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeChat(); });
  if (suggest) suggest.addEventListener("click", (ev) => { const chip = ev.target.closest(".chip-btn"); if (chip) ask(chip.textContent); });
  form.addEventListener("submit", (ev) => { ev.preventDefault(); const q = input.value; input.value = ""; if (q.trim()) ask(q); else input.focus(); });
})();
