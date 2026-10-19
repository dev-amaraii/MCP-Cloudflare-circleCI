import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createOAuthState,
  validateOAuthState,
  generateCSRFProtection,
  validateCSRFToken,
  fetchUpstreamAuthToken,
  bindOAuthStateCookie,
  validateOAuthStateCookie,
  clearOAuthStateCookie,
} from "../src/workers-oauth-utils.ts";

const SECRET = "test-ONLY-32-byte-cryptographic-secret";
const requestFor = (state) => new Request("https://nen.example/callback?state=" + encodeURIComponent(state));
const fakeGuard = () => {
  const used = new Set();
  return {
    idFromName: (name) => name,
    get: () => ({
      fetch: async (request) => {
        const nonce = await request.text();
        if (used.has(nonce)) return new Response(null, { status: 409 });
        used.add(nonce);
        return new Response(null, { status: 204 });
      },
    }),
  };
};
const fakeKV = () => {
  const data = new Map();
  return {
    data,
    put: async (k, v) => { data.set(k, v); },
    get: async (k) => data.get(k) ?? null,
    delete: async (k) => { data.delete(k); },
  };
};

test("signed OAuth state binds original client request and is consumed", async () => {
  const kv = fakeKV();
  const guard = fakeGuard();
  const original = { clientId: "original-approved-client", redirectUri: "https://app.example/callback", scope: ["read"] };
  const { stateToken, codeChallenge } = await createOAuthState(original, kv, SECRET);
  assert.ok(codeChallenge.length > 24);
  const result = await validateOAuthState(requestFor(stateToken), kv, SECRET, guard);
  assert.deepEqual(result.oauthReqInfo, original);
  assert.ok(result.codeVerifier.length > 32);
  await assert.rejects(validateOAuthState(requestFor(stateToken), kv, SECRET, guard), /state/);
});
test("tampering with signed state fails before touching storage", async () => {
  const kv = fakeKV();
  const guard = fakeGuard();
  const { stateToken } = await createOAuthState({ clientId: "good" }, kv, SECRET);
  const bad = (stateToken[0] === "f" ? "e" : "f") + stateToken.slice(1);
  const storedBefore = kv.data.size;
  await assert.rejects(validateOAuthState(requestFor(bad), kv, SECRET, guard), /signature/);
  assert.equal(kv.data.size, storedBefore);
});
test("unknown, missing, or malformed OAuth state is rejected", async () => {
  const kv = fakeKV();
  const guard = fakeGuard();
  await assert.rejects(validateOAuthState(new Request("https://nen.example/callback"), kv, SECRET, guard));
  await assert.rejects(validateOAuthState(requestFor("invalid"), kv, SECRET, guard));
});
test("simultaneous callbacks cannot both claim a signed nonce", async () => {
  const kv = fakeKV();
  const guard = fakeGuard();
  const { stateToken } = await createOAuthState({ clientId: "good" }, kv, SECRET);
  const calls = await Promise.allSettled([
    validateOAuthState(requestFor(stateToken), kv, SECRET, guard),
    validateOAuthState(requestFor(stateToken), kv, SECRET, guard),
  ]);
  assert.equal(calls.filter(c => c.status === "fulfilled").length, 1);
  assert.equal(calls.filter(c => c.status === "rejected").length, 1);
});
test("authorization consent form requires matching double-submit CSRF", () => {
  const { token, setCookie } = generateCSRFProtection();
  const cookie = setCookie.split(";")[0];
  const form = new FormData();
  form.set("csrf_token", token);
  const request = new Request("https://nen.example/authorize", { headers: { Cookie: cookie } });
  assert.match(validateCSRFToken(form, request).clearCookie, /Max-Age=0/);
  form.set("csrf_token", "forged");
  assert.throws(() => validateCSRFToken(form, request), /CSRF/);
  assert.throws(() => validateCSRFToken(new FormData(), request), /CSRF/);
});
test("OAuth callback cookie is scoped, HttpOnly and tied to a signed state", async () => {
  const kv = fakeKV();
  const guard = fakeGuard();
  const { stateToken } = await createOAuthState({ clientId: "good" }, kv, SECRET);
  const cookieHeader = await bindOAuthStateCookie(stateToken);
  assert.match(cookieHeader, /^__Host-OAUTH_STATE=[A-Za-z0-9_-]+;/);
  assert.match(cookieHeader, /HttpOnly; Secure; Path=\/; SameSite=Lax; Max-Age=600/);
  const request = new Request(requestFor(stateToken), {
    headers: { Cookie: cookieHeader.split(";")[0] },
  });
  await validateOAuthStateCookie(request, stateToken);
  assert.equal((await validateOAuthState(request, kv, SECRET, guard, true)).oauthReqInfo.clientId, "good");
  assert.match(clearOAuthStateCookie(), /Max-Age=0/);
});
test("missing callback session cookie rejects before consuming signed state", async () => {
  const kv = fakeKV();
  const guard = fakeGuard();
  const { stateToken } = await createOAuthState({ clientId: "good" }, kv, SECRET);
  await assert.rejects(validateOAuthState(requestFor(stateToken), kv, SECRET, guard, true), /session cookie/i);
  assert.equal(kv.data.size, 1);
  const cookie = (await bindOAuthStateCookie(stateToken)).split(";")[0];
  const req = new Request(requestFor(stateToken), { headers: { Cookie: cookie } });
  assert.equal((await validateOAuthState(req, kv, SECRET, guard, true)).oauthReqInfo.clientId, "good");
});
test("callback state from another browser session is rejected", async () => {
  const kv = fakeKV();
  const guard = fakeGuard();
  const { stateToken } = await createOAuthState({ clientId: "good" }, kv, SECRET);
  const { stateToken: otherState } = await createOAuthState({ clientId: "other" }, kv, SECRET);
  const wrongCookie = (await bindOAuthStateCookie(otherState)).split(";")[0];
  const req = new Request(requestFor(stateToken), { headers: { Cookie: wrongCookie } });
  await assert.rejects(validateOAuthState(req, kv, SECRET, guard, true), /session cookie/i);
  assert.equal(kv.data.size, 2);
});
test("tampered callback cookie is rejected", async () => {
  const kv = fakeKV();
  const guard = fakeGuard();
  const { stateToken } = await createOAuthState({ clientId: "good" }, kv, SECRET);
  const cookie = (await bindOAuthStateCookie(stateToken)).split(";")[0];
  const req = new Request(requestFor(stateToken), { headers: { Cookie: cookie.slice(0,-1)+"x" } });
  await assert.rejects(validateOAuthState(req, kv, SECRET, guard, true), /session cookie/i);
  assert.equal(kv.data.size, 1);
});

test("upstream OAuth errors do not expose upstream response bodies", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("private-token-leak-marker", { status: 401 });
  try {
    const [accessToken, idToken, response] = await fetchUpstreamAuthToken({
      upstream_url: "https://idp.example/token",
      client_id: "test-client", client_secret: "test-secret", code: "not-real",
      redirect_uri: "https://nen.example/callback", code_verifier: "mock-verifier",
    });
    assert.equal(accessToken, null);
    assert.equal(idToken, null);
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /private-token-leak-marker/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
