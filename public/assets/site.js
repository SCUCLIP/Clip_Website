/* CLIP website, public pages. The Worker renders each page's content into its HTML. This script does the rest:
   - scales the layout to the screen and switches to the phone layout below 1000px wide (shared/layout.js),
   - runs the phone menu, the Copy buttons, the sign-up forms (POST /api/signup) and the Ask CLIP chat.
   Ask CLIP answers from window.CLIP_FACTS, which /assets/clip-facts.js builds from the published content. */
import { attachLayout } from "/shared/layout.js";

(() => {
  "use strict";
  const site = document.getElementById("site");
  const F = Object.assign({ email: "connectingleaders@scu.edu", faqs: [], members: [], speakers: [], events: [], hackLede: "", boardNote: "" }, window.CLIP_FACTS || {});
  const $ = (s, r) => (r || document).querySelector(s);

  /* ---------- Layout ---------- */
  attachLayout(site);

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

  /* ---------- Sign-up forms ---------- */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const sitekey = ($('meta[name="turnstile-sitekey"]') || {}).content || "";
  let turnstileLoad = null;
  /* Turnstile (off localhost only): loaded on the first sign-up, shown only if Cloudflare needs the visitor to click. */
  function loadTurnstile() {
    if (!turnstileLoad) {
      turnstileLoad = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        s.async = true;
        s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile didn't load")));
        s.onerror = () => { turnstileLoad = null; reject(new Error("Turnstile didn't load")); };
        document.head.appendChild(s);
      });
    }
    return turnstileLoad;
  }
  async function turnstileToken(form) {
    const ts = await loadTurnstile();
    let box = $(".ts-box", form);
    if (!box) { box = document.createElement("div"); box.className = "ts-box"; form.appendChild(box); }
    if (form._ts !== undefined) { try { ts.remove(form._ts); } catch (_) { /* already gone */ } }
    return new Promise((resolve, reject) => {
      form._ts = ts.render(box, {
        sitekey, appearance: "interaction-only", action: "signup",
        callback: resolve, "error-callback": () => reject(new Error("check failed")), "expired-callback": () => reject(new Error("check expired")),
      });
    });
  }
  const setStatus = (form, msg, isError) => {
    const status = $(".form-status", form);
    status.textContent = msg;
    status.className = "form-status" + (isError ? " error" : "");
  };
  site.addEventListener("input", (ev) => {
    const input = ev.target;
    if (input.getAttribute("aria-invalid") !== "true") return;
    input.removeAttribute("aria-invalid");
    const form = input.closest("form.signup");
    if (form) setStatus(form, "", false);
  });
  site.addEventListener("submit", async (ev) => {
    const form = ev.target.closest("form.signup");
    if (!form) return;
    ev.preventDefault();
    if (form.dataset.busy) return;
    const input = $('input[type="email"]', form), button = $('button[type="submit"]', form);
    const email = input.value.trim();
    if (!EMAIL_RE.test(email)) {
      input.setAttribute("aria-invalid", "true");
      setStatus(form, "Enter an email address like you@scu.edu.", true);
      input.focus();
      return;
    }
    form.dataset.busy = "1";
    button.disabled = true;
    setStatus(form, "Signing you up…", false);
    try {
      const body = { email, list: form.dataset.list || "" };
      if (sitekey) body.token = await turnstileToken(form);
      const res = await fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Sign-up didn't go through.");
      setStatus(form, form.dataset.ok || "You're on the list.", false);
      input.value = "";
    } catch (err) {
      setStatus(form, (err && err.message && !/^check |^Turnstile/.test(err.message) ? err.message + " " : "Sign-up didn't go through. ") + "You can also email " + F.email + ".", true);
    } finally {
      delete form.dataset.busy;
      button.disabled = false;
    }
  });

  /* ---------- Ask CLIP (answers from the published FAQ, board, speakers and events) ---------- */
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
