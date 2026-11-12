import test from 'node:test';
import assert from 'node:assert/strict';

import { validateCommand, executeCommand, PROJECTS } from '../src/index.mjs';
import { CHURCHPRO_SEMAPHORE } from '../src/semaphore-churchpro.mjs';

const id = '11111111-2222-4333-8444-555555555555';
const projectId = '44444444-5555-4666-8777-888888888888';
const otherProjectId = '55555555-6666-4777-8888-999999999999';
const pipelineId = '22222222-3333-4444-8555-666666666666';
const workflowId = '33333333-4444-4555-8666-777777777777';
const revision = 'a'.repeat(40);
const now = Date.parse('2026-11-12T10:00:00Z');
const command = (action, patch = {}) => ({
  v: 1,
  id,
  action,
  project: 'churchpro',
  provider: 'semaphore',
  approved: true,
  requestedAt: new Date(now).toISOString(),
  ...patch,
});
const env = {
  SEMAPHORE_TOKEN: 'synthetic-bridge-test-token',
  SEMAPHORE_PROJECT_ID_CHURCH_PRO: projectId,
  SEMAPHORE_PROJECT_ID: otherProjectId,
};
const valid = (value) => validateCommand(value, id, now);
const execute = (value, fetcher, bindings = env) =>
  executeCommand(bindings, value, valid(value).project, fetcher);
const response = (body, status = 200) => Response.json(body, { status });

test('ChurchPro receives a separate Semaphore validation allowlist', () => {
  assert.ok(PROJECTS.churchpro);
  assert.equal(CHURCHPRO_SEMAPHORE.pipelineFile, '.semaphore/semaphore.yml');
  assert.equal(CHURCHPRO_SEMAPHORE.branch,
    'codex/churchpro-gather-people-cells-integration-20261104');
  assert.equal(valid(command('trigger', {
    branch: CHURCHPRO_SEMAPHORE.branch,
    commitSha: revision,
    mode: 'validation',
  })).project, PROJECTS.churchpro);
  assert.equal(valid(command('health')).project, PROJECTS.churchpro);
  assert.equal(valid(command('inspect', { pipelineId })).project, PROJECTS.churchpro);
  for (const patch of [
    { branch: 'development', commitSha: revision, mode: 'validation' },
    { branch: 'main', commitSha: revision, mode: 'validation' },
    { branch: 'codex/churchpro-gather-people-cells-integration-20261104', mode: 'qa_intel', commitSha: revision },
    { branch: 'codex/churchpro-gather-people-cells-integration-20261104', mode: 'validation' },
    { branch: 'codex/churchpro-gather-people-cells-integration-20261104', mode: 'validation', commitSha: 'bad' },
    { branch: 'codex/churchpro-gather-people-cells-integration-20261104', mode: 'validation', commitSha: revision,
      pipeline_file: '.semaphore/deploy.yml' },
  ]) assert.throws(() => valid(command('trigger', patch)));
  for (const action of ['release', 'semaphore_artifacts', 'semaphore_png', 'nen_trigger_preview']) {
    assert.throws(() => valid(command(action, { pipelineId })));
  }
});

test('health reports only ChurchPro binding readiness, never a token or project ID', async () => {
  const result = await execute(command('health'), () => { throw Error('no network'); });
  assert.equal(result.projectConfigured, true);
  assert.equal(result.tokenConfigured, true);
  assert.deepEqual(result.allowedBranches, [CHURCHPRO_SEMAPHORE.branch]);
  assert.deepEqual(result.allowedActions, ['health', 'trigger', 'inspect']);
  assert.equal(JSON.stringify(result).includes(projectId), false);
  assert.equal(JSON.stringify(result).includes(env.SEMAPHORE_TOKEN), false);
  const missing = await execute(command('health'), () => { throw Error('no network'); }, {});
  assert.equal(missing.projectConfigured, false);
  assert.equal(missing.tokenConfigured, false);
});

test('trigger pins only ChurchPro project, its branch and exact SHA', async () => {
  const requests = [];
  const result = await execute(command('trigger', {
    branch: CHURCHPRO_SEMAPHORE.branch, commitSha: revision, mode: 'validation',
  }), async (url, init) => {
    requests.push({ url, init });
    return response({ pipeline_id: pipelineId, workflow_id: workflowId });
  });
  assert.equal(result.pipelineId, pipelineId);
  assert.equal(result.workflowId, workflowId);
  assert.equal(result.project, 'churchpro');
  assert.equal(result.requestedRevision, revision);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://amaraii.semaphoreci.com/api/v1alpha/plumber-workflows');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.redirect, 'manual');
  assert.equal(requests[0].init.headers.Authorization, 'Token ' + env.SEMAPHORE_TOKEN);
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    project_id: projectId,
    reference: 'refs/heads/' + CHURCHPRO_SEMAPHORE.branch,
    commit_sha: revision,
    pipeline_file: '.semaphore/semaphore.yml',
  });
  assert.equal(JSON.stringify(result).includes(env.SEMAPHORE_TOKEN), false);
});

test('inspect requires a pipeline belonging to the ChurchPro project and branch', async () => {
  const requests = [];
  const basic = { pipeline: {
    ppl_id: pipelineId, wf_id: workflowId,
    project_id: projectId, branch_name: CHURCHPRO_SEMAPHORE.branch,
    state: 'done', result: 'failed', commit_sha: revision,
  } };
  const detailed = {
    pipeline: { ...basic.pipeline },
    blocks: [{ name: 'Source and frontend contract', state: 'done', result: 'failed',
      jobs: [{ job_id: id, name: 'OpenAPI, architecture, web build and tests',
        status: 'finished', result: 'failed' }] }],
  };
  const out = await execute(command('inspect', { pipelineId }), async (url, init) => {
    requests.push({ url, init });
    return response(requests.length === 1 ? basic
      : requests.length === 2 ? detailed : {
        events: [
          { event: 'cmd_started', directive: 'corepack pnpm --filter @churchpro/web typecheck' },
          { event: 'cmd_output', output: 'src/admins/staff.tsx(13,4): error TS2322: Type mismatch.\nAPI_KEY=do-not-disclose\nhttps://private.example.invalid/secret' },
          { event: 'cmd_finished', exit_code: 1 },
        ],
      });
  });
  assert.equal(out.result, 'failed');
  assert.equal(out.vcs.branch, CHURCHPRO_SEMAPHORE.branch);
  assert.equal(out.vcs.revision, revision);
  assert.equal(out.blocks[0].jobs[0].result, 'failed');
  assert.equal(requests.length, 3);
  assert.equal(requests[2].url,
    'https://amaraii.semaphoreci.com/api/v1alpha/logs/' + id);
  assert.equal(out.failure.exitCode, 1);
  assert.match(out.failure.command, /pnpm.*typecheck/);
  assert.match(out.failure.diagnosticLines[0], /TS2322/);
  assert.equal(JSON.stringify(out).includes('do-not-disclose'), false);
  assert.equal(JSON.stringify(out).includes('private.example.invalid'), false);
  assert.equal(JSON.stringify(out).includes(env.SEMAPHORE_TOKEN), false);
  const seen = [];
  await assert.rejects(execute(command('inspect', { pipelineId }), async (url) => {
    seen.push(url);
    return response({ pipeline: { ...basic.pipeline, project_id: otherProjectId } });
  }), /ownership mismatch/);
  assert.equal(seen.length, 1, 'Foreign pipeline must be rejected before detailed/log reads');
  await assert.rejects(execute(command('inspect', { pipelineId }), async () =>
    response({ pipeline: { ...basic.pipeline, branch_name: 'development' } })),
  /ownership mismatch/);
});


test('ChurchPro artifact report reads only owned exact-revision sanitized QA summaries', async () => {
  const path = 'qa-intel/churchpro/agent-handoff.json';
  assert.equal(valid(command('churchpro_report', { pipelineId, jobId: id, artifactPath: path })).project,
    PROJECTS.churchpro);
  for (const bad of [
    { pipelineId, jobId: id, artifactPath: '../.env' },
    { pipelineId, jobId: 'bad', artifactPath: path },
    { pipelineId, jobId: id, artifactPath: path, branch: 'development' },
  ]) assert.throws(() => valid(command('churchpro_report', bad)));
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url, init });
    if (url.includes('storage.googleapis.com')) {
      return response({
        schemaVersion: 1, project: 'churchpro', product: 'ChurchPro',
        revision, evidenceStatus: 'failed',
        checks: [
          { intent: 'real_authorized_roster', status: 'passed' },
          { intent: 'invalid_transfer', status: 'failed',
            diagnostic: 'http_e403_g500' },
        ],
      });
    }
    if (url.endsWith('/pipelines/' + pipelineId)) {
      return response({ pipeline: { ppl_id: pipelineId, wf_id: workflowId,
        project_id: projectId, branch_name: CHURCHPRO_SEMAPHORE.branch,
        commit_sha: revision, state: 'done', result: 'failed' } });
    }
    if (url.endsWith('?detailed=true')) {
      return response({ pipeline: { wf_id: workflowId }, blocks: [{
        jobs: [{ job_id: id, status: 'finished', result: 'failed' }],
      }] });
    }
    if (url.includes('/artifacts/signed_url')) return response({
      items: [{ path, url: 'https://storage.googleapis.com/synthetic/qa.json?sig=test' }],
    });
    if (url.includes('/artifacts?')) return response({ artifacts: [
      { path, is_directory: false, size: 200 },
    ] });
    throw Error('Unexpected URL');
  };
  const out = await execute(command('churchpro_report', {
    pipelineId, jobId: id, artifactPath: path,
  }), fetcher);
  assert.equal(out.project, 'churchpro');
  assert.equal(out.revision, revision);
  assert.equal(out.type, 'qa-intel-api');
  assert.equal(out.total, 2);
  assert.equal(out.passed, 1);
  assert.deepEqual(out.failed, [{ intent: 'invalid_transfer', status: 'failed',
    diagnostic: 'http_e403_g500' }]);
  assert.equal(JSON.stringify(out).includes('sig=test'), false);
  assert.equal(JSON.stringify(out).includes(env.SEMAPHORE_TOKEN), false);
  assert.equal(requests.at(-1).init.headers.Authorization, undefined);
  assert(requests.some(entry => entry.url.includes('/artifacts?') &&
    entry.url.includes('path=qa-intel%2Fchurchpro')),
    'Artifact listing must target the directory, not the signed file');

  const denied = [];
  await assert.rejects(execute(command('churchpro_report', {
    pipelineId, jobId: id, artifactPath: path,
  }), async (url) => {
    denied.push(url);
    return response({ pipeline: { ppl_id: pipelineId, wf_id: workflowId,
      project_id: otherProjectId, branch_name: CHURCHPRO_SEMAPHORE.branch,
      commit_sha: revision } });
  }), /ownership mismatch/);
  assert.equal(denied.length, 1);
});

test('ChurchPro report reader rejects unsigned and foreign artifact locations', async () => {
  const path = 'qa-intel/churchpro/gather-browser-handoff.json';
  const fetcher = async (url) => {
    if (url.endsWith('/pipelines/' + pipelineId)) return response({
      pipeline: { ppl_id: pipelineId, wf_id: workflowId,
        project_id: projectId, branch_name: CHURCHPRO_SEMAPHORE.branch,
        commit_sha: revision },
    });
    if (url.endsWith('?detailed=true')) return response({
      pipeline: { wf_id: workflowId }, blocks: [{ jobs: [
        { job_id: id, status: 'finished', result: 'failed' },
      ] }],
    });
    if (url.includes('/artifacts/signed_url')) return response({ items: [
      { path, url: 'https://unsafe.example.invalid/path' },
    ] });
    if (url.includes('/artifacts?')) return response({ artifacts: [
      { path, is_directory: false, size: 90 },
    ] });
    throw Error('unexpected');
  };
  await assert.rejects(execute(command('churchpro_report', {
    pipelineId, jobId: id, artifactPath: path,
  }), fetcher), /Invalid artifact location/);
});

test('missing credentials and malformed upstream replies fail closed without leaking secrets', async () => {
  const cmd = command('trigger', {
    branch: CHURCHPRO_SEMAPHORE.branch, commitSha: revision, mode: 'validation',
  });
  await assert.rejects(execute(cmd, () => { throw Error('network'); }, {}), /project not configured/);
  await assert.rejects(execute(cmd, () => { throw Error('network'); }, {
    SEMAPHORE_PROJECT_ID_CHURCH_PRO: projectId,
  }), /token not configured/);
  await assert.rejects(execute(cmd, async () => response({ error: 'secret-diagnostic' }, 403)),
    /ChurchPro Semaphore API HTTP 403/);
  await assert.rejects(execute(cmd, async () => response({ workflow_id: 'bad', pipeline_id: pipelineId })),
    /Invalid ChurchPro Semaphore response/);
});

test('ChurchPro inspection never asks for logs of foreign project or branch', async () => {
  const endpoint = '/api/v1alpha/pipelines/' + pipelineId;
  const mismatch = {
    pipeline: {
      ppl_id: pipelineId,
      wf_id: workflowId,
      project_id: otherProjectId,
      branch_name: CHURCHPRO_SEMAPHORE.branch,
      commit_sha: revision,
    },
  };
  const calls = [];
  await assert.rejects(execute(command('inspect', { pipelineId }), async (url) => {
    calls.push(url);
    return response(mismatch);
  }), /ownership mismatch/);
  assert.deepEqual(calls, ['https://amaraii.semaphoreci.com' + endpoint]);
});

