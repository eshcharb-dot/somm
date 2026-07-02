// Test helpers: a fake Upstash REST API and a fake Supabase auth endpoint (both just enough
// of the real wire protocol for checkRateLimit/checkDailyBudget/verifySupabaseUser to work
// against), plus a way to re-`require()` server.js with a specific env — several of the
// module's key behaviors (IS_SERVERLESS, HAS_DURABLE_STORE) are computed once at require time
// from process.env, so each test scenario needs its own fresh module instance.
"use strict";

const http = require("http");

// Minimal fake Upstash REST API backing GET /incr/:key, /incrby/:key/:amount, /expire/:key/:ttl
// — the only three calls server.js makes (see upstashIncr/upstashIncrBy in server.js).
function startFakeUpstash({ fail = false } = {}) {
  const counters = new Map();
  const server = http.createServer((req, res) => {
    if (fail) {
      // Simulate a real outage (connection reset), not just a non-2xx JSON error — server.js's
      // upstashIncr/upstashIncrBy don't check res.ok before parsing, so a clean JSON error body
      // would silently parse to `{result: undefined}` instead of exercising the catch/"unavailable"
      // path. A destroyed socket reliably makes the fetch() call itself throw.
      req.socket.destroy();
      return;
    }
    res.setHeader("content-type", "application/json");
    const parts = new URL(req.url, "http://localhost").pathname.split("/").filter(Boolean);
    if (parts[0] === "incr") {
      const key = decodeURIComponent(parts[1]);
      const count = (counters.get(key) || 0) + 1;
      counters.set(key, count);
      res.end(JSON.stringify({ result: count }));
      return;
    }
    if (parts[0] === "incrby") {
      const key = decodeURIComponent(parts[1]);
      const amount = Number(parts[2]) || 0;
      const total = (counters.get(key) || 0) + amount;
      counters.set(key, total);
      res.end(JSON.stringify({ result: total }));
      return;
    }
    if (parts[0] === "expire") {
      res.end(JSON.stringify({ result: 1 }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}`, counters });
    });
  });
}

// Minimal fake Supabase /auth/v1/user endpoint backing verifySupabaseUser.
function startFakeSupabase({ validToken = "good-token", userId = "user-123" } = {}) {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    const auth = req.headers["authorization"] || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (token === validToken) {
      res.end(JSON.stringify({ id: userId }));
    } else {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "invalid token" }));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

// Re-requires server.js with only the given env vars overridden for the duration of the
// require (module-level consts like IS_SERVERLESS/HAS_DURABLE_STORE are computed once at
// require time) — restores the previous values for exactly those keys afterward so scenarios
// can't leak into each other or into the ambient environment.
function freshServer(envOverrides) {
  const serverPath = require.resolve("../server.js");
  const keys = Object.keys(envOverrides);
  const saved = {};
  keys.forEach((k) => { saved[k] = process.env[k]; });
  keys.forEach((k) => {
    if (envOverrides[k] === undefined) delete process.env[k];
    else process.env[k] = envOverrides[k];
  });
  delete require.cache[serverPath];
  const mod = require(serverPath);
  keys.forEach((k) => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  });
  // server.js exports the Express app itself as module.exports (required by Vercel's Node
  // runtime — a wrapper object isn't detected as a valid handler), with the cost-control
  // internals attached as properties on it. Normalize to a plain object here so callers can
  // destructure { app, checkRateLimit, ... } without caring about that export shape.
  return {
    app: mod,
    checkRateLimit: mod.checkRateLimit,
    checkDailyBudget: mod.checkDailyBudget,
    verifySupabaseUser: mod.verifySupabaseUser,
    REQUESTS_PER_MINUTE: mod.REQUESTS_PER_MINUTE,
  };
}

module.exports = { startFakeUpstash, startFakeSupabase, closeServer, freshServer };
