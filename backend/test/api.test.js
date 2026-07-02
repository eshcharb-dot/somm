// Integration tests for the /api/ai fail-closed behavior — this is exactly the guarantee that
// silently broke in production (see the deploy-drift incident: a stale deployment ran as an
// open, unrate-limited proxy for weeks). These start the real Express app on an ephemeral port
// and hit it over HTTP, so they exercise the actual route wiring, not just the helper functions.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { freshServer } = require("./helpers");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}
function close(server) {
  return new Promise((resolve) => server.close(resolve));
}
function baseUrl(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

test("POST /api/ai returns 503 (fail closed) when SOMM_TOKEN is not configured", async () => {
  const { app } = freshServer({ SOMM_TOKEN: undefined });
  const server = await listen(app);
  try {
    const res = await fetch(`${baseUrl(server)}/api/ai`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    assert.equal(res.status, 503);
  } finally {
    await close(server);
  }
});

test("POST /api/ai returns 403 when the shared token header is missing or wrong", async () => {
  const { app } = freshServer({ SOMM_TOKEN: "correct-token" });
  const server = await listen(app);
  try {
    const noHeader = await fetch(`${baseUrl(server)}/api/ai`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    assert.equal(noHeader.status, 403);

    const wrongHeader = await fetch(`${baseUrl(server)}/api/ai`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-somm-token": "nope" },
      body: JSON.stringify({ messages: [] }),
    });
    assert.equal(wrongHeader.status, 403);
  } finally {
    await close(server);
  }
});

test("POST /api/ai returns 400 for a valid token but missing/invalid 'messages'", async () => {
  const { app } = freshServer({ SOMM_TOKEN: "correct-token" });
  const server = await listen(app);
  try {
    const res = await fetch(`${baseUrl(server)}/api/ai`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-somm-token": "correct-token" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  } finally {
    await close(server);
  }
});

test("GET /health responds ok without needing the shared token", async () => {
  const { app } = freshServer({ SOMM_TOKEN: "correct-token" });
  const server = await listen(app);
  try {
    const res = await fetch(`${baseUrl(server)}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
  } finally {
    await close(server);
  }
});
