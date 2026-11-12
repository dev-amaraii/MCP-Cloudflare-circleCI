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
  assert.deepEqual(result.allowedActions, ['health', 'trigger', 'inspect', 'churchpro_report', 'churchpro_artifact_probe', 'churchpro_png']);
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


test('inspect returns bounded Jest failure names without exposing credentials or raw log output', async () => {
  const basic = { pipeline: {
    ppl_id: pipelineId, wf_id: workflowId,
    project_id: projectId, branch_name: CHURCHPRO_SEMAPHORE.branch,
    state: 'done', result: 'failed', commit_sha: revision,
  } };
  const detailed = {
    ...basic,
    blocks: [{ name: 'Disposable PostgreSQL and agent QA', state: 'done', result: 'failed',
      jobs: [{ job_id: id, name: 'Database, authenticated API and strict QA-Intel',
        status: 'finished', result: 'failed' }] }],
  };
  let count = 0;
  const out = await execute(command('inspect', { pipelineId }), async () => {
    count++;
    if (count === 1) return response(basic);
    if (count === 2) return response(detailed);
    return response({ events: [
      { event: 'cmd_started', directive: 'corepack pnpm --filter "@churchpro/api" test' },
      { event: 'cmd_output', output: [
        'synthetic build output '.repeat(300),
        '● Phase 2 Department API: current permissions › requires branch affiliation',
        'Expected: 404',
        'Received: 409',
        'API_KEY: do-not-disclose',
        'https://private.example.invalid/secret',
        'Tests:       2 failed, 141 passed, 143 total',
      ].join('\n') },
      { event: 'cmd_finished', exit_code: 1 },
    ] });
  });
  assert.equal(out.failure.failedTestCases.length, 1);
  assert.match(out.failure.failedTestCases[0], /requires branch affiliation/);
  assert.ok(out.failure.diagnosticLines.some(line => line.includes('Expected: 404')));
  assert.ok(out.failure.diagnosticLines.some(line => line.includes('Received: 409')));
  assert.equal(JSON.stringify(out).includes('do-not-disclose'), false);
  assert.equal(JSON.stringify(out).includes('private.example.invalid'), false);
  assert.equal(JSON.stringify(out).includes(env.SEMAPHORE_TOKEN), false);
});

test('ChurchPro artifact report reads only owned exact-revision sanitized QA summaries', async () => {
  const path = 'qa-intel/churchpro/agent-handoff.json';
  const stored = 'agent-handoff.json';
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
      items: [{ path: stored, url: 'https://storage.googleapis.com/synthetic/qa.json?sig=test' }],
    });
    if (url.includes('/artifacts?')) return response({ artifacts: [
      { path: stored, is_directory: false, size: 200 },
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
  assert(requests.some(entry => entry.url.endsWith('/artifacts?scope=jobs&scope_id=' + id)),
    'Job artifact listing must target the actual Semaphore job root');

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
  const stored = 'gather-browser-handoff.json';
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
      { path: stored, url: 'https://unsafe.example.invalid/path' },
    ] });
    if (url.includes('/artifacts?')) return response({ artifacts: [
      { path: stored, is_directory: false, size: 90 },
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

test('ChurchPro probe reads only owned job/workflow directories and summarizes upload status', async () => {
  const probe = command('churchpro_artifact_probe', { pipelineId, jobId: id });
  assert.equal(valid(probe).project, PROJECTS.churchpro);
  for (const patch of [
    { pipelineId, jobId: id, artifactPath: 'qa-intel/churchpro/private.json' },
    { pipelineId, jobId: 'not-a-uuid' },
    { pipelineId, jobId: id, branch: 'main' },
  ]) assert.throws(() => valid(command('churchpro_artifact_probe', patch)));
  const calls = [];
  const request = async (url) => {
    calls.push(url);
    if (url.endsWith('/pipelines/' + pipelineId)) return response({
      pipeline: { ppl_id: pipelineId, wf_id: workflowId,
        project_id: projectId, branch_name: CHURCHPRO_SEMAPHORE.branch, commit_sha: revision },
    });
    if (url.endsWith('?detailed=true')) return response({
      pipeline: { wf_id: workflowId },
      blocks: [{ jobs: [{ job_id: id, status: 'finished', result: 'passed' }] }],
    });
    if (url.includes('/logs/')) return response({ events: [
      { event: 'cmd_started', directive: 'artifact push job qa-intel/churchpro/visual-review' },
      { event: 'cmd_finished', exit_code: 0 },
    ] });
    if (url.includes('/artifacts?')) {
      if (url.includes('path=qa-intel%2Fchurchpro')) return response({ artifacts: [
        { name: 'manifest.json', path: 'qa-intel/churchpro/manifest.json', is_directory: false },
        { name: 'secret-token.txt', path: 'qa-intel/churchpro/secret-token.txt', is_directory: false },
      ] });
      if (url.includes('path=qa-intel')) return response({ artifacts: [
        { name: 'churchpro', path: 'qa-intel/churchpro', is_directory: true },
      ] });
      return response({ artifacts: [{ name: 'qa-intel', path: 'qa-intel', is_directory: true }] });
    }
    throw Error('Unexpected endpoint');
  };
  const output = await execute(probe, request);
  assert.equal(output.project, 'churchpro');
  assert.equal(output.revision, revision);
  assert.equal(output.artifacts.length, 5);
  assert.equal(output.artifacts[2].entries[0].file, 'manifest.json');
  assert.equal(output.artifacts[2].entries[1].file, '(other)');
  assert.equal(output.upload.commandSeen, true);
  assert.equal(output.upload.finished, true);
  assert.equal(output.upload.failed, false);
  assert.equal(JSON.stringify(output).includes('secret-token'), false);
  assert.equal(JSON.stringify(output).includes(env.SEMAPHORE_TOKEN), false);
  assert.equal(calls.filter(u => u.includes('/artifacts?')).length, 5);
});

test('ChurchPro probe rejects foreign pipeline before any job/log/artifact access', async () => {
  const calls = [];
  const cmd = command('churchpro_artifact_probe', { pipelineId, jobId: id });
  await assert.rejects(execute(cmd, async (url) => {
    calls.push(url);
    return response({ pipeline: { ppl_id: pipelineId, project_id: otherProjectId,
      branch_name: CHURCHPRO_SEMAPHORE.branch, wf_id: workflowId,
      commit_sha: revision } });
  }), /ownership mismatch/);
  assert.equal(calls.length, 1);
});

test('ChurchPro visual PNG reads are restricted to synthetic review filenames', async () => {
  const validPath = 'visual-review/staff-1280.png';
  assert.equal(valid(command('churchpro_png', {
    pipelineId, jobId: id, artifactPath: validPath,
  })).project, PROJECTS.churchpro);
  for (const path of [
    'visual-review/../../.env', 'visual-review/manifest.json',
    'visual-review/private.png', 'staff-1280.png', '/visual-review/staff-1280.png',
  ]) {
    assert.throws(() => valid(command('churchpro_png', {
      pipelineId, jobId: id, artifactPath: path,
    })));
  }
  const requests = [];
  await assert.rejects(execute(command('churchpro_png', {
    pipelineId, jobId: id, artifactPath: validPath,
  }), async url => {
    requests.push(url);
    return response({ pipeline: { project_id: otherProjectId,
      branch_name: CHURCHPRO_SEMAPHORE.branch,
      ppl_id: pipelineId, wf_id: workflowId, commit_sha: revision } });
  }), /ownership mismatch/);
  assert.equal(requests.length, 1, 'Foreign project must not leak images or artifact paths');
});

test('department PR #20 is read-only inspectable without expanding triggers, artifacts or foreign-project access', async () => {
  const branch = 'codex/churchpro-phase2-departments-foundation-20261112';
  const branchOperations = 'codex/churchpro-phase2-department-operations-20261112';
  assert.throws(() => valid(command('trigger', {
    branch, commitSha: revision, mode: 'validation',
  })), /Branch not permitted/);

  const basic = { pipeline: {
    ppl_id: pipelineId, wf_id: workflowId, project_id: projectId,
    branch_name: branch, state: 'done', result: 'failed', commit_sha: revision,
  } };
  const calls = [];
  const out = await execute(command('inspect', { pipelineId }), async url => {
    calls.push(url);
    if (calls.length === 1) return response(basic);
    if (calls.length === 2) return response({
      pipeline: { ...basic.pipeline },
      blocks: [{ name: 'Disposable PostgreSQL', state: 'done', result: 'failed',
        jobs: [{ job_id: id, name: 'Drizzle and integration', status: 'finished', result: 'failed' }] }],
    });
    return response({ events: [
      { event: 'cmd_started', directive: 'corepack pnpm --filter @churchpro/database db:check' },
      { event: 'cmd_output', output: 'error: synthetic schema mismatch' },
      { event: 'cmd_finished', exit_code: 1 },
    ] });
  });
  assert.equal(out.project, 'churchpro');
  assert.equal(out.vcs.branch, branch);
  assert.equal(out.vcs.revision, revision);
  assert.equal(out.failure.exitCode, 1);
  assert.equal(calls.length, 3);

  for (const invalid of [
    { ...basic.pipeline, branch_name: 'main' },
    { ...basic.pipeline, project_id: otherProjectId },
  ]) {
    const denied = [];
    await assert.rejects(execute(command('inspect', { pipelineId }), async url => {
      denied.push(url);
      return response({ pipeline: invalid });
    }), /ownership mismatch/);
    assert.equal(denied.length, 1, 'deny before detailed jobs or logs');
  }
  const departmentOperationsPipeline = { pipeline: { ...basic.pipeline, branch_name: branchOperations } };
  const validOperations = [];
  const operations = await execute(command('inspect', { pipelineId }), async url => {
    validOperations.push(url);
    if (validOperations.length === 1) return response(departmentOperationsPipeline);
    return response({ pipeline: departmentOperationsPipeline.pipeline, blocks: [] });
  });
  assert.equal(operations.vcs.branch, branchOperations);
  assert.equal(validOperations.length, 2);
  assert.throws(() => valid(command('trigger', {
    branch: branchOperations, commitSha: revision, mode: 'validation',
  })), /Branch not permitted/);

  await assert.rejects(execute(command('churchpro_artifact_probe', {
    pipelineId, jobId: id,
  }), async () => response(basic)), /ownership mismatch/,
  'PR #20 must not acquire PR #18 artifact access');
});
