// Somm — anonymous device identity. No accounts: a random ID in localStorage scopes
// server-side ratings/feedback (see backend /api/rating, /api/feedback, /api/me).
"use strict";

const DEVICE_KEY = "somm_device_id";
const _UUID_RE = /^[0-9a-f-]{36}$/;

function deviceId() {
  let id = null;
  try { id = localStorage.getItem(DEVICE_KEY); } catch (e) { /* storage blocked */ }
  if (!id || !_UUID_RE.test(id)) {
    id = (self.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        return (c === "x" ? r : (r & 3 | 8)).toString(16);
      });
    try { localStorage.setItem(DEVICE_KEY, id); } catch (e) { /* keep in-memory only */ }
  }
  return id;
}

const SommDevice = { id: deviceId, KEY: DEVICE_KEY };

// Compatibility shim: accounts were removed; everyone is a guest.
const SommAuth = {
  init: async () => null,
  getUser: () => null,
  getAccessToken: async () => null,
};
