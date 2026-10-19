import assert from "node:assert/strict";
import { test } from "node:test";
import { readPipeline, readPipelineWorkflows, readWorkflowJobs, readJobDetails } from "../src/circleci-client.ts";

const PROJECT = "circleci/org-123/project-123";
const PID = "11111111-1111-4111-8111-111111111111";
const WID = "22222222-2222-4222-8222-222222222222";
const env = { CIRCLE_TOKEN: "unit-test-token", CIRCLE_PROJECT_SLUG: PROJECT };
const payload = (value, status = 200) => new Response(JSON.stringify(value), { status });
const requester = (table, seen = []) => async (url, init) => {
  assert.equal(init?.headers?.["Circle-Token"], env.CIRCLE_TOKEN);
  assert.equal(init?.redirect, "error");
  seen.push(new URL(url).pathname);
  const path = new URL(url).pathname.replace("/api/v2", "");
  return table[path] || payload({ message: "not found" }, 404);
};
const validPipeline = { id: PID, project_slug: PROJECT, number: 3, state: "created" };

test("pipeline reads only return the configured CircleCI project", async () => {
  const fetcher = requester({ ["/pipeline/" + PID]: payload(validPipeline) });
  assert.equal((await readPipeline(env, PID, fetcher)).id, PID);
  await assert.rejects(readPipeline(env, WID, fetcher));
});
test("foreign pipeline UUID is rejected even if CircleCI token can see it", async () => {
  const fetcher = requester({ ["/pipeline/" + PID]: payload({ ...validPipeline, project_slug: "circleci/other/project" }) });
  await assert.rejects(readPipeline(env, PID, fetcher), /outside/);
});
test("pipeline workflow listing checks parent pipeline first", async () => {
  const seen = [];
  const fetcher = requester({
    ["/pipeline/" + PID]: payload({ ...validPipeline, project_slug: "circleci/other/project" }),
    ["/pipeline/" + PID + "/workflow"]: payload({ items: [{ id: WID }] }),
  }, seen);
  await assert.rejects(readPipelineWorkflows(env, PID, fetcher));
  assert.deepEqual(seen, ["/api/v2/pipeline/" + PID]);
});
test("workflow jobs must be tied to a pipeline in the configured project", async () => {
  const seen = [];
  const fetcher = requester({
    ["/workflow/" + WID]: payload({ id: WID, pipeline_id: PID }),
    ["/pipeline/" + PID]: payload({ ...validPipeline, project_slug: "circleci/other/project" }),
    ["/workflow/" + WID + "/job"]: payload({ items: [{ job_number: 9 }] }),
  }, seen);
  await assert.rejects(readWorkflowJobs(env, WID, fetcher));
  assert.equal(seen.some(p => p.endsWith("/job")), false);
});
test("workflow jobs returned after parent project is validated", async () => {
  const fetcher = requester({
    ["/workflow/" + WID]: payload({ id: WID, pipeline_id: PID }),
    ["/pipeline/" + PID]: payload(validPipeline),
    ["/workflow/" + WID + "/job"]: payload({ items: [{ name: "test", status: "success", job_number: 4 }] }),
  });
  const data = await readWorkflowJobs(env, WID, fetcher);
  assert.equal(data.items[0].job_number, 4);
});
test("job lookup is always scoped to configured project and verified pipeline", async () => {
  const path = "/project/" + PROJECT + "/job/4";
  const fetcher = requester({
    [path]: payload({ number: 4, project: { slug: PROJECT }, pipeline: { id: PID }, status: "success" }),
    ["/pipeline/" + PID]: payload(validPipeline),
  });
  assert.equal((await readJobDetails(env, 4, fetcher)).number, 4);
});
test("job details with foreign project are rejected before following pipeline", async () => {
  const fetcher = requester({
    ["/project/" + PROJECT + "/job/4"]: payload({ number: 4, project: { slug: "circleci/foreign/repo" }, pipeline: { id: PID } }),
  });
  await assert.rejects(readJobDetails(env, 4, fetcher), /outside/);
});
test("job numbers cannot be zero or unsafe", async () => {
  const fetcher = requester({});
  for (const n of [0, -1, Number.MAX_SAFE_INTEGER + 1, 1.5]) {
    await assert.rejects(readJobDetails(env, n, fetcher));
  }
});
