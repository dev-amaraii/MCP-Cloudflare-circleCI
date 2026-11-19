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
const REVIEWED_REVISIONS = new Set([
  "8c818968da6be860ba0e6c4012895b7e2d5331f5", // failed run #23
  "7b9f3ff8d9cf906d4a9df6578d54ddfe44c29d9f", // test-fix run
]);
const JOB_NAMES = new Set([
  "nen-security-preview-source-qa",
  "nen-security-preview-browser-qa",
]);
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SLUG = /^circleci\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;
const ARTIFACT = /^nen-security-preview-qa\/(?:report\.json|(?:home|security|solar|software|communications|about|connect|saas-and-ai|renewable-energy)[-A-Za-z0-9]*\.png)$/;
const MAX_REPORT = 250_000;
const MAX_PNG = 850_000;

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
  deny(UUID.test(command.jobId || ""), "Invalid NEN CircleCI job id");
  deny(Object.keys(command).every(key => ["project","provider","action","jobId","artifactPath"].includes(key)),
    "Unexpected NEN evidence field");
  if (command.action === "artifact_png") {
    deny(typeof command.artifactPath === "string" && ARTIFACT.test(command.artifactPath) &&
      command.artifactPath.endsWith(".png"), "NEN screenshot path not permitted");
  } else {
    deny(command.artifactPath === undefined, "Unexpected NEN artifact path");
  }
  return command;
}
async function verifiedJob(env, jobId, requestFn) {
  const expectedSlug = slug(env);
  const project = await apiJson(env, API2 + "/project/" + expectedSlug, requestFn);
  deny(project.slug === expectedSlug && UUID.test(project.id || ""), "NEN CircleCI project identity mismatch");
  // Project display names can differ from repo names (e.g. "nen-website").
  // Require an actual GitHub App pipeline definition for exactly the NEN repo.
  const definitions=await apiJson(env,API2+"/projects/"+project.id+"/pipeline-definitions",requestFn);
  const owned=(Array.isArray(definitions.items)?definitions.items:[]).filter(x=>
    x.config_source?.provider==="github_app" &&
    x.config_source?.repo?.full_name?.toLowerCase()===REPOSITORY.toLowerCase() &&
    x.config_source?.file_path===".circleci/config.yml" && UUID.test(x.id || ""));
  deny(owned.length===1, "NEN CircleCI repository definition not verified uniquely");
  const job = resource(await apiJson(env, API3 + "/jobs/" + jobId, requestFn));
  deny(job.id === jobId && job.project_id === project.id && JOB_NAMES.has(job.name) &&
    UUID.test(job.pipeline_id || ""), "NEN CircleCI job ownership mismatch");
  const pipeline = await apiJson(env, API2 + "/pipeline/" + job.pipeline_id, requestFn);
  deny(pipeline.id === job.pipeline_id && pipeline.project_slug === expectedSlug,
    "NEN CircleCI pipeline ownership mismatch");
  deny(pipeline.vcs?.branch === BRANCH && REVIEWED_REVISIONS.has(pipeline.vcs?.revision),
    "NEN CircleCI revision not reviewed");
  return {job,pipeline};
}
function failedSteps(job) {
  const rows=[];
  for (const ex of (Array.isArray(job.executions) ? job.executions : [])) {
    const steps=Array.isArray(ex.steps) ? ex.steps : [];
    for (let index=0; index<steps.length; index++) {
      const s=steps[index], exit=s.exit_code;
      if ((typeof exit==="number" && exit!==0) || /fail|error/i.test(s.status || "")) {
        rows.push({stepNum:Number.isInteger(s.step_num)?s.step_num:index,
          execution:Number.isInteger(ex.index)?ex.index:0,
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
  deny(typeof value === "string", "Invalid NEN artifact URL");
  const url=new URL(value);
  deny(url.protocol==="https:" && url.username==="" && url.password==="" &&
    (url.hostname==="circleci.com" || url.hostname.endsWith(".circle-artifacts.com")),
    "NEN artifact host not permitted");
  return url;
}
async function boundedArtifact(env, url, max, requestFn) {
  const target=trustedArtifactUrl(url);
  const headers=target.hostname==="circleci.com" ? apiHeaders(env) : {Accept:"application/octet-stream"};
  const response=await requestFn(target.href, {method:"GET",redirect:"manual",headers});
  if (!response.ok) throw new Error("NEN artifact HTTP " + response.status);
  const length=Number(response.headers?.get?.("content-length") || 0);
  deny(!length || length<=max, "NEN artifact exceeds byte limit");
  deny(response.body?.getReader, "NEN artifact streaming required");
  const reader=response.body.getReader(),chunks=[]; let total=0;
  try {
    for(;;) {
      const next=await reader.read();
      if(next.done)break;
      total+=next.value.byteLength;
      if(total>max) throw new Error("NEN artifact exceeds byte limit");
      chunks.push(next.value);
    }
  } finally {await reader.cancel().catch(()=>{});}
  const result=new Uint8Array(total);let offset=0;
  for(const chunk of chunks) {result.set(chunk,offset);offset+=chunk.byteLength;}
  return result;
}
function toBase64(bytes) {
  let raw="";
  for(let i=0;i<bytes.length;i+=8192) raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(raw);
}
export async function readCircleCiNenEvidence(env, command, requestFn=fetch) {
  checkedCommand(command);
  const {job,pipeline}=await verifiedJob(env,command.jobId,requestFn);
  const common={project:"nen-website-cms",provider:"circleci",jobId:job.id,
    jobName:job.name,status:job.status,revision:pipeline.vcs.revision,
    revisionVerified:true,releasePermitted:false};
  if(command.action==="job_diagnostics"){
    const steps=failedSteps(job),logs=[];
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
