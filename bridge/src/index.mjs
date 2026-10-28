/**
 * NEN CI Bridge — private Cloudflare KV mailbox, no HTTP command endpoint.
 * Only Cloudflare-account-authorized clients can enqueue requests through
 * the Cloudflare Queues control-plane API. No scheduled polling runs.
 *
 * No direct deployment, cancellation, rerun or arbitrary URL functionality.
 * Approved release requests only trigger a separate SHA-pinned CircleCI
 * workflow; QA completion gates the dedicated Pages deployment job.
 */
const API = 'https://circleci.com/api/v2';
const PREFIX = 'requests/';
const RESULT_PREFIX = 'results/';
const CLAIM_PREFIX = 'claims/';
const RESULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_REQUEST_AGE_MS = 30 * 60 * 1000;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const COMMIT_SHA = /^[a-f0-9]{40}$/;

const IMAGE_ARTIFACT_MAX_BYTES = 900000;
// Only disposable NEN QA screenshots, never an arbitrary CircleCI artifact or URL.
const NEN_QA_IMAGE = /^(?:nen-customer-operations-qa|bank-transfer-qa|qa-intel\/transactions)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.png$/;

function artifactHostAllowed(url) {
  const h = url.hostname.toLowerCase();
  return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
    (h === 'circleci.com' || h.endsWith('.circle-artifacts.com') ||
      h === 'circle-artifacts.com' ||
      h === 'circleci-tasks-prod.s3.us-east-1.amazonaws.com' || h === 's3.amazonaws.com' || h.endsWith('.s3.amazonaws.com'));
}

async function downloadQaImage(env, urlValue, requestFn = fetch) {
  let url;
  try { url = new URL(urlValue); } catch { throw new Error('Unsafe artifact URL'); }
  if (!artifactHostAllowed(url)) throw new Error('Unsafe artifact URL: ' + url.hostname);
  for (let attempt = 0; attempt < 3; attempt++) {
    const trusted = url.hostname === 'circleci.com' ||
      url.hostname === 'circle-artifacts.com' || url.hostname.endsWith('.circle-artifacts.com');
    const response = await requestFn(url.toString(), {
      method: 'GET', redirect: 'manual',
      headers: trusted ? { 'Circle-Token': env.CIRCLE_TOKEN, 'Accept': 'image/png' } : { 'Accept': 'image/png' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Artifact download failed');
      url = new URL(location, url);
      if (!artifactHostAllowed(url)) throw new Error('Unsafe artifact URL: ' + url.hostname);
      continue;
    }
    if (!response.ok || !response.body) throw new Error('Artifact download failed');
    const length = Number(response.headers.get('content-length') || 0);
    if (length > IMAGE_ARTIFACT_MAX_BYTES) throw new Error('Artifact too large');
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    if (type && type !== 'image/png' && type !== 'application/octet-stream') throw new Error('Artifact format not supported');
    const reader = response.body.getReader(), chunks = [];
    let count = 0;
    for (;;) {
      const {value,done} = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > IMAGE_ARTIFACT_MAX_BYTES) {
        await reader.cancel();
        throw new Error('Artifact too large');
      }
      chunks.push(value);
    }
    if (!count) throw new Error('Artifact download failed');
    const bytes = new Uint8Array(count);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const signature = [137,80,78,71,13,10,26,10];
    if (!signature.every((b,i)=>bytes[i]===b)) throw new Error('Artifact format not supported');
    let binary = '';
    for (let i=0;i<bytes.length;i+=16384) {
      binary += String.fromCharCode(...bytes.subarray(i,i+16384));
    }
    return {mediaType:'image/png', bytes:count, dataBase64:btoa(binary)};
  }
  throw new Error('Artifact download failed');
}


export const PROJECTS = Object.freeze({
  'amaraii-os': Object.freeze({
    slug: 'circleci/B65DMdC1ZhAJQM74t7SrZ1/LGszExeHMrkJtuxPVvDpjw',
    definitionId: 'c4c6aad9-03c1-4e9e-99ca-cd650deda730',
    branches: ['codex/p2-live-billing-pilot', 'development', 'staging', 'design/amaraii-learn-v1-spec-20261028'],
    modes: Object.freeze({validation: 'run_validation'}),
  }),
  'jayson-storefront': Object.freeze({
    slug: 'circleci/B65DMdC1ZhAJQM74t7SrZ1/CRNFjZzLKeZdypYW5EWkyL',
    definitionId: 'b5a41026-8298-4976-956b-49fbca6de695',
    branches: ['feat/storefront-demo'],
    releaseParameter: 'run_preview_release',
    modes: Object.freeze({
      validation: 'run_validation',
      preview_qa: 'run_preview_qa',
    }),
  }),
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function hasOnlyKeys(value, keys) {
  return Object.keys(value).every(key => keys.includes(key));
}

export function validateCommand(command, keyId, now = Date.now()) {
  if (!isPlainObject(command) ||
      !hasOnlyKeys(command, ['v','id','action','project','branch','mode','commitSha','pipelineId','startNumber','jobNumber','jobId','artifactPath','requestedAt','approved'])) {
    throw new Error('Invalid command shape');
  }
  if (command.v !== 1 || command.id !== keyId || !UUID.test(command.id)) {
    throw new Error('Invalid request identity');
  }
  if (command.approved !== true) throw new Error('Explicit approval required');
  const created = Date.parse(command.requestedAt);
  if (!Number.isFinite(created) || created > now + 120000 || now - created > MAX_REQUEST_AGE_MS) {
    throw new Error('Command is expired or clock is invalid');
  }
  const project = PROJECTS[command.project];
  if (!project || !Object.hasOwn(PROJECTS, command.project)) throw new Error('Project not permitted');
  if (command.action === 'health') {
    if (command.branch !== undefined || command.mode !== undefined || command.pipelineId !== undefined) {
      throw new Error('Health command has unexpected fields');
    }
    return { command, project };
  }
  if (command.action === 'trigger') {
    if (typeof command.branch !== 'string' || !project.branches.includes(command.branch)) throw new Error('Branch not permitted');
    if (typeof command.mode !== 'string' || !Object.hasOwn(project.modes, command.mode)) throw new Error('Pipeline mode not permitted');
    if (command.pipelineId !== undefined) throw new Error('Trigger does not accept pipelineId');
    return { command, project };
  }
  if (command.action === 'release') {
    if (!project.releaseParameter) throw new Error('Action not permitted');
    if (typeof command.branch !== 'string' || !project.branches.includes(command.branch)) throw new Error('Branch not permitted');
    if (typeof command.commitSha !== 'string' || !COMMIT_SHA.test(command.commitSha)) throw new Error('Invalid release revision');
    if (command.mode !== undefined || command.pipelineId !== undefined || command.startNumber !== undefined) {
      throw new Error('Release command has unexpected fields');
    }
    return { command, project };
  }
  if (command.action === 'audit') {
    if (!Number.isSafeInteger(command.startNumber) || command.startNumber < 1 || command.startNumber > 999999) throw new Error('Invalid starting pipeline number');
    if (command.branch !== undefined || command.mode !== undefined || command.pipelineId !== undefined) throw new Error('Audit command has unexpected fields');
    return { command, project };
  }
  if (command.action === 'probe') {
    if (command.branch !== undefined || command.mode !== undefined || command.pipelineId !== undefined) throw new Error('Probe command has unexpected fields');
    return { command, project };
  }
  if (command.action === 'recent') {
    if (typeof command.branch !== 'string' || !project.branches.includes(command.branch)) throw new Error('Branch not permitted');
    if (command.mode !== undefined || command.pipelineId !== undefined) throw new Error('Recent command has unexpected fields');
    return { command, project };
  }
  if (command.action === 'artifact_preview') {
    if (command.project !== 'amaraii-os' || !Number.isSafeInteger(command.jobNumber) ||
        command.jobNumber < 1 || command.jobNumber > 999999 ||
        typeof command.jobId !== 'string' || !UUID.test(command.jobId) ||
        typeof command.pipelineId !== 'string' || !UUID.test(command.pipelineId) ||
        typeof command.artifactPath !== 'string' || command.artifactPath.length > 240 ||
        !NEN_QA_IMAGE.test(command.artifactPath) || command.artifactPath.includes('..') ||
        command.branch !== undefined || command.mode !== undefined || command.commitSha !== undefined ||
        command.startNumber !== undefined) {
      throw new Error('Artifact preview not permitted');
    }
    return {command,project};
  }
  if (command.action === 'job_steps') {
    if (!Number.isSafeInteger(command.jobNumber) || command.jobNumber < 1 || command.jobNumber > 999999) throw new Error('Invalid job number');
    if (typeof command.jobId !== 'string' || !UUID.test(command.jobId) ||
        typeof command.pipelineId !== 'string' || !UUID.test(command.pipelineId)) throw new Error('Invalid job identity');
    if (command.branch !== undefined || command.mode !== undefined || command.commitSha !== undefined || command.startNumber !== undefined) {
      throw new Error('Job steps have unexpected fields');
    }
    return { command, project };
  }
  if (command.action === 'job') {
    if (!Number.isSafeInteger(command.jobNumber) || command.jobNumber < 1 || command.jobNumber > 999999) throw new Error('Invalid job number');
    if (command.branch !== undefined || command.mode !== undefined || command.pipelineId !== undefined ||
        command.commitSha !== undefined || command.startNumber !== undefined) throw new Error('Job inspection has unexpected fields');
    return { command, project };
  }
  if (command.action === 'inspect') {
    if (typeof command.pipelineId !== 'string' || !UUID.test(command.pipelineId)) throw new Error('Invalid pipelineId');
    if (command.branch !== undefined || command.mode !== undefined) throw new Error('Inspect has unexpected fields');
    return { command, project };
  }
  throw new Error('Action not permitted');
}

async function circleRequest(env, path, body, requestFn = fetch) {
  if (!env.CIRCLE_TOKEN || typeof env.CIRCLE_TOKEN !== 'string') {
    throw new Error('CircleCI token not configured');
  }
  const res = await requestFn(API + path, {
    method: body ? 'POST' : 'GET',
    redirect: 'manual',
    headers: {
      'Circle-Token': env.CIRCLE_TOKEN,
      'Accept': 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error('CircleCI API HTTP ' + res.status);
  return res.json();
}

async function circleV3Request(env, path, requestFn = fetch) {
  if (!env.CIRCLE_TOKEN || typeof env.CIRCLE_TOKEN !== 'string') throw new Error('CircleCI token not configured');
  const res = await requestFn('https://circleci.com/api/v3' + path, {
    method:'GET', redirect:'manual',
    headers:{ Authorization: 'Bearer ' + env.CIRCLE_TOKEN, Accept:'application/json' },
  });
  if (!res.ok) throw new Error('CircleCI v3 HTTP ' + res.status);
  return res.json();
}

export async function executeCommand(env, command, project, requestFn = fetch) {
  if (command.action === 'health') {
    return {
      bridge: 'nen-ci-kv-bridge',
      version: 1,
      project: command.project,
      tokenConfigured: typeof env.CIRCLE_TOKEN === 'string' && env.CIRCLE_TOKEN.length > 0,
      availableModes: Object.keys(project.modes),
      allowedBranches: project.branches,
    };
  }
  if (command.action === 'trigger') {
    const body = {
      definition_id: project.definitionId,
      config: { branch: command.branch },
      checkout: { branch: command.branch },
      parameters: { [project.modes[command.mode]]: true },
    };
    const data = await circleRequest(env, '/project/' + project.slug + '/pipeline/run', body, requestFn);
    if (!UUID.test(data.id || '')) throw new Error('CircleCI response missing pipeline ID');
    return { pipelineId: data.id, number: data.number ?? null, state: data.state ?? null, branch: command.branch, mode: command.mode };
  }
  if (command.action === 'release') {
    if (!project.releaseParameter) throw new Error('Action not permitted');
    // A separate explicitly approved command: standard trigger cannot deploy.
    // CircleCI must gate deployment behind an independent QA job and enforce
    // an exact Git SHA before a Pages release job can receive its scoped token.
    const body = {
      definition_id: project.definitionId,
      config: { branch: command.branch },
      checkout: { branch: command.branch },
      parameters: {
        [project.releaseParameter]: true,
        release_sha: command.commitSha,
      },
    };
    const data = await circleRequest(env, '/project/' + project.slug + '/pipeline/run', body, requestFn);
    if (!UUID.test(data.id || '')) throw new Error('CircleCI response missing pipeline ID');
    return {
      pipelineId: data.id,
      number: data.number ?? null,
      state: data.state ?? null,
      branch: command.branch,
      revision: command.commitSha,
      mode: 'preview_release',
    };
  }
  if (command.action === 'probe') {
    // Public, unauthenticated egress checks. Never attach a CircleCI token.
    // Redirects are not followed so HTTP 3xx cannot leave the chosen host.
    const targets = [
      ['circleci', 'https://circleci.com/api/v2/user'],
      ['github', 'https://api.github.com/'],
    ];
    const checks = [];
    for (const [service, url] of targets) {
      try {
        const response = await requestFn(url, { method: 'GET', redirect: 'manual', headers: { Accept: 'application/json' } });
        checks.push({ service, httpStatus: response.status });
      } catch (error) {
        const text = error instanceof Error ? error.message.toLowerCase() : '';
        const category = text.includes('redirect') ? 'redirect_error'
          : text.includes('network') || text.includes('fetch') ? 'fetch_error'
          : text.includes('tls') || text.includes('certificate') ? 'tls_error'
          : text.includes('host') || text.includes('dns') ? 'resolution_error'
          : 'transport_error';
        checks.push({ service, category });
      }
    }
    return { checks };
  }
  if (command.action === 'audit') {
    const checked = [];
    for (let number = command.startNumber; number < command.startNumber + 5; number++) {
      let pipeline;
      try {
        pipeline = await circleRequest(env, '/project/' + project.slug + '/pipeline/' + number, undefined, requestFn);
      } catch (error) {
        if (error instanceof Error && error.message === 'CircleCI API HTTP 404') {
          checked.push({ number, found: false });
          break;
        }
        throw error;
      }
      if (pipeline.project_slug !== project.slug) throw new Error('Pipeline project mismatch');
      checked.push({ number, found: true, id: pipeline.id, state: pipeline.state, branch: pipeline.vcs?.branch, createdAt: pipeline.created_at });
    }
    return { project: command.project, checked };
  }
  if (command.action === 'recent') {
    const recent = await circleRequest(env, '/project/' + project.slug + '/pipeline?branch=' + encodeURIComponent(command.branch), undefined, requestFn);
    return {
      project: command.project, branch: command.branch,
      pipelines: (recent.items || []).filter(p => p.project_slug === project.slug && p.vcs?.branch === command.branch).slice(0, 10)
        .map(p => ({ id: p.id, number: p.number, state: p.state, createdAt: p.created_at, revision: p.vcs?.revision, errors: (p.errors || []).slice(0,3).map(e=>({type:e.type})) })),
    };
  }
  if (command.action === 'artifact_preview') {
    const pipeline = await circleRequest(env,'/pipeline/'+command.pipelineId,undefined,requestFn);
    if (pipeline.project_slug !== project.slug) throw new Error('Pipeline project mismatch');
    const workflows = await circleRequest(env,'/pipeline/'+command.pipelineId+'/workflow',undefined,requestFn);
    let owned = false;
    for (const workflow of (workflows.items || []).slice(0,8)) {
      const jobs = await circleRequest(env,'/workflow/'+workflow.id+'/job',undefined,requestFn);
      if ((jobs.items || []).some(job=>job.id===command.jobId &&
          job.job_number===command.jobNumber && job.project_slug===project.slug)) {
        owned = true;
        break;
      }
    }
    if (!owned) throw new Error('Job does not belong to approved pipeline');
    let token, found = null;
    for (let page=0;page<5;page++) {
      const path='/project/'+project.slug+'/'+command.jobNumber+'/artifacts'+
        (token?'?page-token='+encodeURIComponent(token):'');
      const list=await circleRequest(env,path,undefined,requestFn);
      found=(list.items||[]).find(item=>item.path===command.artifactPath);
      if (found) break;
      token=typeof list.next_page_token==='string'&&list.next_page_token.length<500?
        list.next_page_token:null;
      if (!token) break;
    }
    if (!found || typeof found.url!=='string') throw new Error('Artifact not found');
    const preview=await downloadQaImage(env,found.url,requestFn);
    // The URL (which can be short-lived or signed) must never be returned.
    return {path:command.artifactPath,jobNumber:command.jobNumber,...preview};
  }
  if (command.action === 'job_steps') {
    // Check both pipeline and workflow ownership before requesting v3 job data.
    const pipeline = await circleRequest(env,'/pipeline/' + command.pipelineId,undefined,requestFn);
    if (pipeline.project_slug !== project.slug) throw new Error('Pipeline project mismatch');
    const flows = await circleRequest(env,'/pipeline/' + command.pipelineId + '/workflow',undefined,requestFn);
    let found = false;
    for (const flow of (flows.items || []).slice(0,8)) {
      const workflowJobs = await circleRequest(env,'/workflow/' + flow.id + '/job',undefined,requestFn);
      if ((workflowJobs.items || []).some(j => j.id === command.jobId &&
          j.job_number === command.jobNumber && j.project_slug === project.slug)) {
        found = true; break;
      }
    }
    if (!found) throw new Error('Job does not belong to approved pipeline');
    const response = await circleV3Request(env,'/jobs/' + command.jobId,requestFn);
    // API v3 wraps single resources in {data:{id,attributes,references}}.
    const job = isPlainObject(response?.data) ? response.data : response;
    if (job?.id !== command.jobId) throw new Error('Job identity mismatch');
    const attrs = isPlainObject(job.attributes) ? job.attributes : job;
    const rawExecutions = attrs.parallel_executions ?? attrs.executions ?? job.executions ?? [];
    const failedSteps = (Array.isArray(rawExecutions) ? rawExecutions : []).flatMap((entry, idx)=>{
      const e=isPlainObject(entry?.attributes)?entry.attributes:entry;
      const index=Number.isSafeInteger(e.index)?e.index:idx;
      return (Array.isArray(e.steps)?e.steps:[]).map(original=>{
        const step=isPlainObject(original?.attributes)?original.attributes:original;
        return {index,step};
      });
    }).filter(x=>x.step?.outcome==='failed' || x.step?.exit_code>0);
    let failedStepDiagnostic = null;
    const failed = failedSteps.find(x=> Number.isSafeInteger(x.step?.num) &&
      x.step.num >= 0 && x.step.num < 10000 && x.index >= 0 && x.index < 8);
    if (failed) {
      // Condensed stdout is examined in-worker only. Do not return raw
      // untrusted console output, URLs, secrets or arbitrary messages.
      try {
        const u='https://circleci.com/api/v3/jobs/' + command.jobId +
          '/stdout/condensed?filter%5Bexecution%5D=' + failed.index +
          '&filter%5Bstep_num%5D=' + failed.step.num;
        const out=await requestFn(u,{
          method:'GET',redirect:'manual',
          headers:{Authorization:'Bearer ' + env.CIRCLE_TOKEN,Accept:'text/plain'},
        });
        const raw=out.ok?(await out.text()).slice(0,50000):'';
        failedStepDiagnostic={
          stepNumber:failed.step.num,
          httpStatus:out.status,
          missingDeploymentToken:raw.includes('Cloudflare Pages token missing from restricted CircleCI context'),
          revisionMismatch:raw.includes('revision mismatch') || raw.includes('Expected release SHA does not match'),
          missingArtifact:raw.includes('missing release artifact') || raw.includes('No such file or directory'),
          permissionDenied:raw.includes('permission denied') || raw.includes('Permission denied'),
          typescriptErrors: command.project === 'amaraii-os'
            ? (raw.match(/[^\r\n]*error TS[0-9]{4}:[^\r\n]*/g) || [])
                .slice(0,16).map(line => line.replace(/\x1b\[[0-9;]*m/g,'')
                  .replace(/sk_(?:live|test)_[A-Za-z0-9]+/g,'[REDACTED]').slice(0,240))
            : [],
          outputAvailable:raw.length>0,
        };
      } catch { failedStepDiagnostic={stepNumber:failed.step.num,available:false}; }
    }
    return {
      jobId: command.jobId,
      jobNumber: command.jobNumber,
      failedStepDiagnostic,
      status: typeof attrs.status === 'string' ? attrs.status.slice(0,50) :
        typeof attrs.outcome === 'string' ? attrs.outcome.slice(0,50) : null,
      attributeKeys: Object.keys(attrs).filter(k=>['name','type','phase','outcome','parallel_executions','executions','steps','started_at','ended_at'].includes(k)),
      executions: (Array.isArray(rawExecutions)?rawExecutions:[]).slice(0,4).map(entry=>{
        const e = isPlainObject(entry?.attributes) ? entry.attributes : entry;
        return {
          index:Number.isSafeInteger(e.index)?e.index:null,
          steps:(Array.isArray(e.steps)?e.steps:[]).slice(0,60).map(original=>{
            const step = isPlainObject(original?.attributes) ? original.attributes : original;
            return {
              name:typeof step.name==='string'?step.name.slice(0,110):'',
              type:typeof step.type==='string'?step.type.slice(0,40):'',
              status:typeof step.status==='string'?step.status.slice(0,50):'',
              outcome:typeof step.outcome==='string'?step.outcome.slice(0,50):undefined,
              exitCode:Number.isSafeInteger(step.exit_code)?step.exit_code:null,
              stepNumber:Number.isSafeInteger(step.num)?step.num:null,
            };
          }),
        };
      }),
    };
  }
  if (command.action === 'job') {
    // Read-only diagnostics; never fetch job stdout/stderr or expose secrets.
    const details = await circleRequest(env, '/project/' + project.slug + '/job/' + command.jobNumber, undefined, requestFn);
    const returnedSlug = details.project?.slug || details.project_slug;
    if (returnedSlug && returnedSlug !== project.slug) throw new Error('Job project mismatch');
    // New CircleCI job endpoint provides executions[].steps[] without
    // requiring access to raw terminal output or presigned log URLs.
    let executions = [];
    let stepMetadataUnavailable = false;
    if (typeof details.id === 'string' && UUID.test(details.id)) {
      try {
        const modern = await circleRequest(env, '/jobs/' + details.id, undefined, requestFn);
        if (modern.id !== details.id) throw new Error('Job identity mismatch');
        executions = (Array.isArray(modern.executions) ? modern.executions : []).slice(0, 4)
          .map(execution => ({
            index: Number.isSafeInteger(execution.index) ? execution.index : null,
            steps: (Array.isArray(execution.steps) ? execution.steps : []).slice(0, 50)
              .map(step => ({
                name: typeof step.name === 'string' ? step.name.slice(0, 120) : '',
                type: typeof step.type === 'string' ? step.type.slice(0, 40) : '',
                status: typeof step.status === 'string' ? step.status.slice(0, 40) : '',
                exitCode: Number.isSafeInteger(step.exit_code) ? step.exit_code : null,
              })),
          }));
      } catch (e) { stepMetadataUnavailable = true; }
    } else { stepMetadataUnavailable = true; }
    const steps = Array.isArray(details.steps) ? details.steps.slice(0, 40).map(s => ({
      name: String(s.name || '').slice(0, 110),
      status: String(s.status || '').slice(0, 40),
      actions: Array.isArray(s.actions) ? s.actions.slice(0, 3).map(a => ({
        status: String(a.status || '').slice(0, 40),
        exitCode: Number.isSafeInteger(a.exit_code) ? a.exit_code : null,
      })) : [],
    })) : [];
    // A CircleCI v2 job details response can differ by VCS provider.
    // Return only vetted metadata and field presence; never response bodies.
    return {
      project: command.project,
      jobNumber: command.jobNumber,
      name: details.name || null,
      status: details.status || null,
      startedAt: details.started_at || null,
      stoppedAt: details.stopped_at || null,
      detailKeys: Object.keys(details).filter(k => ['steps','contexts','project','project_slug','status','name','executor','workflows','latest_workflow','errors','duration','parallelism'].includes(k)),
      steps,
      executions,
      stepMetadataUnavailable,
      contexts: Array.isArray(details.contexts) ? details.contexts.slice(0,5).map(c => ({name: typeof c?.name === 'string' ? c.name.slice(0,80) : null})) : undefined,
    };
  }
  if (command.action === 'inspect') {
    const pipeline = await circleRequest(env, '/pipeline/' + command.pipelineId, undefined, requestFn);
    if (pipeline.project_slug !== project.slug) throw new Error('Pipeline project mismatch');
    const flowData = await circleRequest(env, '/pipeline/' + command.pipelineId + '/workflow', undefined, requestFn);
    const flows = [];
    for (const flow of (flowData.items || []).slice(0, 8)) {
      const jobsData = await circleRequest(env, '/workflow/' + flow.id + '/job', undefined, requestFn);
      const jobs = [];
      for (const job of (jobsData.items || []).slice(0, 15)) {
        const summary = { id: job.id, name: job.name, status: job.status, jobNumber: job.job_number };
        if (job.job_number && job.status && ['success','failed','failing','error'].includes(job.status)) {
          try {
            const artifacts = await circleRequest(env, '/project/' + project.slug + '/' + job.job_number + '/artifacts', undefined, requestFn);
            summary.artifacts = (artifacts.items || []).slice(0, 40).map(a => ({ path: a.path, url: a.url }));
          } catch { summary.artifactsUnavailable = true; }
        }
        jobs.push(summary);
      }
      flows.push({ id: flow.id, name: flow.name, status: flow.status, jobs });
    }
    return { pipelineId: command.pipelineId, state: pipeline.state, number: pipeline.number, vcs: { branch: pipeline.vcs?.branch, revision: pipeline.vcs?.revision }, workflows: flows };
  }
  throw new Error('Unsupported action');
}

/**
 * At-most-once best-effort processing: record a claim BEFORE the external
 * API call and never automatically replay an uncertain result. KV is
 * eventually consistent, so use one queue consumer and one request at a time.
 * There is no exactly-once transactional guarantee.
 */
export async function processOne(env, now = Date.now(), requestFn = fetch) {
  if (!env.QUEUE) throw new Error('QUEUE KV binding is required');
  const listing = await env.QUEUE.list({ prefix: PREFIX, limit: 1 });
  const item = listing.keys?.[0];
  if (!item) return { empty: true };

  const raw = await env.QUEUE.get(item.name);
  return processRequest(env, item.name.slice(PREFIX.length), raw, now, requestFn, item.name);
}

export async function processRequest(env, id, raw, now = Date.now(), requestFn = fetch, legacyKey) {
  if (!env.QUEUE) throw new Error('QUEUE KV binding is required');
  const cleanup = async () => { if (legacyKey) await env.QUEUE.delete(legacyKey); };
  const resultKey = RESULT_PREFIX + id;
  const claimKey = CLAIM_PREFIX + id;
  if (!UUID.test(id)) {
    await cleanup();
    return { rejected: 'malformed-key' };
  }

  const prior = await env.QUEUE.get(resultKey) || await env.QUEUE.get(claimKey);
  if (prior) {
    await cleanup();
    return { skipped: true, id };
  }

  const timestamp = new Date(now).toISOString();
  let command;
  try {
    if (!raw || raw.length > 4096) throw new Error('Invalid or oversized command');
    command = JSON.parse(raw);
    const validated = validateCommand(command, id, now);
    // A distinct claim key avoids KV's one-write-per-second per-key limit.
    await env.QUEUE.put(claimKey, JSON.stringify({ id, status:'claimed', action:command.action, updatedAt:timestamp }), { expirationTtl: RESULT_TTL_SECONDS });
    await cleanup();
    const outcome = await executeCommand(env, command, validated.project, requestFn);
    const result = { id, status:'success', action:command.action, updatedAt:new Date().toISOString(), outcome };
    await env.QUEUE.put(resultKey, JSON.stringify(result), { expirationTtl: RESULT_TTL_SECONDS });
    return result;
  } catch (err) {
    // Never record bearer credentials, input payloads, response bodies or stack traces.
    const message = err instanceof Error ? err.message : 'Unknown bridge error';
    const safe = [
      'Invalid command shape', 'Invalid request identity', 'Explicit approval required',
      'Command is expired or clock is invalid', 'Project not permitted',
      'Branch not permitted', 'Pipeline mode not permitted', 'Invalid pipelineId',
      'Action not permitted', 'Health command has unexpected fields',
      'Trigger does not accept pipelineId', 'Inspect has unexpected fields',
      'Invalid or oversized command', 'CircleCI token not configured',
      'CircleCI response missing pipeline ID', 'Unsupported action',
      'Pipeline project mismatch', 'Recent command has unexpected fields', 'Probe command has unexpected fields', 'Audit command has unexpected fields', 'Invalid starting pipeline number',
      'Invalid release revision', 'Release command has unexpected fields', 'Invalid job number', 'Job inspection has unexpected fields', 'Job project mismatch',
      'Invalid job identity', 'Job steps have unexpected fields', 'Job does not belong to approved pipeline', 'Job identity mismatch',
      'Artifact preview not permitted', 'Artifact not found', 'Artifact too large', 'Artifact format not supported', 'Artifact download failed', 'Unsafe artifact URL',
    ];
    // Only expose typed failure categories: never emit raw upstream messages,
    // tokens, request payloads, stack traces or URLs.
    const error = safe.includes(message) || /^CircleCI API HTTP [0-9]{3}$/.test(message) ||
      /^Unsafe artifact URL: [a-z0-9.-]{1,253}$/.test(message) ? message
      : err instanceof SyntaxError ? 'Invalid JSON response or command'
      : /^CircleCI v3 HTTP [0-9]{3}$/.test(message) ? message
      : err instanceof TypeError ? 'Network or API transport failure'
      : 'Bridge request failed';
    const result = { id, status:'error', action:command?.action ?? 'unknown', updatedAt:new Date().toISOString(), error };
    await env.QUEUE.put(resultKey, JSON.stringify(result), { expirationTtl: RESULT_TTL_SECONDS });
    await cleanup();
    return result;
  }
}

export default {
  // Never expose a remotely callable command endpoint, even if a Worker
  // route or workers.dev setting is accidentally enabled.
  fetch() {
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        // Cloudflare authenticates the producer API. The body is still untrusted.
        const raw = JSON.stringify(message.body);
        const id = message.body?.id;
        if (typeof id !== 'string' || !UUID.test(id)) continue;
        await processRequest(env, id, raw, Date.now());
      } finally {
        // Never replay a potentially paid trigger after an ambiguous failure.
        // Consumer max_retries=0 also covers an invocation terminating abruptly.
        message.ack();
      }
    }
  },
};
