import assert from "node:assert/strict";
import { createPublicKey, generateKeyPair, sign } from "node:crypto";
import { promisify } from "node:util";
import test from "node:test";
import { verifyOidcIdToken, validateOidcClaims, validateOidcConfiguration } from "../src/oidc-claims.ts";

const generateKeyPairAsync = promisify(generateKeyPair);
const signAsync = promisify(sign);
const issuer = "https://team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-123";
const clientId = "client-123";
const email = "devops@amaraii.com";

function encode(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function signedToken(claims: Record<string, unknown>, kid = "test-key") {
	const { privateKey, publicKey } = await generateKeyPairAsync("rsa", {
		modulusLength: 2048,
		publicKeyEncoding: { type: "spki", format: "pem" },
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
	});
	const header = encode({ alg: "RS256", kid, typ: "JWT" });
	const payload = encode(claims);
	const content = `${header}.${payload}`;
	const signature = await signAsync("RSA-SHA256", Buffer.from(content), privateKey);
	return {
		token: `${content}.${Buffer.from(signature).toString("base64url")}`,
		publicKey,
	};
}

function validClaims(overrides: Record<string, unknown> = {}) {
	return {
		iss: issuer,
		aud: clientId,
		exp: Math.floor(Date.now() / 1000) + 300,
		nbf: Math.floor(Date.now() / 1000) - 10,
		sub: "user-123",
		email,
		...overrides,
	};
}

test("accepts only the expected issuer, audience, live token, subject, and identity", () => {
	assert.doesNotThrow(() => validateOidcClaims(validClaims(), issuer, clientId, email));
});

for (const [label, overrides] of [
	["wrong issuer", { iss: "https://other.cloudflareaccess.com" }],
	["wrong audience", { aud: "another-client" }],
	["expired token", { exp: 1 }],
	["future not-before", { nbf: Math.floor(Date.now() / 1000) + 60 }],
	["missing subject", { sub: "" }],
	["wrong email", { email: "attacker@example.com" }],
] as const) {
	test(`rejects ${label}`, () => {
		assert.throws(() => validateOidcClaims(validClaims(overrides), issuer, clientId, email));
	});
}

test("validates RS256 signature and OIDC discovery endpoints before accepting claims", async () => {
	const { token, publicKey } = await signedToken(validClaims());
	const publicDer = createPublicKey(publicKey).export({ format: "der", type: "spki" });
	const publicJwk = await crypto.subtle.exportKey("jwk", await crypto.subtle.importKey(
		"spki", publicDer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, true, ["verify"],
	));
	const key = { ...publicJwk, kid: "test-key", alg: "RS256", use: "sig" };
	const fetcher: typeof fetch = async (input) => {
		const url = String(input);
		if (url.endsWith("/.well-known/openid-configuration")) {
			return Response.json({
				issuer,
				authorization_endpoint: "https://team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-123/authorization",
				token_endpoint: "https://team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-123/token",
				jwks_uri: "https://team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-123/jwks",
			});
		}
		if (url.endsWith("/jwks")) return Response.json({ keys: [key] });
		throw new Error("unexpected URL");
	};
	const result = await verifyOidcIdToken({
		token,
		teamDomain: "https://team.cloudflareaccess.com",
		clientId,
		clientSecret: "not-used-here",
		authorizationUrl: "https://team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-123/authorization",
		tokenUrl: "https://team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-123/token",
		jwksUrl: "https://team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-123/jwks",
		expectedEmail: email,
		fetcher,
	});
	assert.equal(result.sub, "user-123");
});

test("rejects tokens signed with an unexpected key", async () => {
	const { token } = await signedToken(validClaims());
	const fetcher: typeof fetch = async (input) => {
		if (String(input).endsWith("/.well-known/openid-configuration")) {
			return Response.json({
				issuer,
				authorization_endpoint: "https://team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-123/authorization",
				token_endpoint: "https://team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-123/token",
				jwks_uri: "https://team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-123/jwks",
			});
		}
		return Response.json({ keys: [] });
	};
	await assert.rejects(verifyOidcIdToken({
		token,
		teamDomain: "https://team.cloudflareaccess.com",
		clientId,
		clientSecret: "not-used-here",
		authorizationUrl: "https://team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-123/authorization",
		tokenUrl: "https://team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-123/token",
		jwksUrl: "https://team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-123/jwks",
		expectedEmail: email,
		fetcher,
	}));
});

test("rejects configured OAuth endpoints that disagree with Access discovery", async () => {
	const fetcher: typeof fetch = async () => Response.json({
		issuer,
		authorization_endpoint: "https://attacker.example/authorize",
		token_endpoint: "https://team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-123/token",
		jwks_uri: "https://team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-123/jwks",
	});
	await assert.rejects(validateOidcConfiguration({
		teamDomain: "https://team.cloudflareaccess.com",
		clientId,
		authorizationUrl: "https://team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-123/authorization",
		tokenUrl: "https://team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-123/token",
		jwksUrl: "https://team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-123/jwks",
		fetcher,
	}), /configuration mismatch/);
});
