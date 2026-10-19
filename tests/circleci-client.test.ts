import assert from "node:assert/strict";
import test from "node:test";
import { CircleCIClient, isSafeCircleCIOutputUrl } from "../src/circleci-client.ts";

const projectSlug = "gh/amaraii/MCP-Cloudflare-circleCI";
const pipelineId = "12345678-1234-1234-1234-123456789abc";
const workflowId = "22345678-1234-1234-1234-123456789abc";
const jobId = "32345678-1234-1234-1234-123456789abc";

function client(fetcher: typeof fetch) {
	return new CircleCIClient({ CIRCLE_TOKEN: "test-token", CIRCLE_PROJECT_SLUG: projectSlug }, fetcher);
}

test("reads pipeline and verifies it belongs to the configured project", async () => {
	const calls: string[] = [];
	const api = client(async (input, init) => {
		calls.push(`${String(input)} ${new Headers(init?.headers).get("Circle-Token")}`);
		return Response.json({ id: pipelineId, project_slug: projectSlug, state: "created" });
	});
	assert.deepEqual(await api.getPipeline(pipelineId), {
		id: pipelineId,
		project_slug: projectSlug,
		state: "created",
	});
	assert.match(calls[0]!, new RegExp(`/pipeline/${pipelineId} test-token$`));
});

test("rejects a pipeline that belongs to another project", async () => {
	const api = client(async () => Response.json({ id: pipelineId, project_slug: "gh/other/repo" }));
	await assert.rejects(api.getPipeline(pipelineId), /configured project/);
});

test("resolves a job through its project-owned workflow before requesting details", async () => {
	const seen: string[] = [];
	const api = client(async (input) => {
		const url = new URL(String(input));
		seen.push(url.pathname);
		if (url.pathname === `/api/v2/workflow/${workflowId}`) {
			return Response.json({ id: workflowId, pipeline_id: pipelineId, status: "failed" });
		}
		if (url.pathname === `/api/v2/pipeline/${pipelineId}`) {
			return Response.json({ id: pipelineId, project_slug: projectSlug });
		}
		if (url.pathname === `/api/v2/workflow/${workflowId}/job`) {
			return Response.json({ items: [{ id: jobId, job_number: 42, name: "test" }] });
		}
		if (url.pathname === "/api/v2/project/gh/amaraii/MCP-Cloudflare-circleCI/job/42") {
			return Response.json({ id: jobId, number: 42, status: "failed" });
		}
		throw new Error(`Unexpected request: ${url.pathname}; seen=${seen.join(",")}`);
	});
	const details = await api.getJobDetails(workflowId, jobId).catch((error: unknown) => {
		assert.fail(`${String(error)} paths=${seen.join(",")}`);
	});
	assert.deepEqual(details, {
		id: jobId,
		number: 42,
		status: "failed",
	});
	assert.deepEqual(seen, [
		`/api/v2/workflow/${workflowId}`,
		`/api/v2/pipeline/${pipelineId}`,
		`/api/v2/workflow/${workflowId}/job`,
		"/api/v2/project/gh/amaraii/MCP-Cloudflare-circleCI/job/42",
	]);
});

test("does not fetch log URLs outside CircleCI's approved HTTPS output hosts", () => {
	assert.equal(isSafeCircleCIOutputUrl("https://output.circle-artifacts.com/output/job/log.json"), true);
	assert.equal(isSafeCircleCIOutputUrl("https://circleci-artifacts.s3.amazonaws.com/output/job/log.json"), true);
	assert.equal(isSafeCircleCIOutputUrl("http://output.circle-artifacts.com/log"), false);
	assert.equal(isSafeCircleCIOutputUrl("https://127.0.0.1/latest/meta-data"), false);
	assert.equal(isSafeCircleCIOutputUrl("https://attacker.example/log"), false);
	assert.equal(isSafeCircleCIOutputUrl("https://output.circle-artifacts.com.evil.example/log"), false);
});

test("fetches only validated CircleCI output URLs and returns bounded step logs", async () => {
	let outputFetched = false;
	const api = client(async (input) => {
		const url = new URL(String(input));
		if (url.pathname === `/api/v2/workflow/${workflowId}`) return Response.json({ id: workflowId, pipeline_id: pipelineId });
		if (url.pathname === `/api/v2/pipeline/${pipelineId}`) return Response.json({ id: pipelineId, project_slug: projectSlug });
		if (url.pathname === `/api/v2/workflow/${workflowId}/job`) return Response.json({ items: [{ id: jobId, job_number: 42 }] });
		if (url.pathname === "/api/v1.1/project/github/amaraii/MCP-Cloudflare-circleCI/42") {
			return Response.json({ steps: [{ actions: [{ name: "Tests", output_url: "https://output.circle-artifacts.com/output/job/log.json" }] }] });
		}
		if (url.hostname === "output.circle-artifacts.com") {
			outputFetched = true;
			return new Response("test output");
		}
		throw new Error("unexpected request");
	});
	assert.deepEqual(await api.getJobLogs(workflowId, jobId), {
		job_id: jobId,
		steps: [{ name: "Tests", output: "test output", truncated: false }],
	});
	assert.equal(outputFetched, true);
});

test("rejects unsafe log URLs without making the external request", async () => {
	let externalFetches = 0;
	const api = client(async (input) => {
		const url = new URL(String(input));
		if (url.pathname === `/api/v2/workflow/${workflowId}`) return Response.json({ id: workflowId, pipeline_id: pipelineId });
		if (url.pathname === `/api/v2/pipeline/${pipelineId}`) return Response.json({ id: pipelineId, project_slug: projectSlug });
		if (url.pathname === `/api/v2/workflow/${workflowId}/job`) return Response.json({ items: [{ id: jobId, job_number: 42 }] });
		if (url.pathname === "/api/v1.1/project/github/amaraii/MCP-Cloudflare-circleCI/42") {
			return Response.json({ steps: [{ actions: [{ output_url: "https://attacker.example/log" }] }] });
		}
		externalFetches++;
		throw new Error("unsafe URL was fetched");
	});
	await assert.rejects(api.getJobLogs(workflowId, jobId), /unsafe log output URL/);
	assert.equal(externalFetches, 0);
});

test("reports CircleCI authorization and rate-limit failures without echoing credentials", async () => {
	for (const [status, expected] of [[401, /credentials/], [429, /rate limit/i]] as const) {
		const api = client(async () => new Response("secret-token should not appear", { status, headers: { "Retry-After": "3" } }));
		await assert.rejects(api.getPipeline(pipelineId), expected);
	}
});


test("rejects malformed credential headers without leaking their value", () => {
 const secret="private-token\n";
 assert.throws(() => new CircleCIClient({CIRCLE_TOKEN:secret,CIRCLE_PROJECT_SLUG:projectSlug}), error => error instanceof Error && !error.message.includes("private-token") && /invalid whitespace/.test(error.message));
});

test("classifies network failures without returning exception details or credentials", async () => {
 for (const [error,expected] of [[new DOMException("test-token", "TimeoutError"),"timed out"], [new TypeError("Invalid header: test-token"),"header configuration"], [new Error("DNS test-token"),"DNS resolution"], [new Error("TLS test-token"),"TLS connection"], [new Error("test-token"),"network request"]] as const) {
  const api=client(async()=>{throw error;});
  await assert.rejects(api.getPipeline(pipelineId),e=>e instanceof Error && e.message.includes(expected) && !e.message.includes("test-token"));
 }
});


test("calls the runtime fetch primitive with its global receiver", async () => {
 const api=client(async function(this: unknown) {
  assert.equal(this, globalThis);
  return Response.json({id:pipelineId,project_slug:projectSlug});
 });
 assert.equal((await api.getPipeline(pipelineId)).id,pipelineId);
});

for (const mismatch of [false, true]) test(`modern log API checks ownership and bounds streams (mismatch=${mismatch})`, async () => {
 const slug = 'circleci/org/project';
 const projectId = '42345678-1234-1234-1234-123456789abc';
 let streams = 0;
 const api = new CircleCIClient({CIRCLE_TOKEN:'test-token',CIRCLE_PROJECT_SLUG:slug},async(input,init)=>{
  const url = new URL(String(input));
  const headers = new Headers(init?.headers);
  assert.equal(init?.redirect,'manual');
  if(url.pathname===`/api/v2/workflow/${workflowId}`) return Response.json({pipeline_id:pipelineId});
  if(url.pathname===`/api/v2/pipeline/${pipelineId}`) return Response.json({project_slug:slug});
  if(url.pathname===`/api/v2/workflow/${workflowId}/job`) return Response.json({items:[{id:jobId,job_number:1}]});
  if(url.pathname==='/api/v2/project/'+slug) return Response.json({id:projectId});
  assert.equal(headers.get('Authorization'),'Bearer test-token');
  assert.equal(headers.has('Circle-Token'),false);
  if(url.pathname===`/api/v3/jobs/${jobId}`) return Response.json({data:{id:jobId,references:{project:{id:mismatch?pipelineId:projectId},workflow:{id:workflowId}},attributes:{parallel_executions:[{steps:Array.from({length:30},(_,num)=>({num,name:'Tests'}))}]}}});
  assert.equal(url.origin,'https://circleci.com');
  assert.equal(url.searchParams.get('filter[execution]'),'0');
  assert.match(url.searchParams.get('filter[step_num]')!,/^\d+$/);
  streams++;
  if(url.pathname.endsWith('/stderr')) return new Response(null,{status:404});
  return new Response(new Uint8Array(30_000).fill(255),{status:206,headers:{'Content-Range':'bytes 0-23999/30000'}});
 });
 if(mismatch){await assert.rejects(api.getJobLogs(workflowId,jobId),/does not belong/);assert.equal(streams,0);}
 else {
  const logs=await api.getJobLogs(workflowId,jobId);
  assert.ok(streams<=20);
  assert.ok(logs.steps.length<=20);
  assert.ok(logs.steps.reduce((n,s)=>n+new TextEncoder().encode(s.output).length,0)<=120000);
  assert.ok(logs.steps.every(s=>new TextEncoder().encode(s.output).length<=24000));
  assert.ok(logs.steps.some(s=>s.truncated));
 }
});
