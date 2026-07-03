// Somm service worker — cache-first for static assets, network-first for API calls.
"use strict";

// Stamped with the deploying commit's SHA by .github/workflows/deploy-frontend.yml before
// publish (see the "Stamp service worker cache" step there). This file's bytes must change on
// every deploy — the browser only re-runs install/activate (and therefore only re-fetches
// app.js/ai.js/app.css etc. into the cache) when the SW script itself changed byte-for-byte.
// A hardcoded constant here silently freezes already-installed users on whatever build was
// live when they first installed the PWA, no matter how many fixes ship after that. If you
// ever see the literal token below in production, the stamp step didn't run — treat that as a
// deploy bug, not a working cache name.
const CACHE_NAME = "somm-56368301bcc06d450cbe466fa231ff9585d45d4f";

const STATIC_ASSETS = [
  "/somm/",
  "/somm/css/app.css",
  "/somm/js/data.js",
  "/somm/js/profile.js",
  "/somm/js/ai.js",
  "/somm/js/auth.js",
  "/somm/js/db.js",
  "/somm/js/app.js",
  "/somm/manifest.json",
  "/somm/icon-192.png",
  "/somm/icon-512.png",
];

// Precache static shell on install.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Drop old caches on activate.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Network-first for API calls (backend + external APIs like Supabase, Frankfurter).
  const isAPI =
    url.hostname.includes("vercel.app") ||
    url.hostname.includes("supabase") ||
    url.hostname.includes("frankfurter.app") ||
    url.pathname.startsWith("/api/");

  if (isAPI) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for everything else (static assets).
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        // Cache successful GET responses for static assets.
        if (res.ok && event.request.method === "GET") {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      });
    })
  );
});
