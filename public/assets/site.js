/* CLIP website, public pages. The Worker renders each page's content into its HTML. This script does the rest:
   - scales the layout to the screen and switches to the phone layout below 1000px wide (shared/layout.js),
   - runs the phone menu, the Copy buttons and the sign-up forms (POST /api/signup). */
import { attachLayout } from "../shared/layout.js";

(() => {
  "use strict";
  const site = document.getElementById("site");
  const $ = (s, r) => (r || document).querySelector(s);
  /* The club email, as the footer shows it. */
  const clubEmail = () => (($(".site-footer .addr", site) || {}).textContent || "").trim() || "connectingleaders@scu.edu";

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
      setStatus(form, (err && err.message && !/^check |^Turnstile/.test(err.message) ? err.message + " " : "Sign-up didn't go through. ") + "You can also email " + clubEmail() + ".", true);
    } finally {
      delete form.dataset.busy;
      button.disabled = false;
    }
  });
})();
