/**
 * NEN CI Bridge — private Cloudflare KV mailbox, no HTTP command endpoint.
 * Only Cloudflare-account-authorized clients can enqueue requests through
 * the KV control-plane API. Cron consumes at most one request per minute.
 *
 * There is deliberately no deployment, cancellation, rerun or arbitrary URL
 * functionality. Only pre-registered project/branch and pipeline parameters.
 */
const API = 'https://circleci.com/api/v2';
const PREFIX = 'requests/';
const RESULT_PREFIX = 'results/';
const CLAIM_PREFIX = 'claims/';
const RESULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_REQUEST_AGE_MS = 30 * 60 * 1000;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

export const PROJECTS = Object.freeze({
  'jayson-storefront': Object.freeze({
    slug: 'circleci/B65DMdC1ZhAJQM74t7SrZ1/CRNFjZzLKeZdypYW5EWkyL',
    definitionId: 'b5a41026-8298-4976-956b-49fbca6de695',
    branches: ['feat/storefront-demo'],
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
      !hasOnlyKeys(command, ['v','id','action','project','branch','mode','pipelineId','requestedAt','approved'])) {
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
  if (command.action === 'recent') {
    if (typeof command.branch !== 'string' || !project.branches.includes(command.branch)) throw new Error('Branch not permitted');
    if (command.mode !== undefined || command.pipelineId !== undefined) throw new Error('Recent command has unexpected fields');
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
    redirect: 'error',
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
  if (command.action === 'recent') {
    const recent = await circleRequest(env, '/project/' + project.slug + '/pipeline?branch=' + encodeURIComponent(command.branch), undefined, requestFn);
    return {
      project: command.project, branch: command.branch,
      pipelines: (recent.items || []).filter(p => p.project_slug === project.slug && p.vcs?.branch === command.branch).slice(0, 10)
        .map(p => ({ id: p.id, number: p.number, state: p.state, createdAt: p.created_at, revision: p.vcs?.revision, errors: (p.errors || []).slice(0,3).map(e=>({type:e.type})) })),
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
 * eventually consistent, so use one cron consumer and one request at a time.
 * There is no exactly-once transactional guarantee.
 */
export async function processOne(env, now = Date.now(), requestFn = fetch) {
  if (!env.QUEUE) throw new Error('QUEUE KV binding is required');
  const listing = await env.QUEUE.list({ prefix: PREFIX, limit: 1 });
  const item = listing.keys?.[0];
  if (!item) return { empty: true };

  const id = item.name.slice(PREFIX.length);
  const resultKey = RESULT_PREFIX + id;
  const claimKey = CLAIM_PREFIX + id;
  if (!UUID.test(id)) {
    await env.QUEUE.delete(item.name);
    return { rejected: 'malformed-key' };
  }

  const prior = await env.QUEUE.get(resultKey) || await env.QUEUE.get(claimKey);
  if (prior) {
    await env.QUEUE.delete(item.name);
    return { skipped: true, id };
  }

  const timestamp = new Date(now).toISOString();
  let command;
  try {
    const raw = await env.QUEUE.get(item.name);
    if (!raw || raw.length > 4096) throw new Error('Invalid or oversized command');
    command = JSON.parse(raw);
    const validated = validateCommand(command, id, now);
    // A distinct claim key avoids KV's one-write-per-second per-key limit.
    await env.QUEUE.put(claimKey, JSON.stringify({ id, status:'claimed', action:command.action, updatedAt:timestamp }), { expirationTtl: RESULT_TTL_SECONDS });
    await env.QUEUE.delete(item.name);
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
      'Pipeline project mismatch', 'Recent command has unexpected fields',
    ];
    // Only expose typed failure categories: never emit raw upstream messages,
    // tokens, request payloads, stack traces or URLs.
    const error = safe.includes(message) || /^CircleCI API HTTP [0-9]{3}$/.test(message) ? message
      : err instanceof SyntaxError ? 'Invalid JSON response or command'
      : err instanceof TypeError ? 'Network or API transport failure'
      : 'Bridge request failed';
    const result = { id, status:'error', action:command?.action ?? 'unknown', updatedAt:new Date().toISOString(), error };
    await env.QUEUE.put(resultKey, JSON.stringify(result), { expirationTtl: RESULT_TTL_SECONDS });
    await env.QUEUE.delete(item.name);
    return result;
  }
}

export default {
  // Never expose a remotely callable command endpoint, even if a Worker
  // route or workers.dev setting is accidentally enabled.
  fetch() {
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(processOne(env));
  },
};
