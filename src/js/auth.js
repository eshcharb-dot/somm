// Somm — Supabase auth layer. Sign up, sign in, sign out, session state.
"use strict";

const SUPABASE_URL = "https://lnrkstvkbpgjfjdwfgik.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxucmtzdHZrYnBnamZqZHdmZ2lrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MjY1NDQsImV4cCI6MjA5NzAwMjU0NH0.nxLsHk9svCAd0th99Jgv007kl76QyUqoN8q8OUsL9vA";

let _sb = null;
function client() {
  if (!_sb) _sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  return _sb;
}

let _user = null;
function getUser() { return _user; }

async function init(onChange) {
  try {
    const { data: { session } } = await client().auth.getSession();
    _user = session?.user ?? null;
  } catch (e) {
    console.warn("Supabase auth init failed (continuing as guest):", e.message);
    _user = null;
  }
  client().auth.onAuthStateChange((event, session) => {
    _user = session?.user ?? null;
    onChange(event, _user);
  });
  return _user;
}

async function signUp(email, password, name) {
  const { data, error } = await client().auth.signUp({
    email, password,
    options: { data: { display_name: name || email.split("@")[0] } },
  });
  if (error) throw error;
  return data;
}

async function signIn(email, password) {
  const { data, error } = await client().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signInWithGoogle() {
  const { error } = await client().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}

async function signOut() {
  const { error } = await client().auth.signOut();
  if (error) throw error;
}

// Sends a password-reset email. Supabase redirects the user back to this page with a
// recovery session; app.js listens for the "PASSWORD_RECOVERY" auth event to prompt for a
// new password. Without this, an email/password user who forgets their password is
// permanently locked out (sign-up rejects re-registering the same email).
async function resetPasswordForEmail(email) {
  const { error } = await client().auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });
  if (error) throw error;
}

async function updatePassword(newPassword) {
  const { error } = await client().auth.updateUser({ password: newPassword });
  if (error) throw error;
}

// Returns the current session's access token (JWT), or null if signed out. Used to prove
// identity to the backend AI proxy (see ai.js) so abuse limits can be scoped per-account
// instead of only per-IP.
async function getAccessToken() {
  try {
    const { data: { session } } = await client().auth.getSession();
    return session?.access_token || null;
  } catch (e) { return null; }
}

const SommAuth = {
  init, signUp, signIn, signInWithGoogle, signOut, getUser, client,
  resetPasswordForEmail, updatePassword, getAccessToken,
};
