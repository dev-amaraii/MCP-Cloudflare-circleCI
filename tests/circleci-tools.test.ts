import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCircleCITools } from "../src/circleci-tools.ts";

const pipeline = "11111111-1111-4111-8111-111111111111";
const workflow = "22222222-2222-4222-8222-222222222222";
const job = "33333333-3333-4333-8333-333333333333";
const project = "gh/nen/example";
const tools = ["circleci_pipeline_status", "circleci_pipeline_workflows", "circleci_workflow_status", "circleci_workflow_jobs", "circleci_job_details", "circleci_job_logs"];

async function connect(email?: string) {
	const requests: string[] = [];
	const fetcher: typeof fetch = async (input, init) => {
		assert.equal(init?.method, "GET", "CircleCI requests must remain read-only");
		const url = new URL(String(input));
		requests.push(url.href);
		if (url.hostname === "output.circle-artifacts.com") {
			assert.equal(new Headers(init?.headers).has("Circle-Token"), false);
			return new Response("example job output");
		}
		assert.equal(url.origin, "https://circleci.com");
		const responses: Record<string, unknown> = {
			[`/api/v2/pipeline/${pipeline}`]: { id: pipeline, project_slug: project },
			[`/api/v2/pipeline/${pipeline}/workflow`]: { items: [{ id: workflow }], next_page_token: null },
			[`/api/v2/workflow/${workflow}`]: { id: workflow, pipeline_id: pipeline },
			[`/api/v2/workflow/${workflow}/job`]: { items: [{ id: job, job_number: 42 }], next_page_token: null },
			[`/api/v2/project/${project}/job/42`]: { id: job, status: "success" },
			"/api/v1.1/project/github/nen/example/42": { steps: [{ actions: [{ name: "test", output_url: "https://output.circle-artifacts.com/log" }] }] },
		};
		assert.ok(url.pathname in responses, `Unexpected API endpoint: ${url.pathname}`);
		return Response.json(responses[url.pathname]);
	};
	const server = new McpServer({ name: "test-circleci", version: "1" }, { capabilities: { tools: {} } });
	registerCircleCITools(server, { CIRCLE_TOKEN: "mock-token", CIRCLE_PROJECT_SLUG: project }, email ? { email } : undefined, fetcher);
	const client = new Client({ name: "protocol-test", version: "1" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	return { client, server, requests, close: async () => { await client.close(); await server.close(); } };
}

test("MCP initializes, lists exactly six tools, and executes only read-only requests", async () => {
	const session = await connect("devops@amaraii.com");
	try {
		assert.equal(session.client.getServerVersion()?.name, "test-circleci");
		assert.deepEqual((await session.client.listTools()).tools.map(t => t.name).sort(), [...tools].sort());
		for (const name of tools) {
			const args = name.startsWith("circleci_pipeline") ? { pipeline_id: pipeline } : name.startsWith("circleci_workflow") ? { workflow_id: workflow } : { workflow_id: workflow, job_id: job };
			const result = await session.client.callTool({ name, arguments: args });
			assert.equal(result.isError, false, name);
			assert.ok(Array.isArray(result.content) && result.content.length > 0);
		}
		const before = session.requests.length;
		for (const name of ["circleci_trigger_pipeline", "circleci_cancel_workflow", "circleci_approve_job", "circleci_rerun_workflow"]) {
			const result = await session.client.callTool({ name, arguments: {} });
			assert.equal(result.isError, true);
		}
		assert.equal(session.requests.length, before, "Unknown tools must never reach CircleCI");
	} finally { await session.close(); }
});

for (const email of [undefined, "attacker@example.com"]) {
	test(`MCP exposes no CircleCI tools for ${email ?? "missing identity"}`, async () => {
		const session = await connect(email);
		try {
			await assert.rejects(session.client.listTools(), { code: -32601 });
			await assert.rejects(session.client.callTool({ name: "circleci_pipeline_status", arguments: { pipeline_id: pipeline } }), { code: -32601 });
			assert.deepEqual(session.requests, []);
		} finally { await session.close(); }
	});
}
