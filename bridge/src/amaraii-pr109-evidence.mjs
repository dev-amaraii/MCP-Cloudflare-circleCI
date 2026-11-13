/**
 * Read-only Semaphore evidence access for one already-passed AmaraiiOS PR.
 * Deliberately separate from CircleCI artifacts, trigger, release, and the
 * other Semaphore project adapters. No secrets or signed URLs leave the Worker.
 *
 * Not a generic Semaphore file proxy. Keep these identifiers pinned.
 */
export const PR109 = Object.freeze({
  project: "amaraii-os",
  branch: "feat/gym-historical-service-review-20261112",
  sha: "7e7b924bb1d8db4deedacf9cf8d1e0f18fafa880",
  jobId: "0c2352b9-3f8a-4aa6-a328-96663980a1c9",
  jobName: "Contracts, Gym preview, workspace checks",
});

const API = "https://amaraii.semaphoreci.com/api/v1alpha";
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MAX_IMAGE = 1600000;
const MAX_REPORT = 131072;
const DIRS = new Set([
  "historical-service",
  "historical-service/screenshots",
  "historical-service/qa-intel",
  "historical-service/qa-intel/screenshots",
]);
const STATIC_IMAGES = /^historical-service\/screenshots\/historical-service-(?:320|390|1280|invalid-390)\.png$/;
const QA_IMAGES = /^historical-service\/qa-intel\/(?:[A-Za-z0-9_-]{1,64}\/){0,3}[A-Za-z0-9_-]{1,110}\.png$/;
const REPORTS = new Set([
  "historical-service/REPORT.md",
  "historical-service/qa-intel/REPORT.md",
  "historical-service/qa-intel/report.md",
  "historical-service/qa-intel/report.json",
  "historical-service/qa-intel/summary.json",
]);
const ALLOWED_HOSTS = host =>
  host === "storage.googleapis.com" ||
  host.endsWith(".storage.googleapis.com") ||
  host === "s3.amazonaws.com" ||
  host.endsWith(".s3.amazonaws.com") ||
  /^[a-z0-9.-]+\.s3\.[a-z0-9-]+\.amazonaws\.com$/.test(host) ||
  host === "artifacts.semaphoreci.com" ||
  host.endsWith(".artifacts.semaphoreci.com");

function semaphoreProjectId(env) {
  const id = env.SEMAPHORE_PROJECT_ID;
  if (!UUID.test(id || "")) throw Error("Amaraii Semaphore project not configured");
  return id;
}
async function api(env, path, fetchFn) {
  if (!env.SEMAPHORE_TOKEN) throw Error("Semaphore token not configured");
  const r = await fetchFn(API + path, {
    method: "GET",
    redirect: "manual",
    headers: {
      Authorization: "Token " + env.SEMAPHORE_TOKEN,
      Accept: "application/json",
      "User-Agent": "SemaphoreCI v2.0 Client",
    },
  });
  if (!r.ok) throw Error("Semaphore API HTTP " + r.status);
  const data = await r.json();
  if (data === null || typeof data !== "object") throw Error("Invalid Semaphore response");
  return data;
}
async function owned(env, pipelineId, fetchFn) {
  if (!UUID.test(pipelineId || "")) throw Error("Invalid pipeline identity");
  const projectId = semaphoreProjectId(env);
  const data = await api(env, "/pipelines/" + pipelineId, fetchFn);
  const p = data.pipeline;
  if (!p || p.project_id !== projectId ||
      p.ppl_id !== pipelineId ||
      p.branch_name !== PR109.branch ||
      p.commit_sha !== PR109.sha ||
      String(p.state).toLowerCase() !== "done" ||
      String(p.result).toLowerCase() !== "passed" ||
      !UUID.test(p.wf_id || "")) throw Error("PR109 pipeline ownership mismatch");
  const detailed = await api(env, "/pipelines/" + pipelineId + "?detailed=true", fetchFn);
  if (detailed.pipeline?.project_id && detailed.pipeline.project_id !== projectId)
    throw Error("PR109 pipeline ownership mismatch");
  if (detailed.pipeline?.wf_id && detailed.pipeline.wf_id !== p.wf_id)
    throw Error("PR109 pipeline ownership mismatch");
  const jobs = (Array.isArray(detailed.blocks) ? detailed.blocks : [])
    .flatMap(b => Array.isArray(b.jobs) ? b.jobs : []);
  if (!jobs.some(j => j.job_id === PR109.jobId &&
      j.name === PR109.jobName &&
      String(j.status).toLowerCase() === "finished" &&
      String(j.result).toLowerCase() === "passed")) {
    throw Error("PR109 job ownership mismatch");
  }
  return {pipelineId, workflowId:p.wf_id, jobId:PR109.jobId, revision:PR109.sha};
}
async function list(env, scopeId, directory, fetchFn) {
  const url = "/artifacts?scope=jobs&scope_id=" + scopeId +
    "&path=" + encodeURIComponent(directory);
  const data = await api(env, url, fetchFn);
  return (Array.isArray(data.artifacts) ? data.artifacts : [])
    .filter(x => typeof x.path === "string" &&
      x.path.startsWith("historical-service/") &&
      !x.path.includes("..") && !x.path.includes("\\") && x.path.length < 241)
    .slice(0, 80)
    .map(x => ({
      path:x.path, directory:x.is_directory === true,
      size:Number.isSafeInteger(x.size) && x.size >= 0 && x.size <= 10000000 ? x.size : null,
    }));
}
async function signed(env, jobId, path, fetchFn) {
  const url = "/artifacts/signed_url?scope=jobs&scope_id=" + jobId +
    "&path=" + encodeURIComponent(path) + "&method=GET";
  const info = await api(env, url, fetchFn);
  const hit = (Array.isArray(info.items) ? info.items : [])
    .find(x => x.path === path && typeof x.url === "string");
  if (!hit) throw Error("PR109 artifact not found");
  return hit.url;
}
function safeUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw Error("Unsafe artifact URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !ALLOWED_HOSTS(url.hostname.toLowerCase())) throw Error("Unsafe artifact URL");
  return url;
}
async function retrieve(urlString, max, contentTypes, fetchFn) {
  let u = safeUrl(urlString);
  for (let redirect=0; redirect<3; redirect++) {
    const r = await fetchFn(u.href, {
      method:"GET", redirect:"manual", headers:{Accept:contentTypes[0]},
    });
    if ([301,302,303,307,308].includes(r.status)) {
      const location = r.headers.get("location");
      if (!location) throw Error("Artifact download failed");
      u = safeUrl(new URL(location,u).href);
      continue;
    }
    if (!r.ok || !r.body) throw Error("Artifact download failed");
    const n = Number(r.headers.get("content-length") || 0);
    if (!Number.isFinite(n) || n > max) throw Error("Artifact too large");
    const mime = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (mime && !contentTypes.includes(mime) && mime !== "application/octet-stream")
      throw Error("Unsupported artifact format");
    const reader = r.body.getReader();
    const chunks=[];let total=0;
    for (;;) {
      const {value,done} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) { await reader.cancel(); throw Error("Artifact too large"); }
      chunks.push(value);
    }
    const out = new Uint8Array(total);let offset=0;
    for(const c of chunks){out.set(c,offset);offset+=c.length;}
    return {bytes:out,mime};
  }
  throw Error("Artifact redirect limit reached");
}
function base64(data) {
  let result="";
  for(let i=0;i<data.length;i+=8192) result+=String.fromCharCode(...data.subarray(i,i+8192));
  return btoa(result);
}
function assertPng(data) {
  const bytes=[137,80,78,71,13,10,26,10];
  if (data.length<33 || bytes.some((b,i)=>data[i]!==b)) throw Error("Invalid PNG data");
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  const width=view.getUint32(16),height=view.getUint32(20);
  if(width<320||width>2000||height<400||height>20000) throw Error("Invalid PNG geometry");
  return {width,height};
}

export async function executePr109Evidence(env,command,fetchFn=fetch){
  if (command.project !== PR109.project || command.provider !== "semaphore" ||
      !["pr109_discover","pr109_artifacts","pr109_png","pr109_report"].includes(command.action)) {
    throw Error("PR109 evidence action not permitted");
  }
  // No mutation or user-supplied origin, branch, revision or credentials.
  if (command.action === "pr109_discover") {
    const id = semaphoreProjectId(env);
    const data = await api(env,
      "/pipelines?project_id="+id+"&branch_name="+encodeURIComponent(PR109.branch),fetchFn);
    const candidates = Array.isArray(data) ? data :
      (Array.isArray(data.pipelines) ? data.pipelines : []);
    for(const item of candidates.slice(0,30)){
      const pipelineId = item.ppl_id || item.id;
      if (!UUID.test(pipelineId || "")) continue;
      try {
        const o = await owned(env,pipelineId,fetchFn);
        return {project:PR109.project,provider:"semaphore",...o,action:"pr109_discover"};
      } catch { /* Do not reveal metadata belonging to another run. */ }
    }
    throw Error("Approved PR109 pipeline not found");
  }
  const ownership = await owned(env,command.pipelineId,fetchFn);
  if (command.action === "pr109_artifacts") {
    const folder=command.artifactPath || "historical-service";
    if (!DIRS.has(folder)) throw Error("PR109 artifact directory not permitted");
    return {...ownership,action:command.action,folder,
      artifacts:await list(env,ownership.jobId,folder,fetchFn)};
  }
  const path=command.artifactPath;
  if (typeof path !== "string" || path.length > 240 || path.includes("..") ||
      path.includes("\\") || path.includes("//")) throw Error("Artifact path not permitted");
  if(command.action === "pr109_png"){
    if (!STATIC_IMAGES.test(path) && !QA_IMAGES.test(path)) throw Error("PNG path not permitted");
    const entries=await list(env,ownership.jobId,
      path.slice(0,path.lastIndexOf("/")),fetchFn);
    const found=entries.find(x=>x.path===path&&!x.directory);
    if (!found || found.size !== null && found.size > MAX_IMAGE)
      throw Error("PR109 artifact not found or too large");
    const data=await retrieve(await signed(env,ownership.jobId,path,fetchFn),
      MAX_IMAGE,["image/png"],fetchFn);
    const dims=assertPng(data.bytes);
    return {...ownership,action:command.action,path,mediaType:"image/png",
      length:data.bytes.length,...dims,dataBase64:base64(data.bytes)};
  }
  if (!REPORTS.has(path)) throw Error("Report path not permitted");
  const entries=await list(env,ownership.jobId,path.slice(0,path.lastIndexOf("/")),fetchFn);
  const found=entries.find(x=>x.path===path&&!x.directory);
  if (!found || found.size !== null && found.size > MAX_REPORT)
    throw Error("PR109 report not found or too large");
  const data=await retrieve(await signed(env,ownership.jobId,path,fetchFn),
    MAX_REPORT,["text/plain","text/markdown","application/json"],fetchFn);
  const report = new TextDecoder("utf-8",{fatal:true}).decode(data.bytes);
  if (!report.trim()) throw Error("Empty PR109 report");
  return {...ownership,action:command.action,path,mediaType:"text/plain",
    length:data.bytes.length,report};
}
