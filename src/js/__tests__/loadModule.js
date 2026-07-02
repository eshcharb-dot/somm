// Test helper: loads Somm's plain-<script>-global browser files into a Node `vm` sandbox so
// they can be unit tested without a bundler/DOM. Each file assigns its public API to a global
// (e.g. `const SommProfile = {...}`) — we just read that property back off the sandbox after
// running the script(s) in order, the same order <script> tags load them in index.html.
"use strict";

const vm = require("vm");
const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "..");

// Minimal in-memory localStorage stand-in — enough for profile.js's load/save calls.
function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    _store: store,
  };
}

// Each file's public API is a single top-level `const <Name> = {...}` — this is what we pull
// back out after evaluating it (see note below on why we can't just read it off the sandbox).
const EXPORT_NAME = {
  "data.js": "SOMM_DATA",
  "profile.js": "SommProfile",
  "ai.js": "SommAI",
};

// Runs one or more files (relative to src/js/) in a single shared sandbox context — later
// files can see globals defined by earlier ones (e.g. ai.js reads SommProfile, profile.js
// reads SOMM_DATA) exactly like real <script> tag load order — and returns an object exposing
// each file's export by name (e.g. { SommProfile, SommAI }).
//
// Note: every source file starts with "use strict", so its top-level `const`/`let` never
// become own properties of the sandbox/global object (that's true of strict *and* sloppy
// mode — only `var` does that). We work around it by asking the shared vm context itself,
// via a follow-up `vm.runInContext(name, sandbox)`, which resolves against the context's
// lexical environment (not the global object) and therefore does see it.
function loadFiles(relPaths, extraGlobals) {
  const sandbox = {
    console,
    localStorage: makeLocalStorage(),
    window: { location: { hostname: "test" } },
    fetch: () => Promise.reject(new Error("fetch() not stubbed in this test")),
    ...(extraGlobals || {}),
  };
  vm.createContext(sandbox);
  const exported = {};
  for (const relPath of relPaths) {
    const code = fs.readFileSync(path.join(SRC_DIR, relPath), "utf8");
    vm.runInContext(code, sandbox, { filename: relPath });
    const name = EXPORT_NAME[relPath];
    if (name) exported[name] = vm.runInContext(name, sandbox);
  }
  return exported;
}

module.exports = { loadFiles, makeLocalStorage };
