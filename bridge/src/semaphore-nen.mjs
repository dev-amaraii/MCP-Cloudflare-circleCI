/** Isolated NEN Semaphore diagnostics plus one reviewed validation-only workflow.
 * No caller-selected project, origin, token, pipeline file, or release mode.
 * The approved preview trigger is pinned to one branch and exact SHA.
 * AmaraiiOS retains its independent SEMAPHORE_PROJECT_ID binding.
 */
const API = 'https://amaraii.semaphoreci.com/api/v1alpha';
export const NEN_PREVIEW = Object.freeze({
  branch:'fix/nen-mobile-footer-overflow-20261110',
  commitSha:'7413ef8417f0b3c8f488ae9462633d837cae45b7',
  base:'https://nen-website-cms-staging-git-fix-nen-mobile-fe8706-amaraii-team.vercel.app',
  pipelineFile:'.semaphore/semaphore.yml',
});
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/;
const ARTIFACT_DIR = 'qa-intel/nen-production';
const REPORT_FILE = ARTIFACT_DIR + '/report.json';
export const NEN_SCREENSHOT = /^(?:home|software|security|solar|communications|about|connect|amaraii|billing|privacy|terms)-(?:320|390|1280|1440)-(?:light|dark|system)(?:-error)?\.png$/;
const MAX_JSON_BYTES = 200_000;
const MAX_PNG_BYTES = 3_000_000;
const MAX_LOG_EVENTS = 20_000;

function projectId(env) {
  if (!UUID.test(env.SEMAPHORE_NEN_PROJECT_ID ?? '')) throw Error('NEN Semaphore project not configured');
  return env.SEMAPHORE_NEN_PROJECT_ID;
}
function tokenReady(env) { return typeof env.SEMAPHORE_TOKEN === 'string' && !!env.SEMAPHORE_TOKEN; }
function checkId(id) { if (!UUID.test(id ?? '')) throw Error('Invalid Semaphore resource identity'); return id; }
function safeState(s, allowed) { return typeof s === 'string' && allowed.includes(s.toLowerCase()) ? s.toLowerCase() : null; }

async function apiGet(env, path, requestFn) {
  if (!tokenReady(env)) throw Error('Semaphore token not configured');
  const res = await requestFn(API + path, {
    method:'GET', redirect:'manual', headers:{Authorization:'Token ' + env.SEMAPHORE_TOKEN,
      Accept:'application/json','User-Agent':'SemaphoreCI v2.0 Client'},
  });
  if (!res.ok) throw Error('NEN Semaphore API HTTP ' + res.status);
  const value = await res.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Malformed Semaphore response');
  return value;
}
async function triggerPreview(env, command, requestFn) {
  if (command.branch !== NEN_PREVIEW.branch || command.commitSha !== NEN_PREVIEW.commitSha)
    throw Error('NEN preview revision not permitted');
  if (!tokenReady(env)) throw Error('Semaphore token not configured');
  const response = await requestFn(API+'/plumber-workflows',{
    method:'POST',redirect:'manual',
    headers:{Authorization:'Token '+env.SEMAPHORE_TOKEN,
      Accept:'application/json', 'Content-Type':'application/json',
      'User-Agent':'SemaphoreCI v2.0 Client'},
    body:JSON.stringify({
      project_id:projectId(env),
      reference:'refs/heads/'+NEN_PREVIEW.branch,
      commit_sha:NEN_PREVIEW.commitSha,
      pipeline_file:NEN_PREVIEW.pipelineFile,
    }),
  });
  if (!response.ok) throw Error('NEN Semaphore API HTTP '+response.status);
  const data = await response.json();
  if (!UUID.test(data?.workflow_id??'') || !UUID.test(data?.pipeline_id??''))
    throw Error('Invalid NEN preview workflow response');
  return {provider:'semaphore',project:'nen-website-cms',
    branch:NEN_PREVIEW.branch,revision:NEN_PREVIEW.commitSha,
    pipelineId:data.pipeline_id,workflowId:data.workflow_id,
    validationOnly:true,releasePermitted:false};
}
async function getOwned(env, pipelineId, requestFn) {
  checkId(pipelineId);
  const target = projectId(env);
  const basic = await apiGet(env, '/pipelines/' + pipelineId, requestFn);
  const first = basic.pipeline;
  // Return only fixed error categories, never upstream identifiers or payloads.
  // In particular, a project mismatch must stop before the detailed pipeline
  // or any job/artifact access, preserving tenant isolation.
  if (!first || first.project_id !== target)
    throw Error('NEN Semaphore project identity mismatch');
  if (first.ppl_id && first.ppl_id !== pipelineId)
    throw Error('NEN Semaphore pipeline identity mismatch');
  if (!UUID.test(first.wf_id ?? ''))
    throw Error('NEN Semaphore workflow identity missing');
  const details = await apiGet(env, '/pipelines/' + pipelineId + '?detailed=true', requestFn);
  const p = details.pipeline;
  if (!p || (p.project_id && p.project_id !== target) ||
      (p.ppl_id && p.ppl_id !== pipelineId) ||
      (p.wf_id && p.wf_id !== first.wf_id))
    throw Error('NEN Semaphore detailed pipeline identity mismatch');
  if (!Array.isArray(details.blocks))
    throw Error('NEN Semaphore detailed job blocks missing');
  return {pipeline:first, blocks:details.blocks, workflowId:first.wf_id};
}
function jobsFrom(blocks) {
  return blocks.slice(0,16).flatMap(b=>(Array.isArray(b.jobs)?b.jobs:[]).slice(0,25));
}
function fileAllowed(filename) { return filename === 'report.json' || NEN_SCREENSHOT.test(filename); }
function signedHostAllowed(url) {
  const h=url.hostname.toLowerCase();
  return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
    (h === 'storage.googleapis.com' || h.endsWith('.storage.googleapis.com') ||
     h === 's3.amazonaws.com' || /^s3[.-][a-z0-9-]+\.amazonaws\.com$/.test(h) ||
     /^[a-z0-9.-]+\.s3[.-][a-z0-9-]+\.amazonaws\.com$/.test(h) ||
     h.endsWith('.r2.cloudflarestorage.com') || h.endsWith('.semaphoreci.com'));
}
async function signedArtifact(env, workflowId, path, requestFn) {
  checkId(workflowId);
  if (path !== REPORT_FILE && !(path.startsWith(ARTIFACT_DIR + '/') &&
      NEN_SCREENSHOT.test(path.slice(ARTIFACT_DIR.length+1)))) throw Error('NEN artifact path not permitted');
  const params=new URLSearchParams({scope:'workflows',scope_id:workflowId,path,method:'GET'});
  const data=await apiGet(env, '/artifacts/signed_url?' + params.toString(), requestFn);
  const item=Array.isArray(data.items) && data.items.length === 1 ? data.items[0] : null;
  if (!item || item.path !== path || typeof item.url !== 'string') throw Error('Invalid NEN artifact signature');
  let url;
  try {url=new URL(item.url);} catch {throw Error('Invalid NEN artifact URL');}
  if (!signedHostAllowed(url)) throw Error('Unapproved NEN artifact storage host');
  return url;
}
async function readArtifact(env, workflowId, path, maxBytes, requestFn) {
  let url = await signedArtifact(env,workflowId,path,requestFn);
  for (let hop=0;hop<3;hop++) {
    if (!signedHostAllowed(url)) throw Error('Unapproved NEN artifact storage host');
    const response=await requestFn(url.toString(), {method:'GET',redirect:'manual',headers:{Accept:'application/octet-stream'}});
    if ([301,302,303,307,308].includes(response.status)) {
      const location=response.headers.get('location');
      if (!location) throw Error('NEN artifact redirect rejected');
      url=new URL(location,url);
      continue;
    }
    if (!response.ok || !response.body) throw Error('NEN artifact download failed');
    const length=Number(response.headers.get('content-length') || 0);
    if (!Number.isFinite(length) || length > maxBytes) throw Error('NEN artifact too large');
    const reader=response.body.getReader(), chunks=[];
    let total=0;
    for (;;) {
      const {done,value}=await reader.read();
      if (done) break;
      total+=value.byteLength;
      if (total>maxBytes) { await reader.cancel(); throw Error('NEN artifact too large'); }
      chunks.push(value);
    }
    const bytes=new Uint8Array(total); let offset=0;
    for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
    if (!total) throw Error('NEN artifact empty');
    return bytes;
  }
  throw Error('NEN artifact redirect limit');
}
function boundedJson(bytes) {
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch {throw Error('Invalid NEN QA report');}
}
function safeReport(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.results) ||
      data.count !== data.results.length || data.count < 1 || data.count > 100 ||
      !Number.isInteger(data.failures) || data.failures < 0 || data.failures > data.count ||
      typeof data.base !== 'string' ||
      !(/^https:\/\/(?:www\.)?neninternational\.com\/?$/.test(data.base) ||
        data.base === NEN_PREVIEW.base)) {
    throw Error('Invalid NEN QA report');
  }
  const failures=[];
  for (const result of data.results) {
    if (!result || typeof result.id !== 'string' ||
        !/^[a-z]+-(?:320|390|1280|1440)-(?:light|dark|system)$/.test(result.id) ||
        !Array.isArray(result.failures) || result.failures.length > 8) throw Error('Invalid NEN QA report');
    if (result.failures.length) failures.push({
      id:result.id,
      viewportWidth:Number.isInteger(result.viewport?.width)?result.viewport.width:null,
      overflowPx:Number.isInteger(result.horizontalOverflow)?result.horizontalOverflow:null,
      errors:result.failures.map(value=> {
        if (typeof value !== 'string') throw Error('Invalid NEN QA report');
        if (/^horizontal overflow \d{1,4}px$/.test(value)) return 'horizontal_overflow';
        if (/^HTTP (?:\d{3}|none)$/.test(value)) return 'http_error';
        if (value.startsWith('execution:')) return 'browser_execution';
        if (value === 'NEN brand CSS tokens missing') return 'brand_tokens_missing';
        if (value.startsWith('hero background lost contrast')) return 'hero_contrast';
        if (value === 'visible image load failure') return 'image_load_failure';
        if (value === 'stylesheet request failed') return 'css_load_failure';
        if (value === 'incomplete site shell') return 'site_shell';
        if (value === 'redundant section navigation returned') return 'duplicated_navigation';
        return 'other';
      }),
      overflowCandidates:(Array.isArray(result.overflowCandidates)?result.overflowCandidates:[])
        .slice(0,8).map(c=>({tag:/^[a-z0-9-]{1,20}$/.test(c?.tag??'')?c.tag:null,
          excessRight:Number.isFinite(c?.excessRight)?Math.round(c.excessRight):null,
          width:Number.isFinite(c?.width)?Math.round(c.width):null,
          parentOverflow:['visible','hidden','clip','auto','scroll'].includes(c?.parentOverflow)?c.parentOverflow:null})),
    });
  }
  if (failures.length !== data.failures) throw Error('Invalid NEN QA report count');
  return {project:'nen-website-cms',testCount:data.count,passed:data.count-data.failures,
    failures:data.failures,runnerCommit:SHA.test(data.runnerCommit ?? '')?data.runnerCommit:null,
    runnerBranch:typeof data.runnerBranch==='string' && /^[a-z0-9/_-]{1,100}$/.test(data.runnerBranch)?data.runnerBranch:null,
    failuresDetail:failures};
}
function encodeBase64(bytes) {
  let binary='';
  for(let n=0;n<bytes.length;n+=16384) binary+=String.fromCharCode(...bytes.subarray(n,n+16384));
  return btoa(binary);
}
function safeLog(events) {
  if (!Array.isArray(events) || events.length > MAX_LOG_EVENTS) throw Error('Invalid NEN Semaphore log');
  const failedCommands=[], errorKinds=new Set(); let failureOutputs=0;
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    if (event.event === 'cmd_finished' && Number.isInteger(event.exit_code) && event.exit_code!==0) {
      const d=typeof event.directive==='string'?event.directive:'';
      const allowed = ['checkout','nvm install 24','nvm use 24','corepack enable',
        'corepack prepare pnpm@9.15.9 --activate','test -s pnpm-lock.yaml',
        'pnpm install --frozen-lockfile','pnpm --filter web test',
        'pnpm --filter web typecheck','pnpm --filter web lint','pnpm --filter web build',
        'npm install --prefix /tmp/nen-qa --no-save --no-audit --no-fund playwright@1.56.1',
        'node /tmp/nen-qa/node_modules/playwright/cli.js install --with-deps chromium',
        'node scripts/qa/nen-production.mjs'];
      failedCommands.push({name:allowed.includes(d)?d:'other',exitCode:event.exit_code});
    }
    if (event.event!=='cmd_output' || typeof event.output!=='string') continue;
    const output=event.output.slice(0,20000); failureOutputs++;
    if (/ERR_PNPM_OUTDATED_LOCKFILE|frozen.lockfile/i.test(output))errorKinds.add('lockfile');
    if (/error TS\d{4}/.test(output))errorKinds.add('typescript');
    if (/horizontal overflow \d+px|OVERFLOW_DIAGNOSTICS/.test(output))errorKinds.add('horizontal_overflow');
    if (/chromium.*(install|launch|missing|not found)|Executable doesn't exist/i.test(output))errorKinds.add('browser_setup');
    if (/HTTP 404/.test(output))errorKinds.add('http_404');
    if (/ENOMEM|out of memory|heap out of memory/i.test(output))errorKinds.add('memory');
    if (/EAI_AGAIN|ENOTFOUND|ETIMEDOUT/i.test(output))errorKinds.add('network');
    if (/Permission denied|EACCES|EPERM/.test(output))errorKinds.add('permissions');
    if (/artifact.*(not found|failed|permission)/i.test(output))errorKinds.add('artifact_upload');
    if (/NEN_PREVIEW_AUTH_REQUIRED/.test(output))errorKinds.add('preview_credential_missing');
    if (/NEN_PREVIEW_AUTH_DENIED/.test(output)) {
      errorKinds.add('preview_authentication_denied');
      const preflight = output.match(/NEN_PREVIEW_AUTH_DENIED:\s*(http_unavailable|vercel_login|unexpected_origin|navigation_or_heading_timeout)\b/);
      if (preflight) errorKinds.add('preview_preflight_'+preflight[1]);
    }
  }
  return {failedCommands:failedCommands.slice(0,12),errorKinds:[...errorKinds],outputEventsExamined:failureOutputs};
}

export async function executeSemaphoreNen(env, command, requestFn=fetch) {
  if (command.action === 'health') return {provider:'semaphore',project:'nen-website-cms',
    projectConfigured:UUID.test(env.SEMAPHORE_NEN_PROJECT_ID ?? ''), tokenConfigured:tokenReady(env),
    allowedActions:['health','inspect','nen_job_diagnostics','nen_artifact_list','nen_artifact_report','nen_artifact_preview','nen_trigger_preview'],
    releasePermitted:false,triggerPermitted:true,triggerScope:'single-reviewed-branch-and-exact-sha'};
  if (command.action === 'nen_trigger_preview') return triggerPreview(env,command,requestFn);
  const {pipeline,blocks,workflowId}=await getOwned(env,command.pipelineId,requestFn);
  if (command.action === 'inspect') return {provider:'semaphore',project:'nen-website-cms',
    pipelineId:command.pipelineId,workflowId,
    state:safeState(pipeline.state,['pending','running','done','stopping','stopped','queued']),
    result:safeState(pipeline.result,['passed','failed','stopped','canceled','skipped']),
    revision:SHA.test(pipeline.commit_sha ?? '')?pipeline.commit_sha:null,
    branch:typeof pipeline.branch_name==='string' && /^[a-z0-9/_-]{1,100}$/.test(pipeline.branch_name)?pipeline.branch_name:null,
    blocks:blocks.slice(0,12).map(b=>({name:typeof b.name==='string'?b.name.slice(0,80):null,
      state:safeState(b.state,['pending','running','done','stopping','stopped','queued']),
      result:safeState(b.result,['passed','failed','stopped','canceled','skipped']),
      jobs:(Array.isArray(b.jobs)?b.jobs:[]).slice(0,20).map(j=>({id:UUID.test(j.job_id??'')?j.job_id:null,
        name:typeof j.name==='string'?j.name.slice(0,80):null,
        result:safeState(j.result,['passed','failed','stopped','canceled','skipped']),
        status:safeState(j.status,['queued','pending','running','finished','stopped'])}))}))};
  if (command.action === 'nen_job_diagnostics') {
    if (!jobsFrom(blocks).some(j=>j.job_id===command.jobId)) throw Error('NEN Semaphore job ownership mismatch');
    const data=await apiGet(env,'/logs/'+checkId(command.jobId),requestFn);
    return {project:'nen-website-cms',pipelineId:command.pipelineId,jobId:command.jobId,
      ...safeLog(data.events)};
  }
  if (command.action === 'nen_artifact_list') {
    const params=new URLSearchParams({scope:'workflows',scope_id:workflowId,path:ARTIFACT_DIR});
    const result=await apiGet(env,'/artifacts?'+params.toString(),requestFn);
    const files=(Array.isArray(result.artifacts)?result.artifacts:[]).filter(x=>
      !x.is_directory && typeof x.name==='string' && fileAllowed(x.name) &&
      x.path===ARTIFACT_DIR+'/'+x.name).slice(0,100).map(f=>({name:f.name,
        bytes:Number.isSafeInteger(f.size) && f.size>=0?f.size:null}));
    return {project:'nen-website-cms',pipelineId:command.pipelineId,files};
  }
  if (command.action === 'nen_artifact_report') {
    const data=boundedJson(await readArtifact(env,workflowId,REPORT_FILE,MAX_JSON_BYTES,requestFn));
    return {pipelineId:command.pipelineId,...safeReport(data)};
  }
  if (command.action === 'nen_artifact_preview') {
    const filename=command.artifactPath;
    if (typeof filename!=='string' || !NEN_SCREENSHOT.test(filename)) throw Error('NEN screenshot path not permitted');
    const bytes=await readArtifact(env,workflowId,ARTIFACT_DIR+'/'+filename,MAX_PNG_BYTES,requestFn);
    if (![137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)) throw Error('NEN screenshot format mismatch');
    return {project:'nen-website-cms',pipelineId:command.pipelineId,path:filename,mediaType:'image/png',
      bytes:bytes.byteLength,dataBase64:encodeBase64(bytes)};
  }
  throw Error('NEN Semaphore action not permitted');
}
