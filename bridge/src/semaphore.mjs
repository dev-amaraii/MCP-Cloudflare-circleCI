/**
 * Explicit, validation-only Semaphore adapter for Amaraii.
 * This never receives caller-supplied URLs, project IDs or YAML paths.
 * The pilot is intentionally pinned to the CI feature branch until PR #95
 * is merged and verified; there is no automatic billable failover.
 */
const API = 'https://amaraii.semaphoreci.com/api/v1alpha';
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SHA = /^[a-f0-9]{40}$/;
const PR109_BRANCH = 'feat/gym-historical-service-review-20261112';
const PR109_SHA = '43690eef91cf5fa1e35bee7257312c2cb2586f48';
const PR110_BRANCH = 'feat/gym-historical-reconciliation-integration-20261113';
const PR110_SHA = '48bbd49b702bdd560dd97b6ce5a83bdf009af0d0';
export const SEMAPHORE_BRANCHES = Object.freeze(['ci/semaphore-validation-20261106','development',PR109_BRANCH,PR110_BRANCH]);
export const PR110_DIAGNOSTIC=Object.freeze({
  branch: PR110_BRANCH,
  sha: PR110_SHA,
  pipelineId: '0681f323-34b8-413f-9672-742123060e6b',
  jobId: '7418b830-a9fb-4701-9a11-1a262fdfbd40'
});
function safeDirective(value) {
  if (typeof value !== 'string') return 'unnamed';
  if (/pnpm typecheck/.test(value))return 'typecheck';
  if (/pnpm --filter @amaraii\/api test/.test(value))return 'api tests';
  if (/pnpm exec vitest run test\/p2-clarification/.test(value))return 'p2 database tests';
  if (/pnpm exec vitest/.test(value))return 'focused tests';
  if (/pnpm --filter @amaraii\/api docs:generate/.test(value))return 'OpenAPI generation';
  if (/pnpm build/.test(value))return 'build';
  if (/pnpm qa:intel/.test(value))return 'QA-Intel';
  if (/pnpm exec playwright/.test(value))return 'browser setup';
  if (/pnpm install/.test(value))return 'frozen dependency installation';
  if (/artifact push/.test(value))return 'artifact upload';
  if (/^printf|SEMAPHORE_JOB_RESULT|SEMAPHORE_GIT_WORKING_BRANCH/.test(value))return 'reporting epilogue';
  if (/docker/.test(value))return 'disposable database setup';
  return 'other';
}


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

export async function executeSemaphore(env, command, requestFn = fetch) {
  if (command.action === 'pr110_diagnostics') {
    const id=projectId(env);
    const expected=PR110_DIAGNOSTIC;
    if (command.pipelineId !== expected.pipelineId || command.jobId !== expected.jobId)
      throw new Error('PR110 diagnostic scope not permitted');
    const basic=await semaphoreRequest(env,'/pipelines/'+expected.pipelineId,undefined,requestFn);
    const p=basic.pipeline;
    if (!p || p.project_id!==id || p.ppl_id!==expected.pipelineId ||
        p.branch_name!==expected.branch || p.commit_sha!==expected.sha)
      throw new Error('PR110 pipeline ownership mismatch');
    const detail=await semaphoreRequest(env,'/pipelines/'+expected.pipelineId+'?detailed=true',undefined,requestFn);
    if (!detail.pipeline || (detail.pipeline.project_id && detail.pipeline.project_id!==id) ||
      !(Array.isArray(detail.blocks) && detail.blocks.some(b=>
        Array.isArray(b.jobs) && b.jobs.some(j=>j.job_id===expected.jobId &&
          j.result?.toLowerCase()==='failed'))))
      throw new Error('PR110 job ownership mismatch');
    const log=await semaphoreRequest(env,'/logs/'+expected.jobId,undefined,requestFn);
    if (!Array.isArray(log.events) || log.events.length>30000)
      throw new Error('Invalid or excessive PR110 diagnostic log');
    const commands=[];
    const outputs={};
    for (const event of log.events) {
      if (event.event==='cmd_finished') {
        const exitCode=Number.isSafeInteger(event.exit_code)?event.exit_code:null;
        commands.push({ordinal:commands.length+1,category:safeDirective(event.directive),
          exitCode,failed:exitCode!==null && exitCode!==0});
      } else if (event.event==='cmd_output' && typeof event.output==='string') {
        // Count categories, never retain or return output bytes, URLs or secrets.
        const s=event.output.slice(0,32768);
        for (const [label,regex] of [
          ['typescript',/error TS[0-9]+/],['unit',/Failed Tests|FAIL /],
          ['openapi',/OpenAPI|generated-openapi/],['database',/migration|PostgreSQL/],
          ['browser',/playwright|chromium/],['qa',/qa.intel/i],
        ]) if(regex.test(s)) outputs[label]=(outputs[label]||0)+1;
      }
    }
    return {action:'pr110_diagnostics',pipelineId:expected.pipelineId,
      revision:expected.sha,jobId:expected.jobId,
      commands:commands.slice(-180),eventCount:log.events.length,
      signalCounts:outputs,rawLogsReturned:false};
  }
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
    if (command.branch === PR109_BRANCH && command.commitSha !== PR109_SHA)
      throw new Error('PR109 validation revision not permitted');
    if (command.branch === PR110_BRANCH && command.commitSha !== PR110_SHA)
      throw new Error('PR110 validation revision not permitted');
    const response = await semaphoreRequest(env, '/plumber-workflows', {
      project_id:id,
      reference:'refs/heads/' + command.branch,
      commit_sha:command.commitSha,
      pipeline_file:'.semaphore/semaphore.yml',
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
    return {
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
