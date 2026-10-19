import assert from "node:assert/strict";
import test from "node:test";
import {
	createOAuthState,
	generateCSRFProtection,
	validateCSRFToken,
	validateOAuthState,
} from "../src/workers-oauth-utils.ts";

function memoryKv(): KVNamespace & { values: Map<string, string> } {
	const values = new Map<string, string>();
	return {
		values,
		async get(key: string) { return values.get(key) ?? null; },
		async put(key: string, value: string) { values.set(key, value); },
		async delete(key: string) { values.delete(key); },
	} as unknown as KVNamespace & { values: Map<string, string> };
}

const secret = "test-cookie-key-with-at-least-32-bytes";

test("OAuth state is bound to the stored request and can be consumed only once", async () => {
	const kv = memoryKv();
	const oauthReqInfo = { clientId: "client-1", redirectUri: "https://client.example/callback" } as never;
	const state = await createOAuthState(oauthReqInfo, kv, secret);
	const request = new Request(`https://mcp.example/callback?state=${encodeURIComponent(state.stateToken)}&code=code-1`);
	const result = await validateOAuthState(request, kv, secret);
	assert.equal(result.oauthReqInfo.clientId, "client-1");
	assert.match(result.codeVerifier, /^[A-Za-z0-9_-]{43}$/);
	await assert.rejects(validateOAuthState(request, kv, secret), /expired state/);
});

test("OAuth state rejects a forged signature without reading a stored state", async () => {
	let reads = 0;
	const kv = memoryKv();
	const instrumented = { ...kv, async get(key: string) { reads++; return kv.get(key); } } as unknown as KVNamespace;
	const request = new Request("https://mcp.example/callback?state=00000000-0000-4000-8000-000000000000.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
	await assert.rejects(validateOAuthState(request, instrumented, secret), /state signature/);
	assert.equal(reads, 0);
});

test("CSRF token must match the secure one-time cookie", () => {
	const protection = generateCSRFProtection();
	const request = new Request("https://mcp.example/authorize", {
		method: "POST",
		headers: { Cookie: protection.setCookie.split(";")[0]! },
	});
	const form = new FormData();
	form.set("csrf_token", protection.token);
	assert.match(validateCSRFToken(form, request).clearCookie, /Max-Age=0/);
	form.set("csrf_token", "attacker-token");
	assert.throws(() => validateCSRFToken(form, request), /mismatch/);
});
