/**
 * REVIEW-ONLY NEN CircleCI evidence reader (NOT WIRED INTO LIVE QUEUE).
 * Uses CircleCI API v3 for job/step/artifact data; v2 for immutable pipeline
 * ownership/revision. Never accepts an external host, project, revision, or
 * arbitrary artifact path. Never returns presigned URLs or raw unrestricted logs.
 */
const API3 = "https://circleci.com/api/v3";
const API2 = "https://circleci.com/api/v2";
const BRANCH = "codex/nen-approved-overview-hero-20261118";
const REPOSITORY = "dev-amaraii/nen-website-cms";
const SHA = /^[a-f0-9]{40}$/i;
// Read-only diagnostics do not require a code deployment for every new commit.
// Return exact VCS revision for the caller to compare with the expected PR SHA.
const JOB_NAMES = new Set([
  "nen-security-preview-source-qa",
  "nen-security-preview-browser-qa",
]);
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SLUG = /^circleci\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;
const ARTIFACT = /^nen-security-preview-qa\/(?:report\.json|(?:home|security|solar|software|communications|about|connect|saas-and-ai|renewable-energy)[-A-Za-z0-9]*\.png)$/;
const MAX_REPORT = 250_000;
// Full-page responsive screenshots can be several megabytes. A strict 8 MB
// cap still fits Cloudflare KV's 25 MiB per-value limit after base64 encoding.
const MAX_PNG = 8_000_000;

function deny(ok, message) {
  if (!ok) throw new Error(message);
}
function token(env) {
  deny(typeof env?.CIRCLE_TOKEN === "string" && env.CIRCLE_TOKEN.length > 0, "CircleCI token not configured");
  return env.CIRCLE_TOKEN;
}
function slug(env) {
  const value = env?.NEN_CIRCLECI_PROJECT_SLUG;
  deny(typeof value === "string" && SLUG.test(value), "NEN CircleCI project not configured");
  return value;
}
function apiHeaders(env) {
  return {Authorization:"Bearer " + token(env), Accept:"application/json"};
}
async function apiJson(env, url, requestFn) {
  deny(url.startsWith(API3 + "/") || url.startsWith(API2 + "/"), "Untrusted CircleCI API origin");
  const response = await requestFn(url, {method:"GET",redirect:"manual",headers:apiHeaders(env)});
  if (!response.ok) throw new Error("CircleCI read HTTP " + response.status);
  const value = await response.json();
  deny(value && typeof value === "object" && !Array.isArray(value), "Invalid CircleCI JSON");
  return value;
}
function resource(value) {
  if (value?.data?.attributes && typeof value.data.attributes === "object") {
    return {id:value.data.id,...value.data.attributes};
  }
  return value;
}
function sanitize(text) {
  // Treat all provider logs/reports as untrusted and potentially secret-bearing.
  return String(text ?? "").replace(/\x1b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .filter(line => /(?:AssertionError|Error:|ERR_[A-Z_]+|failed|failure|missing|expected|actual|exit code|Cannot find|Module not found|typecheck|lint)/i.test(line))
    .filter(line => !/(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTHORIZATION|PRIVATE.?KEY|COOKIE|SET-COOKIE|DATABASE_URL|API_KEY)/i.test(line))
    .slice(-16)
    .map(line => line.replace(/https?:\/\/\S+/gi,"[URL]")
      .replace(/[A-Za-z0-9_./+=-]{72,}/g,"[REDACTED_LONG_VALUE]")
      .replace(/[\u0000-\u001f\u007f]/g,"").slice(0,260));
}
function checkedCommand(command) {
  deny(command && typeof command === "object" && !Array.isArray(command), "Invalid NEN evidence request");
  deny(command.project === "nen-website-cms" && command.provider === "circleci", "NEN evidence project/provider mismatch");
  deny(["job_diagnostics","artifact_list","artifact_report","artifact_png"].includes(command.action), "NEN evidence action not permitted");
  deny(UUID.test(command.jobId || "") && UUID.test(command.pipelineId || ""),
    "Invalid NEN CircleCI workflow or job id");
  deny(Object.keys(command).every(key => ["project","provider","action","jobId","pipelineId","artifactPath"].includes(key)),
    "Unexpected NEN evidence field");
  if (command.action === "artifact_png") {
    deny(typeof command.artifactPath === "string" && ARTIFACT.test(command.artifactPath) &&
      command.artifactPath.endsWith(".png"), "NEN screenshot path not permitted");
  } else {
    deny(command.artifactPath === undefined, "Unexpected NEN artifact path");
  }
  return command;
}
async function verifiedJob(env, command, requestFn) {
  const expectedSlug = slug(env);
  const project = await apiJson(env, API2 + "/project/" + expectedSlug, requestFn);
  deny(project.slug === expectedSlug && UUID.test(project.id || ""), "NEN CircleCI project identity mismatch");
  // The NEN slug is pinned in the live Worker binding. GitHub App definition
  // metadata is not stable across all CircleCI projects, so ownership is
  // established from the exact project ID and verified workflow -> pipeline ->
  // job relationships below, rather than an optional config-source field.
  // The caller's pipelineId field is the *workflow UUID*. Verify CircleCI v2
  // workflow -> pipeline -> job membership before fetching v3 output.
  const workflow=await apiJson(env, API2+"/workflow/"+command.pipelineId, requestFn);
  deny(workflow.id===command.pipelineId && UUID.test(workflow.pipeline_id||""),
    "NEN CircleCI workflow identity mismatch");
  const pipeline=await apiJson(env,API2+"/pipeline/"+workflow.pipeline_id,requestFn);
  deny(pipeline.id===workflow.pipeline_id && pipeline.project_slug===expectedSlug,
    "NEN CircleCI pipeline ownership mismatch");
  // GitHub App pipelines can omit 'vcs' from CircleCI v2. The NEN project
  // slug + exact workflow/job membership are authoritative for read-only access.
  // Never claim commit verification when CircleCI omitted revision information.
  if (typeof pipeline.vcs?.branch==="string") {
    deny(pipeline.vcs.branch===BRANCH,"NEN CircleCI revision not permitted");
  }
  if (pipeline.vcs?.revision !== undefined) {
    deny(SHA.test(pipeline.vcs.revision),"NEN CircleCI revision not permitted");
  }
  const listing=await apiJson(env,API2+"/workflow/"+command.pipelineId+"/job",requestFn);
  const candidates=(Array.isArray(listing.items)?listing.items:[]).filter(j=>
    j.id===command.jobId && JOB_NAMES.has(j.name) && j.project_slug===expectedSlug);
  deny(candidates.length===1,"NEN CircleCI job ownership mismatch");
  return {job:candidates[0],pipeline};
}
function failedSteps(job) {
  const rows=[];
  for (const ex of (Array.isArray(job.parallel_executions||job.executions) ? (job.parallel_executions||job.executions) : [])) {
    const entry=ex?.attributes && typeof ex.attributes==="object" ? ex.attributes : ex;
    const steps=Array.isArray(entry.steps) ? entry.steps : [];
    for (let index=0; index<steps.length; index++) {
      const s=steps[index]?.attributes || steps[index], exit=s?.exit_code;
      if ((typeof exit==="number" && exit!==0) || /fail|error/i.test(s?.status || s?.outcome || "")) {
        rows.push({stepNum:Number.isInteger(s.num)?s.num:(Number.isInteger(s.step_num)?s.step_num:index),
          execution:Number.isInteger(entry.index)?entry.index:0,
          name:String(s.name || "").slice(0,100), status:String(s.status || "").slice(0,30),
          exitCode:Number.isInteger(exit)?exit:null});
      }
    }
  }
  return rows.slice(0,3);
}
function artifactRows(payload) {
  deny(Array.isArray(payload.data), "Invalid CircleCI artifacts response");
  deny(!payload.page?.next, "Artifact listing requires additional pages");
  return payload.data.map(x => ({
    path:x.attributes?.path, url:x.attributes?.url,
    size:x.attributes?.size ?? null,
  })).filter(x=>typeof x.path==="string" && ARTIFACT.test(x.path)).slice(0,60);
}
function trustedArtifactUrl(value) {
  deny(typeof value==="string","Invalid NEN artifact URL");
  const u=new URL(value),h=u.hostname.toLowerCase();
  deny(u.protocol==="https:" && !u.username && !u.password && !u.port &&
    (h==="circleci.com" || h==="circle-artifacts.com" ||
      h.endsWith(".circle-artifacts.com") ||
      h==="circleci-tasks-prod.s3.us-east-1.amazonaws.com" ||
      h==="s3.amazonaws.com" || h.endsWith(".s3.amazonaws.com")),
    "NEN artifact host not permitted");
  return u;
}
async function boundedArtifact(env, url, max, requestFn) {
  let target=trustedArtifactUrl(url);
  for(let redirects=0;redirects<3;redirects++) {
    const trusted=target.hostname==="circleci.com" ||
      target.hostname==="circle-artifacts.com" ||
      target.hostname.endsWith(".circle-artifacts.com");
    // Never send CircleCI credentials to redirected S3/other hosts.
    const headers=trusted ? {"Circle-Token":token(env),Accept:"application/octet-stream"}
      : {Accept:"application/octet-stream"};
    const response=await requestFn(target.href,{method:"GET",redirect:"manual",headers});
    if([301,302,303,307,308].includes(response.status)) {
      const location=response.headers.get("location");
      deny(!!location,"Artifact download failed");
      target=trustedArtifactUrl(new URL(location,target).href);
      continue;
    }
    deny(response.ok && !!response.body,"Artifact download failed");
    const length=Number(response.headers.get("content-length")||0);
    deny(!length||length<=max,"NEN artifact exceeds byte limit");
    deny(typeof response.body.getReader==="function","NEN artifact streaming required");
    const reader=response.body.getReader(),chunks=[];let total=0;
    try {
      for(;;) {
        const next=await reader.read();
        if(next.done)break;
        total+=next.value.byteLength;
        deny(total<=max,"NEN artifact exceeds byte limit");
        chunks.push(next.value);
      }
    } finally {await reader.cancel().catch(()=>{});}
    deny(total>0,"Artifact download failed");
    const result=new Uint8Array(total);let offset=0;
    for(const part of chunks){result.set(part,offset);offset+=part.byteLength;}
    return result;
  }
  throw Error("Artifact download failed");
}
function toBase64(bytes) {
  let raw="";
  for(let i=0;i<bytes.length;i+=8192) raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(raw);
}
export async function readCircleCiNenEvidence(env, command, requestFn=fetch) {
  checkedCommand(command);
  const {job,pipeline}=await verifiedJob(env,command,requestFn);
  const common={project:"nen-website-cms",provider:"circleci",jobId:job.id,
    jobName:job.name,status:job.status,
    revision:pipeline.vcs?.revision||null,
    revisionVerified:typeof pipeline.vcs?.revision==="string" && SHA.test(pipeline.vcs.revision),
    revisionSource:typeof pipeline.vcs?.revision==="string" ? "circleci_v2" : "unavailable_in_circleci_v2",
    releasePermitted:false};
  if(command.action==="job_diagnostics"){
    const jobResponse=resource(await apiJson(env,API3+"/jobs/"+job.id,requestFn));
    deny(jobResponse.id===job.id,"NEN CircleCI job identity mismatch");
    const steps=failedSteps(jobResponse),logs=[];
    for(const s of steps){
      const path="/jobs/"+job.id+"/stdout/condensed?filter%5Bexecution%5D="+s.execution+
        "&filter%5Bstep_num%5D="+s.stepNum;
      const response=await requestFn(API3+path,{method:"GET",redirect:"manual",headers:apiHeaders(env)});
      if(response.status===204) {logs.push({...s,diagnostics:[]});continue;}
      if(!response.ok) {logs.push({...s,diagnostics:[],readStatus:response.status});continue;}
      const body=await response.text();
      logs.push({...s,diagnostics:sanitize(body.slice(0,12000))});
    }
    return {...common,failedSteps:logs};
  }
  const payload=await apiJson(env,API3+"/jobs/"+job.id+"/artifacts",requestFn);
  const artifacts=artifactRows(payload);
  if(command.action==="artifact_list")return {...common,artifacts:artifacts.map(x=>({path:x.path,size:x.size}))};
  const path=command.action==="artifact_report" ? "nen-security-preview-qa/report.json" : command.artifactPath;
  const artifact=artifacts.find(x=>x.path===path);
  deny(!!artifact,"NEN artifact not present");
  const bytes=await boundedArtifact(env,artifact.url,command.action==="artifact_report"?MAX_REPORT:MAX_PNG,requestFn);
  if(command.action==="artifact_png"){
    deny(bytes.length>=8 && [137,80,78,71,13,10,26,10].every((v,i)=>v===bytes[i]),
      "NEN PNG signature mismatch");
    return {...common,artifactPath:path,mimeType:"image/png",base64:toBase64(bytes),
      bytes:bytes.length};
  }
  const json=JSON.parse(new TextDecoder().decode(bytes));
  deny(json && typeof json==="object" && !Array.isArray(json), "Invalid NEN report JSON");
  const rawResults=Array.isArray(json.results)?json.results:[];
  const failed=rawResults.filter(x=>Array.isArray(x.failures)&&x.failures.length);
  return {...common,artifactPath:path,caseCount:rawResults.length,
    reportedCount:typeof json.count==="number"?json.count:null,
    failureCount:failed.length,
    failures:failed.slice(0,15).map(x=>({id:String(x.id||"").slice(0,90),
      messages:sanitize(x.failures.join("\n"))}))};
}

/** Read-only, tightly pinned identity discovery for the two founder-provided
 *  NEN CircleCI workflows. No artifacts, logs or pipeline mutations. */
export async function probeCircleCiNenProject(env, command, requestFn=fetch) {
  const recognized = {
    "40e8c61b-a100-42cb-833d-02cb3b0e0bb8":"f5db7ff8-0004-4761-aeb4-9ceadca52682",
    "582d9151-2f67-42a7-beb8-ab1794302da8":"dd8016e8-513d-4385-b106-096b8cb71b0c",
  };
  deny(command?.action==="project_probe" &&
    recognized[command.pipelineId]===command.jobId &&
    command.project==="nen-website-cms" && command.provider==="circleci",
    "NEN CircleCI probe not permitted");
  const workflow=await apiJson(env,API2+"/workflow/"+command.pipelineId,requestFn);
  deny(workflow.id===command.pipelineId && UUID.test(workflow.pipeline_id||""),
    "NEN CircleCI workflow identity mismatch");
  const pipeline=await apiJson(env,API2+"/pipeline/"+workflow.pipeline_id,requestFn);
  const listing=await apiJson(env,API2+"/workflow/"+command.pipelineId+"/job",requestFn);
  const jobs=(Array.isArray(listing.items)?listing.items:[]).filter(j=>j.id===command.jobId && JOB_NAMES.has(j.name));
  deny(jobs.length===1,"NEN CircleCI job ownership mismatch");
  return {project:"nen-website-cms",provider:"circleci",
    observedProjectSlug:typeof pipeline.project_slug==="string"?pipeline.project_slug:null,
    configuredProjectSlug:typeof env.NEN_CIRCLECI_PROJECT_SLUG==="string"?env.NEN_CIRCLECI_PROJECT_SLUG:null,
    pipelineId:workflow.pipeline_id,workflowId:workflow.id,jobId:command.jobId,
    jobName:jobs[0].name,jobProjectSlug:jobs[0].project_slug||null,
    vcsBranch:pipeline.vcs?.branch||null,vcsRevision:pipeline.vcs?.revision||null,
    pipelineFields:Object.keys(pipeline).filter(k=>["id","project_slug","project_id","vcs","state","number"].includes(k)),
    releasePermitted:false};
}
