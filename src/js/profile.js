// Somm — taste profile engine. Pure functions + localStorage persistence.
// The profile is the product: everything else reads from it.
"use strict";

const PROFILE_KEY = "somm.profile.v1";
const SETTINGS_KEY = "somm.settings.v1";

const DIM_KEYS = ["body", "sweet", "acid", "tannin", "fruit", "oak"];
const TYPE_KEYS = ["red", "white", "rose", "sparkling", "orange", "dessert"];

const DIM_LABELS = {
  body: "Body", sweet: "Sweetness", acid: "Acidity",
  tannin: "Tannin", fruit: "Fruitiness", oak: "Oak",
};
const TYPE_LABELS = {
  red: "Red", white: "White", rose: "Rosé",
  sparkling: "Sparkling", orange: "Orange", dessert: "Dessert",
};

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

function defaultProfile() {
  return {
    version: 1,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    onboarded: false,
    name: "",
    experience: "casual",
    dims: { body: .5, sweet: .25, acid: .55, tannin: .45, fruit: .55, oak: .35 },
    types: { red: .5, white: .5, rose: .35, sparkling: .35, orange: .15, dessert: .15 },
    adventure: .4,
    budget: { store: [12, 25], restaurant: [30, 65] },
    nos: [],            // ["sweet","oak","red","white","sparkling"]
    grapes: {},         // grape -> cumulative score
    regions: {},        // region -> cumulative score
    ratingCount: 0,
    history: [],        // [{ts, name, region, grape, type, attrs, rating, context, note}]
  };
}

function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) return Object.assign(defaultProfile(), JSON.parse(raw));
  } catch (e) { console.warn("profile load failed", e); }
  return defaultProfile();
}

function saveProfile(p) {
  p.updated = new Date().toISOString();
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* fall through */ }
  return { currency: "€" };
}

function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

// ---- Onboarding: apply quiz answers to a fresh profile ----
function buildProfileFromQuiz(answers) {
  const p = defaultProfile();
  for (const ans of answers) {
    const fxList = Array.isArray(ans) ? ans : [ans];
    for (const fx of fxList) {
      if (!fx) continue;
      if (fx.dims) for (const k in fx.dims) p.dims[k] = clamp01(p.dims[k] + fx.dims[k]);
      if (fx.types) for (const k in fx.types) p.types[k] = clamp01(p.types[k] + fx.types[k]);
      if (typeof fx.adventure === "number") p.adventure = clamp01(p.adventure + fx.adventure);
      if (fx.experience) p.experience = fx.experience;
      if (fx.budget) {
        p.budget.store = fx.budget.slice();
        p.budget.restaurant = [Math.round(fx.budget[0] * 2.5), Math.round(fx.budget[1] * 2.5)];
      }
      if (fx.no) {
        if (!p.nos.includes(fx.no)) p.nos.push(fx.no);
        if (fx.no === "red") p.types.red = 0;
        if (fx.no === "white") p.types.white = 0;
        if (fx.no === "sparkling") p.types.sparkling = 0;
        if (fx.no === "sweet") { p.types.dessert = 0; p.dims.sweet = Math.min(p.dims.sweet, .15); }
        if (fx.no === "oak") p.dims.oak = Math.min(p.dims.oak, .2);
      }
    }
  }
  p.onboarded = true;
  return p;
}

// ---- Learning loop ----
// rating: "love" (+1) | "ok" (+0.25) | "no" (-1)
const RATING_VALUE = { love: 1, ok: 0.25, no: -1 };

function learnFromRating(p, wine, rating, context) {
  const r = RATING_VALUE[rating] ?? 0;
  // Decaying learning rate: fast first impressions, stable veteran palate.
  const lr = 0.30 / (1 + p.ratingCount * 0.08);

  if (wine.attrs) {
    for (const k of DIM_KEYS) {
      const a = wine.attrs[k];
      if (typeof a !== "number") continue;
      if (r > 0) {
        p.dims[k] = clamp01(p.dims[k] + lr * r * (a - p.dims[k]));
      } else {
        // Disliked: push away from this wine's extremes only.
        const diff = a - p.dims[k];
        if (Math.abs(diff) > 0.15) p.dims[k] = clamp01(p.dims[k] - lr * 0.6 * diff);
      }
    }
  }
  if (wine.type && p.types[wine.type] !== undefined) {
    p.types[wine.type] = clamp01(p.types[wine.type] + lr * r * 0.8);
  }
  if (wine.grape) p.grapes[wine.grape] = (p.grapes[wine.grape] || 0) + r;
  if (wine.region) {
    const regionKey = String(wine.region).split(",")[0].trim();
    p.regions[regionKey] = (p.regions[regionKey] || 0) + r;
  }

  p.ratingCount += 1;
  p.history.unshift({
    ts: new Date().toISOString(),
    name: wine.name, region: wine.region || "", grape: wine.grape || "",
    type: wine.type || "", attrs: wine.attrs || null, price: wine.price || null,
    rating, context: context || "",
  });
  if (p.history.length > 200) p.history.length = 200;
  saveProfile(p);
  return p;
}

function confidencePct(p) {
  // Onboarding gives a base; each rating adds, saturating around 40 ratings.
  const base = p.onboarded ? 0.30 : 0;
  return Math.round(100 * clamp01(base + 0.70 * (1 - Math.exp(-p.ratingCount / 14))));
}

// ---- Local recommendation engine ----
function wineAllowed(p, w) {
  if (p.nos.includes(w.type)) return false;
  if (p.nos.includes("sweet") && w.attrs.sweet > 0.5) return false;
  if (p.nos.includes("oak") && w.attrs.oak > 0.6) return false;
  return true;
}

function paletteMatch(p, w) {
  // Weighted similarity between profile dims and wine attrs (0..1).
  const weights = { body: 1, sweet: 1.2, acid: .9, tannin: 1.1, fruit: .7, oak: .9 };
  let dist = 0, wsum = 0;
  for (const k of DIM_KEYS) {
    dist += weights[k] * Math.abs(p.dims[k] - w.attrs[k]);
    wsum += weights[k];
  }
  return 1 - dist / wsum;
}

function scoreWine(p, w, opts) {
  opts = opts || {};
  let score = paletteMatch(p, w) * 100;

  score += (p.types[w.type] ?? 0.3) * 22;
  if (w.grape && p.grapes[w.grape]) score += Math.max(-12, Math.min(12, p.grapes[w.grape] * 4));
  const regionKey = String(w.region || "").split(",")[0].trim();
  if (regionKey && p.regions[regionKey]) score += Math.max(-8, Math.min(8, p.regions[regionKey] * 3));

  // Budget fit (store band by default)
  const band = opts.budget || p.budget.store;
  const mid = (w.price[0] + w.price[1]) / 2;
  if (mid < band[0] * 0.6) score -= 6;
  else if (mid > band[1] * 1.4) score -= 25;
  else if (mid > band[1]) score -= 10;

  // Food pairing dominates when the user asked about food.
  if (opts.foodTags && opts.foodTags.length) {
    const hits = w.pairs.filter((t) => opts.foodTags.includes(t)).length;
    score += hits > 0 ? 24 + hits * 8 : -22;
  }

  // Adventure: novelty bonus for types/grapes the user hasn't rated
  const tried = p.history.some((h) => h.grape === w.grape);
  if (!tried) score += (p.adventure - 0.4) * 14;

  // Don't repeat a recent "no"
  const recentNo = p.history.slice(0, 20).some((h) => h.rating === "no" && h.name === w.name);
  if (recentNo) score -= 30;

  return score;
}

// Honest, displayable 0–100 fit independent of ranking boosts.
function matchPct(p, w) {
  const pct = paletteMatch(p, w) * 74 + (p.types[w.type] ?? 0.3) * 24;
  return Math.max(35, Math.min(98, Math.round(pct)));
}

function extractFoodTags(text) {
  const t = (text || "").toLowerCase();
  const tags = [];
  for (const tag in SOMM_DATA.FOOD_SYNONYMS) {
    if (SOMM_DATA.FOOD_SYNONYMS[tag].some((syn) => t.includes(syn))) tags.push(tag);
  }
  return tags;
}

function recommend(p, opts) {
  opts = opts || {};
  const pool = SOMM_DATA.WINES.filter((w) => wineAllowed(p, w));
  const scored = pool
    .map((w) => ({ wine: w, score: scoreWine(p, w, opts) }))
    .sort((a, b) => b.score - a.score);
  const n = opts.n || 3;
  // When the user asked about food, wines that actually pair come first —
  // palate-favorites only fill leftover slots.
  if (opts.foodTags && opts.foodTags.length) {
    const matches = scored.filter(({ wine }) => wine.pairs.some((t) => opts.foodTags.includes(t)));
    if (matches.length >= n) return matches.slice(0, n);
    const rest = scored.filter((s) => !matches.includes(s));
    return matches.concat(rest).slice(0, n);
  }
  return scored.slice(0, n);
}

// Profile summary string injected into Vera's system prompt.
function profileForPrompt(p) {
  const fav = (obj, min) => Object.entries(obj).filter(([, v]) => v >= (min ?? 1))
    .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
  const avoid = (obj) => Object.entries(obj).filter(([, v]) => v <= -1)
    .sort((a, b) => a[1] - b[1]).slice(0, 5).map(([k]) => k);
  const dimDesc = (k) => {
    const v = p.dims[k];
    return `${DIM_LABELS[k]}: ${v < 0.33 ? "low" : v < 0.66 ? "medium" : "high"} (${v.toFixed(2)})`;
  };
  const typePrefs = TYPE_KEYS.filter((t) => !p.nos.includes(t))
    .sort((a, b) => p.types[b] - p.types[a])
    .map((t) => `${TYPE_LABELS[t]} ${(p.types[t] * 100) | 0}%`).join(", ");
  const recent = p.history.slice(0, 8).map((h) =>
    `${h.name} (${h.region}) → ${h.rating === "love" ? "LOVED" : h.rating === "ok" ? "fine" : "DISLIKED"}`).join("; ");

  return [
    `Experience level: ${p.experience}. Profile confidence: ${confidencePct(p)}% (${p.ratingCount} wines rated).`,
    `Palate: ${DIM_KEYS.map(dimDesc).join(", ")}.`,
    `Type affinity: ${typePrefs}.`,
    `Adventurousness: ${p.adventure < 0.33 ? "low — prefers familiar wines" : p.adventure < 0.6 ? "moderate" : "high — loves discovering new things"}.`,
    `Budget: store ${p.budget.store[0]}–${p.budget.store[1]}, restaurant ${p.budget.restaurant[0]}–${p.budget.restaurant[1]} (per bottle).`,
    p.nos.length ? `HARD NOS (never recommend): ${p.nos.join(", ")}.` : "No hard restrictions.",
    fav(p.grapes).length ? `Loved grapes: ${fav(p.grapes).join(", ")}.` : "",
    avoid(p.grapes).length ? `Disliked grapes: ${avoid(p.grapes).join(", ")}.` : "",
    recent ? `Recent ratings: ${recent}.` : "No ratings yet — profile is from onboarding only.",
  ].filter(Boolean).join("\n");
}

const SommProfile = {
  DIM_KEYS, TYPE_KEYS, DIM_LABELS, TYPE_LABELS,
  loadProfile, saveProfile, loadSettings, saveSettings,
  defaultProfile, buildProfileFromQuiz, learnFromRating,
  confidencePct, recommend, extractFoodTags, profileForPrompt, wineAllowed, matchPct,
};
