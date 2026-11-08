// Somm — storage layer. Anonymous, fire-and-forget calls to the backend (Upstash KV).
// Chat and profile stay in localStorage only.
"use strict";

async function _api(method, path, body) {
  const base = SommAI.BACKEND_URL;
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", "x-device-id": SommDevice.id() },
    body: body ? JSON.stringify(body) : undefined,
    keepalive: true,
  });
  if (!res.ok) {
    let msg = "HTTP " + res.status;
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) { /* ignore */ }
    throw new Error(msg);
  }
  return res;
}

async function saveRating(wine, rating, context) {
  try {
    await _api("POST", "/api/rating", {
      wine: { name: wine.name, type: wine.type, region: wine.region, grape: wine.grape, price: wine.price },
      rating, context: context || "vera",
    });
  } catch (e) { console.warn("db.saveRating:", e.message); }
}

// Permanently delete this device's server-side ratings.
async function deleteMyData() {
  try { await _api("DELETE", "/api/me"); return { ok: true }; }
  catch (e) { console.warn("db.deleteMyData:", e.message); return { ok: false, error: e.message }; }
}

// Write-only error visibility; must never throw or block the UI.
async function logError(source, context, err) {
  try {
    const msg = String((err && err.message) || err || "unknown error").slice(0, 1000);
    await _api("POST", "/api/feedback", {
      kind: "error", message: `[${source}] ${msg}`, context: context || null,
      url: typeof location !== "undefined" ? location.href : null,
    });
  } catch (e) { /* never let error logging itself break the app */ }
}

// User-initiated feedback ("something's off / here's an idea").
async function saveFeedback(message, context) {
  const trimmed = String(message || "").trim();
  if (!trimmed) return { ok: false, error: "Empty feedback" };
  try {
    await _api("POST", "/api/feedback", {
      kind: "feedback", message: trimmed.slice(0, 2000), context: context || null,
      url: typeof location !== "undefined" ? location.href : null,
    });
    return { ok: true };
  } catch (e) {
    console.warn("db.saveFeedback:", e.message);
    return { ok: false, error: e.message };
  }
}

// Profile/chat are local-only now; kept as no-ops so call sites stay harmless.
const SommDB = {
  saveRating, deleteMyData, logError, saveFeedback,
  saveMessage: async () => {}, saveProfile: async () => {},
  getProfile: async () => null, getCrowdFavorites: async () => [],
};
