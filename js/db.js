// Somm — Supabase data layer. Save ratings, messages, profile. Fire-and-forget.
"use strict";

async function saveRating(wine, rating, context) {
  const user = SommAuth.getUser();
  if (!user) return;
  try {
    await SommAuth.client().from("wine_ratings").insert({
      user_id: user.id,
      wine_name: wine.name,
      wine_type: wine.type || null,
      wine_region: wine.region || null,
      wine_grape: wine.grape || null,
      wine_attrs: wine.attrs || null,
      rating,
      context: context || "vera",
      food_pairing: wine.pairing || null,
      price: wine.price || null,
    });
  } catch (e) { console.warn("db.saveRating:", e.message); }
}

async function saveMessage(role, content, context, wineCards) {
  const user = SommAuth.getUser();
  if (!user) return;
  try {
    await SommAuth.client().from("chat_messages").insert({
      user_id: user.id, role, content,
      context: context || "vera",
      wine_cards: wineCards?.length ? wineCards : null,
    });
  } catch (e) { console.warn("db.saveMessage:", e.message); }
}

async function saveProfile(profile, settings) {
  const user = SommAuth.getUser();
  if (!user) return;
  try {
    await SommAuth.client().from("profiles").upsert({
      id: user.id,
      display_name: profile.name || null,
      currency: settings?.currency || "€",
      palate: profile.dims || {},
      confidence: SommProfile.confidencePct(profile) / 100,
      adventurousness: profile.adventure || 0.5,
      ratings_count: profile.ratingCount || 0,
    });
  } catch (e) { console.warn("db.saveProfile:", e.message); }
}

// Fetch the signed-in user's cloud profile row, or null if none exists yet
// (e.g. their very first sign-in) or on error. Callers should load this BEFORE ever
// calling saveProfile, so a fresh/emptier local device never clobbers richer cloud data.
async function getProfile() {
  const user = SommAuth.getUser();
  if (!user) return null;
  try {
    const { data, error } = await SommAuth.client()
      .from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (error) throw error;
    return data || null;
  } catch (e) { console.warn("db.getProfile:", e.message); return null; }
}

async function getCrowdFavorites(limit) {
  try {
    const { data } = await SommAuth.client().rpc("get_crowd_favorites", { p_limit: limit || 10 });
    return data || [];
  } catch (e) { return []; }
}

// Permanently delete the signed-in user's rows from every user-scoped table. Used by the
// "Delete my data" control so the app's privacy copy ("kept until you delete it") is actually
// true — previously the only reset control (#p-reset) only cleared localStorage and never
// touched Supabase.
async function deleteMyData() {
  const user = SommAuth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  try {
    const c = SommAuth.client();
    const results = await Promise.all([
      c.from("wine_ratings").delete().eq("user_id", user.id),
      c.from("chat_messages").delete().eq("user_id", user.id),
      c.from("profiles").delete().eq("id", user.id),
    ]);
    const failed = results.find((r) => r.error);
    if (failed) throw failed.error;
    return { ok: true };
  } catch (e) {
    console.warn("db.deleteMyData:", e.message);
    return { ok: false, error: e.message };
  }
}

// Write-only error visibility (round 5 finding: no monitoring existed, failures on beta
// testers' own devices were invisible beyond a toast they'd dismiss). Fire-and-forget by
// design — logging a failure must never itself throw or block the UI. Works for guests too
// (user_id is null); RLS only allows INSERT, so this can't be abused to read other reports.
async function logError(source, context, err) {
  try {
    const user = SommAuth.getUser();
    await SommAuth.client().from("error_reports").insert({
      user_id: user ? user.id : null,
      source,
      context: context || null,
      message: String((err && err.message) || err || "unknown error").slice(0, 2000),
      stack: err && err.stack ? String(err.stack).slice(0, 4000) : null,
      url: typeof location !== "undefined" ? location.href : null,
    });
  } catch (e) { /* never let error logging itself break the app */ }
}

const SommDB = { saveRating, saveMessage, saveProfile, getProfile, getCrowdFavorites, deleteMyData, logError };
