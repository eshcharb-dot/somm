// Somm — app shell: onboarding, tabs, chat, scan, profile.
"use strict";

const CHAT_KEY = "somm.chat.v1";

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
});

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
    state.profile.name = cloud.display_name || state.profile.name;
    state.profile.dims = { ...state.profile.dims, ...(cloud.palate || {}) };
    if (typeof cloud.adventurousness === "number") state.profile.adventure = cloud.adventurousness;
    state.profile.ratingCount = cloud.ratings_count;
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
        <input id="onb-name" class="input" type="text" placeholder="What should I call you? (optional)" maxlength="24" autocomplete="given-name" />
        <label class="onb-agegate">
          <input type="checkbox" id="onb-agegate">
          <span>I confirm I'm of legal drinking age in my country</span>
        </label>
        <button class="btn btn-primary btn-block" id="onb-start" disabled>Let's go</button>
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
        ${q.options.map((o, i) => `<button class="opt" data-i="${i}">${esc(o.label)}</button>`).join("")}
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
    if (picked.has(i)) btn.classList.add("sel");
  });
  if (q.multi) $("#quiz-next").disabled = picked.size === 0;
  $$(".opt", wrap).forEach((btn) => btn.addEventListener("click", () => {
    const i = Number(btn.dataset.i);
    if (q.multi) {
      const isNone = !q.options[i].fx || !Object.keys(q.options[i].fx).length;
      if (isNone) { picked.clear(); $$(".opt", wrap).forEach((b) => b.classList.remove("sel")); }
      else {
        // deselect the "none" option if it was picked
        q.options.forEach((o, j) => {
          if (!o.fx || !Object.keys(o.fx).length) { picked.delete(j); $$(".opt", wrap)[j].classList.remove("sel"); }
        });
      }
      if (picked.has(i)) { picked.delete(i); btn.classList.remove("sel"); }
      else { picked.add(i); btn.classList.add("sel"); }
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

function switchTab(tab) {
  state.tab = tab;
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".tab").forEach((t) => { t.hidden = t.id !== "tab-" + tab; });
  if (tab === "you") renderYou();
  if (tab === "vera") { renderChat(); $("#chat-scroll").scrollTop = $("#chat-scroll").scrollHeight; }
  if (tab === "scan") renderScanHint();
  if (tab === "tonight") renderTonightGreeting();
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

function wineCardEl(card, context) {
  const el = document.createElement("div");
  el.className = "wine-card";
  const typeClass = { red: "t-red", white: "t-white", rose: "t-rose", sparkling: "t-spark", orange: "t-orange", dessert: "t-dessert" }[card.type] || "t-red";
  el.innerHTML = `
    <div class="wc-head">
      <span class="wc-type ${typeClass}">${esc((SommProfile.TYPE_LABELS[card.type] || card.type || "wine").toUpperCase())}</span>
      <span class="wc-match">${card.match != null ? esc(String(card.match)) + "% match" : ""}</span>
    </div>
    <div class="wc-name">${esc(card.name)}</div>
    <div class="wc-meta">${esc([card.grape, card.region].filter(Boolean).join(" · "))}${card.price ? ` · <strong>${esc(card.price)}</strong>` : ""}</div>
    <a class="wc-buy" href="https://www.wine-searcher.com/find/${encodeURIComponent(card.name)}" target="_blank" rel="noopener noreferrer">Find online →</a>
    ${card.why ? `<div class="wc-why">${esc(card.why)}</div>` : ""}
    ${card.pairing ? `<div class="wc-pair">🍽 ${esc(card.pairing)}</div>` : ""}
    <div class="wc-actions">
      <button class="rate" data-r="love">♥ Loved it</button>
      <button class="rate" data-r="ok">Fine</button>
      <button class="rate" data-r="no">Not for me</button>
    </div>`;
  $$(".rate", el).forEach((btn) => btn.addEventListener("click", () => {
    const rating = btn.dataset.r;
    const wine = {
      name: card.name, region: card.region, grape: card.grape, type: card.type,
      attrs: card.attrs, price: card.price,
    };
    SommProfile.learnFromRating(state.profile, wine, rating, context);
    const dbRating = rating === "love" ? "loved" : rating === "ok" ? "fine" : "skip";
    SommDB.saveRating(wine, dbRating, context);
    SommDB.saveProfile(state.profile, state.settings);
    $(".wc-actions", el).innerHTML = `<span class="rated">${
      rating === "love" ? "Noted — more like this ♥" : rating === "ok" ? "Noted." : "Got it — steering away."
    } <em>(profile ${SommProfile.confidencePct(state.profile)}%)</em></span>`;
  }));
  return el;
}

// ============================== TONIGHT ==============================
function renderTonightGreeting() {
  const p = state.profile;
  const h = new Date().getHours();
  const part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  $("#tonight-greet").textContent =
    `Good ${part}${p.name ? ", " + p.name : ""}. What's on the table tonight?`;

  // Daily pour: keep the screen alive before the first search.
  const wrap = $("#tonight-results");
  if (!wrap.childElementCount) {
    const pool = SOMM_DATA.WINES.filter((w) => SommProfile.wineAllowed(p, w));
    if (pool.length) {
      const day = Math.floor(Date.now() / 86400000);
      const ranked = pool.map((w) => ({ w, m: SommProfile.matchPct(p, w) }))
        .sort((a, b) => b.m - a.m).slice(0, 7);
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
  const intro = document.createElement("div");
  intro.className = "vera-line";
  intro.innerHTML = `<div class="vera-avatar sm">V</div><div class="vera-bubble">Your shopping shortlist — styles to grab in your budget (${state.settings.currency}${state.profile.budget.store[0]}–${state.profile.budget.store[1]}):</div>`;
  wrap.appendChild(intro);
  recs.forEach(({ wine, score }) => wrap.appendChild(wineCardEl(localCard(wine, score), "store list")));

  const ask = document.createElement("button");
  ask.className = "btn btn-outline btn-block";
  ask.textContent = "Ask Vera to go deeper →";
  ask.addEventListener("click", () => {
    state.chatMode = "store";
    switchTab("vera");
    sendToVera(`Shopping list — my budget is ${state.settings.currency}${state.profile.budget.store[0]}–${state.profile.budget.store[1]}. Which of these styles should I prioritise and why?`);
  });
  wrap.appendChild(ask);
}

// ============================== SCAN ==============================
function renderScanHint() {
  $("#scan-nokey").hidden = true;
  $("#scan-ready").hidden = false;
}

function scanWith(mode) {
  state.pendingScanMode = mode;
  $("#scan-input").click();
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
      messages, system, provider: "claude", model: "claude-opus-4-8", maxTokens: 2000,
      authToken: SommAuth.getUser() ? await SommAuth.getAccessToken() : null,
    });
    const result = SommAI.parseScanResult(res.text);
    if (!result) throw new Error("Vera couldn't structure the analysis. Try a clearer photo or use chat.");
    showScanResultScreen(img, mode, result);
  } catch (err) {
    showScanResultScreen(img, mode, { error: err.message || "Analysis failed — try again." });
  }
}

function showScanResultScreen(img, mode, result) {
  const screen = $("#screen-scan-result");
  const modeLabel = { bottle: "Bottle", shelf: "Shelf Scan", list: "Wine List", menu: "Food Menu" }[mode] || "Scan";
  screen.hidden = false;

  if (!result) {
    const loadSub = {
      bottle: "Reading the label, checking your profile fit…",
      shelf: "Scanning bottles, matching to your palate…",
      list: "Finding the best value picks for you…",
      menu: "Planning your perfect pairing…",
    }[mode] || "Analyzing…";
    screen.innerHTML = `
      <div class="sr-loading">
        <div class="sr-topbar"><span class="sr-mode-tag">${esc(modeLabel)}</span></div>
        <img src="${img.dataUrl}" class="sr-photo" alt="Scanning">
        <div class="sr-loading-msg">
          <div class="vera-avatar">V</div>
          <div>
            <div class="sr-loading-title">Vera is looking…</div>
            <div class="sr-loading-sub">${esc(loadSub)}</div>
          </div>
        </div>
        <div class="sr-spinner"></div>
      </div>`;
    return;
  }

  if (result.error) {
    // The shared anon per-IP budget can be exhausted by several beta testers on the same
    // wifi hitting the same daily cap — nudge sign-in (which gets its own, larger, per-account
    // budget) rather than leaving people to assume the app itself is broken.
    const isBudgetErr = /budget/i.test(result.error);
    const showSignIn = isBudgetErr && !SommAuth.getUser();
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
              <button class="btn btn-outline" style="margin-top:10px" id="sr-chat-fb">Try in chat instead →</button>
            </div>
          </div>
        </div>
      </div>`;
    $("#sr-back").addEventListener("click", hideScanResultScreen);
    $("#sr-chat-fb").addEventListener("click", () => openScanInChat(img, mode));
    if (showSignIn) $("#sr-signin-fb").addEventListener("click", showAuthModal);
    return;
  }

  const picks = result.picks || [];
  const picksHeading = { bottle: "The verdict", menu: "Wine pairings", list: "Best picks", shelf: "Grab these" }[mode] || "Your picks";

  screen.innerHTML = `
    <div class="sr-wrap">
      <div class="sr-topbar">
        <button class="sr-back" id="sr-back">← Back</button>
        <span class="sr-mode-tag">${esc(modeLabel)}</span>
      </div>
      <img src="${img.dataUrl}" class="sr-photo" alt="Your scan">
      <div class="sr-body">
        <div class="sr-summary">
          <div class="vera-avatar sm">V</div>
          <div class="vera-bubble">${esc(result.summary || "Here's what I found.")}</div>
        </div>
        ${picks.length ? `<h3 class="sr-picks-head">${esc(picksHeading)}</h3>` : ""}
        <div id="sr-picks-list"></div>
        <button class="btn btn-outline btn-block" id="sr-chat-cta">Ask Vera for more →</button>
      </div>
    </div>`;

  const picksWrap = $("#sr-picks-list");
  picks.forEach((pick) => picksWrap.appendChild(srPickCard(pick, mode)));

  $("#sr-back").addEventListener("click", hideScanResultScreen);
  $("#sr-chat-cta").addEventListener("click", () => openScanInChat(img, mode, picks[0]));
}

function srPickCard(pick, context) {
  const el = document.createElement("div");
  el.className = "sr-pick";
  const typeClass = { red: "t-red", white: "t-white", rose: "t-rose", sparkling: "t-spark", orange: "t-orange", dessert: "t-dessert" }[pick.type] || "t-red";
  const pvLower = (pick.price_verdict || "").toLowerCase();
  const priceClass = pvLower.includes("great") ? "sr-price-great" : pvLower.includes("overpriced") ? "sr-price-bad" : "sr-price-ok";
  const metaParts = [pick.grape, pick.region, pick.vintage].filter(Boolean);

  el.innerHTML = `
    <div class="sr-pick-head">
      <span class="sr-rank">#${esc(String(Number(pick.rank) || 0))}</span>
      <span class="wc-type ${typeClass}">${esc((SommProfile.TYPE_LABELS[pick.type] || pick.type || "wine").toUpperCase())}</span>
      <span class="sr-match-pct">${esc(String(Number(pick.match) || 0))}% match</span>
    </div>
    <div class="sr-pick-name">${esc(pick.name)}</div>
    <a class="wc-buy" href="https://www.wine-searcher.com/find/${encodeURIComponent(pick.name)}" target="_blank" rel="noopener noreferrer">Find online →</a>
    <div class="sr-pick-meta">${esc(metaParts.join(" · "))}${pick.label_price ? ` · <strong>${esc(pick.label_price)}</strong>` : ""}</div>
    ${pick.shelf_position ? `<div class="sr-position">📍 ${esc(pick.shelf_position)}</div>` : ""}
    ${pick.match_reason ? `<div class="sr-why">✓ ${esc(pick.match_reason)}</div>` : ""}
    ${pick.price_verdict ? `<div class="sr-price-row"><span class="sr-price ${priceClass}">${esc(pick.price_verdict)}</span><span class="sr-price-caveat" title="AI estimate from training knowledge — not a live price lookup">not a live price check</span></div>` : ""}
    ${pick.market_price_note ? `<div class="sr-market-note">🔍 ${esc(pick.market_price_note)}</div>` : ""}
    ${pick.pairing ? `<div class="wc-pair">🍽 ${esc(pick.pairing)}</div>` : ""}
    <div class="wc-actions">
      <button class="rate" data-r="love">♥ Loved it</button>
      <button class="rate" data-r="ok">Fine</button>
      <button class="rate" data-r="no">Not for me</button>
    </div>`;

  $$(".rate", el).forEach((btn) => btn.addEventListener("click", () => {
    const rating = btn.dataset.r;
    const wine = { name: pick.name, region: pick.region, grape: pick.grape, type: pick.type, attrs: pick.attrs, price: pick.label_price };
    SommProfile.learnFromRating(state.profile, wine, rating, context);
    const dbRating = rating === "love" ? "loved" : rating === "ok" ? "fine" : "skip";
    SommDB.saveRating(wine, dbRating, context);
    SommDB.saveProfile(state.profile, state.settings);
    $(".wc-actions", el).innerHTML = `<span class="rated">${
      rating === "love" ? "Noted — more like this ♥" : rating === "ok" ? "Noted." : "Got it — steering away."
    } <em>(profile ${SommProfile.confidencePct(state.profile)}%)</em></span>`;
  }));
  return el;
}

function hideScanResultScreen() {
  $("#screen-scan-result").hidden = true;
  switchTab("scan");
}

function openScanInChat(img, mode, topPick) {
  hideScanResultScreen();
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
    c.classList.toggle("active", c.dataset.mode === state.chatMode);
    c.onclick = () => { state.chatMode = c.dataset.mode; renderChat(); };
  });
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
  } catch (err) {
    // Timeouts are the one failure mode worth a real retry affordance — network errors and
    // rate/budget limits need the user to actually do something different (check connection,
    // wait), so only wire up "tap to retry" for the timeout case (see ai.js's AbortError copy).
    const isTimeout = /tap to try again/i.test(err.message);
    state.chat.push({
      role: "assistant",
      text: `⚠️ ${err.message}`,
      retry: isTimeout ? true : null,
      retryText: isTimeout ? text : null,
      retryImage: isTimeout ? image : null,
    });
  } finally {
    clearTimeout(thinkTimer);
    $("#chat-input").disabled = false;
    $("#chat-form").querySelector("button[type=submit]").disabled = false;
    $("#chat-input").focus();
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
        <p class="privacy-note">Signing in stores your chat history, ratings and taste profile in our cloud database (Supabase) indefinitely, tied to your account, so they can sync across devices. Nothing is shared or sold, and you can delete it anytime from this tab once signed in.</p>
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
      <h3>Budget <span class="muted">(per bottle)</span></h3>
      <div class="budget-row"><label>Store</label>
        <input type="number" id="b-store-min" value="${p.budget.store[0]}" min="1"> –
        <input type="number" id="b-store-max" value="${p.budget.store[1]}" min="1">
      </div>
      <div class="budget-row"><label>Restaurant</label>
        <input type="number" id="b-rest-min" value="${p.budget.restaurant[0]}" min="1"> –
        <input type="number" id="b-rest-max" value="${p.budget.restaurant[1]}" min="1">
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
      <select id="set-currency" class="input">
        ${["€", "$", "£", "₪"].map((c) => `<option ${state.settings.currency === c ? "selected" : ""}>${c}</option>`).join("")}
      </select>
      <button class="btn btn-primary" id="set-save">Save settings</button>
      <p class="muted small" style="margin-top: 12px;">✓ Vera AI powered by Claude (via secure backend)</p>
      <p class="muted small">No API keys needed — just chat and scan. All requests are private.</p>
    </section>

    <section class="panel danger-zone">
      <button class="btn-ghost" id="p-export">Export profile</button>
      <button class="btn-ghost" id="p-redo">Redo onboarding</button>
      ${user ? `<button class="btn-ghost danger" id="p-delete-cloud">Delete my cloud data</button>` : ""}
      <button class="btn-ghost danger" id="p-reset">Reset everything</button>
      <a class="btn-ghost" href="privacy.html" target="_blank" rel="noopener noreferrer" style="display:block">Privacy &amp; Terms</a>
    </section>`;

  $("#b-save").addEventListener("click", () => {
    p.budget.store = [Number($("#b-store-min").value) || 1, Number($("#b-store-max").value) || 25];
    p.budget.restaurant = [Number($("#b-rest-min").value) || 1, Number($("#b-rest-max").value) || 65];
    SommProfile.saveProfile(p);
    toast("Budget saved");
  });
  $("#set-save").addEventListener("click", () => {
    state.settings.currency = $("#set-currency").value;
    SommProfile.saveSettings(state.settings);
    toast("Settings saved");
  });
  $("#p-export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ profile: p, settings: state.settings }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "somm-profile.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("#p-redo").addEventListener("click", () => {
    if (confirm("Redo the onboarding quiz? This resets your quiz-based taste dimensions and budget — your journal, ratings and everything Vera has learned from them are kept.")) {
      state.profile.onboarded = false;
      showOnboarding();
    }
  });
  $("#p-reset").addEventListener("click", () => {
    if (confirm("Erase profile, journal, chat and settings on this device?")) {
      localStorage.removeItem(PROFILE_KEY);
      localStorage.removeItem(CHAT_KEY);
      localStorage.removeItem(SETTINGS_KEY);
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
      if (!confirm("Permanently delete your ratings, chat history and taste profile from our servers, sign you out, and reset this device? This can't be undone. (Your sign-in account itself is not deleted — you can create a fresh profile with the same email.)")) return;
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
      localStorage.removeItem(PROFILE_KEY);
      localStorage.removeItem(CHAT_KEY);
      localStorage.removeItem(SETTINGS_KEY);
      location.reload();
    });
  } else {
    $("#you-signin").addEventListener("click", () => showAuthModal());
  }
}

// ============================== AUTH MODAL ==============================
function showAuthModal() { $("#auth-modal").hidden = false; }
function hideAuthModal() { $("#auth-modal").hidden = true; }

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
    const err = $("#auth-error");
    err.hidden = true;
    err.textContent = "";
  }

  $("#at-signin").addEventListener("click", () => setMode("signin"));
  $("#at-signup").addEventListener("click", () => setMode("signup"));
  $("#auth-close").addEventListener("click", hideAuthModal);
  $("#auth-skip").addEventListener("click", hideAuthModal);

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
        hideAuthModal();
      } else {
        await SommAuth.signIn(email, password);
        hideAuthModal();
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
      hideAuthModal();
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
