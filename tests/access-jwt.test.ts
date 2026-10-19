import assert from "node:assert/strict";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyAccessAssertion } from "../src/access-jwt.ts";
import { createWorker } from "../src/index.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const env = { ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com", ACCESS_AUD: "self-hosted-audience", MCP_PUBLIC_URL: "https://mcp.example.com", CIRCLE_TOKEN: "mock-token", CIRCLE_PROJECT_SLUG: "gh/nen/repo" };
const pair = await generateKeyPair("RS256", { extractable: true });
const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "test" }] });
async function token(overrides: Record<string, unknown> = {}, signingKey = pair.privateKey) {
	return new SignJWT({ iss: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, exp: Math.floor(Date.now()/1000)+300, sub: "owner", email: "devops@amaraii.com", ...overrides }).setProtectedHeader({ alg: "RS256", kid: "test" }).sign(signingKey);
}
function req(assertion?: string) { return new Request(env.MCP_PUBLIC_URL+"/mcp", { headers: assertion ? { "Cf-Access-Jwt-Assertion": assertion } : {} }); }

test("accepts the signed self-hosted Access identity", async () => {
	assert.deepEqual(await verifyAccessAssertion(req(await token()), env, keys), { email: "devops@amaraii.com", sub: "owner" });
});
for (const [label, claims] of Object.entries({ issuer: { iss: "https://other.cloudflareaccess.com" }, audience: { aud: "saas-client-id" }, expiry: { exp: 1 }, notBefore: { nbf: Math.floor(Date.now()/1000)+300 }, email: { email: "other@example.com" }, subject: { sub: "" }, noEmail: { email: undefined }, noExpiry: { exp: undefined } })) {
	test(`rejects Access token with invalid ${label}`, async () => {
		await assert.rejects(verifyAccessAssertion(req(await token(claims)), env, keys));
	});
}
test("rejects forged assertions and never trusts an email header", async () => {
	const other = await generateKeyPair("RS256");
	await assert.rejects(verifyAccessAssertion(req(await token({}, other.privateKey)), env, keys));
	await assert.rejects(verifyAccessAssertion(new Request(env.MCP_PUBLIC_URL+"/mcp", { headers: { "Cf-Access-Authenticated-User-Email": "devops@amaraii.com", Authorization: "Bearer fake" } }), env, keys));
});
test("HTTP origin denies missing/invalid identity before CircleCI", async () => {
	let calls=0;const worker=createWorker((r,e)=>verifyAccessAssertion(r,e,keys),async()=>{calls++;throw Error("must not call");});
	for(const assertion of [undefined,"invalid",await token({email:"other@example.com"})]) assert.equal((await worker.fetch(req(assertion),env)).status,401);
	assert.equal(calls,0);
});
test("real Streamable HTTP client initializes and lists/calls tools through signed assertion middleware", async () => {
	const pipeline="11111111-1111-4111-8111-111111111111";
	const worker=createWorker((r,e)=>verifyAccessAssertion(r,e,keys),async(input,init)=>{assert.equal(init?.method,"GET");assert.equal(String(input),`https://circleci.com/api/v2/pipeline/${pipeline}`);return Response.json({id:pipeline,project_slug:env.CIRCLE_PROJECT_SLUG});});
	const assertion=await token();
	const transport=new StreamableHTTPClientTransport(new URL(env.MCP_PUBLIC_URL+"/mcp"),{fetch:async(input,init)=>{const request=new Request(input,init);request.headers.set("Cf-Access-Jwt-Assertion",assertion);return worker.fetch(request,env);}});
	const client=new Client({name:"http-test",version:"1"});
	try {
		await client.connect(transport);
		assert.equal(client.getServerVersion()?.name,"nen-circleci-mcp");
		assert.equal((await client.listTools()).tools.length,7);
		assert.equal((await client.callTool({name:"circleci_pipeline_status",arguments:{pipeline_id:pipeline}})).isError,false);
	} finally {await client.close();}
});
