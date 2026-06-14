// Somm AI Backend Proxy
// Receives AI requests from frontend, calls Claude/Groq, returns responses
// Keeps API keys secure (never exposed to client)

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;

if (!CLAUDE_KEY && !GROQ_KEY) {
  console.warn("⚠️ Warning: No API keys configured. Set ANTHROPIC_API_KEY or GROQ_API_KEY env vars.");
}

// Rate limiting (simple in-memory, replace with Redis for production)
const rateLimits = new Map();
const REQUESTS_PER_MINUTE = 100;

function checkRateLimit(ip) {
  const now = Date.now();
  const limit = rateLimits.get(ip) || { count: 0, resetAt: now + 60000 };
  if (now > limit.resetAt) {
    limit.count = 0;
    limit.resetAt = now + 60000;
  }
  limit.count++;
  rateLimits.set(ip, limit);
  return limit.count <= REQUESTS_PER_MINUTE;
}

// POST /api/ai — main AI endpoint
// Body: { provider: "claude" | "groq", messages, system, model, maxTokens }
app.post("/api/ai", async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: "Rate limited (100 req/min per IP)" });
  }

  const { provider = "claude", messages, system, model, maxTokens = 1500 } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Missing or invalid 'messages'" });
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
      system_prompt: system,
      messages,
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

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🍷 Somm AI backend running on port ${PORT}`);
  console.log(`Provider: ${CLAUDE_KEY ? "Claude" : GROQ_KEY ? "Groq" : "NONE (configure env vars)"}`);
});
