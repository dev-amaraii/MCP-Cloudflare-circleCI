import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createOAuthState,
  validateOAuthState,
  generateCSRFProtection,
  validateCSRFToken,
  fetchUpstreamAuthToken,
} from "../src/workers-oauth-utils.ts";

const SECRET = "test-ONLY-32-byte-cryptographic-secret";
const requestFor = (state) => new Request("https://nen.example/callback?state=" + encodeURIComponent(state));
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
  const original = { clientId: "original-approved-client", redirectUri: "https://app.example/callback", scope: ["read"] };
  const { stateToken, codeChallenge } = await createOAuthState(original, kv, SECRET);
  assert.ok(codeChallenge.length > 24);
  const result = await validateOAuthState(requestFor(stateToken), kv, SECRET);
  assert.deepEqual(result.oauthReqInfo, original);
  assert.ok(result.codeVerifier.length > 32);
  await assert.rejects(validateOAuthState(requestFor(stateToken), kv, SECRET), /state/);
});
test("tampering with signed state fails before touching storage", async () => {
  const kv = fakeKV();
  const { stateToken } = await createOAuthState({ clientId: "good" }, kv, SECRET);
  const bad = "f" + stateToken.slice(1);
  const storedBefore = kv.data.size;
  await assert.rejects(validateOAuthState(requestFor(bad), kv, SECRET), /signature/);
  assert.equal(kv.data.size, storedBefore);
});
test("unknown, missing, or malformed OAuth state is rejected", async () => {
  const kv = fakeKV();
  await assert.rejects(validateOAuthState(new Request("https://nen.example/callback"), kv, SECRET));
  await assert.rejects(validateOAuthState(requestFor("invalid"), kv, SECRET));
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
