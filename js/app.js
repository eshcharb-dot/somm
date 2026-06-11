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
  // Persist without heavy image data beyond the last 2 photos.
  const slim = state.chat.slice(-40).map((m, i, arr) => {
    if (m.dataUrl && i < arr.length - 4) return { ...m, dataUrl: null };
    return m;
  });
  localStorage.setItem(CHAT_KEY, JSON.stringify(slim));
}

// ============================== BOOT ==============================
document.addEventListener("DOMContentLoaded", () => {
  loadChat();
  if (!state.profile.onboarded) {
    showOnboarding();
  } else {
    showMain();
  }
  bindGlobal();
});

function bindGlobal() {
  $$(".nav-btn").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
  $("#chat-form").addEventListener("submit", onChatSubmit);
  $("#scan-input").addEventListener("change", onScanFile);
  $("#tonight-form").addEventListener("submit", onTonightSubmit);
  $("#btn-surprise").addEventListener("click", () => runTonight("surprise me", true));
  $("#btn-store-picks").addEventListener("click", runStorePicks);
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
        <p class="onb-tag">Your pocket sommelier</p>
        <div class="vera-intro">
          <div class="vera-avatar">V</div>
          <div class="vera-bubble">Hi, I'm <strong>Vera</strong> — your sommelier. Eight quick questions and I'll start
          learning your palate. No wine knowledge needed, I promise. <em>In vino veritas.</em></div>
        </div>
        <input id="onb-name" class="input" type="text" placeholder="What should I call you? (optional)" maxlength="24" autocomplete="given-name" />
        <button class="btn btn-primary btn-block" id="onb-start">Let's go</button>
      </div>`;
    $("#onb-start").addEventListener("click", () => {
      state.profile.name = $("#onb-name").value.trim();
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

  const picked = new Set();
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
  state.profile = SommProfile.buildProfileFromQuiz(state.quizAnswers);
  state.profile.name = name;
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
  return {
    name: wine.name, region: wine.region, grape: wine.grape, type: wine.type,
    price: `${state.settings.currency}${wine.price[0]}–${wine.price[1]}`,
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
  const recs = SommProfile.recommend(state.profile, { n: 3, foodTags: tags, budget: state.profile.budget.store });
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
  ask.textContent = state.settings.apiKey ? "Ask Vera to go deeper →" : "Get the full Vera experience (add API key) →";
  ask.addEventListener("click", () => {
    if (!state.settings.apiKey) { switchTab("you"); toast("Add your Claude API key under Settings"); return; }
    state.chatMode = "tonight";
    switchTab("vera");
    sendToVera(surprise ? "Surprise me — what should I open tonight?" : `Tonight I'm having: ${text}. What should I open, and why?`);
  });
  wrap.appendChild(ask);
}

function runStorePicks() {
  const wrap = $("#tonight-results");
  wrap.innerHTML = "";
  const recs = SommProfile.recommend(state.profile, { n: 3, budget: state.profile.budget.store });
  const intro = document.createElement("div");
  intro.className = "vera-line";
  intro.innerHTML = `<div class="vera-avatar sm">V</div><div class="vera-bubble">Your shopping shortlist — styles to grab in your budget (${state.settings.currency}${state.profile.budget.store[0]}–${state.profile.budget.store[1]}):</div>`;
  wrap.appendChild(intro);
  recs.forEach(({ wine, score }) => wrap.appendChild(wineCardEl(localCard(wine, score), "store list")));
}

// ============================== SCAN ==============================
function renderScanHint() {
  const hasKey = !!state.settings.apiKey;
  $("#scan-nokey").hidden = hasKey;
  $("#scan-ready").hidden = !hasKey;
  if (!hasKey) {
    const list = $("#scan-cheatsheet");
    if (!list.childElementCount) {
      SOMM_DATA.RESTO_CHEATSHEET.forEach((r) => {
        const li = document.createElement("div");
        li.className = "cheat-row";
        li.innerHTML = `<strong>${esc(r.cuisine)}</strong><span>${esc(r.tip)}</span>`;
        list.appendChild(li);
      });
    }
  }
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
    img.scanMode = state.pendingScanMode || "bottle";
    state.pendingImage = img;
    state.chatMode = { bottle: "store", shelf: "store", list: "restaurant", menu: "restaurant" }[img.scanMode] || "chat";
    switchTab("vera");
    const ask = {
      bottle: "Here's a bottle — what is it, and is it for me?",
      shelf: "Here's the shelf in front of me. What should I grab?",
      list: "Here's the wine list. What should I order?",
      menu: "Here's the menu. What wine should I pair with what?",
    }[img.scanMode];
    sendToVera(ask, img);
  } catch (err) {
    toast(err.message || "Couldn't process that photo");
  }
}

// ============================== VERA CHAT ==============================
function renderChat() {
  const wrap = $("#chat-scroll");
  wrap.innerHTML = "";
  if (!state.chat.length) {
    const hello = document.createElement("div");
    hello.className = "msg assistant";
    hello.innerHTML = `<div class="vera-avatar sm">V</div><div class="bubble">${
      state.settings.apiKey
        ? `Hey${state.profile.name ? " " + esc(state.profile.name) : ""}. Ask me anything — what to open, what to buy, what to order. Or snap a photo from the Scan tab.`
        : `I can chat properly once you add a Claude API key in <strong>You → Settings</strong>. Until then, the Tonight tab works offline with your taste profile.`
    }</div>`;
    wrap.appendChild(hello);
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

async function sendToVera(text, image) {
  if (!state.settings.apiKey) {
    switchTab("you");
    toast("Add your Claude API key under Settings first");
    return;
  }
  const userMsg = { role: "user", text, dataUrl: image ? image.dataUrl : null };
  state.chat.push(userMsg);
  renderChat();
  scrollChat();

  const typing = document.createElement("div");
  typing.className = "msg assistant typing";
  typing.innerHTML = `<div class="vera-avatar sm">V</div><div class="bubble"><span class="tdot"></span><span class="tdot"></span><span class="tdot"></span></div>`;
  $("#chat-scroll").appendChild(typing);
  scrollChat();
  state.busy = true;

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
    const res = await SommAI.callClaude({
      messages: apiMessages,
      system,
      apiKey: state.settings.apiKey,
      model: state.settings.model,
      maxTokens: 1500,
    });
    const { prose, cards } = SommAI.parseWineCards(res.text);
    state.chat.push({ role: "assistant", text: prose, cards });
  } catch (err) {
    state.chat.push({ role: "assistant", text: `⚠️ ${err.message}` });
  } finally {
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

  wrap.innerHTML = `
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
      ${lovedGrapes.length ? `<p class="muted">Loves: ${lovedGrapes.map(([g]) => esc(g)).join(", ")}</p>` : ""}
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
      <label class="field-label">Claude API key <span class="muted">(stored only on this device)</span></label>
      <input type="password" id="set-key" class="input" placeholder="sk-ant-..." value="${esc(state.settings.apiKey)}" autocomplete="off">
      <label class="field-label">Model</label>
      <select id="set-model" class="input">
        <option value="claude-opus-4-8" ${state.settings.model === "claude-opus-4-8" ? "selected" : ""}>Opus 4.8 — best (default)</option>
        <option value="claude-sonnet-4-6" ${state.settings.model === "claude-sonnet-4-6" ? "selected" : ""}>Sonnet 4.6 — faster, cheaper</option>
        <option value="claude-haiku-4-5" ${state.settings.model === "claude-haiku-4-5" ? "selected" : ""}>Haiku 4.5 — cheapest</option>
      </select>
      <label class="field-label">Currency</label>
      <select id="set-currency" class="input">
        ${["€", "$", "£", "₪"].map((c) => `<option ${state.settings.currency === c ? "selected" : ""}>${c}</option>`).join("")}
      </select>
      <button class="btn btn-primary" id="set-save">Save settings</button>
      <p class="muted small">Get a key at console.anthropic.com → API keys. Calls go directly from your device to Anthropic — nothing passes through any other server.</p>
    </section>

    <section class="panel danger-zone">
      <button class="btn-ghost" id="p-export">Export profile</button>
      <button class="btn-ghost" id="p-redo">Redo onboarding</button>
      <button class="btn-ghost danger" id="p-reset">Reset everything</button>
    </section>`;

  $("#b-save").addEventListener("click", () => {
    p.budget.store = [Number($("#b-store-min").value) || 1, Number($("#b-store-max").value) || 25];
    p.budget.restaurant = [Number($("#b-rest-min").value) || 1, Number($("#b-rest-max").value) || 65];
    SommProfile.saveProfile(p);
    toast("Budget saved");
  });
  $("#set-save").addEventListener("click", () => {
    state.settings.apiKey = $("#set-key").value.trim();
    state.settings.model = $("#set-model").value;
    state.settings.currency = $("#set-currency").value;
    SommProfile.saveSettings(state.settings);
    toast(state.settings.apiKey ? "Settings saved — Vera is fully online" : "Settings saved");
  });
  $("#p-export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ profile: p, settings: { ...state.settings, apiKey: "" } }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "somm-profile.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("#p-redo").addEventListener("click", () => {
    if (confirm("Redo the onboarding quiz? Your journal and ratings are kept.")) {
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
}
