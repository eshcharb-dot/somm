// Tests for the anonymous storage routes: /api/rating, /api/feedback, DELETE /api/me.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { freshServer, startFakeUpstash, closeServer } = require("./helpers");

const DEV = "123e4567-e89b-12d3-a456-426614174000";
const listen = (app) => new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const close = (s) => new Promise((r) => s.close(r));

async function setup(extraEnv = {}) {
  const up = await startFakeUpstash();
  const { app } = freshServer({ KV_REST_API_URL: up.url, KV_REST_API_TOKEN: "t", UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined, ...extraEnv });
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, body, { device = DEV, method = "POST" } = {}) => fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(device ? { "x-device-id": device } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const done = async () => { await close(server); await closeServer(up.server); };
  return { up, call, done };
}

const wine = { name: "Barolo", type: "red", region: "Piedmont", grape: "Nebbiolo", price: 30 };

test("rating: stores a valid entry and trims fields", async () => {
  const { up, call, done } = await setup();
  try {
    const res = await call("/api/rating", { wine: { ...wine, name: "x".repeat(500) }, rating: 4, context: "tonight" });
    assert.equal(res.status, 200);
    const stored = JSON.parse(up.lists.get(`somm:rating:${DEV}`)[0]);
    assert.equal(stored.wine_name.length, 200);
    assert.equal(stored.rating, 4);
  } finally { await done(); }
});

test("rating: rejects bad rating, missing name, bad/missing device id, oversize body", async () => {
  const { call, done } = await setup();
  try {
    assert.equal((await call("/api/rating", { wine, rating: 6 })).status, 400);
    assert.equal((await call("/api/rating", { wine, rating: 2.5 })).status, 400);
    assert.equal((await call("/api/rating", { wine: {}, rating: 3 })).status, 400);
    assert.equal((await call("/api/rating", { wine, rating: 3 }, { device: "nope" })).status, 400);
    assert.equal((await call("/api/rating", { wine, rating: 3 }, { device: null })).status, 400);
    assert.equal((await call("/api/rating", { wine, rating: 3, context: "y".repeat(9000) })).status, 413);
  } finally { await done(); }
});

test("rating: list is capped at 500 entries (LTRIM)", async () => {
  const { up, call, done } = await setup();
  try {
    up.lists.set(`somm:rating:${DEV}`, Array.from({ length: 500 }, (_, i) => `old${i}`));
    assert.equal((await call("/api/rating", { wine, rating: 5 })).status, 200);
    const list = up.lists.get(`somm:rating:${DEV}`);
    assert.equal(list.length, 500);
    assert.equal(JSON.parse(list[0]).rating, 5);
  } finally { await done(); }
});

test("rating: per-minute IP limit returns 429 on the 31st request", async () => {
  const { call, done } = await setup();
  try {
    let last;
    for (let i = 0; i < 31; i++) last = await call("/api/rating", { wine, rating: 3 });
    assert.equal(last.status, 429);
  } finally { await done(); }
});

test("feedback: stores, caps message, requires message, errors limited to 10/day", async () => {
  const { up, call, done } = await setup();
  try {
    assert.equal((await call("/api/feedback", { message: "  " })).status, 400);
    assert.equal((await call("/api/feedback", { message: "m".repeat(3000), context: "c", kind: "feedback" })).status, 200);
    const e = JSON.parse(up.lists.get("somm:feedback")[0]);
    assert.equal(e.message.length, 2000);
    assert.equal(e.kind, "feedback");
    assert.equal(e.deviceId, DEV);
    let last;
    for (let i = 0; i < 11; i++) last = await call("/api/feedback", { message: "boom", kind: "error" });
    assert.equal(last.status, 429);
  } finally { await done(); }
});

test("DELETE /api/me removes the device's ratings", async () => {
  const { up, call, done } = await setup();
  try {
    await call("/api/rating", { wine, rating: 3 });
    assert.ok(up.lists.has(`somm:rating:${DEV}`));
    assert.equal((await call("/api/me", undefined, { method: "DELETE" })).status, 200);
    assert.ok(!up.lists.has(`somm:rating:${DEV}`));
  } finally { await done(); }
});

test("storage routes fail closed (503) without a durable store", async () => {
  const { app } = freshServer({ KV_REST_API_URL: undefined, KV_REST_API_TOKEN: undefined, UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined });
  const server = await listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/feedback`, {
      method: "POST", headers: { "content-type": "application/json", "x-device-id": DEV }, body: JSON.stringify({ message: "hi" }),
    });
    assert.equal(res.status, 503);
  } finally { await close(server); }
});
