/**
 * REVIEW-ONLY NEN CircleCI adapter.
 *
 * This module is intentionally NOT wired into bridge/src/index.mjs, so it cannot
 * be reached through the live Queue. The shared Worker source branch predates
 * the November 16 deployed revision and must be reconciled before integration.
 *
 * No releases, CMS writes, arbitrary branches, user-selected URLs or retries.
 * The GitHub App trigger is BRANCH-based, not SHA-pinned; any subsequent result
 * MUST be independently inspected against its exact expected revision.
 */
const CIRCLE_API = "https://circleci.com/api/v2";
const PROJECT = "nen-website-cms";
const REPOSITORY = "dev-amaraii/nen-website-cms";
const CONFIG_PATH = ".circleci/config.yml";
const BRANCH = "codex/nen-approved-overview-hero-20261118";
const REVIEW_SHA = "8c818968da6be860ba0e6c4012895b7e2d5331f5";
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SLUG = /^circleci\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;

export const NEN_CIRCLECI_REVIEW = Object.freeze({
  project: PROJECT, repository: REPOSITORY, configPath: CONFIG_PATH,
  branch: BRANCH, reviewSha: REVIEW_SHA, allowedModes: ["validation"],
  releasePermitted: false, autoFallback: false,
});

function ensure(value, message) {
  if (!value) throw new Error(message);
}
function projectSlug(env) {
  const value = env?.NEN_CIRCLECI_PROJECT_SLUG;
  ensure(typeof value === "string" && SLUG.test(value), "NEN CircleCI project not configured");
  return value;
}
function credential(env) {
  const value = env?.CIRCLE_TOKEN;
  ensure(typeof value === "string" && value.length > 0, "CircleCI token not configured");
  return value;
}
async function api(env, path, {body,requestFn=fetch}={}) {
  const token = credential(env);
  const result = await requestFn(CIRCLE_API + path, {
    method: body ? "POST" : "GET", redirect: "manual",
    headers: { "Circle-Token": token, "Accept": "application/json",
      ...(body ? {"Content-Type": "application/json"} : {}) },
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
  if (!result.ok) throw new Error("CircleCI API HTTP " + result.status);
  const value = await result.json();
  ensure(value && typeof value === "object" && !Array.isArray(value), "Invalid CircleCI response");
  return value;
}
async function verifiedDefinition(env, requestFn) {
  const slug = projectSlug(env);
  const project = await api(env, "/project/" + slug, {requestFn});
  ensure(project.slug === slug && UUID.test(project.id || ""), "NEN CircleCI project identity mismatch");
  const definitions = await api(env, "/projects/" + project.id + "/pipeline-definitions", {requestFn});
  // Do not guess the definition ID. Resolve precisely one GitHub App definition
  // targeting the NEN repo and config file, then use that identity for triggering.
  const matches = (Array.isArray(definitions.items) ? definitions.items : []).filter(item =>
    UUID.test(item.id || "") &&
    item.config_source?.provider === "github_app" &&
    item.config_source?.file_path === CONFIG_PATH &&
    item.config_source?.repo?.full_name?.toLowerCase() === REPOSITORY.toLowerCase());
  ensure(matches.length === 1, "NEN CircleCI definition not verified uniquely");
  return {slug,projectId:project.id,definitionId:matches[0].id};
}
function validatedCommand(command) {
  ensure(command && typeof command === "object" && !Array.isArray(command), "Invalid NEN CircleCI command");
  ensure(command.project === PROJECT && command.provider === "circleci",
    "NEN CircleCI project/provider mismatch");
  ensure(command.action === "health" || command.action === "verify_project" ||
    command.action === "trigger" || command.action === "inspect",
    "NEN CircleCI action not permitted");
  const keys = ["project","provider","action","branch","commitSha","mode","pipelineId","approved"];
  ensure(Object.keys(command).every(k => keys.includes(k)), "Unexpected NEN CircleCI command field");
  if (command.action === "trigger") {
    ensure(command.approved === true && command.mode === "validation" &&
      command.branch === BRANCH && command.commitSha === REVIEW_SHA,
      "NEN CircleCI review revision not permitted");
    ensure(command.pipelineId === undefined, "Unexpected NEN CircleCI pipeline");
  } else if (command.action === "inspect") {
    ensure(UUID.test(command.pipelineId || "") &&
      command.branch === undefined && command.commitSha === undefined &&
      command.mode === undefined, "Invalid NEN CircleCI inspect scope");
  } else {
    ensure(command.branch === undefined && command.commitSha === undefined &&
      command.mode === undefined && command.pipelineId === undefined,
      "Unexpected NEN CircleCI health field");
  }
  return command;
}
/** An isolated adapter for future integration once live source parity is green. */
export async function executeCircleCiNen(env, command, requestFn = fetch) {
  validatedCommand(command);
  if (command.action === "health") return {
    project: PROJECT, provider: "circleci",
    tokenConfigured: typeof env?.CIRCLE_TOKEN === "string" && env.CIRCLE_TOKEN.length > 0,
    projectConfigured: typeof env?.NEN_CIRCLECI_PROJECT_SLUG === "string" &&
      SLUG.test(env.NEN_CIRCLECI_PROJECT_SLUG),
    triggerEnabled: env?.NEN_CIRCLECI_TRIGGER_ENABLED === "true",
    releasePermitted: false, allowedBranches: [BRANCH], allowedModes: ["validation"],
    sourceStatus: "review-only-not-wired",
  };
  if (command.action === "verify_project") {
    const verified = await verifiedDefinition(env, requestFn);
    return {project: PROJECT, provider:"circleci", verified:true,
      projectSlug:verified.slug, definitionVerified:true, releasePermitted:false};
  }
  if (command.action === "inspect") {
    const slug = projectSlug(env);
    const pipeline = await api(env, "/pipeline/" + command.pipelineId, {requestFn});
    ensure(pipeline.id === command.pipelineId && pipeline.project_slug === slug,
      "NEN CircleCI pipeline ownership mismatch");
    const branch = pipeline.vcs?.branch || null;
    const revision = pipeline.vcs?.revision || null;
    ensure(branch === BRANCH, "NEN CircleCI pipeline branch mismatch");
    // Do not claim SHA parity from the branch-based POST request. Reject stale
    // revisions and missing revision rather than accepting green tests on HEAD+1.
    ensure(revision === REVIEW_SHA, "NEN CircleCI pipeline revision mismatch");
    return {project: PROJECT, provider:"circleci", pipelineId:pipeline.id,
      branch, revision, revisionVerified:true,
      state:typeof pipeline.state === "string" ? pipeline.state : null,
      releasePermitted:false};
  }
  ensure(env?.NEN_CIRCLECI_TRIGGER_ENABLED === "true",
    "NEN CircleCI trigger disabled");
  const verified = await verifiedDefinition(env, requestFn);
  const response = await api(env, "/project/" + verified.slug + "/pipeline/run", {
    requestFn, body: {
      definition_id: verified.definitionId,
      config: {branch: BRANCH},
      checkout: {branch: BRANCH},
    },
  });
  ensure(UUID.test(response.id || ""), "Invalid NEN CircleCI trigger response");
  return {project: PROJECT, provider:"circleci", pipelineId:response.id,
    branch:BRANCH, requestedRevision: REVIEW_SHA,
    revisionVerificationRequired:true, releasePermitted:false,
    automaticRetryPermitted:false};
}
