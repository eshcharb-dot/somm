// Somm — AI layer. Calls backend proxy for Claude/Groq access (no client-side keys).
// Backend at BACKEND_URL handles API calls securely.
"use strict";

const BACKEND_URL = window.location.hostname === "localhost"
  ? "http://localhost:3000"
  : "https://somm-backend.vercel.app"; // Update to your deployed backend URL

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
- Shelf photo → read the visible bottles, pick the best 2–3 for this user and their budget; if labels are unreadable, say which section to look at.
- Wine list photo → pick best 2–3 value-for-money for their profile (and their food if mentioned). Flag overpriced traps. Use list prices in cards.
- Food menu photo → suggest what wine style to order with what dish.
- If the image is unclear, say what you can see and ask for a closer shot.

STYLE RULES
- Keep replies under ~120 words of prose (cards excluded). No headers, no bullet lists unless comparing. No markdown tables.
- Currency: match the user's setting. Never invent exact vintages you can't see.`;

function buildSystemPrompt(profile, mode, currency) {
  const modeCtx = {
    tonight: "CURRENT CONTEXT: The user is AT HOME deciding what to drink tonight and what to pair with their food.",
    store: "CURRENT CONTEXT: The user is AT A WINE STORE deciding what to buy. Use the store budget band.",
    restaurant: "CURRENT CONTEXT: The user is AT A RESTAURANT choosing from a wine list. Use the restaurant budget band. Value-for-money matters.",
    chat: "CURRENT CONTEXT: Open conversation — could be anything wine-related.",
  }[mode] || "";
  return [
    VERA_SYSTEM_BASE,
    `USER SETTINGS: currency ${currency || "€"}.`,
    modeCtx,
    "=== USER'S TASTE PROFILE ===",
    SommProfile.profileForPrompt(profile),
  ].join("\n\n");
}

// Call backend AI proxy (no client-side keys needed)
async function callAI({ messages, system, provider, model, maxTokens }) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/ai`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: provider || "claude",
        messages,
        system,
        model,
        maxTokens: maxTokens || 1500,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      if (res.status === 429) throw new Error("Rate limited — wait a moment and try again.");
      if (res.status === 503) throw new Error("AI service unavailable — try again later.");
      throw new Error(err.error || `Backend error ${res.status}`);
    }

    const data = await res.json();
    return { text: data.text, usage: data.usage, stopReason: data.stopReason };
  } catch (err) {
    if (err.message.includes("fetch")) {
      throw new Error("Can't reach AI backend. Check your internet or backend URL.");
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

const SommAI = { buildSystemPrompt, callAI, parseWineCards, prepareImage };
