import assert from "node:assert/strict";
import { test } from "node:test";
import { handleAccessRequest } from "../src/access-handler.ts";

const URL_ROOT = "https://nen-circleci-mcp.example";
const UPSTREAM = "https://example.cloudflareaccess.com/cdn-cgi/access/sso/oidc/demo-client";
const SECRET = "test-only-cookie-encryption-key-32bytes-long";
const fakeKV = () => {
  const values = new Map();
  return {
    values,
    put: async (key, data) => { values.set(key, data); },
    get: async (key) => values.get(key) ?? null,
    delete: async (key) => { values.delete(key); },
  };
};
const fakeReplayGuard = () => {
  const claimed = new Set();
  return {
    idFromName: (name) => name,
    get: () => ({
      fetch: async (request) => {
        const nonce = await request.text();
        if (claimed.has(nonce)) return new Response(null, { status: 409 });
        claimed.add(nonce);
        return new Response(null, { status: 204 });
      },
    }),
  };
};
const fakeEnv = () => ({
  COOKIE_ENCRYPTION_KEY: SECRET,
  OAUTH_KV: fakeKV(),
  OAUTH_REPLAY_GUARD: fakeReplayGuard(),
  ACCESS_CLIENT_ID: "demo-client",
  ACCESS_AUTHORIZATION_URL: UPSTREAM + "/authorization",
  ACCESS_TOKEN_URL: UPSTREAM + "/token",
  OAUTH_PROVIDER: {
    parseAuthRequest: async () => ({ clientId: "chatgpt-client", scope: ["read"] }),
    lookupClient: async () => ({
      clientId: "chatgpt-client", clientName: "ChatGPT",
      redirectUris: ["https://chatgpt.com/callback"],
    }),
    completeAuthorization: async () => {
      throw new Error("Unexpected authorization completion");
    },
  },
});
const cookies = (response) => response.headers.getSetCookie().map(value => value.split(";")[0]);
const getCookie = (response, prefix) => cookies(response).find(value => value.startsWith(prefix));
const request = (path, options = {}) => new Request(URL_ROOT + path, options);

test("first-time consent stays CSRF-protected and redirects with browser-bound state", async () => {
  const env = fakeEnv();
  const first = await handleAccessRequest(request("/authorize"), env, {});
  assert.equal(first.status, 200);
  const csrfCookie = getCookie(first, "__Host-CSRF_TOKEN=");
  assert.ok(csrfCookie);
  const html = await first.text();
  const state = html.match(/name="state" value="([^"]+)"/)?.[1];
  const csrf = html.match(/name="csrf_token" value="([^"]+)"/)?.[1];
  assert.ok(state);
  assert.ok(csrf);

  const body = new URLSearchParams({ state, csrf_token: csrf });
  const approved = await handleAccessRequest(request("/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: csrfCookie },
    body: body.toString(),
  }), env, {});
  assert.equal(approved.status, 302);
  assert.ok(approved.headers.get("location").startsWith(UPSTREAM + "/authorization"));
  assert.ok(getCookie(approved, "__Host-OAUTH_STATE="));
  assert.ok(getCookie(approved, "__Host-APPROVED_CLIENTS="));
  // getCookie() returns only the name=value pair, so it cannot verify the
  // expiration attributes that follow the first semicolon in Set-Cookie.
  const csrfClearCookies = approved.headers.getSetCookie()
    .filter((value) => value.startsWith("__Host-CSRF_TOKEN="));
  assert.equal(csrfClearCookies.length, 1);
  const csrfCookieParts = csrfClearCookies[0].split(";").map((part) => part.trim());
  assert.equal(csrfCookieParts[0], "__Host-CSRF_TOKEN=");
  for (const requiredAttribute of ["Max-Age=0", "Secure", "HttpOnly", "Path=/"]) {
    assert.ok(csrfCookieParts.includes(requiredAttribute), "Missing CSRF clear-cookie attribute: " + requiredAttribute);
  }

  const callback = new URL(approved.headers.get("location")).searchParams.get("state");
  const stateCookie = getCookie(approved, "__Host-OAUTH_STATE=");
  assert.ok(callback);
  // Login-CSRF attack: callback state with no cookie must fail *before* use.
  const rejected = await handleAccessRequest(request("/callback?state=" + encodeURIComponent(callback) + "&code=demo"), env, {});
  assert.equal(rejected.status, 400);
  // Proper session continuity reaches upstream exchange; no code makes it return 400.
  const bound = await handleAccessRequest(request("/callback?state=" + encodeURIComponent(callback), {
    headers: { Cookie: stateCookie },
  }), env, {});
  assert.equal(bound.status, 400);
  assert.match(await bound.text(), /Missing authorization code/);
});

test("already approved client also receives callback session binding", async () => {
  const env = fakeEnv();
  const first = await handleAccessRequest(request("/authorize"), env, {});
  const html = await first.text();
  const state = html.match(/name="state" value="([^"]+)"/)?.[1];
  const csrf = html.match(/name="csrf_token" value="([^"]+)"/)?.[1];
  const approved = await handleAccessRequest(request("/authorize", {
    method: "POST",
    headers: {
      Cookie: getCookie(first, "__Host-CSRF_TOKEN="),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ state, csrf_token: csrf }).toString(),
  }), env, {});
  const approvedCookie = getCookie(approved, "__Host-APPROVED_CLIENTS=");
  assert.ok(approvedCookie);
  const again = await handleAccessRequest(request("/authorize", { headers: { Cookie: approvedCookie } }), env, {});
  assert.equal(again.status, 302);
  assert.ok(getCookie(again, "__Host-OAUTH_STATE="));
  assert.match(again.headers.get("location"), /code_challenge_method=S256/);
});

test("consent POST without matching CSRF cookie is rejected", async () => {
  const env = fakeEnv();
  const first = await handleAccessRequest(request("/authorize"), env, {});
  const html = await first.text();
  const state = html.match(/name="state" value="([^"]+)"/)?.[1];
  const csrf = html.match(/name="csrf_token" value="([^"]+)"/)?.[1];
  const response = await handleAccessRequest(request("/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ state, csrf_token: csrf }).toString(),
  }), env, {});
  assert.equal(response.status, 400);
});
