#!/usr/bin/env node
// Post-deploy smoke test — run against a LIVE backend URL right after every deploy (see
// .github/workflows/deploy-backend.yml) so a stale or misconfigured deployment (e.g. the
// beta-hardening fail-closed checks silently not running) fails CI loudly instead of sitting
// undetected in production for weeks, which is exactly what happened before this existed.
//
// Usage: node scripts/smoke-test.js <backend-url>
//   or:  SMOKE_TEST_URL=https://your-backend.vercel.app node scripts/smoke-test.js
"use strict";

const TARGET = process.argv[2] || process.env.SMOKE_TEST_URL;

if (!TARGET) {
  console.error("Usage: node scripts/smoke-test.js <backend-url>  (or set SMOKE_TEST_URL)");
  process.exit(2);
}

// Not a real secret — this is the same public shared-app-identifier constant shipped in the
// frontend bundle (see SOMM_CLIENT_TOKEN in src/js/ai.js) and expected in the backend's
// SOMM_TOKEN env var (see backend/.env.example). Used below to make one real, minimal /api/ai
// call so a missing/rotated ANTHROPIC_API_KEY or misconfigured Upstash creds fail this
// workflow loudly instead of only surfacing as a broken Chat/Scan for real users.
const SOMM_CLIENT_TOKEN = "somm-2025";

const BASE = TARGET.replace(/\/$/, "");
let failures = 0;

function check(label, ok, detail) {
  if (ok) {
    console.log(`✓ ${label}`);
  } else {
    failures++;
    console.error(`✗ ${label}${detail ? " — " + detail : ""}`);
  }
}

async function main() {
  // 1. /health must be up at all — confirms the deploy actually shipped and is reachable.
  try {
    const res = await fetch(`${BASE}/health`);
    const body = await res.json().catch(() => ({}));
    check("GET /health returns 200 with status:ok", res.status === 200 && body.status === "ok", `got ${res.status} ${JSON.stringify(body)}`);
  } catch (e) {
    check("GET /health returns 200 with status:ok", false, e.message);
  }

  // 2. No shared-secret token → must be rejected (403 wrong/missing token, or 503 if the
  // backend itself is misconfigured/fail-closed) — NEVER a 200. This is the exact regression
  // that let production run as an open, unrate-limited proxy for weeks undetected.
  try {
    const res = await fetch(`${BASE}/api/ai`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "smoke test" }] }),
    });
    check(
      "POST /api/ai without x-somm-token is rejected (403/503, never 200)",
      res.status === 403 || res.status === 503,
      `got ${res.status}`
    );
  } catch (e) {
    check("POST /api/ai without x-somm-token is rejected (403/503, never 200)", false, e.message);
  }

  // 2b. WITH a valid client token, a real minimal AI call must succeed end-to-end. Everything
  // above only proves the backend is reachable and correctly rejects bad auth — this is the
  // check that actually exercises the Claude API key and the Upstash-backed rate/budget path,
  // which is exactly what nothing in the pipeline previously verified before reaching users
  // (a missing/wrong ANTHROPIC_API_KEY or Upstash creds still returns cleanly from /health).
  try {
    const res = await fetch(`${BASE}/api/ai`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-somm-token": SOMM_CLIENT_TOKEN },
      body: JSON.stringify({
        provider: "claude",
        model: "claude-sonnet-5",
        maxTokens: 16,
        messages: [{ role: "user", content: 'Reply with exactly one word: "pong".' }],
      }),
    });
    const body = await res.json().catch(() => ({}));
    check(
      "POST /api/ai with a valid token returns a real AI reply (200 + non-empty text)",
      res.status === 200 && typeof body.text === "string" && body.text.trim().length > 0,
      `got ${res.status} ${JSON.stringify(body).slice(0, 300)}`
    );
  } catch (e) {
    check("POST /api/ai with a valid token returns a real AI reply (200 + non-empty text)", false, e.message);
  }

  // 3. CORS preflight from an untrusted origin must NOT be allowed — the backend is locked to
  // the GitHub Pages origin (see backend/server.js's cors({origin: ...}) config).
  try {
    const evilOrigin = "https://evil-origin.example";
    const res = await fetch(`${BASE}/api/ai`, {
      method: "OPTIONS",
      headers: {
        Origin: evilOrigin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-somm-token",
      },
    });
    const allowOrigin = res.headers.get("access-control-allow-origin");
    check(
      "CORS preflight from an untrusted origin is not allowed",
      allowOrigin !== evilOrigin,
      `Access-Control-Allow-Origin: ${allowOrigin}`
    );
  } catch (e) {
    check("CORS preflight from an untrusted origin is not allowed", false, e.message);
  }

  if (failures > 0) {
    console.error(`\n${failures} smoke test check(s) failed against ${BASE}`);
    process.exit(1);
  }
  console.log(`\nAll smoke test checks passed against ${BASE}`);
}

main().catch((e) => {
  console.error("Smoke test crashed:", e);
  process.exit(1);
});
