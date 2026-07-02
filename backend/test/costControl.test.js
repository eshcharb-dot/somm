// Tests for the cost-control logic that stands between the backend and a runaway API bill:
// checkRateLimit, checkDailyBudget, verifySupabaseUser. These previously had zero automated
// coverage — see the CI incident that motivated this (an open, unrate-limited proxy silently
// running in production for weeks).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startFakeUpstash, startFakeSupabase, closeServer, freshServer } = require("./helpers");

// ---------- checkRateLimit ----------

test("checkRateLimit: non-serverless in-memory fallback allows up to the per-minute cap then blocks", async () => {
  const { checkRateLimit, REQUESTS_PER_MINUTE } = freshServer({
    VERCEL: undefined, NOW_REGION: undefined, AWS_LAMBDA_FUNCTION_NAME: undefined,
    UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined,
  });
  const id = "ip:1.2.3.4";
  for (let i = 0; i < REQUESTS_PER_MINUTE; i++) {
    const r = await checkRateLimit(id);
    assert.equal(r.ok, true, `request ${i + 1} should be allowed`);
  }
  const over = await checkRateLimit(id);
  assert.equal(over.ok, false);
  assert.equal(over.reason, "exceeded");
});

test("checkRateLimit: serverless without a durable store fails closed (never falls back to per-instance memory)", async () => {
  const { checkRateLimit } = freshServer({
    VERCEL: "1", UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined,
  });
  const r = await checkRateLimit("ip:5.6.7.8");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unavailable");
});

test("checkRateLimit: serverless + Upstash enforces the shared cap across calls", async () => {
  const upstash = await startFakeUpstash();
  const { checkRateLimit, REQUESTS_PER_MINUTE } = freshServer({
    VERCEL: "1", UPSTASH_REDIS_REST_URL: upstash.url, UPSTASH_REDIS_REST_TOKEN: "test-token",
  });
  try {
    const id = "user:abc";
    for (let i = 0; i < REQUESTS_PER_MINUTE; i++) {
      const r = await checkRateLimit(id);
      assert.equal(r.ok, true, `request ${i + 1} should be allowed`);
    }
    const over = await checkRateLimit(id);
    assert.equal(over.ok, false);
    assert.equal(over.reason, "exceeded");
  } finally {
    await closeServer(upstash.server);
  }
});

test("checkRateLimit: serverless + Upstash outage fails closed, not open", async () => {
  const upstash = await startFakeUpstash({ fail: true });
  const { checkRateLimit } = freshServer({
    VERCEL: "1", UPSTASH_REDIS_REST_URL: upstash.url, UPSTASH_REDIS_REST_TOKEN: "test-token",
  });
  try {
    const r = await checkRateLimit("ip:9.9.9.9");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unavailable");
  } finally {
    await closeServer(upstash.server);
  }
});

// ---------- checkDailyBudget ----------

test("checkDailyBudget: non-serverless in-memory fallback allows spend up to the cap then blocks", async () => {
  const { checkDailyBudget } = freshServer({
    VERCEL: undefined, NOW_REGION: undefined, AWS_LAMBDA_FUNCTION_NAME: undefined,
    UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined,
  });
  const id = "ip:1.1.1.1";
  const cap = 1000;
  const first = await checkDailyBudget(id, 600, cap);
  assert.equal(first.ok, true);
  const second = await checkDailyBudget(id, 300, cap);
  assert.equal(second.ok, true); // 900 <= 1000
  const third = await checkDailyBudget(id, 200, cap);
  assert.equal(third.ok, false); // 1100 > 1000
  assert.equal(third.reason, "exceeded");
});

test("checkDailyBudget: serverless without a durable store fails closed", async () => {
  const { checkDailyBudget } = freshServer({
    VERCEL: "1", UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined,
  });
  const r = await checkDailyBudget("ip:2.2.2.2", 100, 1000);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unavailable");
});

test("checkDailyBudget: serverless + Upstash accumulates spend across calls and enforces the cap", async () => {
  const upstash = await startFakeUpstash();
  const { checkDailyBudget } = freshServer({
    VERCEL: "1", UPSTASH_REDIS_REST_URL: upstash.url, UPSTASH_REDIS_REST_TOKEN: "test-token",
  });
  try {
    const id = "user:xyz";
    const cap = 1000;
    assert.equal((await checkDailyBudget(id, 700, cap)).ok, true);
    assert.equal((await checkDailyBudget(id, 250, cap)).ok, true); // 950 <= 1000
    const over = await checkDailyBudget(id, 100, cap); // 1050 > 1000
    assert.equal(over.ok, false);
    assert.equal(over.reason, "exceeded");
  } finally {
    await closeServer(upstash.server);
  }
});

test("checkDailyBudget: signed-in users and IPs are tracked as independent budgets", async () => {
  const upstash = await startFakeUpstash();
  const { checkDailyBudget } = freshServer({
    VERCEL: "1", UPSTASH_REDIS_REST_URL: upstash.url, UPSTASH_REDIS_REST_TOKEN: "test-token",
  });
  try {
    const cap = 500;
    assert.equal((await checkDailyBudget("user:abc", 400, cap)).ok, true);
    // A different identity (another user or an IP) must not share the same accumulated spend.
    assert.equal((await checkDailyBudget("ip:1.2.3.4", 400, cap)).ok, true);
  } finally {
    await closeServer(upstash.server);
  }
});

// ---------- verifySupabaseUser ----------

test("verifySupabaseUser: returns null when no Authorization header is sent", async () => {
  const { verifySupabaseUser } = freshServer({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon-key" });
  assert.equal(await verifySupabaseUser(undefined), null);
});

test("verifySupabaseUser: returns null when Supabase isn't configured on the backend, even with a header", async () => {
  const { verifySupabaseUser } = freshServer({ SUPABASE_URL: undefined, SUPABASE_ANON_KEY: undefined });
  assert.equal(await verifySupabaseUser("Bearer some-token"), null);
});

test("verifySupabaseUser: returns null for a malformed Authorization header", async () => {
  const { verifySupabaseUser } = freshServer({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon-key" });
  assert.equal(await verifySupabaseUser("Basic not-a-bearer-token"), null);
});

test("verifySupabaseUser: returns the verified user id for a valid session JWT", async () => {
  const supabase = await startFakeSupabase({ validToken: "good-token", userId: "user-123" });
  const { verifySupabaseUser } = freshServer({ SUPABASE_URL: supabase.url, SUPABASE_ANON_KEY: "anon-key" });
  try {
    assert.equal(await verifySupabaseUser("Bearer good-token"), "user-123");
  } finally {
    await closeServer(supabase.server);
  }
});

test("verifySupabaseUser: returns null for an invalid/expired token", async () => {
  const supabase = await startFakeSupabase({ validToken: "good-token" });
  const { verifySupabaseUser } = freshServer({ SUPABASE_URL: supabase.url, SUPABASE_ANON_KEY: "anon-key" });
  try {
    assert.equal(await verifySupabaseUser("Bearer expired-or-wrong"), null);
  } finally {
    await closeServer(supabase.server);
  }
});
