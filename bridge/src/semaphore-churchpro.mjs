/**
 * ChurchPro-only Semaphore adapter. No deployments, arbitrary revisions,
 * caller URLs, user-provided YAML paths, raw logs or signed artifact links.
 * Shares only the pre-existing encrypted SEMAPHORE_TOKEN binding.
 */
const API = 'https://amaraii.semaphoreci.com/api/v1alpha';
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SHA = /^[a-f0-9]{40}$/;
export const CHURCHPRO_SEMAPHORE = Object.freeze({
  branch: 'codex/churchpro-gather-people-cells-integration-20261104',
  pipelineFile: '.semaphore/semaphore.yml',
  project: 'churchpro',
});

function projectId(env) {
  const id = env.SEMAPHORE_PROJECT_ID_CHURCH_PRO;
  if (typeof id !== 'string' || !UUID.test(id)) {
    throw Error('ChurchPro Semaphore project not configured');
  }
  return id;
}

async function semaphoreRequest(env, path, body, requestFn) {
  if (typeof env.SEMAPHORE_TOKEN !== 'string' || !env.SEMAPHORE_TOKEN) {
    throw Error('Semaphore token not configured');
  }
  const response = await requestFn(API + path, {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'manual',
    headers: {
      Authorization: 'Token ' + env.SEMAPHORE_TOKEN,
      Accept: 'application/json',
      'User-Agent': 'SemaphoreCI v2.0 Client',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw Error('ChurchPro Semaphore API HTTP ' + response.status);
  const data = await response.json();
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw Error('Invalid ChurchPro Semaphore response');
  }
  return data;
}

function enumValue(value, allowed) {
  return typeof value === 'string' && allowed.includes(value.toLowerCase())
    ? value.toLowerCase() : null;
}

function checkedPipeline(response, expectedId) {
  const pipeline = response?.pipeline;
  if (!pipeline || pipeline.project_id !== expectedId ||
      pipeline.branch_name !== CHURCHPRO_SEMAPHORE.branch ||
      (pipeline.ppl_id !== undefined && !UUID.test(pipeline.ppl_id))) {
    throw Error('ChurchPro Semaphore pipeline ownership mismatch');
  }
  return pipeline;
}

// Semaphore logs are untrusted and can contain secret-bearing stdout.
// Return only short diagnostic patterns, never raw events or signed links.
function failureSummary(payload) {
  const events = Array.isArray(payload?.events) ? payload.events.slice(0, 4000) : [];
  let current = null;
  let lastFailure = null;
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    if (event.event === 'cmd_started') {
      current = {
        command: typeof event.directive === 'string' ? event.directive.slice(0, 120) : '',
        output: '',
      };
    } else if (event.event === 'cmd_output' && current && typeof event.output === 'string') {
      current.output = (current.output + event.output.slice(0, 2000)).slice(-16000);
    } else if (event.event === 'cmd_finished' && current) {
      if (Number.isInteger(event.exit_code) && event.exit_code !== 0) {
        lastFailure = { ...current, exitCode: event.exit_code };
      }
      current = null;
    }
  }
  if (!lastFailure) return null;
  const redact = (value) => value
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b(?:Bearer|Token|Authorization)\s*[:=]?\s*\S+/gi, '[redacted]')
    .replace(/\b(?:sk-|ghp_|github_pat_|semaphore_)[A-Za-z0-9_-]+/gi, '[redacted]')
    .replace(/\b[A-Za-z0-9+/_=-]{32,}\b/g, '[redacted]')
    .slice(0, 180);
  const lines = lastFailure.output.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)
    .filter(line => /(?:\berror\b|\bwarning\b|ERR_|failed|failure|not found|not installed|command not found|TS\d{4}|TypeError|SyntaxError|AssertionError|cannot |denied|invalid |unsupported |malformed|✖)/i.test(line))
    .filter(line => !/(?:API[_-]?KEY|SECRET|PASSWORD|TOKEN|AUTHORIZATION|PRIVATE[_-]?KEY)\s*[:=]/i.test(line))
    .slice(-10).map(redact);
  return {
    command: redact(lastFailure.command),
    exitCode: lastFailure.exitCode,
    diagnosticLines: [...new Set(lines)],
  };
}

/** A private Queue caller must use explicit, validated project + action. */
export async function executeSemaphoreChurchPro(env, command, requestFn = fetch) {
  if (command.project !== CHURCHPRO_SEMAPHORE.project || command.provider !== 'semaphore') {
    throw Error('ChurchPro Semaphore routing mismatch');
  }
  if (command.action === 'health') {
    return {
      provider: 'semaphore',
      project: CHURCHPRO_SEMAPHORE.project,
      tokenConfigured: typeof env.SEMAPHORE_TOKEN === 'string' && !!env.SEMAPHORE_TOKEN,
      projectConfigured: UUID.test(env.SEMAPHORE_PROJECT_ID_CHURCH_PRO ?? ''),
      allowedBranches: [CHURCHPRO_SEMAPHORE.branch],
      availableModes: ['validation'],
      allowedActions: ['health', 'trigger', 'inspect'],
    };
  }
  const id = projectId(env);
  if (command.action === 'trigger') {
    if (command.branch !== CHURCHPRO_SEMAPHORE.branch ||
        command.mode !== 'validation' ||
        typeof command.commitSha !== 'string' || !SHA.test(command.commitSha)) {
      throw Error('ChurchPro Semaphore revision not permitted');
    }
    const response = await semaphoreRequest(env, '/plumber-workflows', {
      project_id: id,
      reference: 'refs/heads/' + CHURCHPRO_SEMAPHORE.branch,
      commit_sha: command.commitSha,
      pipeline_file: CHURCHPRO_SEMAPHORE.pipelineFile,
    }, requestFn);
    if (!UUID.test(response.workflow_id ?? '') || !UUID.test(response.pipeline_id ?? '')) {
      throw Error('Invalid ChurchPro Semaphore response');
    }
    return {
      provider: 'semaphore',
      project: CHURCHPRO_SEMAPHORE.project,
      mode: 'validation',
      branch: CHURCHPRO_SEMAPHORE.branch,
      requestedRevision: command.commitSha,
      pipelineId: response.pipeline_id,
      workflowId: response.workflow_id,
    };
  }
  if (command.action === 'inspect') {
    if (!UUID.test(command.pipelineId ?? '')) throw Error('Invalid ChurchPro pipeline identity');
    const base = await semaphoreRequest(env, '/pipelines/' + command.pipelineId,
      undefined, requestFn);
    const pipeline = checkedPipeline(base, id);
    if (pipeline.ppl_id && pipeline.ppl_id !== command.pipelineId) {
      throw Error('ChurchPro Semaphore pipeline identity mismatch');
    }
    const details = await semaphoreRequest(env, '/pipelines/' + command.pipelineId +
      '?detailed=true', undefined, requestFn);
    // Semaphore's detailed response may omit repeated project/branch metadata.
    // The basic response above is mandatory and already establishes ownership.
    const detailed = details?.pipeline;
    if (!detailed ||
        (detailed.project_id && detailed.project_id !== id) ||
        (detailed.branch_name && detailed.branch_name !== CHURCHPRO_SEMAPHORE.branch) ||
        (detailed.ppl_id && detailed.ppl_id !== command.pipelineId) ||
        (detailed.wf_id && detailed.wf_id !== pipeline.wf_id)) {
      throw Error('ChurchPro Semaphore workflow identity mismatch');
    }
    const blocks = (Array.isArray(details.blocks) ? details.blocks : []).slice(0, 12)
      .map(block => ({
        name: typeof block.name === 'string' ? block.name.slice(0, 100) : null,
        state: enumValue(block.state, ['pending', 'running', 'done', 'stopped', 'queued']),
        result: enumValue(block.result, ['passed', 'failed', 'stopped', 'canceled', 'skipped']),
        jobs: (Array.isArray(block.jobs) ? block.jobs : []).slice(0, 15).map(job => ({
          id: UUID.test(job.job_id ?? '') ? job.job_id : null,
          name: typeof job.name === 'string' ? job.name.slice(0, 100) : null,
          status: enumValue(job.status, ['queued', 'pending', 'running', 'finished', 'stopped']),
          result: enumValue(job.result, ['passed', 'failed', 'stopped', 'canceled', 'skipped']),
        })),
      }));
    const failed = blocks.flatMap(block => block.jobs)
      .find(job => job.id && job.result === 'failed');
    let failure = null;
    if (failed) {
      try {
        const logs = await semaphoreRequest(env, '/logs/' + failed.id, undefined, requestFn);
        failure = { jobId: failed.id, ...(
          failureSummary(logs) ?? { diagnostic: 'No failed-command diagnostic available' }
        ) };
      } catch {
        failure = { jobId: failed.id, diagnostic: 'Failed-job logs unavailable' };
      }
    } else if (pipeline.result === 'failed') {
      failure = { diagnostic: 'Pipeline failed before a job-level error could be identified' };
    }
    return {
      ...(failure ? { failure } : {}),
      provider: 'semaphore',
      project: CHURCHPRO_SEMAPHORE.project,
      pipelineId: command.pipelineId,
      workflowId: UUID.test(pipeline.wf_id ?? '') ? pipeline.wf_id : null,
      state: enumValue(pipeline.state, ['pending', 'running', 'done', 'stopping', 'stopped', 'queued']),
      result: enumValue(pipeline.result, ['passed', 'failed', 'stopped', 'canceled', 'skipped']),
      vcs: {
        branch: CHURCHPRO_SEMAPHORE.branch,
        revision: SHA.test(pipeline.commit_sha ?? '') ? pipeline.commit_sha : null,
      },
      blocks,
    };
  }
  throw Error('ChurchPro Semaphore action not permitted');
}
