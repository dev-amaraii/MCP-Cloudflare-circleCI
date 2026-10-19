import assert from "node:assert/strict";
import { test } from "node:test";
import { Buffer } from "node:buffer";
import { getAccessOidcIssuer, validateOidcClaims } from "../src/oidc-claims.ts";
import { verifyAccessIdToken } from "../src/access-jwt.ts";

const NOW = 1_800_000_000;
const TEAM = "https://example.cloudflareaccess.com";
const CLIENT = "example-client-id";
const ISSUER = TEAM + "/cdn-cgi/access/sso/oidc/" + CLIENT;
const EMAIL = "devops@amaraii.com";
const env = {
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_CLIENT_ID: CLIENT,
  ACCESS_AUTHORIZATION_URL: ISSUER + "/authorization",
  ACCESS_TOKEN_URL: ISSUER + "/token",
  ACCESS_JWKS_URL: ISSUER + "/jwks",
};
const valid = {
  iss: ISSUER, aud: CLIENT, sub: "subject-1", email: EMAIL,
  exp: NOW + 120, iat: NOW - 30, nbf: NOW - 30,
};

test("Access OIDC issuer is the full SaaS issuer (not its origin)", () => {
  assert.equal(getAccessOidcIssuer(env), ISSUER);
});
for (const [name, override] of [
  ["http issuer", { ACCESS_AUTHORIZATION_URL: ISSUER.replace("https:", "http:") + "/authorization" }],
  ["host mismatch", { ACCESS_AUTHORIZATION_URL: "https://evil.example/cdn-cgi/access/sso/oidc/" + CLIENT + "/authorization" }],
  ["wrong app", { ACCESS_AUTHORIZATION_URL: TEAM + "/cdn-cgi/access/sso/oidc/other/authorization" }],
  ["wrong jwks", { ACCESS_JWKS_URL: TEAM + "/cdn-cgi/access/sso/oidc/other/jwks" }],
  ["wrong token", { ACCESS_TOKEN_URL: TEAM + "/cdn-cgi/access/sso/oidc/other/token" }],
  ["wrong team", { ACCESS_TEAM_DOMAIN: "https://other.cloudflareaccess.com" }],
]) {
  test("fail closed on " + name, () => assert.throws(() => getAccessOidcIssuer({ ...env, ...override })));
}
test("accepts verified OIDC claims for configured app", () => {
  assert.doesNotThrow(() => validateOidcClaims(valid, ISSUER, CLIENT, EMAIL, NOW));
  assert.doesNotThrow(() => validateOidcClaims({ ...valid, email: EMAIL.toUpperCase() }, ISSUER, CLIENT, EMAIL, NOW));
});
for (const [name, claim] of [
  ["origin-only issuer", { iss: TEAM }],
  ["other SaaS issuer", { iss: ISSUER + "-other" }],
  ["wrong audience", { aud: "other-app" }],
  ["empty audience", { aud: [] }],
  ["malformed audience", { aud: [CLIENT, 123] }],
  ["expired", { exp: NOW }],
  ["no expiration", { exp: undefined }],
  ["string expiration", { exp: String(NOW + 1) }],
  ["future not-before", { nbf: NOW + 1 }],
  ["malformed not-before", { nbf: "tomorrow" }],
  ["no subject", { sub: "" }],
  ["other email", { email: "unauthorized@example.com" }],
  ["missing email", { email: undefined }],
  ["missing issued-at", { iat: undefined }],
  ["future issued-at", { iat: NOW + 90 }],
  ["multiple audiences without azp", { aud: [CLIENT, "other"] }],
  ["multiple audiences with wrong azp", { aud: [CLIENT, "other"], azp: "other" }],
]) {
  test("rejects OIDC claims: " + name, () => assert.throws(() => validateOidcClaims({ ...valid, ...claim }, ISSUER, CLIENT, EMAIL, NOW)));
}
test("accepts multi-audience claims only with matching authorized party", () => {
  assert.doesNotThrow(() => validateOidcClaims({ ...valid, aud: [CLIENT, "other"], azp: CLIENT }, ISSUER, CLIENT, EMAIL, NOW));
});

function b64(v) { return Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url"); }
async function signedToken(claimChanges = {}, headerChanges = {}) {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true, ["sign", "verify"],
  );
  const publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "test-kid", use: "sig", alg: "RS256" };
  const header = { alg: "RS256", kid: "test-kid", typ: "JWT", ...headerChanges };
  const data = b64(header) + "." + b64({ ...valid, ...claimChanges });
  const sig = Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, Buffer.from(data))).toString("base64url");
  return { token: data + "." + sig, publicJwk };
}
const jwks = (keys, status = 200) => async () => new Response(JSON.stringify({ keys }), { status });

test("accepts RS256 signature with pinned SaaS issuer, correct audience and identity", async () => {
  const { token, publicJwk } = await signedToken();
  const claims = await verifyAccessIdToken(env, token, NOW, jwks([publicJwk]));
  assert.equal(claims.sub, valid.sub);
});
test("rejects tampered signature", async () => {
  const { token, publicJwk } = await signedToken();
  const [h, p, s] = token.split(".");
  const tampered = h + "." + b64({ ...valid, sub: "attacker" }) + "." + s;
  await assert.rejects(verifyAccessIdToken(env, tampered, NOW, jwks([publicJwk])));
});
test("rejects JWT alg none before fetching JWKS", async () => {
  const { token, publicJwk } = await signedToken({}, { alg: "none" });
  await assert.rejects(verifyAccessIdToken(env, token, NOW, jwks([publicJwk])));
});
test("rejects missing kid before fetching JWKS", async () => {
  const { token, publicJwk } = await signedToken({}, { kid: "" });
  await assert.rejects(verifyAccessIdToken(env, token, NOW, jwks([publicJwk])));
});
test("rejects unknown JWKS key", async () => {
  const { token } = await signedToken();
  await assert.rejects(verifyAccessIdToken(env, token, NOW, jwks([])));
});
test("rejects non-RSA JWKS key", async () => {
  const { token, publicJwk } = await signedToken();
  await assert.rejects(verifyAccessIdToken(env, token, NOW, jwks([{ ...publicJwk, kty: "oct" }])));
});
test("rejects duplicate JWKS key IDs", async () => {
  const { token, publicJwk } = await signedToken();
  await assert.rejects(verifyAccessIdToken(env, token, NOW, jwks([publicJwk, publicJwk])));
});
test("rejects JWKS HTTP failure", async () => {
  const { token } = await signedToken();
  await assert.rejects(verifyAccessIdToken(env, token, NOW, jwks([], 503)));
});
test("rejects invalid issuer even with a valid signature", async () => {
  const { token, publicJwk } = await signedToken({ iss: TEAM });
  await assert.rejects(verifyAccessIdToken(env, token, NOW, jwks([publicJwk])));
});
test("rejects invalid email even with a valid signature", async () => {
  const { token, publicJwk } = await signedToken({ email: "other@example.com" });
  await assert.rejects(verifyAccessIdToken(env, token, NOW, jwks([publicJwk])));
});
