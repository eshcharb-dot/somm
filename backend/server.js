// Somm AI Backend Proxy
// Receives AI requests from frontend, calls Claude/Groq, returns responses
// Keeps API keys secure (never exposed to client)

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
// Vercel (and most PaaS) sit behind a reverse proxy — without this, req.ip resolves to the
// proxy's internal address instead of the client's, which silently breaks per-IP rate limiting.
app.set("trust proxy", 1);
app.use(cors({ origin: "https://eshcharb-dot.github.io" }));
app.use(express.json({ limit: "10mb" }));

const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;
const SOMM_TOKEN = process.env.SOMM_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!CLAUDE_KEY && !GROQ_KEY) {
  console.warn("⚠️ Warning: No API keys configured. Set ANTHROPIC_API_KEY or GROQ_API_KEY env vars.");
}
if (!SOMM_TOKEN) {
  console.error("SEVERE: SOMM_TOKEN is not set — /api/ai will reject ALL requests (fail closed) until it is configured.");
}

// Write-only visibility into unexpected upstream/provider failures (round 5 finding: no error
// monitoring existed anywhere — Vercel's console logs are ephemeral and nobody was watching
// them). Mirrors the client-side SommDB.logError table. Fire-and-forget: never awaited by
// callers, never throws, and never delays a response to the user.
function logBackendError(context, err) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  fetch(`${SUPABASE_URL}/rest/v1/error_reports`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      source: "backend",
      context,
      message: String((err && err.message) || err || "unknown error").slice(0, 2000),
      stack: err && err.stack ? String(err.stack).slice(0, 4000) : null,
    }),
  }).catch(() => {});
}

// Rate limiting + daily budget.
// NOTE: on Vercel serverless, this process is not a long-lived singleton — every cold start
// and every concurrent instance gets its own empty in-memory Map, so a bare in-memory limiter
// is NOT a real global cap there (each instance thinks it's the only one). Upstash Redis
// (durable, shared across instances) is therefore a HARD REQUIREMENT in a serverless
// deployment — see IS_SERVERLESS below. The in-memory fallback only runs on non-serverless
// hosts (e.g. `npm run dev` locally, or a long-lived container), where a single process really
// is the whole picture.
const IS_SERVERLESS = !!(process.env.VERCEL || process.env.NOW_REGION || process.env.AWS_LAMBDA_FUNCTION_NAME);
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const HAS_DURABLE_STORE = !!(UPSTASH_URL && UPSTASH_TOKEN);

if (IS_SERVERLESS && !HAS_DURABLE_STORE) {
  console.error("SEVERE: running serverless without UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN — rate limiting and usage budgets cannot be enforced across instances, so /api/ai will refuse all requests (503) until Upstash is configured.");
}

const rateLimits = new Map(); // dev-only fallback
const dailyBudgets = new Map(); // dev-only fallback
const REQUESTS_PER_MINUTE = 100;
// Conservative daily token budgets (charged against the REQUESTED maxTokens, capped at 4096
// per call below, so a single account/IP can't run up an unbounded bill even under sustained
// abuse). Signed-in accounts — verified via Supabase JWT, see verifySupabaseUser — get a
// higher budget since they're identifiable and can be individually blocked if abused.
// Bumped for the beta window: beta testers frequently cluster on one shared office/home/venue
// IP, so a per-IP cap sized for a single person (~26 replies/day) locks out an entire group
// after a handful of scans. 100k/IP (~65 replies) gives a shared network realistic daily
// headroom while still bounding worst-case cost; signed-in accounts get their own budget on
// top of this since they're scoped per-account, not per-IP.
const DAILY_TOKEN_BUDGET_ANON = 100_000; // ~65 default-sized (1500-token) replies/day per IP
const DAILY_TOKEN_BUDGET_USER = 150_000; // generous but still bounded per signed-in account

// Periodically drop expired entries so the in-memory fallback doesn't grow unbounded on
// long-lived instances (e.g. `npm run dev` / non-serverless hosting).
setInterval(() => {
  const now = Date.now();
  for (const [id, limit] of rateLimits) {
    if (now > limit.resetAt) rateLimits.delete(id);
  }
}, 5 * 60 * 1000).unref?.();

async function upstashIncr(key, ttlSeconds) {
  const incrRes = await fetch(`${UPSTASH_URL}/incr/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const { result: count } = await incrRes.json();
  if (count === 1) {
    fetch(`${UPSTASH_URL}/expire/${encodeURIComponent(key)}/${ttlSeconds}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    }).catch(() => {});
  }
  return count;
}

async function upstashIncrBy(key, amount, ttlSeconds) {
  const res = await fetch(`${UPSTASH_URL}/incrby/${encodeURIComponent(key)}/${amount}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const { result: total } = await res.json();
  if (total === amount) {
    fetch(`${UPSTASH_URL}/expire/${encodeURIComponent(key)}/${ttlSeconds}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    }).catch(() => {});
  }
  return total;
}

// Returns { ok, reason }. reason "unavailable" means there's no durable store on a serverless
// deployment — the caller MUST treat this as a hard failure (503), not silently let the
// request through, or the whole limiter is decorative. reason "exceeded" means the real cap
// was hit.
async function checkRateLimit(id) {
  if (HAS_DURABLE_STORE) {
    try {
      const count = await upstashIncr(`somm:ratelimit:${id}`, 60);
      return { ok: count <= REQUESTS_PER_MINUTE, reason: "exceeded" };
    } catch (e) {
      console.warn("Upstash rate limit check failed:", e.message);
      if (IS_SERVERLESS) return { ok: false, reason: "unavailable" };
      // else fall through to in-memory (non-serverless host, Upstash hiccup)
    }
  } else if (IS_SERVERLESS) {
    return { ok: false, reason: "unavailable" };
  }
  // Local/dev fallback — in-memory, per-process only. Never reached on serverless without
  // Upstash (handled above).
  const now = Date.now();
  const limit = rateLimits.get(id) || { count: 0, resetAt: now + 60000 };
  if (now > limit.resetAt) {
    limit.count = 0;
    limit.resetAt = now + 60000;
  }
  limit.count++;
  rateLimits.set(id, limit);
  return { ok: limit.count <= REQUESTS_PER_MINUTE, reason: "exceeded" };
}

function todayKeyUTC() { return new Date().toISOString().slice(0, 10); }

// Same availability semantics as checkRateLimit — see its comment.
async function checkDailyBudget(id, tokens, cap) {
  const key = `somm:daybudget:${id}:${todayKeyUTC()}`;
  if (HAS_DURABLE_STORE) {
    try {
      // 26h TTL (not 24h) gives slack for the key to still be readable near UTC midnight
      // across instances/clock skew, without meaningfully extending the enforced window.
      const total = await upstashIncrBy(key, tokens, 26 * 60 * 60);
      return { ok: total <= cap, reason: "exceeded" };
    } catch (e) {
      console.warn("Upstash daily budget check failed:", e.message);
      if (IS_SERVERLESS) return { ok: false, reason: "unavailable" };
    }
  } else if (IS_SERVERLESS) {
    return { ok: false, reason: "unavailable" };
  }
  const total = (dailyBudgets.get(key) || 0) + tokens;
  dailyBudgets.set(key, total);
  return { ok: total <= cap, reason: "exceeded" };
}

// Requires a verified Supabase JWT (not just the static x-somm-token) for vision requests
// (photo scan/analysis — by far the most expensive call the app makes: Opus + image tokens).
// Defaults OFF: both the Lead Engineer and PM's beta review agreed the static token + per-IP
// rate limit/budget/CORS defenses are an acceptable bar for a small closed beta, and flipping
// this on blocks the app's supported anonymous/guest scan flow — a real product decision, not
// something to force silently. This finishes the TODO in src/js/ai.js (JWT-based gating) as an
// opt-in switch to flip on before widening the beta or going public, rather than leaving the
// wiring half-built. See hasImageContent() below and its call site in POST /api/ai.
const REQUIRE_AUTH_FOR_VISION = String(process.env.REQUIRE_AUTH_FOR_VISION || "").toLowerCase() === "true";

// True if any message carries an image content block — used to identify the "heavier" vision
// calls (scan analysis, chat with a photo attached) that REQUIRE_AUTH_FOR_VISION gates.
function hasImageContent(messages) {
  return Array.isArray(messages) && messages.some((m) => Array.isArray(m && m.content) && m.content.some((c) => c && c.type === "image"));
}

// Verifies a Supabase session JWT by asking Supabase's own /auth/v1/user endpoint — no extra
// dependency needed, just an HTTP round trip with the token. Returns the verified user id, or
// null if no token was sent, SUPABASE_URL/SUPABASE_ANON_KEY aren't configured, or the token is
// invalid/expired. This is additive to the shared SOMM_TOKEN check below (not a replacement):
// it lets us scope abuse budgets to an account instead of only an IP when the client sends one,
// while still allowing the app's supported guest/anonymous mode.
async function verifySupabaseUser(authHeader) {
  if (!authHeader || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!m) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${m[1]}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data && data.id) || null;
  } catch (e) {
    console.warn("Supabase JWT verification failed:", e.message);
    return null;
  }
}

// POST /api/ai — main AI endpoint
// Body: { provider: "claude" | "groq", messages, system, model, maxTokens }
app.post("/api/ai", async (req, res) => {
  // Shared-secret check — fail CLOSED. A misconfigured deploy (SOMM_TOKEN unset) must reject
  // every request with a loud 503, not silently skip the check and become an open proxy.
  if (!SOMM_TOKEN) {
    return res.status(503).json({ error: "AI gateway misconfigured — contact the maintainer" });
  }
  if (req.headers["x-somm-token"] !== SOMM_TOKEN) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { provider = "claude", messages, system, model, maxTokens: requestedMaxTokens = 1500 } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Missing or invalid 'messages'" });
  }
  // Cap per-request token budget so no single call can generate a runaway bill.
  const maxTokens = Math.min(Number(requestedMaxTokens) || 1500, 4096);

  // A verified Supabase JWT (if the client sent one) ties limits to an account rather than
  // just an IP — stronger, since IPs are trivial to rotate and accounts aren't free to mint.
  const userId = await verifySupabaseUser(req.headers["authorization"]);
  const ip = req.ip || req.connection.remoteAddress;
  const identity = userId ? `user:${userId}` : `ip:${ip}`;

  // Opt-in stricter gate for the most expensive request shape (vision) — see
  // REQUIRE_AUTH_FOR_VISION's comment above. Checked before rate limit/budget so a rejected
  // request doesn't also consume the caller's quota.
  if (REQUIRE_AUTH_FOR_VISION && !userId && hasImageContent(messages)) {
    return res.status(401).json({ error: "Sign in to analyze photos — this keeps photo scans tied to an account." });
  }

  const rate = await checkRateLimit(identity);
  if (!rate.ok) {
    if (rate.reason === "unavailable") {
      return res.status(503).json({ error: "Rate limiting temporarily unavailable — try again shortly" });
    }
    return res.status(429).json({ error: "Rate limited (100 req/min per IP)" });
  }

  const budgetCap = userId ? DAILY_TOKEN_BUDGET_USER : DAILY_TOKEN_BUDGET_ANON;
  const budget = await checkDailyBudget(identity, maxTokens, budgetCap);
  if (!budget.ok) {
    if (budget.reason === "unavailable") {
      return res.status(503).json({ error: "Usage budget check temporarily unavailable — try again shortly" });
    }
    return res.status(429).json({
      error: userId
        ? "Daily usage budget reached for your account — resets at midnight UTC."
        : "This network has hit today's shared usage budget (this limit is per wifi/IP, not personal) — sign in for your own budget, or try again tomorrow.",
    });
  }

  try {
    let result;
    if (provider === "groq" && GROQ_KEY) {
      result = await callGroq(messages, system, model, maxTokens);
    } else if (provider === "claude" && CLAUDE_KEY) {
      result = await callClaude(messages, system, model, maxTokens);
    } else if (CLAUDE_KEY) {
      result = await callClaude(messages, system, model, maxTokens);
    } else {
      return res.status(503).json({ error: "No AI provider configured on backend" });
    }
    res.json(result);
  } catch (err) {
    console.error("AI error:", err.message);
    logBackendError(`api/ai:${req.body.provider || "claude"}`, err);
    res.status(500).json({ error: err.message });
  }
});

async function callClaude(messages, system, model, maxTokens) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": CLAUDE_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || "claude-opus-4-8",
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || `Claude API error ${res.status}`);
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return { text, usage: data.usage, stopReason: data.stop_reason };
}

async function callGroq(messages, system, model, maxTokens) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + GROQ_KEY,
    },
    body: JSON.stringify({
      model: model || "mixtral-8x7b-32768",
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, ...messages],
      temperature: 1,
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || `Groq API error ${res.status}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  return { text, usage: data.usage, stopReason: data.choices?.[0]?.finish_reason };
}

// Health check
app.get("/health", (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

// Start server — skipped when this file is `require()`d instead of run directly (e.g. by the
// test suite in test/), so tests can exercise `app` and the cost-control functions below
// without also binding a port / double-listening.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🍷 Somm AI backend running on port ${PORT}`);
    console.log(`Provider: ${CLAUDE_KEY ? "Claude" : GROQ_KEY ? "Groq" : "NONE (configure env vars)"}`);
  });
}

// The default export MUST be the Express app itself (a callable (req, res) handler) — Vercel's
// Node runtime detects and invokes it directly. Exporting a wrapper object here (even one that
// includes `app`) breaks production with "Can't detect way to handle request" — Vercel only
// looks for a function, not a property on some other shape.
//
// The test suite (test/*.test.js) needs the cost-control internals (checkRateLimit,
// checkDailyBudget, verifySupabaseUser) too, so they're attached as properties on the exported
// app function rather than wrapped in an object — `require("../server")` still returns a valid
// Express handler, while `require("../server").checkRateLimit` etc. remain accessible.
module.exports = app;
module.exports.checkRateLimit = checkRateLimit;
module.exports.checkDailyBudget = checkDailyBudget;
module.exports.verifySupabaseUser = verifySupabaseUser;
module.exports.hasImageContent = hasImageContent;
module.exports.REQUESTS_PER_MINUTE = REQUESTS_PER_MINUTE;
