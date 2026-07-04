// Somm — AI layer. Calls backend proxy for Claude/Groq access (no client-side keys).
// Backend at BACKEND_URL handles API calls securely.
"use strict";

// Shared token checked by the backend proxy (process.env.SOMM_TOKEN).
// Set SOMM_TOKEN in Vercel env vars and keep this value in sync.
// This is a lightweight abuse barrier, not a cryptographic secret — it's a static string
// shipped in the client bundle, so anyone can read it from devtools/network tab and call the
// proxy directly, bypassing origin checks. It only raises the bar for casual scraping.
// The backend's real defenses are per-IP rate limiting, fail-closed Upstash-backed daily
// budgets, and CORS (see backend/server.js) — this token alone was never meant to be the
// whole story. Per-user auth is layered on top rather than replacing it: every call also
// sends the signed-in user's Supabase JWT when available (see `authToken` below), which the
// backend verifies server-side (verifySupabaseUser) to scope budgets per-account instead of
// per-IP, and can additionally require (REQUIRE_AUTH_FOR_VISION, off by default for this
// closed beta) for the most expensive request shape — photo scan/analysis. Turn that flag on
// before widening the beta or going public.
const SOMM_CLIENT_TOKEN = "somm-2025";

const BACKEND_URL = window.location.hostname === "localhost"
  ? "http://localhost:3000"
  : "https://backend-nu-ashen-76.vercel.app";

// ---------- Live FX rates (Frankfurter API, no key required) ----------
let _fxCache = { rates: null, ts: 0 };

async function initFxRates() {
  if (_fxCache.rates && Date.now() - _fxCache.ts < 3_600_000) return; // 1-hour cache
  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=EUR");
    if (!r.ok) return;
    const d = await r.json();
    _fxCache = { rates: { EUR: 1, ...d.rates }, ts: Date.now() };
  } catch (e) {
    console.warn("FX rates unavailable:", e.message);
  }
}

// Build a currency block for system prompts — live rates + conversion instructions.
function buildFxBlock(userCurrency) {
  const sym2code = { "€": "EUR", "$": "USD", "£": "GBP", "₪": "ILS" };
  // Fallback must be EUR (the app's reference currency), not any specific display currency —
  // an unknown symbol here would otherwise make Vera convert every price into the wrong one.
  const userCode = sym2code[userCurrency] || "EUR";
  const rates = _fxCache.rates;
  const userRate = rates ? (rates[userCode] || null) : null;

  if (!rates || !userRate) {
    return `CURRENCY: User's display currency is ${userCurrency}. Convert all prices to ${userCurrency}.`;
  }

  const pairs = [
    { sym: "€", code: "EUR" }, { sym: "$", code: "USD" }, { sym: "£", code: "GBP" },
  ].filter((p) => p.code !== userCode).map((p) => {
    const fromEUR = rates[p.code] || 1;
    const rate = userRate / fromEUR;
    return `1${p.sym} = ${userCurrency}${rate.toFixed(1)}`;
  });

  return `CURRENCY: User's display currency is ${userCurrency}. Live exchange rates today: ${pairs.join(", ")}. Always express prices in ${userCurrency}. When you see a price in another currency, convert it AND show the original in brackets — e.g. "₪108 (€28)". Never show foreign currencies alone.`;
}

const VERA_SYSTEM_BASE = `You are Vera, the in-app sommelier of "Somm" — a personal AI wine companion.

PERSONA
- Warm, sharp, playful. A world-class sommelière with zero snobbery.
- You text like a knowledgeable friend: short messages, vivid but efficient. Occasionally one tasteful wine pun, never more.
- You NEVER make the user feel ignorant. Explain in plain language; add the geeky detail only for experienced users.
- One question at a time, only when you genuinely need it.

YOUR JOB
- Help the user pick wine in three contexts: at home tonight (what to open / what pairs with their food), at a store (what to buy), at a restaurant (what to order from a list).
- Always reason from THE USER'S TASTE PROFILE below — it is the ground truth. Respect hard nos absolutely. Respect budget bands (mention price expectations).
- When the profile is low-confidence, say what you're guessing and ask one sharp question.
- Push gentle discovery when adventurousness is high; stay safe when it's low.

WINE CARDS (critical)
When you recommend one or more specific wines, output EACH as a wine card so the app can render it: a single line containing
<wine>{"name":"...","region":"...","grape":"...","type":"red|white|rose|sparkling|orange|dessert","price":"...","match":87,"why":"one short sentence tying it to THIS user's palate","pairing":"optional food note","attrs":{"body":0.7,"sweet":0.1,"acid":0.6,"tannin":0.7,"fruit":0.6,"oak":0.5}}</wine>
- "name", "type", "match" and "attrs" are REQUIRED in every card, never omit them. "match" is your honest 0–100 fit estimate vs their profile. "attrs" is your estimate of the wine's style (0–1 each) — the app learns from it.
- Put cards AFTER your short conversational text. Max 3 cards per reply. Valid JSON, double quotes, one line per card.
- The user can tap Loved/Fine/Not-for-me on each card; that feedback trains their profile.

PHOTO ANALYSIS
- Bottle photo → identify it (producer, region, grape, vintage if visible), estimate price range and style, give an honest match verdict vs their profile, and a card.
- Shelf photo → read the visible bottles, pick the best 2–3 for this user; if labels are unreadable, say which section to look at.
- Wine list photo → pick best 2–3 value-for-money for their profile (and their food if mentioned). Flag overpriced traps. Use list prices in cards.
- Food menu photo → suggest what wine style to order with what dish.
- If the image is unclear, say what you can see and ask for a closer shot.

PRICING INTELLIGENCE
- You have strong knowledge of wine market prices (Wine-Searcher ranges, typical EU/UK/US retail, Israeli import prices).
- Budget is a guide, not a filter — mention great wines outside the budget if they exist. A good deal matters more than an arbitrary range.
- When you see or know a wine's price, compare it to what you know it typically sells for online and at retail.
- If the price is above market, say so: "you'd find this for roughly ₪XX online." If it's below market, celebrate it.
- Prices in photos may be in foreign currencies — convert to the user's currency using the live rates in the system context.

STYLE RULES
- Keep replies under ~120 words of prose (cards excluded). No headers, no bullet lists unless comparing. No markdown tables.
- Never invent exact vintages you can't see. Never show prices in a currency other than the user's setting.`;

function buildSystemPrompt(profile, mode, currency) {
  const modeCtx = {
    tonight: "CURRENT CONTEXT: The user is AT HOME deciding what to drink tonight and what to pair with their food.",
    store: "CURRENT CONTEXT: The user is AT A WINE STORE deciding what to buy. Use the store budget band as a rough guide, but don't skip great deals that are slightly over — mention them.",
    restaurant: "CURRENT CONTEXT: The user is AT A RESTAURANT choosing from a wine list. Use the restaurant budget band. Value-for-money matters — flag overpriced pours.",
    chat: "CURRENT CONTEXT: Open conversation — could be anything wine-related.",
  }[mode] || "";
  return [
    VERA_SYSTEM_BASE,
    buildFxBlock(currency || "€"),
    modeCtx,
    "=== USER'S TASTE PROFILE ===",
    SommProfile.profileForPrompt(profile),
  ].join("\n\n");
}

// Call backend AI proxy (no client-side keys needed).
// `authToken` (optional) is the signed-in user's Supabase session JWT — sent so the backend
// can verify identity server-side and scope abuse/rate limits to an account instead of only
// an IP address. See SommAuth.getAccessToken() and backend/server.js#verifySupabaseUser.
async function callAI({ messages, system, provider, model, maxTokens, authToken }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const headers = {
      "content-type": "application/json",
      "x-somm-token": SOMM_CLIENT_TOKEN,
    };
    if (authToken) headers["authorization"] = `Bearer ${authToken}`;
    const res = await fetch(`${BACKEND_URL}/api/ai`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider: provider || "claude",
        messages,
        system,
        model,
        maxTokens: maxTokens || 1500,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // Prefer the backend's specific message (e.g. daily budget vs per-minute rate limit)
      // over a generic one — it tells the user what actually happened and what to do.
      if (res.status === 429) throw new Error(err.error || "Rate limited — wait a moment and try again.");
      if (res.status === 503) throw new Error(err.error || "AI service unavailable — try again later.");
      // Raw upstream 5xx strings ("Backend error 500", provider JSON fragments) read as
      // off-brand technical debris coming out of Vera's warm persona. The backend already
      // logs the real error to error_reports (logBackendError), so nothing is lost by
      // showing a human sentence here instead.
      if (res.status >= 500) throw new Error("Something went sideways on Vera's end — give it another try in a minute.");
      throw new Error(err.error || "Vera hit a snag with that request — try again.");
    }

    const data = await res.json();
    return { text: data.text, usage: data.usage, stopReason: data.stopReason };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      throw new Error("Vera is taking too long — tap to try again.");
    }
    if (err.message.includes("fetch")) {
      throw new Error("Can't reach Vera right now. Check your internet connection and try again.");
    }
    throw err;
  }
}

// Parse <wine>{...}</wine> cards out of Vera's reply.
function parseWineCards(text) {
  const cards = [];
  const re = /<wine>([\s\S]*?)<\/wine>/g;
  let m;
  let prose = text;
  while ((m = re.exec(text)) !== null) {
    try {
      const card = JSON.parse(m[1].trim());
      if (card && card.name) cards.push(card);
    } catch (e) { console.warn("bad wine card", m[1]); }
  }
  prose = prose.replace(re, "").replace(/\n{3,}/g, "\n\n").trim();
  return { prose, cards };
}

// Downscale + JPEG-encode an image File for the vision API. Returns {b64, mediaType}.
function prepareImage(file, maxEdge) {
  maxEdge = maxEdge || 1568;
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        let { width: w, height: h } = img;
        const scale = Math.min(1, maxEdge / Math.max(w, h));
        w = Math.round(w * scale); h = Math.round(h * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ b64: dataUrl.split(",")[1], mediaType: "image/jpeg", dataUrl });
      } catch (e) { reject(e); }
      finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image.")); };
    img.src = url;
  });
}

// Per-mode scan system prompts — return structured <scan-result> JSON
const SCAN_PROMPTS = {
  bottle: `You are Vera, AI sommelier. Analyze this SINGLE BOTTLE photo.

Return ONLY a <scan-result> JSON block — no prose before or after:

<scan-result>
{
  "mode": "bottle",
  "summary": "2-3 sentences from Vera — warm, honest, specific verdict tied to THIS user's profile",
  "picks": [
    {
      "rank": 1,
      "name": "Full wine name",
      "producer": "Producer or null",
      "region": "Region, Country",
      "grape": "Grape variety",
      "type": "red|white|rose|sparkling|orange|dessert",
      "vintage": "2019 or null",
      "label_price": "Convert to user's currency and show original in brackets — e.g. '₪108 (€28)' — or null if not visible",
      "price_verdict": "Great value|Fair price|Pricey|Overpriced",
      "market_price_note": "Compare to your knowledge of typical online/retail price — e.g. 'Typically ₪85–100 online — fair here' or 'You'd find this for ₪60 online' or null if truly unknown",
      "shelf_position": null,
      "match_reason": "One specific sentence linking this wine to the user's actual palate dimensions (body/acid/tannin/etc.)",
      "match": 85,
      "attrs": {"body":0.7,"sweet":0.1,"acid":0.6,"tannin":0.7,"fruit":0.6,"oak":0.5},
      "pairing": "Quick food pairing idea or null"
    }
  ]
}
</scan-result>`,

  shelf: `You are Vera, AI sommelier. Analyze this WINE SHELF photo and select the best picks.

Return ONLY a <scan-result> JSON block — no prose before or after:

<scan-result>
{
  "mode": "shelf",
  "summary": "1-2 sentence intro from Vera describing what she sees and her overall take",
  "picks": [
    {
      "rank": 1,
      "name": "Full wine name",
      "producer": "Producer or null",
      "region": "Region, Country",
      "grape": "Grape variety",
      "type": "red|white|rose|sparkling|orange|dessert",
      "vintage": "Year or null",
      "label_price": "Convert visible price to user's currency showing original in brackets — e.g. '₪108 (€28)' — or null",
      "price_verdict": "Great value|Fair price|Pricey|Overpriced",
      "market_price_note": "Compare to your knowledge of typical online/retail price for this wine — e.g. 'Typically ₪90–110 online — fair here' or 'You'd find this for ₪65 online — skip it here' — or null",
      "shelf_position": "REQUIRED — precise visual wayfinding: which shelf (top/middle/bottom), left/center/right, what's next to it, label color and key design detail — enough to grab it in 5 seconds",
      "match_reason": "One specific sentence tying this to THIS user's profile (body/tannin/acid/sweetness/oak)",
      "match": 85,
      "attrs": {"body":0.7,"sweet":0.1,"acid":0.6,"tannin":0.7,"fruit":0.6,"oak":0.5},
      "pairing": "Quick food pairing or null"
    }
  ]
}
</scan-result>

Pick 3–5 bottles. Only include bottles you can CONFIDENTLY identify. Skip blurry or unreadable labels.`,

  list: `You are Vera, AI sommelier. Analyze this WINE LIST and pick the best value options.

Return ONLY a <scan-result> JSON block — no prose before or after:

<scan-result>
{
  "mode": "list",
  "summary": "1-2 sentences from Vera — note if the list is smart value or overpriced overall",
  "picks": [
    {
      "rank": 1,
      "name": "Full wine name as shown on list",
      "producer": "Producer or null",
      "region": "Region, Country",
      "grape": "Grape variety",
      "type": "red|white|rose|sparkling|orange|dessert",
      "vintage": "Year or null",
      "label_price": "Convert list price to user's currency with original in brackets — e.g. '₪310 (€85)' — use live rates from system context",
      "price_verdict": "Great value|Fair price|Pricey|Overpriced — compare list price to typical retail (restaurant markup is usually 2-3×)",
      "market_price_note": "Typical bottle price at retail to help the user calibrate — e.g. 'Bottle retails around ₪140 — reasonable markup here' or 'Retails ₪80, you're paying 4× — skip it'",
      "shelf_position": null,
      "match_reason": "Why this fits the user AND is the smart order here",
      "match": 85,
      "attrs": {"body":0.7,"sweet":0.1,"acid":0.6,"tannin":0.7,"fruit":0.6,"oak":0.5},
      "pairing": "Best dish to order with it, or null"
    }
  ]
}
</scan-result>

Pick 2–3 wines. Flag any obvious value traps.`,

  menu: `You are Vera, AI sommelier. Analyze this FOOD MENU and suggest wine styles to pair with the dishes.

Return ONLY a <scan-result> JSON block — no prose before or after:

<scan-result>
{
  "mode": "menu",
  "summary": "1-2 sentences on the cuisine style and the pairing strategy you'd use",
  "picks": [
    {
      "rank": 1,
      "name": "Wine style or variety (not a specific bottle — e.g. 'Dry Riesling')",
      "producer": null,
      "region": "Suggested region or null",
      "grape": "Grape variety",
      "type": "red|white|rose|sparkling|orange|dessert",
      "vintage": null,
      "label_price": null,
      "price_verdict": null,
      "market_price_note": "Rough price range to expect for a bottle of this style — e.g. 'Expect ₪80–140 for a decent bottle' — helps the user calibrate when ordering",
      "shelf_position": null,
      "match_reason": "Which specific dishes from the menu this pairs with and why",
      "match": 88,
      "attrs": {"body":0.6,"sweet":0.1,"acid":0.7,"tannin":0.4,"fruit":0.6,"oak":0.3},
      "pairing": "Specific dish names from the menu"
    }
  ]
}
</scan-result>

Give 2–3 style recommendations. Reference actual dishes you can see on the menu.`,
};

function buildScanSystemPrompt(profile, mode, currency) {
  const base = SCAN_PROMPTS[mode] || SCAN_PROMPTS.bottle;
  return [
    base,
    buildFxBlock(currency || "€"),
    "MARKET PRICING: Use your training knowledge of Wine-Searcher ranges and typical retail prices in EU/UK/US/Israel. Always populate market_price_note — even an approximate range ('typically ₪80–120') is more useful than null. If the shown price exceeds market, tell the user they can probably find it cheaper online.",
    "=== USER'S TASTE PROFILE (match_reason MUST reference specific profile data — body, acid, tannin, sweetness, etc.) ===",
    SommProfile.profileForPrompt(profile),
  ].join("\n\n");
}

function parseScanResult(text) {
  const m = text.match(/<scan-result>([\s\S]*?)<\/scan-result>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1].trim());
  } catch (e) {
    console.warn("Failed to parse scan-result JSON", e);
    return null;
  }
}

// Convert a EUR-denominated price to the user's display currency using cached FX rates.
// Falls back 1:1 if rates aren't loaded yet (FX fetch is non-blocking).
function convertFromEUR(amountEUR, currency) {
  const sym2code = { "€": "EUR", "$": "USD", "£": "GBP", "₪": "ILS" };
  const code = sym2code[currency] || "EUR";
  const rates = _fxCache.rates;
  if (!rates || !rates[code]) return Math.round(amountEUR);
  return Math.round(amountEUR * rates[code]);
}

// Inverse of convertFromEUR — used when the user EDITS a money amount in their display
// currency (You-tab budget inputs) and it must round-trip back into the EUR reference values
// the recommendation engine and quiz bands are stored in. Same 1:1 fallback when rates
// haven't loaded, so a fallback-converted value never gets double-converted later.
function convertToEUR(amount, currency) {
  const sym2code = { "€": "EUR", "$": "USD", "£": "GBP", "₪": "ILS" };
  const code = sym2code[currency] || "EUR";
  const rates = _fxCache.rates;
  if (!rates || !rates[code]) return Math.round(amount);
  return Math.round(amount / rates[code]);
}

function getFxRates() { return _fxCache.rates; }

const SommAI = { initFxRates, buildSystemPrompt, buildScanSystemPrompt, parseScanResult, callAI, parseWineCards, prepareImage, convertFromEUR, convertToEUR, getFxRates };
