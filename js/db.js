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

async function getCrowdFavorites(limit) {
  try {
    const { data } = await SommAuth.client().rpc("get_crowd_favorites", { p_limit: limit || 10 });
    return data || [];
  } catch (e) { return []; }
}

const SommDB = { saveRating, saveMessage, saveProfile, getCrowdFavorites };
