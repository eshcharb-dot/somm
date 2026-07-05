// Somm — app shell: onboarding, tabs, chat, scan, profile.
"use strict";

const CHAT_KEY = "somm.chat.v1";
const LAST_SCANS_KEY = "somm.lastScans.v1";
const LAST_SCANS_MAX = 5;

const state = {
  profile: SommProfile.loadProfile(),
  settings: SommProfile.loadSettings(),
  tab: "tonight",
  chatMode: "chat",          // tonight | store | restaurant | chat
  chat: [],                  // [{role:"user"|"assistant", text, dataUrl?, cards?}]
  quizStep: 0,
  quizAnswers: [],
  pendingImage: null,        // {b64, mediaType, dataUrl, scanMode}
  busy: false,
  scanAbortToken: 0,         // bumped whenever the user backs out of an in-flight scan (see
                              // runScanAnalysis/closeScanResultScreen) so a late-arriving
                              // result doesn't reopen a screen the user already left.
  scanLoadingTimer: null,    // interval id for the rotating sr-loading-sub reassurance text —
                              // see showScanResultScreen's loading branch.
};

const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2600);
}

function loadChat() {
  try { state.chat = JSON.parse(localStorage.getItem(CHAT_KEY)) || []; }
  catch (e) { state.chat = []; }
}
function saveChat() {
  // Persist without heavy image data beyond the last 2 photos. Retry metadata (retryText/
  // retryImage) is intentionally dropped — it's only meaningful for the live in-memory
  // session; reloading the page loses the retry affordance, which is fine since the failed
  // request is stale by then anyway.
  const slim = state.chat.slice(-40).map((m, i, arr) => {
    const { retry, retryText, retryImage, ...rest } = m;
    if (m.dataUrl && i < arr.length - 4) return { ...rest, dataUrl: null };
    return rest;
  });
  try {
    localStorage.setItem(CHAT_KEY, JSON.stringify(slim));
  } catch (e) {
    // QuotaExceededError — strip ALL dataUrls except the two most recent, then retry once.
    // If it still fails, swallow silently so the chat UI always renders.
    try {
      const stripped = slim.map((m, i, arr) => {
        if (m.dataUrl && i < arr.length - 2) return { ...m, dataUrl: null };
        return m;
      });
      localStorage.setItem(CHAT_KEY, JSON.stringify(stripped));
    } catch (_) { /* storage full — UI still works, persistence skipped */ }
  }
}

// ============================== BOOT ==============================
// Catch-all visibility net for anything not already logged at its call site (see
// SommDB.logError call sites in scan/chat error handling above) — e.g. render-time
// exceptions in an onclick handler. Fire-and-forget, never blocks or alters behavior.
window.addEventListener("error", (e) => {
  SommDB.logError("client", "window.onerror", e.error || e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  SommDB.logError("client", "unhandledrejection", e.reason);
});

document.addEventListener("DOMContentLoaded", async () => {
  loadChat();
  SommAI.initFxRates(); // non-blocking — rates cached for prompt injection
  try {
    await SommAuth.init(onAuthStateChange);
  } catch (e) {
    // Auth is optional — localStorage works without Supabase. Never block the boot.
    console.warn("Auth init failed, continuing as guest:", e.message);
  }
  if (!state.profile.onboarded) {
    showOnboarding();
  } else {
    showMain();
  }
  bindGlobal();
  bindAuthModal();
  bindBackButton();
});

// ============================== ANDROID BACK BUTTON ==============================
// switchTab()/showAuthModal()/showScanResultScreen() toggle plain hidden flags with no History
// API integration, which on Android means the hardware/gesture back button exits the installed
// PWA entirely instead of closing an overlay or stepping back a tab. We push a history entry
// whenever an overlay opens (or a tab changes), and a single popstate listener below closes
// whatever's on top instead of letting the back gesture fall through to the browser/OS.
function bindBackButton() {
  window.addEventListener("popstate", () => {
    const st = history.state;
    if (!$("#src-modal").hidden && !(st && st.sommOverlay === "src")) {
      hideScanSourceChooser();
      return;
    }
    if (!$("#dlg-modal").hidden && !(st && st.sommOverlay === "dlg")) {
      hideDlg();
      const resolve = dlgResolve;
      dlgResolve = null;
      if (resolve) resolve(false);
      return;
    }
    if (!$("#auth-modal").hidden && !(st && st.sommOverlay === "auth")) {
      hideAuthModal();
      return;
    }
    if (!$("#screen-scan-result").hidden && !(st && st.sommOverlay === "scanresult")) {
      hideScanResultScreen();
      return;
    }
    if (st && st.sommTab && st.sommTab !== state.tab) {
      switchTab(st.sommTab, true);
    }
  });
}

async function onAuthStateChange(event, user) {
  if (event === "SIGNED_IN" && user) {
    await syncProfileOnSignIn();
    if (state.tab === "you") renderYou();
  }
  if (event === "SIGNED_OUT") {
    if (state.tab === "you") renderYou();
  }
  if (event === "PASSWORD_RECOVERY") {
    // User clicked the reset-password link from their email — Supabase already gave us a
    // recovery session; prompt for a new password instead of silently signing them in.
    showAuthModal();
    setAuthView("newpw");
  }
}

// Pull the cloud profile down BEFORE ever pushing this device's local profile up.
// Without this, signing in on a second device blindly overwrote whatever palate/ratings
// history the account already had in Supabase with this device's (possibly blank) local
// profile — exactly the data loss the "your ratings travel with you" sign-in prompt promises
// won't happen. If the cloud already has a richer profile (more rated wines), adopt it
// locally instead of clobbering it; otherwise push this device's profile up as before.
async function syncProfileOnSignIn() {
  let cloud = null;
  try { cloud = await SommDB.getProfile(); } catch (e) { console.warn("cloud profile fetch failed", e); }

  if (cloud && (cloud.ratings_count || 0) > (state.profile.ratingCount || 0)) {
    if (cloud.full_profile && typeof cloud.full_profile === "object") {
      // Lossless restore: full_profile carries the entire client profile (journal/history,
      // nos, type affinities, grape+region learnings, budget) — the palate-snapshot columns
      // below only cover dims, which left second-device sign-ins with an empty journal
      // despite the sign-in copy's promise. Keep the stricter of the two age confirmations.
      const ageOk = state.profile.ageConfirmed || !!cloud.full_profile.ageConfirmed;
      state.profile = Object.assign(SommProfile.defaultProfile(), cloud.full_profile);
      state.profile.ageConfirmed = ageOk;
    } else {
      // Older cloud rows predate the full_profile column — partial restore is still better
      // than clobbering the richer cloud data with a blank local profile.
      state.profile.name = cloud.display_name || state.profile.name;
      state.profile.dims = { ...state.profile.dims, ...(cloud.palate || {}) };
      if (typeof cloud.adventurousness === "number") state.profile.adventure = cloud.adventurousness;
      state.profile.ratingCount = cloud.ratings_count;
    }
    state.profile.onboarded = true;
    SommProfile.saveProfile(state.profile);
    if (cloud.currency) {
      state.settings.currency = cloud.currency;
      SommProfile.saveSettings(state.settings);
    }
    toast("Synced your profile from the cloud ✓");
  } else {
    SommDB.saveProfile(state.profile, state.settings);
    toast("Profile synced to cloud ✓");
  }
}

function bindGlobal() {
  $$(".nav-btn").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
  $("#chat-form").addEventListener("submit", onChatSubmit);
  $("#scan-input").addEventListener("change", onScanFile);
  $("#scan-input-camera").addEventListener("change", onScanFile);
  $("#tonight-form").addEventListener("submit", onTonightSubmit);
  $("#btn-surprise").addEventListener("click", () => runTonight("surprise me", true));
  $("#btn-store-picks").addEventListener("click", runStorePicks);
  bindKeyboardHandler();
}

function bindKeyboardHandler() {
  // On Android, the software keyboard shrinks visualViewport but not window.
  // We use this to push the chat form above the keyboard.
  if (!window.visualViewport) return;
  const chatForm = $("#chat-form");
  const chatScroll = $("#chat-scroll");

  function onViewportResize() {
    if (state.tab !== "vera") return;
    const keyboardH = window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop;
    if (keyboardH > 100) {
      // Keyboard is open — lift form above it
      chatForm.style.paddingBottom = keyboardH + "px";
      setTimeout(() => scrollChat(), 50);
    } else {
      chatForm.style.paddingBottom = "";
    }
  }

  window.visualViewport.addEventListener("resize", onViewportResize);
  window.visualViewport.addEventListener("scroll", onViewportResize);
}

// ============================== ONBOARDING ==============================
function showOnboarding() {
  $("#screen-onboarding").hidden = false;
  $("#screen-main").hidden = true;
  state.quizStep = -1;
  state.quizAnswers = [];
  renderQuizStep();
}

function renderQuizStep() {
  const wrap = $("#quiz");
  const QUIZ = SOMM_DATA.QUIZ;

  if (state.quizStep === -1) {
    wrap.innerHTML = `
      <div class="onb-hero">
        <div class="onb-logo">Somm<span class="accent">.</span></div>
        <p class="onb-tag">Wine recs built around your palate</p>
        <div class="vera-intro">
          <div class="vera-avatar">V</div>
          <div class="vera-bubble">Hi, I'm <strong>Vera</strong> — your personal sommelier. A few quick questions and I'll start recommending wines that actually fit <em>your</em> taste — not just the crowd favourites. No wine knowledge needed.</div>
        </div>
        <!-- Prefilled for "Redo onboarding" returners — the field is optional, so without the
             prefill a returning user who skips it silently loses their name (and Vera stops
             greeting them by it), despite the redo-confirm promising their data is kept. Same
             logic pre-checks the age gate they already confirmed once. -->
        <input id="onb-name" class="input" type="text" placeholder="What should I call you? (optional)" maxlength="24" autocomplete="given-name" value="${esc(state.profile.name || "")}" />
        <label class="onb-agegate">
          <input type="checkbox" id="onb-agegate" ${state.profile.ageConfirmed ? "checked" : ""}>
          <span>I confirm I'm of legal drinking age in my country</span>
        </label>
        <button class="btn btn-primary btn-block" id="onb-start" ${state.profile.ageConfirmed ? "" : "disabled"}>Let's go</button>
        <p class="onb-legal"><a href="privacy.html" target="_blank" rel="noopener noreferrer">Privacy &amp; Terms</a></p>
      </div>`;
    $("#onb-agegate").addEventListener("change", (e) => {
      $("#onb-start").disabled = !e.target.checked;
    });
    $("#onb-start").addEventListener("click", () => {
      // Belt-and-suspenders: the button is disabled until checked, but don't rely on that
      // alone — Somm's entire purpose is alcohol recommendations, so this confirmation must
      // actually be recorded before onboarding proceeds.
      if (!$("#onb-agegate").checked) return;
      state.profile.name = $("#onb-name").value.trim();
      state.profile.ageConfirmed = true;
      state.quizStep = 0;
      renderQuizStep();
    });
    return;
  }

  if (state.quizStep >= QUIZ.length) { finishOnboarding(); return; }

  const q = QUIZ[state.quizStep];
  const dots = QUIZ.map((_, i) =>
    `<span class="dot ${i < state.quizStep ? "done" : i === state.quizStep ? "now" : ""}"></span>`).join("");

  wrap.innerHTML = `
    <div class="quiz-step">
      <div class="dots">${dots}</div>
      <h2 class="quiz-q">${esc(q.q)}</h2>
      <p class="quiz-sub">${esc(q.sub || "")}</p>
      <div class="quiz-opts">
        ${q.options.map((o, i) => `<button class="opt" data-i="${i}" aria-pressed="false">${esc(o.label)}</button>`).join("")}
      </div>
      ${q.multi ? `<button class="btn btn-primary btn-block" id="quiz-next" disabled>Continue</button>` : ""}
      ${state.quizStep > 0 ? `<button class="btn-ghost" id="quiz-back">← Back</button>` : ""}
    </div>`;

  // Seed from any previously-recorded answer for this step so tapping Back to an
  // already-answered multi-select question shows prior selections instead of blank —
  // otherwise users are forced to redo their picks blind every time they go back.
  const picked = new Set();
  if (q.multi) {
    const prevAnswer = state.quizAnswers[state.quizStep];
    if (Array.isArray(prevAnswer)) {
      q.options.forEach((o, i) => {
        if (prevAnswer.includes(o.fx)) picked.add(i);
      });
    }
  }
  $$(".opt", wrap).forEach((btn, i) => {
    if (picked.has(i)) { btn.classList.add("sel"); btn.setAttribute("aria-pressed", "true"); }
  });
  if (q.multi) $("#quiz-next").disabled = picked.size === 0;
  $$(".opt", wrap).forEach((btn) => btn.addEventListener("click", () => {
    const i = Number(btn.dataset.i);
    if (q.multi) {
      const isNone = !q.options[i].fx || !Object.keys(q.options[i].fx).length;
      if (isNone) {
        picked.clear();
        $$(".opt", wrap).forEach((b) => { b.classList.remove("sel"); b.setAttribute("aria-pressed", "false"); });
      } else {
        // deselect the "none" option if it was picked
        q.options.forEach((o, j) => {
          if (!o.fx || !Object.keys(o.fx).length) {
            picked.delete(j);
            const b = $$(".opt", wrap)[j];
            b.classList.remove("sel"); b.setAttribute("aria-pressed", "false");
          }
        });
      }
      if (picked.has(i)) { picked.delete(i); btn.classList.remove("sel"); btn.setAttribute("aria-pressed", "false"); }
      else { picked.add(i); btn.classList.add("sel"); btn.setAttribute("aria-pressed", "true"); }
      $("#quiz-next").disabled = picked.size === 0;
    } else {
      state.quizAnswers[state.quizStep] = q.options[i].fx;
      state.quizStep++;
      renderQuizStep();
    }
  }));
  if (q.multi) $("#quiz-next").addEventListener("click", () => {
    state.quizAnswers[state.quizStep] = Array.from(picked).map((i) => q.options[i].fx);
    state.quizStep++;
    renderQuizStep();
  });
  const back = $("#quiz-back");
  if (back) back.addEventListener("click", () => { state.quizStep--; renderQuizStep(); });
}

function finishOnboarding() {
  const name = state.profile.name;
  const existing = state.profile;
  const quizProfile = SommProfile.buildProfileFromQuiz(state.quizAnswers);
  // Merge the quiz-derived taste signals into the EXISTING profile instead of replacing it
  // wholesale — redoing onboarding must not wipe ratingCount/history/grapes/regions, which is
  // exactly what the "Redo onboarding" confirm() copy promises ("Your journal and ratings are
  // kept"). Only the quiz-driven fields (dims/types/adventure/budget/experience/nos) are reset;
  // everything learned from actual ratings survives.
  state.profile = {
    ...existing,
    name,
    experience: quizProfile.experience,
    dims: quizProfile.dims,
    types: quizProfile.types,
    adventure: quizProfile.adventure,
    budget: quizProfile.budget,
    nos: quizProfile.nos,
    onboarded: true,
  };
  SommProfile.saveProfile(state.profile);

  const wrap = $("#quiz");
  const p = state.profile;
  const topType = SommProfile.TYPE_KEYS.slice().sort((a, b) => p.types[b] - p.types[a])[0];
  const recs = SommProfile.recommend(p, { n: 3 });
  wrap.innerHTML = `
    <div class="onb-hero">
      <div class="vera-intro">
        <div class="vera-avatar">V</div>
        <div class="vera-bubble">Got it${name ? ", " + esc(name) : ""}. Early read: you lean
        <strong>${esc(SommProfile.TYPE_LABELS[topType])}</strong>, ${p.dims.tannin > .55 ? "you can handle structure" : "smooth over grippy"},
        ${p.dims.sweet > .4 ? "with a soft spot for a touch of sweetness" : "and you like it dry"}.
        I'll sharpen this every time you rate a wine. Here's where I'd start:</div>
      </div>
      <div id="onb-recs"></div>
      <button class="btn btn-primary btn-block" id="onb-done">Open the app</button>
    </div>`;
  const recWrap = $("#onb-recs");
  recs.forEach(({ wine, score }) => recWrap.appendChild(wineCardEl(localCard(wine, score), "onboarding")));
  $("#onb-done").addEventListener("click", showMain);
}

// ============================== MAIN SHELL ==============================
function showMain() {
  $("#screen-onboarding").hidden = true;
  $("#screen-main").hidden = false;
  switchTab(state.tab || "tonight");
}

// fromPopstate is true when this call is a reaction to the back button (see bindBackButton) —
// in that case the browser already moved the history pointer, so we must not push another entry.
function switchTab(tab, fromPopstate) {
  const changed = state.tab !== tab;
  state.tab = tab;
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".tab").forEach((t) => { t.hidden = t.id !== "tab-" + tab; });
  if (tab === "you") renderYou();
  if (tab === "vera") { renderChat(); $("#chat-scroll").scrollTop = $("#chat-scroll").scrollHeight; }
  if (tab === "tonight") renderTonightGreeting();
  if (tab === "scan") renderScanRecent();
  if (changed && !fromPopstate) history.pushState({ sommTab: tab }, "");
}

// ============================== WINE CARDS ==============================
function localCard(wine) {
  // Convert EUR-based price endpoints to the user's display currency.
  const cur = state.settings.currency;
  const p0 = SommAI.convertFromEUR(wine.price[0], cur);
  const p1 = SommAI.convertFromEUR(wine.price[1], cur);
  return {
    name: wine.name, region: wine.region, grape: wine.grape, type: wine.type,
    price: `${cur}${p0}–${p1}`,
    match: SommProfile.matchPct(state.profile, wine),
    why: wine.desc, attrs: wine.attrs, _local: true,
  };
}

// Match percentages (whether computed locally by matchPct or estimated by the AI in scan/chat
// cards) are always a fit ESTIMATE against the user's profile, never a verified/guaranteed
// score — this makes that visible at the badge itself instead of relying on a caption users can
// miss, and spells it out even more plainly while the profile barely has any rating history to
// back it up (same "warming up" threshold used on the You tab's confidence ring).
function matchBadgeText(pct) {
  if (pct == null) return "";
  const p = esc(String(pct));
  const conf = SommProfile.confidencePct(state.profile);
  return conf < 40 ? `${p}% estimated match` : `~${p}% match`;
}

// Short mono tag for the card head's right slot — where this recommendation came from.
const CONTEXT_TAGS = { "tonight": "Tonight", "store list": "Store", "onboarding": "First pour" };
function contextTag(context) {
  if (!context) return "";
  if (CONTEXT_TAGS[context]) return CONTEXT_TAGS[context];
  if (String(context).startsWith("vera")) return "Vera";
  return String(context);
}

// Measurement-rail attribute scales (Body/Tannin/Fruit/Acidity) — the Atelier card's
// "spec sheet" element. Rendered only when the card carries a full attrs vector (local
// catalog cards always do; Vera's chat cards and scan picks usually do per the wine-card
// protocol, and gracefully omit otherwise).
function scalesHtml(attrs) {
  if (!attrs) return "";
  const rows = [["body", "Body"], ["tannin", "Tannin"], ["fruit", "Fruit"], ["acid", "Acidity"]]
    .filter(([k]) => typeof attrs[k] === "number");
  if (rows.length < 4) return "";
  return `<div class="scales">${rows.map(([k, label]) => {
    const v = Math.max(.05, Math.min(.95, attrs[k]));
    const word = attrs[k] >= .66 ? "High" : attrs[k] >= .33 ? "Med" : "Low";
    return `<div class="scale"><div class="scale-lab"><span>${label}</span><b>${word}</b></div>
      <div class="rail"><i></i><i></i><i></i><b style="left:${(v * 100).toFixed(0)}%"></b></div></div>`;
  }).join("")}</div>`;
}

function wineCardEl(card, context) {
  const el = document.createElement("div");
  el.className = "wine-card";
  const conf = SommProfile.confidencePct(state.profile);
  // Same honesty split as the old badge: while the profile has little rating history,
  // say so at the number itself instead of implying precision.
  const cap = conf < 40 ? "Estimated match — profile warming up" : "Estimated match — your palate";
  const headLeft = [SommProfile.TYPE_LABELS[card.type] || card.type || "Wine", card.region].filter(Boolean).join(" — ");
  const sub = [card.grape, card.price ? `${card.price} · est.` : null].filter(Boolean).join(" · ");
  el.innerHTML = `
    <span class="wc-cm"></span>
    <div class="wc-inner">
      <div class="wc-head">
        <span class="microlabel">${esc(headLeft)}</span>
        <span class="microlabel ctx">${esc(contextTag(context))}</span>
      </div>
      <div class="wc-center">
        <div class="wc-name">${esc(card.name)}</div>
        ${sub ? `<div class="wc-sub num">${esc(sub)}</div>` : ""}
        ${card.match != null ? `
        <div class="rule-orn"><span>◆</span></div>
        <div class="wc-match-big num" title="Estimated fit vs your taste profile — not a guarantee">${esc(String(Number(card.match) || 0))}<sup>%</sup></div>
        <div class="wc-cap">${esc(cap)}</div>` : ""}
      </div>
      ${card.why ? `<div class="wc-why">${esc(card.why)}</div>` : ""}
      ${card.pairing ? `<div class="wc-pair">🍽 ${esc(card.pairing)}</div>` : ""}
      <a class="wc-buy" href="https://www.wine-searcher.com/find/${encodeURIComponent(card.name)}" target="_blank" rel="noopener noreferrer">Find online →</a>
      ${scalesHtml(card.attrs)}
      <div class="wc-actions">${RATE_BUTTONS_HTML}</div>
    </div>`;
  bindRateButtons(el, {
    name: card.name, region: card.region, grape: card.grape, type: card.type,
    attrs: card.attrs, price: card.price,
  }, context);
  return el;
}

const RATE_BUTTONS_HTML = `
      <button class="rate" data-r="love">♥ Loved it</button>
      <button class="rate" data-r="ok">Fine</button>
      <button class="rate" data-r="no">Not for me</button>`;

// Shared by wineCardEl and srPickCard. Rating trains the profile IMMEDIATELY
// (learnFromRating), so a mis-tap — or rating a wine the vision scan misidentified — would
// otherwise permanently teach Vera the wrong palate. Undo restores a pre-rating snapshot and
// re-arms the buttons. Cloud-side: the wine_ratings row isn't deleted on undo (saveRating
// returns no row id), but the snapshot push that follows overwrites the cloud palate, which
// is what recommendation quality actually depends on.
function bindRateButtons(el, wine, context) {
  $$(".rate", el).forEach((btn) => btn.addEventListener("click", () => {
    const rating = btn.dataset.r;
    const snapshot = JSON.stringify(state.profile);
    SommProfile.learnFromRating(state.profile, wine, rating, context);
    const dbRating = rating === "love" ? "loved" : rating === "ok" ? "fine" : "skip";
    SommDB.saveRating(wine, dbRating, context);
    SommDB.saveProfile(state.profile, state.settings);
    const actions = $(".wc-actions", el);
    actions.innerHTML = `<span class="rated">${
      rating === "love" ? "Noted — more like this ♥" : rating === "ok" ? "Noted." : "Got it — steering away."
    } <em>(profile ${SommProfile.confidencePct(state.profile)}%)</em></span><button class="btn-ghost rated-undo">Undo</button>`;
    $(".rated-undo", el).addEventListener("click", () => {
      state.profile = Object.assign(SommProfile.defaultProfile(), JSON.parse(snapshot));
      SommProfile.saveProfile(state.profile);
      SommDB.saveProfile(state.profile, state.settings);
      actions.innerHTML = RATE_BUTTONS_HTML;
      bindRateButtons(el, wine, context);
      toast("Rating undone");
    });
  }));
}

// ============================== TONIGHT ==============================
function renderTonightGreeting() {
  const p = state.profile;
  const h = new Date().getHours();
  const part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  // The question matches the time of day — "what's on the table tonight?" read oddly at
  // 9 AM next to "Good morning" (the meal being planned is dinner, but the phrasing
  // shouldn't fight the greeting).
  const q = h < 12 ? "What's cooking later?" : h < 18 ? "What's for dinner tonight?" : "What's on the table tonight?";
  $("#tonight-greet").textContent =
    `Good ${part}${p.name ? ", " + p.name : ""}. ${q}`;

  // Daily pour: keep the screen alive before the first search.
  const wrap = $("#tonight-results");
  if (!wrap.childElementCount) {
    const pool = SOMM_DATA.WINES.filter((w) => SommProfile.wineAllowed(p, w));
    if (pool.length) {
      const day = Math.floor(Date.now() / 86400000);
      // Rotate across a wide slice of the ranked pool, not just the top handful — narrowing
      // to a small top-N means daily-active users cycle back to the same wines within a
      // week or two even though the underlying pool is much bigger. 21 gives a 3-week cycle
      // (or the whole pool, if it's smaller) while still favoring better matches over the
      // long tail.
      const ranked = pool.map((w) => ({ w, m: SommProfile.matchPct(p, w) }))
        .sort((a, b) => b.m - a.m).slice(0, Math.min(21, pool.length));
      const pick = ranked[day % ranked.length].w;
      const intro = document.createElement("div");
      intro.className = "vera-line";
      intro.innerHTML = `<div class="vera-avatar sm">V</div><div class="vera-bubble">Today's pour, if you're not cooking anything in particular:</div>`;
      wrap.appendChild(intro);
      wrap.appendChild(wineCardEl(localCard(pick), "daily pour"));
    }
  }
}

function onTonightSubmit(e) {
  e.preventDefault();
  const text = $("#tonight-food").value.trim();
  if (!text) return;
  runTonight(text, false);
}

function runTonight(text, surprise) {
  const wrap = $("#tonight-results");
  const tags = surprise ? [] : SommProfile.extractFoodTags(text);
  const recs = SommProfile.recommend(state.profile, {
    n: 3, foodTags: tags, budget: state.profile.budget.store,
    fxRates: SommAI.getFxRates(), currency: state.settings.currency,
  });
  wrap.innerHTML = "";

  const intro = document.createElement("div");
  intro.className = "vera-line";
  intro.innerHTML = `<div class="vera-avatar sm">V</div><div class="vera-bubble">${
    surprise ? "Off the cuff — three I'd open for you tonight:" :
    tags.length ? `For <strong>${esc(text)}</strong> — here's what I'd pour:` :
    `I don't recognize the dish, so I matched these to your palate. For sharper pairing, ask me in chat:`}</div>`;
  wrap.appendChild(intro);

  recs.forEach(({ wine, score }) => wrap.appendChild(wineCardEl(localCard(wine, score), "tonight: " + text)));

  const ask = document.createElement("button");
  ask.className = "btn btn-outline btn-block";
  ask.textContent = "Ask Vera to go deeper →";
  ask.addEventListener("click", () => {
    state.chatMode = "tonight";
    switchTab("vera");
    sendToVera(surprise ? "Surprise me — what should I open tonight?" : `Tonight I'm having: ${text}. What should I open, and why?`);
  });
  wrap.appendChild(ask);
}

function runStorePicks() {
  const wrap = $("#tonight-results");
  wrap.innerHTML = "";
  const recs = SommProfile.recommend(state.profile, {
    n: 3, budget: state.profile.budget.store,
    fxRates: SommAI.getFxRates(), currency: state.settings.currency,
  });
  // budget.store holds EUR reference values — convert before pairing with the user's currency
  // symbol. Raw numbers next to "₪" showed an Israeli user "₪12–25" for a €12–25 band (~4x off).
  const cur = state.settings.currency;
  const bLo = SommAI.convertFromEUR(state.profile.budget.store[0], cur);
  const bHi = SommAI.convertFromEUR(state.profile.budget.store[1], cur);
  const intro = document.createElement("div");
  intro.className = "vera-line";
  intro.innerHTML = `<div class="vera-avatar sm">V</div><div class="vera-bubble">Your shopping shortlist — styles to grab in your budget (${cur}${bLo}–${bHi}):</div>`;
  wrap.appendChild(intro);
  recs.forEach(({ wine, score }) => wrap.appendChild(wineCardEl(localCard(wine, score), "store list")));

  const ask = document.createElement("button");
  ask.className = "btn btn-outline btn-block";
  ask.textContent = "Ask Vera to go deeper →";
  ask.addEventListener("click", () => {
    state.chatMode = "store";
    switchTab("vera");
    sendToVera(`Shopping list — my budget is ${cur}${bLo}–${bHi}. Which of these styles should I prioritise and why?`);
  });
  wrap.appendChild(ask);
}

// ============================== SCAN ==============================
function scanWith(mode) {
  state.pendingScanMode = mode;
  openScanSourceChooser();
}

// ---- Scan source chooser (camera vs gallery) ----
// capture="environment" jumps straight to the camera on phones but hides the gallery; omitting
// it (the state since commit 381331a) does the reverse on many Android browsers — the picker
// opens with no camera path at all, which killed the flagship in-aisle/at-table use case.
// Only offering BOTH explicitly covers every browser: two hidden inputs (one per source, see
// index.html) behind this lightweight on-brand chooser. Same overlay/card/history-stack
// patterns as dlg-modal so the Android back gesture closes it instead of exiting the PWA.
let srcPrevFocus = null;

function openScanSourceChooser() {
  const modal = $("#src-modal");
  srcPrevFocus = document.activeElement;
  modal.hidden = false;
  history.pushState({ sommOverlay: "src" }, "");
  $("#src-camera").focus();
}

// Raw hide — used by the popstate handler (browser already moved past our pushed entry) and by
// closeScanSourceChooser(). Mirrors hideDlg()'s focus-restore behavior.
function hideScanSourceChooser() {
  const modal = $("#src-modal");
  if (modal.hidden) return;
  modal.hidden = true;
  if (srcPrevFocus && typeof srcPrevFocus.focus === "function") srcPrevFocus.focus();
  srcPrevFocus = null;
}

// UI-triggered close (Cancel, backdrop, Escape, or picking a source).
function closeScanSourceChooser() {
  if ($("#src-modal").hidden) return;
  hideScanSourceChooser();
  if (history.state && history.state.sommOverlay === "src") {
    history.replaceState({ sommTab: state.tab }, "");
  }
}

async function onScanFile(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const img = await SommAI.prepareImage(file);
    const mode = state.pendingScanMode || "bottle";
    img.scanMode = mode;
    await runScanAnalysis(img, mode);
  } catch (err) {
    toast(err.message || "Couldn't process that photo");
  }
}

async function runScanAnalysis(img, mode) {
  // Snapshot the abort token for this run — if the user backs out of the loading screen before
  // this resolves (see the loading-screen back button below), state.scanAbortToken changes and
  // we drop the result on the floor instead of yanking them back into a screen they left.
  const myToken = ++state.scanAbortToken;
  showScanResultScreen(img, mode, null); // loading state immediately
  try {
    await SommAI.initFxRates(); // ensure fresh rates before building prompt
    const system = SommAI.buildScanSystemPrompt(state.profile, mode, state.settings.currency);
    const userText = {
      bottle: "Analyze this bottle for me.",
      shelf: "Analyze this wine shelf and recommend the best bottles for my taste.",
      list: "Analyze this wine list — what should I order and what's the best value?",
      menu: "Analyze this menu and suggest what wine styles to pair with the dishes.",
    }[mode] || "Analyze this photo.";
    const messages = [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.b64 } },
        { type: "text", text: userText },
      ],
    }];
    const res = await SommAI.callAI({
      // 3500, not 2000: a 5-pick shelf scan with all the verbose per-pick fields can exceed
      // 2000 output tokens, truncating the JSON mid-stream — the closing tag never arrived,
      // parse failed, and the user got an error blaming their photo after a 20s wait.
      // Backend hard-caps at 4096 regardless.
      messages, system, provider: "claude", model: "claude-opus-4-8", maxTokens: 3500,
      authToken: SommAuth.getUser() ? await SommAuth.getAccessToken() : null,
    });
    const result = SommAI.parseScanResult(res.text);
    if (!result) {
      // Distinguish "response was cut off" (our budget, not their photo) from a genuine
      // can't-structure failure — blaming the user's photo for a truncation is a trust hit.
      throw new Error(res.stopReason === "max_tokens"
        ? "That photo had a lot going on and Vera ran out of room. Try a tighter shot with fewer bottles in frame."
        : "Vera couldn't structure the analysis. Try a clearer photo or use chat.");
    }
    if (myToken !== state.scanAbortToken) return; // user backed out — let it resolve quietly
    saveLastScan(img, mode, result);
    showScanResultScreen(img, mode, result);
  } catch (err) {
    SommDB.logError("client", `scan:${mode}`, err);
    if (myToken !== state.scanAbortToken) return;
    // ai.js's timeout copy says "tap to try again" — accurate in chat (the bubble is tappable),
    // misleading here where the retry affordance is a real button on the error screen instead.
    const msg = (err.message || "Analysis failed — try again.").replace(/\s*—\s*tap to try again\.?$/i, ".");
    showScanResultScreen(img, mode, { error: msg });
  }
}

const SCAN_NUDGE_KEY = "somm.scanNudge.v1";
const SCAN_NUDGE_AT = 3;
// Soft, early sign-in nudge — separate from the hard-wall prompt shown when the shared anon
// budget is exhausted (see the isBudgetErr branch below). Waiting until that hard wall to ever
// mention sign-in is a rough first impression for a brand-new user who just wanted one scan and
// gets blocked by strangers on the same wifi. Firing once, after a few *successful* scans,
// lets sign-in read as "keep this going" instead of "you're locked out." Guests only; fires
// once ever (per device) via the `shown` flag.
function shouldShowSignInNudge() {
  if (SommAuth.getUser()) return false;
  let s;
  try { s = JSON.parse(localStorage.getItem(SCAN_NUDGE_KEY)) || {}; } catch (e) { s = {}; }
  if (s.shown) return false;
  s.count = (s.count || 0) + 1;
  const fire = s.count >= SCAN_NUDGE_AT;
  if (fire) s.shown = true;
  localStorage.setItem(SCAN_NUDGE_KEY, JSON.stringify(s));
  return fire;
}

// Mode-specific rotation of reassurance sub-lines for the scan loading screen — same idea as
// requestVeraReply's THINKING_MSGS for chat, but scan's Opus vision call routinely runs 10-25s
// (vs. chat's near-instant-then-typing), so this keeps rotating on an interval the whole wait
// instead of swapping in once. First line doubles as the immediate (0s) sub-line so there's no
// flash of "Analyzing…" before it.
const SCAN_LOADING_MSGS = {
  bottle: [
    "Reading the label, checking your profile fit…",
    "Cross-referencing the vintage and region…",
    "Comparing to what you've loved before…",
    "Almost there — double-checking the details…",
  ],
  shelf: [
    "Scanning bottles, matching to your palate…",
    "Weighing each bottle against your taste…",
    "Narrowing down the best picks on the shelf…",
    "Almost there — ranking your top matches…",
  ],
  list: [
    "Finding the best value picks for you…",
    "Comparing prices against what's actually good…",
    "Matching the list to your palate…",
    "Almost there — picking the standouts…",
  ],
  menu: [
    "Planning your perfect pairing…",
    "Reading the dishes, thinking through pairings…",
    "Matching wine styles to your meal…",
    "Almost there — finalizing pairings…",
  ],
};

function loadLastScans() {
  try { return JSON.parse(localStorage.getItem(LAST_SCANS_KEY)) || []; }
  catch (e) { return []; }
}

// Persist completed (non-error) scan results so closing the scan-result screen or backgrounding
// the PWA doesn't silently discard the picks and shelf-position wayfinding — exactly the moment
// a user standing in a store aisle wants to recheck what Vera recommended, without re-shooting
// the photo. Mirrors saveChat's slimming pattern: only the most recent couple of entries keep
// their full image, the rest drop it, so this can't blow the localStorage quota.
function saveLastScan(img, mode, result) {
  const entry = { mode, result, dataUrl: img.dataUrl, ts: Date.now() };
  const list = [entry, ...loadLastScans()].slice(0, LAST_SCANS_MAX);
  const slim = list.map((s, i) => (i < 2 ? s : { ...s, dataUrl: null }));
  try {
    localStorage.setItem(LAST_SCANS_KEY, JSON.stringify(slim));
  } catch (e) {
    // QuotaExceededError — keep only the newest entry's image, then retry once. If it still
    // fails, swallow silently so the scan UI still works, same fallback shape as saveChat.
    try {
      const stripped = slim.map((s, i) => (i === 0 ? s : { ...s, dataUrl: null }));
      localStorage.setItem(LAST_SCANS_KEY, JSON.stringify(stripped));
    } catch (_) { /* storage full — persistence skipped, UI still works */ }
  }
}

const SCAN_MODE_ICON = { bottle: "🍾", shelf: "🛒", list: "📜", menu: "🍽️" };
const SCAN_MODE_LABEL = { bottle: "Bottle", shelf: "Shelf Scan", list: "Wine List", menu: "Food Menu" };

// "Return to your last scan" strip on the Scan tab's ready screen — lets a user re-open Vera's
// picks (and shelf-position wayfinding) from a recent scan without re-shooting the photo, e.g.
// after accidentally backing out or backgrounding the PWA mid-aisle.
function renderScanRecent() {
  const wrap = $("#scan-recent");
  if (!wrap) return;
  const scans = loadLastScans();
  if (!scans.length) { wrap.innerHTML = ""; return; }
  wrap.innerHTML = `
    <p class="scan-recent-head">Recent scans</p>
    <div class="scan-recent-list">
      ${scans.map((s, i) => `
        <button class="scan-recent-item" data-i="${i}">
          ${s.dataUrl ? `<img src="${s.dataUrl}" alt="">` : `<span class="scan-recent-ico">${SCAN_MODE_ICON[s.mode] || "🍷"}</span>`}
          <span class="scan-recent-meta">
            <strong>${esc(SCAN_MODE_LABEL[s.mode] || "Scan")}</strong>
            <span>${esc(new Date(s.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }))}</span>
          </span>
        </button>`).join("")}
    </div>`;
  $$(".scan-recent-item", wrap).forEach((btn) => btn.addEventListener("click", () => {
    const s = scans[Number(btn.dataset.i)];
    showScanResultScreen({ dataUrl: s.dataUrl || "" }, s.mode, s.result);
  }));
}

function showScanResultScreen(img, mode, result) {
  const screen = $("#screen-scan-result");
  const modeLabel = { bottle: "Bottle", shelf: "Shelf Scan", list: "Wine List", menu: "Food Menu" }[mode] || "Scan";
  // This screen is re-rendered in place across loading -> result/error, so only push a history
  // entry on the transition INTO the screen, not on every re-render — otherwise each loading ->
  // result swap would stack a redundant entry.
  const wasHidden = screen.hidden;
  screen.hidden = false;
  if (wasHidden) history.pushState({ sommOverlay: "scanresult" }, "");

  // Any previous loading rotation is no longer relevant once we re-render (whether that's a
  // fresh loading state, a result, or an error) — avoid leaking an interval that keeps firing
  // against a screen that's moved on.
  if (state.scanLoadingTimer) {
    clearInterval(state.scanLoadingTimer);
    state.scanLoadingTimer = null;
  }

  if (!result) {
    const loadMsgs = SCAN_LOADING_MSGS[mode] || ["Analyzing…"];
    screen.innerHTML = `
      <div class="sr-loading">
        <div class="sr-topbar">
          <button class="sr-back" id="sr-back">← Back</button>
          <span class="sr-mode-tag">${esc(modeLabel)}</span>
        </div>
        <img src="${img.dataUrl}" class="sr-photo" alt="Scanning">
        <div class="sr-loading-msg">
          <div class="vera-avatar">V</div>
          <div>
            <div class="sr-loading-title">Vera is looking…</div>
            <div class="sr-loading-sub" id="sr-loading-sub">${esc(loadMsgs[0])}</div>
          </div>
        </div>
        <div class="sr-spinner"></div>
      </div>`;
    // Rotate the reassurance line every 4s so a long wait (Opus vision routinely takes 10-25s)
    // doesn't read as a hung spinner — same reassurance pattern as chat's THINKING_MSGS, just
    // kept going for as long as the loading screen is up instead of swapping in once.
    let loadIdx = 0;
    state.scanLoadingTimer = setInterval(() => {
      loadIdx = (loadIdx + 1) % loadMsgs.length;
      const sub = $("#sr-loading-sub");
      if (sub) sub.textContent = loadMsgs[loadIdx];
    }, 4000);
    // Scanned the wrong thing? Bail without waiting out the up-to-~30s analysis. The in-flight
    // fetch itself isn't aborted (no AbortController plumbed through SommAI.callAI), but
    // runScanAnalysis checks scanAbortToken before acting on the result, so it resolves
    // quietly in the background instead of yanking the user back into this screen.
    $("#sr-back").addEventListener("click", closeScanResultScreen);
    return;
  }

  if (result.error) {
    // The shared anon per-IP budget can be exhausted by several beta testers on the same
    // wifi hitting the same daily cap — nudge sign-in (which gets its own, larger, per-account
    // budget) rather than leaving people to assume the app itself is broken. Same nudge for the
    // backend's REQUIRE_AUTH_FOR_VISION 401 ("sign in to analyze photos" — see backend/server.js),
    // if that's ever turned on.
    const isAuthPromptErr = /budget|limit|allowance|sign in/i.test(result.error);
    const showSignIn = isAuthPromptErr && !SommAuth.getUser();
    screen.innerHTML = `
      <div class="sr-wrap">
        <div class="sr-topbar">
          <button class="sr-back" id="sr-back">← Back</button>
          <span class="sr-mode-tag">${esc(modeLabel)}</span>
        </div>
        <img src="${img.dataUrl}" class="sr-photo" alt="">
        <div class="sr-body">
          <div class="sr-error">
            <div class="vera-avatar">V</div>
            <div>
              <p>${esc(result.error)}</p>
              ${showSignIn ? `<button class="btn btn-primary" style="margin-top:10px" id="sr-signin-fb">Sign in for your own budget →</button>` : ""}
              ${img.b64 && !showSignIn ? `<button class="btn btn-primary" style="margin-top:10px" id="sr-retry">Try again</button>` : ""}
              <button class="btn btn-outline" style="margin-top:10px" id="sr-chat-fb">Try in chat instead →</button>
              <button class="btn btn-ghost" style="margin-top:10px" id="sr-feedback-fb">Something off? Tell Vera</button>
            </div>
          </div>
        </div>
      </div>`;
    $("#sr-back").addEventListener("click", closeScanResultScreen);
    // Retry with the SAME photo — the whole point of scan mode is not re-shooting while standing
    // in an aisle. Only offered when the full image is still in memory (img.b64; entries
    // re-opened from "Recent scans" only keep a display dataUrl) and when the error isn't a
    // budget/auth wall, where retrying without signing in would just hit the same wall.
    const retryBtn = $("#sr-retry");
    if (retryBtn) retryBtn.addEventListener("click", () => runScanAnalysis(img, mode));
    $("#sr-chat-fb").addEventListener("click", () => openScanInChat(img, mode));
    if (showSignIn) $("#sr-signin-fb").addEventListener("click", showAuthModal);
    $("#sr-feedback-fb").addEventListener("click", async () => {
      const msg = await sommPrompt("What went wrong? (a couple of words is plenty)", { placeholder: "e.g. wrong vintage, bad match…" });
      if (!msg) return;
      const fbResult = await SommDB.saveFeedback(msg, `scan-error:${mode}`);
      toast(fbResult.ok ? "Thanks — got it ✓" : "Couldn't send that — try again in a bit");
    });
    return;
  }

  const picks = result.picks || [];
  const picksHeading = { bottle: "The verdict", menu: "Wine pairings", list: "Best picks", shelf: "Grab these" }[mode] || "Your picks";
  const showSignInNudge = shouldShowSignInNudge();

  screen.innerHTML = `
    <div class="sr-wrap">
      <div class="sr-topbar">
        <button class="sr-back" id="sr-back">← Back</button>
        <span class="sr-mode-tag">${esc(modeLabel)}</span>
      </div>
      ${img.dataUrl ? `<img src="${img.dataUrl}" class="sr-photo" alt="Your scan">` : ""}
      <div class="sr-body">
        <div class="sr-summary">
          <div class="vera-avatar sm">V</div>
          <div class="vera-bubble">${esc(result.summary || "Here's what I found.")}</div>
        </div>
        ${picks.length ? `<h3 class="sr-picks-head">${esc(picksHeading)}</h3>` : ""}
        <div id="sr-picks-list"></div>
        <button class="btn btn-outline btn-block" id="sr-chat-cta">Ask Vera for more →</button>
        ${showSignInNudge ? `<div class="signin-nudge" style="margin-top:14px">
          <p>Liking Vera so far? Sign in to keep your taste profile and ratings across devices — and get your own daily usage allowance instead of sharing one with everyone on this wifi.</p>
          <button class="btn btn-primary" id="sr-signin-nudge">Sign in / Create account</button>
        </div>` : ""}
      </div>
    </div>`;

  const picksWrap = $("#sr-picks-list");
  picks.forEach((pick) => picksWrap.appendChild(srPickCard(pick, mode)));
  if (showSignInNudge) $("#sr-signin-nudge").addEventListener("click", showAuthModal);

  $("#sr-back").addEventListener("click", closeScanResultScreen);
  $("#sr-chat-cta").addEventListener("click", () => openScanInChat(img, mode, picks[0]));
}

function srPickCard(pick, context) {
  const el = document.createElement("div");
  // Same proof-frame as wineCardEl — one card language app-wide (crop marks, hairlines,
  // mono annotations); scan picks just carry extra rows (position, price verdict).
  el.className = "wine-card";
  const pvLower = (pick.price_verdict || "").toLowerCase();
  const priceClass = pvLower.includes("great") ? "sr-price-great" : pvLower.includes("overpriced") ? "sr-price-bad" : "sr-price-ok";
  const rank = Number(pick.rank) || 0;
  const headLeft = [
    rank ? `Pick ${String(rank).padStart(2, "0")}` : null,
    [SommProfile.TYPE_LABELS[pick.type] || pick.type, pick.region].filter(Boolean).join(" — "),
  ].filter(Boolean).join(" · ");
  const sub = [pick.grape, pick.vintage, pick.label_price].filter(Boolean).join(" · ");

  el.innerHTML = `
    <span class="wc-cm"></span>
    <div class="wc-inner">
      <div class="wc-head">
        <span class="microlabel">${esc(headLeft)}</span>
        <span class="microlabel" style="color: var(--claret); flex: 0 0 auto;" title="Estimated fit vs your taste profile — not a guarantee">${matchBadgeText(Number(pick.match) || 0)}</span>
      </div>
      <div class="wc-center" style="padding-bottom: 6px;">
        <div class="wc-name" style="font-size: 1.25rem;">${esc(pick.name)}</div>
        ${sub ? `<div class="wc-sub num">${esc(sub)}</div>` : ""}
      </div>
      ${pick.shelf_position ? `<div class="sr-position"><span class="pos-label num">${esc(pick.shelf_position)}</span></div>` : ""}
      ${pick.match_reason ? `<div class="sr-why">✓ ${esc(pick.match_reason)}</div>` : ""}
      ${pick.price_verdict ? `<div class="sr-price-row"><span class="sr-price ${priceClass}" title="AI estimate from training knowledge — not a live price lookup">Est.: ${esc(pick.price_verdict)}</span><span class="sr-price-caveat" title="AI estimate from training knowledge — not a live price lookup">not a live price check</span></div>` : ""}
      ${pick.market_price_note ? `<div class="sr-market-note" title="AI estimate from training knowledge — not a live price lookup">Est. — ${esc(pick.market_price_note)}</div>` : ""}
      ${pick.pairing ? `<div class="wc-pair">🍽 ${esc(pick.pairing)}</div>` : ""}
      <a class="wc-buy" href="https://www.wine-searcher.com/find/${encodeURIComponent(pick.name)}" target="_blank" rel="noopener noreferrer">Find online →</a>
      <div class="wc-actions">${RATE_BUTTONS_HTML}</div>
    </div>`;

  bindRateButtons(el, { name: pick.name, region: pick.region, grape: pick.grape, type: pick.type, attrs: pick.attrs, price: pick.label_price }, context);
  return el;
}

function hideScanResultScreen() {
  state.scanAbortToken++; // invalidate any scan still in flight — see runScanAnalysis. Bumped
                           // here (not just in closeScanResultScreen) so this also covers the
                           // Android hardware/gesture back button, which calls this directly.
  if (state.scanLoadingTimer) {
    clearInterval(state.scanLoadingTimer);
    state.scanLoadingTimer = null;
  }
  $("#screen-scan-result").hidden = true;
  // fromPopstate=true here too — this is just restoring the tab underneath the overlay, not a
  // real navigation, so it must not push another history entry (see switchTab/bindBackButton).
  switchTab("scan", true);
}

// UI-triggered close (back button in the screen, "try in chat" fallback, etc.) — as opposed to
// hideScanResultScreen(), which is also called directly by the popstate handler once the
// browser has already moved past the pushed "scanresult" history entry. Here we still own that
// entry, so we replace it (not push a new one) to keep the stack from growing on repeated opens.
function closeScanResultScreen() {
  if ($("#screen-scan-result").hidden) return;
  hideScanResultScreen(); // also bumps scanAbortToken — see its comment
  if (history.state && history.state.sommOverlay === "scanresult") {
    history.replaceState({ sommTab: state.tab }, "");
  }
}

function openScanInChat(img, mode, topPick) {
  closeScanResultScreen();
  state.pendingImage = img;
  state.chatMode = { bottle: "store", shelf: "store", list: "restaurant", menu: "restaurant" }[mode] || "chat";
  switchTab("vera");
  const msg = topPick
    ? `Let's go deeper on ${topPick.name} — what else should I know?`
    : { bottle: "Here's a bottle — what is it, and is it for me?", shelf: "Here's the shelf. What should I grab?", list: "Here's the wine list. What should I order?", menu: "Here's the menu. What wine do I pair?" }[mode];
  sendToVera(msg, img);
}

// ============================== VERA CHAT ==============================
function chatStarters() {
  const cur = state.settings.currency;
  const p = state.profile;
  const prefersRed = (p.types.red || 0) >= (p.types.white || 0);
  return prefersRed ? [
    "What should I open with pasta tonight?",
    `Find me a Malbec under ${cur}20`,
    "Surprise me — I trust you",
    "What red pairs with lamb?",
  ] : [
    "What should I open with fish tonight?",
    `Find me a crisp white under ${cur}20`,
    "Surprise me — I trust you",
    "What white pairs with seafood?",
  ];
}

function renderChat() {
  const wrap = $("#chat-scroll");
  wrap.innerHTML = "";
  if (!state.chat.length) {
    const hello = document.createElement("div");
    hello.className = "msg assistant";
    hello.innerHTML = `<div class="vera-avatar sm">V</div><div class="bubble">Hey${state.profile.name ? " " + esc(state.profile.name) : ""}. Ask me anything about wine — what to open, what to buy, what to order. Or snap a photo from the Scan tab.</div>`;
    wrap.appendChild(hello);

    // Conversation starter chips — profile-aware (red vs white skew)
    const starters = document.createElement("div");
    starters.className = "chat-starters";
    chatStarters().forEach((prompt) => {
      const btn = document.createElement("button");
      btn.className = "chat-starter-btn";
      btn.textContent = prompt;
      btn.addEventListener("click", () => {
        starters.remove();
        sendToVera(prompt);
      });
      starters.appendChild(btn);
    });
    wrap.appendChild(starters);
  }
  state.chat.forEach((m) => wrap.appendChild(msgEl(m)));
  // mode chips
  $$(".mode-chip").forEach((c) => {
    const isActive = c.dataset.mode === state.chatMode;
    c.classList.toggle("active", isActive);
    c.setAttribute("aria-pressed", String(isActive));
    c.onclick = () => {
      if (state.chatMode === c.dataset.mode) return;
      state.chatMode = c.dataset.mode;
      // The chips silently changed Vera's framing with zero acknowledgment — first-time users
      // couldn't tell anything happened and ignored one of the app's better features.
      toast(MODE_CHANGE_NOTE[state.chatMode] || "Mode changed");
      renderChat();
    };
  });
}

const MODE_CHANGE_NOTE = {
  tonight: "Home mode — pairing what's on tonight's table",
  store: "Store mode — shelf picks in your budget",
  restaurant: "Restaurant mode — list navigation & value calls",
  chat: "Anything goes — ask away",
};

// Feeds the visually-hidden #chat-live region (see index.html) so screen readers hear ONLY the
// newest reply — aria-live on #chat-scroll itself made every renderChat() rebuild re-announce
// the entire conversation.
function announceForScreenReader(text) {
  const live = $("#chat-live");
  if (live) live.textContent = String(text || "").slice(0, 400);
}

function msgEl(m) {
  const el = document.createElement("div");
  el.className = "msg " + m.role;
  const inner = document.createElement("div");
  inner.className = "bubble";
  if (m.dataUrl) {
    const im = document.createElement("img");
    im.src = m.dataUrl;
    im.className = "msg-photo";
    inner.appendChild(im);
  }
  if (m.text) {
    const t = document.createElement("div");
    t.innerHTML = esc(m.text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
    inner.appendChild(t);
  }
  if (m.role === "assistant") {
    const av = document.createElement("div");
    av.className = "vera-avatar sm";
    av.textContent = "V";
    el.appendChild(av);
  }
  el.appendChild(inner);
  if (m.retry) {
    // Timed-out replies get a real retry affordance instead of a dead-end error bubble —
    // tapping it resends the exact request that failed (see retryVeraMessage).
    el.classList.add("msg-retry");
    inner.title = "Tap to retry";
    inner.addEventListener("click", () => retryVeraMessage(m));
  }
  if (m.cards && m.cards.length) {
    const cardWrap = document.createElement("div");
    cardWrap.className = "msg-cards";
    m.cards.forEach((c) => cardWrap.appendChild(wineCardEl(c, "vera/" + state.chatMode)));
    el.appendChild(cardWrap);
  }
  return el;
}

function onChatSubmit(e) {
  e.preventDefault();
  const input = $("#chat-input");
  const text = input.value.trim();
  if (!text || state.busy) return;
  input.value = "";
  sendToVera(text);
}

// Re-sends the exact request behind a failed (timed-out) reply — removes the dead error
// bubble and re-runs the request with the same text/image, without duplicating the user's
// original message bubble (it's already in state.chat from the first attempt).
function retryVeraMessage(failedMsg) {
  if (state.busy) return;
  const idx = state.chat.indexOf(failedMsg);
  if (idx !== -1) state.chat.splice(idx, 1);
  renderChat();
  requestVeraReply(failedMsg.retryText, failedMsg.retryImage);
}

async function sendToVera(text, image) {
  const userMsg = { role: "user", text, dataUrl: image ? image.dataUrl : null };
  state.chat.push(userMsg);
  SommDB.saveMessage("user", text, state.chatMode);
  renderChat();
  scrollChat();
  await requestVeraReply(text, image);
}

// Does the actual AI call + typing indicator + error handling. Split out from sendToVera so
// retryVeraMessage can re-run just this part without re-pushing the user's message.
async function requestVeraReply(text, image) {
  // Capture BEFORE disabling the input below — refocusing unconditionally in `finally`
  // re-opened the software keyboard over the reply the user is about to read, even when the
  // message came from a starter chip or scan handoff where they never touched the keyboard.
  const inputWasFocused = document.activeElement === $("#chat-input");
  const typing = document.createElement("div");
  typing.className = "msg assistant typing";
  typing.innerHTML = `<div class="vera-avatar sm">V</div><div class="bubble"><span class="tdot"></span><span class="tdot"></span><span class="tdot"></span></div>`;
  $("#chat-scroll").appendChild(typing);
  scrollChat();
  state.busy = true;
  $("#chat-input").disabled = true;
  $("#chat-form").querySelector("button[type=submit]").disabled = true;

  // After 4 s, show a reassuring note so users don't think it's broken.
  const THINKING_MSGS = [
    "Checking your palate profile…",
    "Almost there — Vera thinks carefully…",
    "Pulling from the cellar…",
  ];
  let thinkIdx = 0;
  const thinkTimer = setTimeout(() => {
    const bubble = typing.querySelector(".bubble");
    if (bubble) {
      bubble.innerHTML = `<span class="tdot"></span><span class="tdot"></span><span class="tdot"></span> <span class="typing-note">${esc(THINKING_MSGS[thinkIdx])}</span>`;
      thinkIdx = (thinkIdx + 1) % THINKING_MSGS.length;
    }
  }, 4000);

  try {
    // Build API messages from recent history (text-only for old turns).
    const recent = state.chat.slice(-12);
    const apiMessages = recent.map((m, i) => {
      const isLast = i === recent.length - 1;
      if (m.role === "user" && isLast && image) {
        return {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.b64 } },
            { type: "text", text: `${scanModeNote(image.scanMode)}\n\n${m.text}` },
          ],
        };
      }
      return { role: m.role, content: (m.dataUrl ? "[photo sent earlier] " : "") + (m.text || "…") };
    });

    const system = SommAI.buildSystemPrompt(state.profile, state.chatMode, state.settings.currency);
    // Vision needs Opus; plain-text chat turns run on the cheaper Sonnet tier — same
    // approach for both abuse-cost control and everyday margin, since most chat turns
    // never touch an image. See backend/server.js for the matching per-day token budget.
    const res = await SommAI.callAI({
      messages: apiMessages,
      system,
      provider: "claude",
      model: image ? "claude-opus-4-8" : "claude-sonnet-5",
      maxTokens: 1500,
      authToken: SommAuth.getUser() ? await SommAuth.getAccessToken() : null,
    });
    const { prose, cards } = SommAI.parseWineCards(res.text);
    state.chat.push({ role: "assistant", text: prose, cards });
    SommDB.saveMessage("assistant", prose, state.chatMode, cards);
    announceForScreenReader(prose);
  } catch (err) {
    // Timeouts are the one failure mode worth a real retry affordance — network errors and
    // rate/budget limits need the user to actually do something different (check connection,
    // wait), so only wire up "tap to retry" for the timeout case (see ai.js's AbortError copy).
    const isTimeout = /tap to try again/i.test(err.message);
    SommDB.logError("client", `chat:${state.chatMode}`, err);
    state.chat.push({
      role: "assistant",
      text: `⚠️ ${err.message}`,
      retry: isTimeout ? true : null,
      retryText: isTimeout ? text : null,
      retryImage: isTimeout ? image : null,
    });
    announceForScreenReader(err.message);
  } finally {
    clearTimeout(thinkTimer);
    $("#chat-input").disabled = false;
    $("#chat-form").querySelector("button[type=submit]").disabled = false;
    if (inputWasFocused) $("#chat-input").focus();
    state.busy = false;
    saveChat();
    renderChat();
    scrollChat();
  }
}

function scanModeNote(mode) {
  return {
    bottle: "[The user snapped a single BOTTLE photo.]",
    shelf: "[The user snapped a STORE SHELF photo.]",
    list: "[The user snapped a RESTAURANT WINE LIST photo.]",
    menu: "[The user snapped a FOOD MENU photo.]",
  }[mode] || "";
}

function scrollChat() {
  const s = $("#chat-scroll");
  s.scrollTop = s.scrollHeight;
}

// ============================== YOU (profile + settings) ==============================
function renderYou() {
  const p = state.profile;
  const wrap = $("#you-content");
  const conf = SommProfile.confidencePct(p);
  const user = SommAuth.getUser();

  const dimBars = SommProfile.DIM_KEYS.map((k) => `
    <div class="bar-row">
      <span class="bar-label">${SommProfile.DIM_LABELS[k]}</span>
      <div class="bar"><div class="bar-fill" style="width:${Math.round(p.dims[k] * 100)}%"></div></div>
      <span class="bar-val">${p.dims[k] < .33 ? "Low" : p.dims[k] < .66 ? "Med" : "High"}</span>
    </div>`).join("");

  const typeChips = SommProfile.TYPE_KEYS.map((t) => {
    const off = p.nos.includes(t);
    return `<span class="type-chip ${off ? "off" : ""}" style="--w:${p.types[t]}">${SommProfile.TYPE_LABELS[t]} ${off ? "✕" : Math.round(p.types[t] * 100) + "%"}</span>`;
  }).join("");

  const lovedGrapes = Object.entries(p.grapes).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const journal = p.history.slice(0, 25).map((h) => `
    <div class="j-row">
      <span class="j-dot ${h.rating}"></span>
      <div class="j-main">
        <div class="j-name">${esc(h.name)}</div>
        <div class="j-meta">${esc([h.grape, h.region].filter(Boolean).join(" · "))}</div>
      </div>
      <span class="j-date">${new Date(h.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
    </div>`).join("");

  const authSection = user
    ? `<div class="user-card">
        <div class="user-avatar">${esc((user.email || "?")[0].toUpperCase())}</div>
        <div class="user-info">
          <div class="user-name">${esc(user.user_metadata?.display_name || p.name || user.email?.split("@")[0] || "Wine lover")}</div>
          <div class="user-email">${esc(user.email || "")}</div>
        </div>
        <button class="btn-ghost" id="you-signout">Sign out</button>
      </div>
      <p class="privacy-note">Synced to the cloud: your chat history, ratings and taste profile. Stored in Supabase, tied to this account, kept until you delete it below.</p>`
    : `<div class="signin-nudge">
        <p>Sign in to remember your palate across devices — your ratings and preferences travel with you.</p>
        <button class="btn btn-primary" id="you-signin">Sign in / Create account</button>
        <p class="privacy-note">Signing in syncs your taste profile, ratings and journal across your devices, and backs up your chat messages — all stored in our cloud database (Supabase) indefinitely, tied to your account. Nothing is shared or sold, and you can delete it anytime from this tab once signed in.</p>
      </div>`;

  wrap.innerHTML = authSection + `
    <div class="you-head">
      <div class="you-conf-ring" style="--pct:${conf}">
        <span class="you-conf-num">${conf}%</span>
      </div>
      <div>
        <h2>${esc(p.name || "Your palate")}</h2>
        <p class="muted">${p.ratingCount} wines rated · profile ${conf < 40 ? "warming up" : conf < 70 ? "taking shape" : "sharp"}</p>
      </div>
    </div>

    <section class="panel">
      <h3>Palate</h3>
      ${dimBars}
      <div class="type-chips">${typeChips}</div>
      ${lovedGrapes.length ? `<p class="muted">Loves: ${lovedGrapes.map(([g]) => esc(g.replace(/_/g, " "))).join(", ")}</p>` : ""}
      ${p.nos.length ? `<p class="muted">Hard nos: ${p.nos.map(esc).join(", ")}</p>` : ""}
    </section>

    <section class="panel">
      <h3>Budget <span class="muted">(per bottle, in ${esc(state.settings.currency)})</span></h3>
      <div class="budget-row"><label id="b-store-label">Store</label>
        <input type="number" id="b-store-min" value="${SommAI.convertFromEUR(p.budget.store[0], state.settings.currency)}" min="1" aria-label="Store budget minimum" aria-describedby="b-store-label"> –
        <input type="number" id="b-store-max" value="${SommAI.convertFromEUR(p.budget.store[1], state.settings.currency)}" min="1" aria-label="Store budget maximum" aria-describedby="b-store-label">
      </div>
      <div class="budget-row"><label id="b-rest-label">Restaurant</label>
        <input type="number" id="b-rest-min" value="${SommAI.convertFromEUR(p.budget.restaurant[0], state.settings.currency)}" min="1" aria-label="Restaurant budget minimum" aria-describedby="b-rest-label"> –
        <input type="number" id="b-rest-max" value="${SommAI.convertFromEUR(p.budget.restaurant[1], state.settings.currency)}" min="1" aria-label="Restaurant budget maximum" aria-describedby="b-rest-label">
      </div>
      <button class="btn btn-outline" id="b-save">Save budget</button>
    </section>

    <section class="panel">
      <h3>Journal</h3>
      ${journal || `<p class="muted">No wines rated yet. Every rating makes me smarter about you.</p>`}
    </section>

    <section class="panel">
      <h3>Settings</h3>
      <label class="field-label">Currency</label>
      <select id="set-currency" class="input" aria-label="Currency">
        ${[["€", "Euro"], ["$", "US Dollar"], ["£", "British Pound"], ["₪", "Israeli Shekel"]]
          .map(([c, name]) => `<option value="${c}" ${state.settings.currency === c ? "selected" : ""}>${c} ${name}</option>`).join("")}
      </select>
      <button class="btn btn-primary" id="set-save">Save settings</button>
      <p class="muted small" style="margin-top: 12px;">✓ Vera AI powered by Claude (via secure backend)</p>
      <p class="muted small">No API keys needed — just chat and scan. All requests are private.</p>
      <p class="muted small">Free during beta — we'll tell you before anything changes.</p>
    </section>

    <section class="panel">
      <h3>Something off?</h3>
      <p class="muted small">Beta bug, bad rec, missing feature — tell us and we'll see it.</p>
      <button class="btn btn-outline" id="you-feedback-btn">Tell Vera →</button>
      <div id="you-feedback-form" hidden style="margin-top: 10px;">
        <textarea id="you-feedback-text" class="input" rows="3" placeholder="What happened, or what would make this better?"></textarea>
        <button class="btn btn-primary" id="you-feedback-send" style="margin-top: 8px;">Send feedback</button>
      </div>
    </section>

    <section class="panel danger-zone">
      <button class="btn-ghost" id="p-export">Export profile</button>
      <button class="btn-ghost" id="p-redo">Redo onboarding</button>
      ${user ? `<button class="btn-ghost danger" id="p-delete-cloud">Delete my cloud data</button>` : ""}
      <button class="btn-ghost danger" id="p-reset">Reset everything</button>
      <a class="btn-ghost" href="privacy.html" target="_blank" rel="noopener noreferrer" style="display:block">Privacy &amp; Terms</a>
    </section>`;

  $("#b-save").addEventListener("click", () => {
    // Inputs are edited in the user's display currency (labeled above); the engine and quiz
    // bands are EUR reference values, so convert back on save. Also silently swap inverted
    // ranges (min > max) rather than saving a band no wine can match.
    const cur = state.settings.currency;
    const band = (lo, hi, dLo, dHi) => {
      let a = SommAI.convertToEUR(Number(lo), cur) || dLo, b = SommAI.convertToEUR(Number(hi), cur) || dHi;
      return a > b ? [b, a] : [a, b];
    };
    p.budget.store = band($("#b-store-min").value, $("#b-store-max").value, 1, 25);
    p.budget.restaurant = band($("#b-rest-min").value, $("#b-rest-max").value, 1, 65);
    $("#b-store-min").value = SommAI.convertFromEUR(p.budget.store[0], cur); $("#b-store-max").value = SommAI.convertFromEUR(p.budget.store[1], cur);
    $("#b-rest-min").value = SommAI.convertFromEUR(p.budget.restaurant[0], cur); $("#b-rest-max").value = SommAI.convertFromEUR(p.budget.restaurant[1], cur);
    SommProfile.saveProfile(p);
    toast("Budget saved");
  });
  $("#set-save").addEventListener("click", () => {
    state.settings.currency = $("#set-currency").value;
    SommProfile.saveSettings(state.settings);
    toast("Settings saved");
  });
  $("#you-feedback-btn").addEventListener("click", () => {
    const form = $("#you-feedback-form");
    form.hidden = !form.hidden;
    if (!form.hidden) $("#you-feedback-text").focus();
  });
  $("#you-feedback-send").addEventListener("click", async () => {
    const text = $("#you-feedback-text").value.trim();
    if (!text) return;
    const btn = $("#you-feedback-send");
    btn.disabled = true;
    btn.textContent = "Sending…";
    const result = await SommDB.saveFeedback(text, "you-tab");
    btn.disabled = false;
    btn.textContent = "Send feedback";
    if (result.ok) {
      $("#you-feedback-text").value = "";
      $("#you-feedback-form").hidden = true;
      toast("Thanks — got it ✓");
    } else {
      toast("Couldn't send that — try again in a bit");
    }
  });
  $("#p-export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ profile: p, settings: state.settings }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "somm-profile.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("#p-redo").addEventListener("click", async () => {
    if (await sommConfirm("Redo the onboarding quiz? This resets your quiz-based taste dimensions and budget — your journal, ratings and everything Vera has learned from them are kept.", { confirmLabel: "Redo quiz" })) {
      state.profile.onboarded = false;
      showOnboarding();
    }
  });
  $("#p-reset").addEventListener("click", async () => {
    if (await sommConfirm("Erase profile, journal, chat and settings on this device?", { confirmLabel: "Erase everything", danger: true })) {
      clearAllLocalData();
      location.reload();
    }
  });

  if (user) {
    $("#you-signout").addEventListener("click", async () => {
      await SommAuth.signOut();
      toast("Signed out");
    });
    const deleteBtn = $("#p-delete-cloud");
    if (deleteBtn) deleteBtn.addEventListener("click", async () => {
      const ok = await sommConfirm("Permanently delete your ratings, chat history and taste profile from our servers, sign you out, and reset this device? This can't be undone. (Your sign-in account itself is not deleted — you can create a fresh profile with the same email.)", { confirmLabel: "Delete permanently", danger: true });
      if (!ok) return;
      deleteBtn.disabled = true;
      deleteBtn.textContent = "Deleting…";
      const result = await SommDB.deleteMyData();
      if (!result.ok) {
        toast("Couldn't delete cloud data: " + (result.error || "unknown error"));
        deleteBtn.disabled = false;
        deleteBtn.textContent = "Delete my cloud data";
        return;
      }
      await SommAuth.signOut();
      clearAllLocalData();
      location.reload();
    });
  } else {
    $("#you-signin").addEventListener("click", () => showAuthModal());
  }
}

// Both destructive flows above must clear EVERY somm.* key, not just profile/chat/settings —
// LAST_SCANS_KEY holds actual photo dataUrls, and leaving those behind after "Erase everything"
// contradicts both the reset promise and the Scan tab's "photos are not stored" copy.
// Enumerating localStorage (rather than listing keys) means a future somm.* key can't be
// forgotten here again.
function clearAllLocalData() {
  const doomed = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("somm.")) doomed.push(k);
  }
  doomed.forEach((k) => localStorage.removeItem(k));
}

// ============================== GENERIC DIALOG ==============================
// On-brand replacement for window.confirm()/window.prompt() — the rest of the app (auth modal,
// You-tab feedback) uses custom-styled components with a focus trap, so a sudden unstyled OS
// dialog (no app branding, especially jarring in an installed PWA) read as an unfinished
// corner. Single reusable dialog backing both sommConfirm() and sommPrompt() below.
let dlgPrevFocus = null; // element to return focus to when the dialog closes
let dlgResolve = null;   // resolves the promise returned by sommConfirm/sommPrompt

function openDlg({ message, isPrompt, placeholder, value, confirmLabel, cancelLabel, danger }) {
  return new Promise((resolve) => {
    dlgResolve = resolve;
    const modal = $("#dlg-modal");
    dlgPrevFocus = document.activeElement;
    $("#dlg-message").textContent = message;
    const input = $("#dlg-input");
    $("#dlg-input-wrap").hidden = !isPrompt;
    input.value = value || "";
    input.placeholder = placeholder || "";
    const confirmBtn = $("#dlg-confirm");
    confirmBtn.textContent = confirmLabel || (isPrompt ? "Send" : "OK");
    confirmBtn.classList.toggle("danger", !!danger);
    $("#dlg-cancel").textContent = cancelLabel || "Cancel";
    modal.hidden = false;
    history.pushState({ sommOverlay: "dlg" }, "");
    (isPrompt ? input : confirmBtn).focus();
  });
}

// Raw hide — used both by popstate (browser already moved past our pushed entry) and by
// closeDlg() below. Mirrors hideAuthModal()'s focus-restore behavior.
function hideDlg() {
  const modal = $("#dlg-modal");
  if (modal.hidden) return;
  modal.hidden = true;
  if (dlgPrevFocus && typeof dlgPrevFocus.focus === "function") dlgPrevFocus.focus();
  dlgPrevFocus = null;
}

// UI-triggered close (Cancel, backdrop, Escape, OK/Send). `result` is `false`/`null` for a
// cancel, or `true`/the trimmed input string for a confirm — resolves whichever promise
// sommConfirm/sommPrompt handed back to the caller.
function closeDlg(result) {
  if ($("#dlg-modal").hidden) return;
  hideDlg();
  if (history.state && history.state.sommOverlay === "dlg") {
    // The dialog can be opened ON TOP of the scan-result error screen (the "Something off?
    // Tell Vera" fallback) — if that screen is still open underneath, the replaced entry must
    // stay tagged as the scan-result overlay, same reasoning as closeAuthModal.
    const under = $("#screen-scan-result").hidden ? { sommTab: state.tab } : { sommOverlay: "scanresult" };
    history.replaceState(under, "");
  }
  const resolve = dlgResolve;
  dlgResolve = null;
  if (resolve) resolve(result);
}

// Promise<boolean> — replacement for `confirm(message)`.
function sommConfirm(message, opts) {
  return openDlg({ message, isPrompt: false, ...opts });
}

// Promise<string|null> — replacement for `prompt(message)`. Resolves the trimmed input string
// on submit, or null on cancel/Escape/backdrop (never an empty string — same as openDlg's
// "empty submit does nothing" guard on the confirm button).
function sommPrompt(message, opts) {
  return openDlg({ message, isPrompt: true, ...opts }).then((v) => (v === false ? null : v));
}

document.addEventListener("DOMContentLoaded", () => {
  // Scan source chooser — closing BEFORE .click() matters: some Android browsers suppress the
  // file/camera picker if a modal grabs focus at the same moment it opens.
  $("#src-camera").addEventListener("click", () => { closeScanSourceChooser(); $("#scan-input-camera").click(); });
  $("#src-gallery").addEventListener("click", () => { closeScanSourceChooser(); $("#scan-input").click(); });
  $("#src-cancel").addEventListener("click", () => closeScanSourceChooser());
  $("#src-close").addEventListener("click", () => closeScanSourceChooser());
  document.addEventListener("keydown", (e) => {
    if ($("#src-modal").hidden) return;
    if (e.key === "Escape") { closeScanSourceChooser(); return; }
    if (e.key !== "Tab") return;
    const focusable = focusableEls($("#src-modal .dlg-card"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  $("#dlg-cancel").addEventListener("click", () => closeDlg(false));
  $("#dlg-close").addEventListener("click", () => closeDlg(false));
  $("#dlg-confirm").addEventListener("click", () => {
    const isPrompt = !$("#dlg-input-wrap").hidden;
    if (isPrompt) {
      const val = $("#dlg-input").value.trim();
      if (!val) return; // same as native prompt() — empty submit does nothing
      closeDlg(val);
    } else {
      closeDlg(true);
    }
  });
  document.addEventListener("keydown", (e) => {
    if ($("#dlg-modal").hidden) return;
    if (e.key === "Escape") { closeDlg(false); return; }
    if (e.key !== "Tab") return;
    // Scoped under #dlg-modal — a bare $(".dlg-card") would grab #src-modal's card instead,
    // since that modal shares the class and appears earlier in the DOM.
    const focusable = focusableEls($("#dlg-modal .dlg-card"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
});

// ============================== AUTH MODAL ==============================
let authPrevFocus = null; // element to return focus to when the modal closes

// Focusable elements within container, in DOM/tab order — used for the modal's focus trap.
function focusableEls(container) {
  return $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', container)
    .filter((el) => !el.hidden && el.offsetParent !== null);
}

function showAuthModal() {
  const modal = $("#auth-modal");
  if (!modal.hidden) return; // already open
  authPrevFocus = document.activeElement;
  modal.hidden = false;
  history.pushState({ sommOverlay: "auth" }, "");
  const first = focusableEls($(".auth-card"))[0];
  (first || $(".auth-card")).focus();
}

// Raw hide — used both by popstate (browser already moved past our pushed entry) and by
// closeAuthModal() below. Restores focus to whatever had it before the modal opened, since a
// screen-reader/keyboard user's context would otherwise be silently lost.
function hideAuthModal() {
  const modal = $("#auth-modal");
  if (modal.hidden) return;
  modal.hidden = true;
  if (authPrevFocus && typeof authPrevFocus.focus === "function") authPrevFocus.focus();
  authPrevFocus = null;
}

// UI-triggered close (X button, backdrop, "continue without signing in", successful
// sign-in/up). Replaces (rather than pops) the pushed "auth" history entry so the back stack
// doesn't grow on repeated opens, without the async race a history.back() here would risk if
// the caller immediately does more navigation afterward (e.g. nothing currently does, but
// keeping this symmetric with closeScanResultScreen avoids that footgun for future callers).
function closeAuthModal() {
  if ($("#auth-modal").hidden) return;
  hideAuthModal();
  if (history.state && history.state.sommOverlay === "auth") {
    // Auth can be opened ON TOP of the scan-result error screen (see the "Sign in for your own
    // budget" fallback) — if that screen is still open underneath, the replaced entry must stay
    // tagged as the scan-result overlay, not collapse to a bare tab entry, so a follow-up back
    // press still closes it in one step instead of doing nothing.
    const under = $("#screen-scan-result").hidden ? { sommTab: state.tab } : { sommOverlay: "scanresult" };
    history.replaceState(under, "");
  }
}

// Keyboard trap: Tab/Shift+Tab cycle within the modal instead of escaping to page content
// behind the overlay, and Escape closes it — standard dialog behavior for keyboard/screen-
// reader users, which #auth-modal previously had none of (no role=dialog either, fixed below).
document.addEventListener("keydown", (e) => {
  if ($("#auth-modal").hidden) return;
  if (e.key === "Escape") { closeAuthModal(); return; }
  if (e.key !== "Tab") return;
  const focusable = focusableEls($(".auth-card"));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

// Switches which sub-view of the auth modal is visible: "signin" (sign in/up form),
// "forgot" (request a reset email), "sent" (confirmation), or "newpw" (set a new password,
// reached via the emailed recovery link — see onAuthStateChange's PASSWORD_RECOVERY handler).
function setAuthView(view) {
  $("#auth-tab-row").hidden = view !== "signin";
  $("#auth-form").hidden = view !== "signin";
  $("#auth-forgot-link").hidden = view !== "signin";
  $("#auth-oauth-block").hidden = view !== "signin";
  $("#auth-forgot-view").hidden = view !== "forgot";
  $("#auth-forgot-sent").hidden = view !== "sent";
  $("#auth-newpw-view").hidden = view !== "newpw";
}

function bindAuthModal() {
  let mode = "signin";
  setAuthView("signin");

  function setMode(m) {
    mode = m;
    $("#at-signin").classList.toggle("active", m === "signin");
    $("#at-signup").classList.toggle("active", m === "signup");
    $("#auth-name-wrap").hidden = m === "signin";
    $("#auth-submit").textContent = m === "signin" ? "Sign in" : "Create account";
    // new-password tells password managers to OFFER a generated password on signup instead of
    // autofilling the existing one; the min-length hint shows Supabase's rule up front rather
    // than as a rejection after submit.
    $("#auth-password").setAttribute("autocomplete", m === "signin" ? "current-password" : "new-password");
    $("#auth-pw-hint").hidden = m === "signin";
    const err = $("#auth-error");
    err.hidden = true;
    err.textContent = "";
  }

  $("#at-signin").addEventListener("click", () => setMode("signin"));
  $("#at-signup").addEventListener("click", () => setMode("signup"));
  $("#auth-close").addEventListener("click", closeAuthModal);
  $("#auth-skip").addEventListener("click", closeAuthModal);

  $("#auth-google").addEventListener("click", async () => {
    try { await SommAuth.signInWithGoogle(); }
    catch (e) { showAuthError(e.message); }
  });

  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    const name = $("#auth-name").value.trim();
    const btn = $("#auth-submit");
    btn.disabled = true;
    btn.textContent = mode === "signin" ? "Signing in…" : "Creating account…";
    try {
      if (mode === "signup") {
        await SommAuth.signUp(email, password, name);
        toast("Check your email to confirm your account!");
        closeAuthModal();
      } else {
        await SommAuth.signIn(email, password);
        closeAuthModal();
      }
    } catch (err) {
      showAuthError(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = mode === "signin" ? "Sign in" : "Create account";
    }
  });

  // ---- Forgot password ----
  $("#auth-forgot-link").addEventListener("click", () => {
    $("#auth-forgot-email").value = $("#auth-email").value.trim();
    setAuthView("forgot");
  });
  $("#auth-forgot-back").addEventListener("click", () => setAuthView("signin"));
  $("#auth-forgot-done").addEventListener("click", () => setAuthView("signin"));

  $("#auth-forgot-submit").addEventListener("click", async () => {
    const email = $("#auth-forgot-email").value.trim();
    const errEl = $("#auth-forgot-error");
    errEl.hidden = true;
    if (!email) { errEl.textContent = "Enter your email first."; errEl.hidden = false; return; }
    const btn = $("#auth-forgot-submit");
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      await SommAuth.resetPasswordForEmail(email);
      $("#auth-forgot-sent-email").textContent = email;
      setAuthView("sent");
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Send reset link";
    }
  });

  // ---- Set new password (reached from the emailed recovery link) ----
  $("#auth-newpw-submit").addEventListener("click", async () => {
    const pw = $("#auth-newpw").value;
    const errEl = $("#auth-newpw-error");
    errEl.hidden = true;
    if (!pw || pw.length < 6) {
      errEl.textContent = "Password must be at least 6 characters.";
      errEl.hidden = false;
      return;
    }
    const btn = $("#auth-newpw-submit");
    btn.disabled = true;
    btn.textContent = "Updating…";
    try {
      await SommAuth.updatePassword(pw);
      toast("Password updated ✓");
      $("#auth-newpw").value = "";
      closeAuthModal();
      setAuthView("signin");
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Update password";
    }
  });
}

function showAuthError(msg) {
  const el = $("#auth-error");
  el.textContent = msg;
  el.hidden = false;
}
