/**
 * Explicit, validation-only Semaphore adapter for Amaraii.
 * This never receives caller-supplied URLs, project IDs or YAML paths.
 * A small, explicit branch-to-pipeline allowlist prevents arbitrary CI YAML
 * execution. No automatic billable failover or deploy access is granted.
 */
const API = 'https://amaraii.semaphoreci.com/api/v1alpha';
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SHA = /^[a-f0-9]{40}$/;
const SEMAPHORE_PIPELINES = Object.freeze({
  'ci/semaphore-validation-20261106': '.semaphore/semaphore.yml',
  development: '.semaphore/semaphore.yml',
  'codex/bar-bill-summary-20261107': '.semaphore/bar-bill-review.yml',
  'codex/bar-bill-staging-live-base-20261108': '.semaphore/bar-bill-review.yml',
  'codex/qa-intel-hosted-observation-20261108': '.semaphore/hosted-observer-review.yml',
  'ci/qa-intel-hosted-auth-20261108': '.semaphore/hosted-auth-observe.yml',
  'codex/qa-intel-full-walkthrough-20261109': '.semaphore/qa-walkthrough-review.yml',
  'ci/qa-intel-walkthrough-survey-20261109': '.semaphore/qa-walkthrough-run.yml',
});
export const SEMAPHORE_BRANCHES = Object.freeze(Object.keys(SEMAPHORE_PIPELINES));

function projectId(env) {
  if (typeof env.SEMAPHORE_PROJECT_ID !== 'string' || !UUID.test(env.SEMAPHORE_PROJECT_ID)) {
    throw new Error('Semaphore project not configured');
  }
  return env.SEMAPHORE_PROJECT_ID;
}

async function semaphoreRequest(env, path, body, requestFn) {
  if (typeof env.SEMAPHORE_TOKEN !== 'string' || !env.SEMAPHORE_TOKEN) {
    throw new Error('Semaphore token not configured');
  }
  const res = await requestFn(API + path, {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'manual',
    headers: {
      Authorization: 'Token ' + env.SEMAPHORE_TOKEN,
      Accept: 'application/json',
      'User-Agent': 'SemaphoreCI v2.0 Client',
      ...(body === undefined ? {} : {'Content-Type':'application/json'}),
    },
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  });
  if (!res.ok) throw new Error('Semaphore API HTTP ' + res.status);
  const data = await res.json();
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid Semaphore response');
  }
  return data;
}

function safeValue(value, allowed) {
  return typeof value === 'string' && allowed.includes(value.toLowerCase())
    ? value.toLowerCase() : null;
}

// Only a bounded subset of failed job output is returned to the private bridge.
// Do not expose full logs, environment dumps, URLs, credentials or artifact links.
function failureSummary(payload) {
  const events=Array.isArray(payload.events)?payload.events.slice(0,6000):[];
  let current=null,lastFailure=null;
  for(const event of events){
    if(!event||typeof event!=='object')continue;
    if(event.event==='cmd_started') current={command:typeof event.directive==='string'?event.directive.slice(0,160):'',output:''};
    if(event.event==='cmd_output'&&current&&typeof event.output==='string'){
      current.output=(current.output+event.output.slice(0,4000)).slice(-64000);
    }
    if(event.event==='cmd_finished'&&current){
      if(Number.isInteger(event.exit_code)&&event.exit_code!==0){
        lastFailure={command:current.command,exitCode:event.exit_code,output:current.output};
      }
      current=null;
    }
  }
  if(!lastFailure)return null;
  const scrub=s=>s.replace(/\bAuthorization\s*:\s*(?:Bearer|Token)\s+\S+/gi,'Authorization: [redacted]')
    .replace(/\b(?:Bearer|Token)\s+\S+/gi,'[redacted]')
    .replace(/\b(?:SEMAPHORE_TOKEN|CIRCLE_TOKEN|API_KEY|PASSWORD|SECRET|TOKEN)\s*[:=]\s*\S+/gi,'[redacted]')
    .replace(/(?:https?|postgres(?:ql)?):\/\/\S+/gi,'[url]')
    .replace(/\b(?:Authorization|Bearer|Token|Password|Secret|ApiKey)\s*(?:[:=]|\s)\s*[^\s]+/gi,'[redacted]')
    .replace(/\b(?:ghp_|github_pat_|sk-|semaphore_)[A-Za-z0-9_-]+/gi,'[redacted]')
    .slice(0,800);
  const lines=lastFailure.output.split(/\r?\n/).filter(Boolean);
  const focus=lines.filter(line=>/BAR_TABS_OVERFLOW|BAR_TABS_(?:QA|OPEN_RETRY)_STAGE|BAR_TAB_SETTLEMENT_QA_STAGE/i.test(line));
  const relevant=lines.filter(line=>/\berror\b|ERR_|fail|cannot |not found|missing|ENOENT|TS\d+|assert|expected|denied|invalid|EACCES|SyntaxError|TypeError|\bfatal\b/i.test(line));
  return {failedCommand:scrub(lastFailure.command),exitCode:lastFailure.exitCode,
    diagnosticLines:[...new Set([...focus.slice(-6),...(relevant.length?relevant.slice(-18):lines.slice(-6))])].slice(-24).map(scrub)};
}

/**
 * Extract only bounded, non-sensitive QA results from the job's stdout.
 * The underlying logs can contain tokens, URLs and customer data; never return
 * them, and only inspect exact project-owned protected-survey jobs.
 */
function safeQaSurveySummary(logs) {
  const events=Array.isArray(logs?.events)?logs.events.slice(-6000):[];
  const tail=events.filter(e=>e?.event==='cmd_output'&&typeof e.output==='string')
    .map(e=>e.output.slice(0,2500)).join('').slice(-32000);
  for(const line of tail.split(/\r?\n/).slice(-250).reverse()){
    const sample=line.trim();
    if(!sample.startsWith('{"runId":')||sample.length>4000)continue;
    let data;
    try { data=JSON.parse(sample); } catch { continue; }
    const valid=Number.isInteger(data.completed)&&data.completed>=0&&data.completed<=500&&
      Number.isInteger(data.blocked)&&data.blocked>=0&&data.blocked<=500&&
      Number.isInteger(data.findings)&&data.findings>=0&&data.findings<=500;
    if(!UUID.test(data.runId||'')||!valid||
      !['SURVEY_COMPLETED_WITH_VISUAL_FINDINGS_TRACKED','PARTIAL_WITH_BLOCKERS','BLOCKED'].includes(data.outcome))continue;
    const allowedApps=['gymnalysis','bookings','hospitality','games'];
    const allowedReasons=['not-admitted','not-entitled','branch-not-admitted'];
    const skipped=(Array.isArray(data.skippedApps)?data.skippedApps:[]).slice(0,4)
      .filter(x=>allowedApps.includes(x?.app)&&allowedReasons.includes(x?.reason))
      .map(x=>({app:x.app,reason:x.reason}));
    return {runId:data.runId,outcome:data.outcome,
      completed:data.completed,blocked:data.blocked,findings:data.findings,
      skippedApps:skipped};
  }
  return null;
}

export async function executeSemaphore(env, command, requestFn = fetch) {
  if (command.action === 'health') {
    return {
      provider:'semaphore', project:command.project,
      tokenConfigured:typeof env.SEMAPHORE_TOKEN === 'string' && !!env.SEMAPHORE_TOKEN,
      projectConfigured:typeof env.SEMAPHORE_PROJECT_ID === 'string' &&
        UUID.test(env.SEMAPHORE_PROJECT_ID),
      allowedBranches:SEMAPHORE_BRANCHES, availableModes:['validation'],
    };
  }
  const id = projectId(env);
  if (command.action === 'trigger') {
    const response = await semaphoreRequest(env, '/plumber-workflows', {
      project_id:id,
      reference:'refs/heads/' + command.branch,
      commit_sha:command.commitSha,
      pipeline_file:SEMAPHORE_PIPELINES[command.branch],
    }, requestFn);
    if (!UUID.test(response.workflow_id || '') || !UUID.test(response.pipeline_id || '')) {
      throw new Error('Invalid Semaphore response');
    }
    return {provider:'semaphore',workflowId:response.workflow_id,pipelineId:response.pipeline_id,
      branch:command.branch,requestedRevision:command.commitSha,mode:'validation'};
  }
  if (command.action === 'inspect') {
    // First read the minimal response and enforce tenant/project ownership
    // before asking for detailed jobs. No arbitrary job logs or artifact URLs.
    const basic = await semaphoreRequest(env, '/pipelines/' + command.pipelineId,
      undefined, requestFn);
    const pipeline = basic.pipeline;
    if (!pipeline || pipeline.project_id !== id ||
        (pipeline.ppl_id && pipeline.ppl_id !== command.pipelineId)) {
      throw new Error('Semaphore project mismatch');
    }
    const detailed = await semaphoreRequest(env, '/pipelines/' + command.pipelineId +
      '?detailed=true', undefined, requestFn);
    if (!detailed.pipeline || (detailed.pipeline.project_id &&
        detailed.pipeline.project_id !== id) ||
        (detailed.pipeline.wf_id && !UUID.test(detailed.pipeline.wf_id))) {
      throw new Error('Semaphore project mismatch');
    }
    const blocks = (Array.isArray(detailed.blocks) ? detailed.blocks : []).slice(0,12)
      .map(block => ({
        name:typeof block.name === 'string' ? block.name.slice(0,100) : null,
        state:safeValue(block.state,['pending','running','done','stopping','stopped','queued']),
        result:safeValue(block.result,['passed','failed','stopped','canceled','skipped']),
        jobs:(Array.isArray(block.jobs) ? block.jobs : []).slice(0,20).map(job=>({
          id:UUID.test(job.job_id || '') ? job.job_id : null,
          name:typeof job.name === 'string' ? job.name.slice(0,100) : null,
          status:safeValue(job.status,['queued','pending','running','finished','stopped']),
          result:safeValue(job.result,['passed','failed','stopped','canceled','skipped']),
        })),
      }));
    const failed=blocks.flatMap(block=>block.jobs).find(job=>job.id&&job.result==='failed');
    // Survey summaries are read only after the same project/branch ownership
    // validation above. Never return arbitrary job logs or signed artifact URLs.
    const surveyJob=pipeline.branch_name==='ci/qa-intel-walkthrough-survey-20261109'&&
      pipeline.state?.toLowerCase()==='done'?
      blocks.flatMap(block=>block.jobs).find(job=>job.id&&
        job.name==='Authenticated four-viewport survey; preserve findings without UI fixes'&&
        job.status==='finished'):null;
    let survey=null;
    if(surveyJob){
      try { survey=safeQaSurveySummary(await semaphoreRequest(env,'/logs/'+surveyJob.id,undefined,requestFn)); }
      catch { survey=null; }
    }
    let failure=null;
    if(failed) {
      try {
        const logs=await semaphoreRequest(env,'/logs/'+failed.id,undefined,requestFn);
        const summary=failureSummary(logs);
        failure=summary?{jobId:failed.id,...summary}:{jobId:failed.id,diagnostics:'No failed-command output available'};
      } catch {
        failure={jobId:failed.id,diagnostics:'Job diagnostic API unavailable'};
      }
    }
    return {
      ...(failure?{failure}:{}),
      ...(survey?{survey}:{}),
      provider:'semaphore',pipelineId:command.pipelineId,
      workflowId:UUID.test(pipeline.wf_id || '') ? pipeline.wf_id : null,
      project:'amaraii-os',
      state:safeValue(pipeline.state,['pending','running','done','stopping','stopped','queued']),
      result:safeValue(pipeline.result,['passed','failed','stopped','canceled','skipped']),
      vcs:{
        branch:SEMAPHORE_BRANCHES.includes(pipeline.branch_name) ? pipeline.branch_name : null,
        revision:SHA.test(pipeline.commit_sha || '') ? pipeline.commit_sha : null,
      },
      blocks,
    };
  }
  throw new Error('Semaphore action not permitted');
}
