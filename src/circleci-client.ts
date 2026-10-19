/** Read-only CircleCI API client scoped to one configured GitHub App project. */
export interface CircleReadEnv {
  CIRCLE_TOKEN: string;
  CIRCLE_PROJECT_SLUG: string;
}
const API = "https://circleci.com/api/v2";
const UUID = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const PROJECT = /^circleci\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;
const uuid = (id: string) => {
  if (typeof id !== "string" || !UUID.test(id)) throw new Error("Invalid CircleCI UUID");
};
const projectSlug = (env: CircleReadEnv) => {
  if (!PROJECT.test(env.CIRCLE_PROJECT_SLUG || "") || !env.CIRCLE_TOKEN) {
    throw new Error("CircleCI project is not configured");
  }
  return env.CIRCLE_PROJECT_SLUG;
};
async function circleGet(env: CircleReadEnv, path: string, fetcher: typeof fetch): Promise<any> {
  if (!path.startsWith("/")) throw new Error("Invalid CircleCI route");
  const response = await fetcher(API + path, {
    method: "GET",
    redirect: "error",
    headers: { "Circle-Token": env.CIRCLE_TOKEN, Accept: "application/json" },
  });
  if (!response.ok) throw new Error("CircleCI read failed (HTTP " + response.status + ")");
  return response.json();
}

/** Never disclose pipelines belonging to other projects even with a broad PAT. */
export async function readPipeline(env: CircleReadEnv, pipelineId: string, fetcher: typeof fetch = fetch): Promise<any> {
  uuid(pipelineId);
  const slug = projectSlug(env);
  const pipeline = await circleGet(env, "/pipeline/" + pipelineId, fetcher);
  if (pipeline?.project_slug !== slug) throw new Error("Pipeline outside configured project");
  return pipeline;
}

export async function readPipelineWorkflows(env: CircleReadEnv, pipelineId: string, fetcher: typeof fetch = fetch): Promise<any> {
  await readPipeline(env, pipelineId, fetcher);
  return circleGet(env, "/pipeline/" + pipelineId + "/workflow", fetcher);
}

export async function readWorkflowJobs(env: CircleReadEnv, workflowId: string, fetcher: typeof fetch = fetch): Promise<any> {
  uuid(workflowId);
  const workflow = await circleGet(env, "/workflow/" + workflowId, fetcher);
  uuid(workflow?.pipeline_id);
  await readPipeline(env, workflow.pipeline_id, fetcher);
  return circleGet(env, "/workflow/" + workflowId + "/job", fetcher);
}

export async function readJobDetails(env: CircleReadEnv, jobNumber: number, fetcher: typeof fetch = fetch): Promise<any> {
  if (!Number.isSafeInteger(jobNumber) || jobNumber < 1) throw new Error("Invalid job number");
  const slug = projectSlug(env);
  const job = await circleGet(env, "/project/" + slug + "/job/" + jobNumber, fetcher);
  if (job?.project?.slug !== slug || job?.number !== jobNumber) {
    throw new Error("Job outside configured project");
  }
  uuid(job?.pipeline?.id);
  await readPipeline(env, job.pipeline.id, fetcher);
  return job;
}
