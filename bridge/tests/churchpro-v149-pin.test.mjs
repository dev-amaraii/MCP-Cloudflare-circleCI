import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCommand, executeCommand } from '../src/index.mjs';

const id = 'a31b4436-15d6-4779-8708-d76073e1298f';
const now = Date.parse('2026-11-14T22:05:00Z');
const branch = 'codex/churchpro-p3-p31-manual-sessions-20261114';
const latest = {
  pipeline: '2a37bec8-689f-474c-85c9-52261d858979',
  source: 'a374d8ec02b7e3a0b73c25a129fae577649a856d',
};
const previous = {
  pipeline: '80f5a3cf-e8dc-454a-999d-820e99d06b62',
  source: 'd806877f3532b69223a822ebd0a2131b7a65363a',
};
const ownerProject = '44444444-5555-4666-8777-888888888888';
const otherProject = '55555555-6666-4777-8888-999999999999';
const workflow = '3899a5a5-1bb2-4a3c-8619-9622774fae91';
const jobs = {
  'qa-intel/churchpro/agent-handoff.json': {
    name: 'Database, authenticated API and strict QA-Intel',
    id: '07f62cf3-7327-45c6-92ab-b64630e6a0c2',
    total: 73,
    type: 'qa-intel-api',
  },
  'qa-intel/churchpro/gather-browser-handoff.json': {
    name: 'Authenticated Gather browser and visual review',
    id: '56a95fbc-5214-43e0-9ed5-63f2ac084d37',
    total: 35,
    type: 'gather-browser',
  },
};
const env = {
  SEMAPHORE_PROJECT_ID_CHURCH_PRO: ownerProject,
  SEMAPHORE_TOKEN: 'synthetic-test-token-not-a-secret',
};
const command = (pin, path, extras = {}) => ({
  v: 1, id, approved: true, action: 'churchpro_report',
  project: 'churchpro', provider: 'semaphore',
  pipelineId: pin.pipeline,
  jobId: '00000000-0000-4000-8000-000000000001',
  artifactPath: path,
  requestedAt: new Date(now).toISOString(),
  ...extras,
});
function checkedRun(commandValue, fetcher) {
  const checked = validateCommand(commandValue, id, now);
  return executeCommand(env, commandValue, checked.project, fetcher);
}
function fakeReport(pin, path, state = 'passed') {
  const job = jobs[path];
  if (job.type === 'qa-intel-api') {
    return {
      schemaVersion: 1, project: 'churchpro', product: 'ChurchPro',
      revision: pin.source, evidenceStatus: state,
      productAcceptance: 'pending_independent_qa_review',
      checks: Array.from({ length: job.total }, (_, index) => ({
        intent: 'synthetic_intent_' + String(index).padStart(2, '0'),
        status: state,
      })),
    };
  }
  return {
    sourceSha: pin.source,
    evidence: 'disposable-real-postgresql-nest-browser',
    status: state,
    productAcceptance: 'pending_independent_qa_review',
    cases: Array.from({ length: job.total }, (_, index) => ({
      id: 'synthetic_browser_' + String(index).padStart(2, '0'),
      kind: 'browser', status: state,
    })),
  };
}
function fakeProvider(pin, path, options = {}) {
  const job = jobs[path];
  const source = options.source ?? pin.source;
  const pipeline = {
    ppl_id: pin.pipeline, wf_id: workflow,
    project_id: options.project ?? ownerProject,
    branch_name: options.branch ?? branch,
    commit_sha: source,
    state: options.state ?? 'done',
    result: options.result ?? 'passed',
  };
  const calls = [];
  async function fetcher(url) {
    calls.push(url);
    if (url.endsWith('/pipelines/' + pin.pipeline)) {
      return Response.json({ pipeline });
    }
    if (url.endsWith('/pipelines/' + pin.pipeline + '?detailed=true')) {
      return Response.json({
        pipeline: { ...pipeline },
        blocks: [{
          jobs: [{
            job_id: job.id,
            name: options.jobName ?? job.name,
            result: options.jobResult ?? 'passed',
          }],
        }],
      });
    }
    if (url.endsWith('/artifacts?scope=jobs&scope_id=' + job.id)) {
      return Response.json({
        artifacts: [{ path: path.split('/').at(-1), is_directory: false, size: 1600 }],
      });
    }
    if (url.includes('/artifacts/signed_url')) {
      return Response.json({
        items: [{
          path: path.split('/').at(-1),
          url: 'https://storage.googleapis.com/synthetic-qa/test.json?sig=private',
        }],
      });
    }
    if (url.startsWith('https://storage.googleapis.com/')) {
      return Response.json(options.report ?? fakeReport(pin, path));
    }
    throw new Error('Unexpected outbound request in exact-pin regression: ' + url);
  }
  return { calls, fetcher };
}

test('live v149 accepts exactly two successful current-SHA sanitized report types', async () => {
  for (const [path, expected] of Object.entries(jobs)) {
    const mock = fakeProvider(latest, path);
    const outcome = await checkedRun(command(latest, path), mock.fetcher);
    assert.equal(outcome.project, 'churchpro');
    assert.equal(outcome.pipelineId, latest.pipeline);
    assert.equal(outcome.revision, latest.source);
    assert.equal(outcome.type, expected.type);
    assert.equal(outcome.status, 'passed');
    assert.equal(outcome.passed, expected.total);
    assert.equal(outcome.total, expected.total);
    assert.deepEqual(outcome.failed, []);
    assert.equal(mock.calls.length, 5);
    assert.equal(mock.calls.some(url => url.includes('logs') || url.includes('cmd_output')), false);
    assert.equal(JSON.stringify(outcome).includes('sig=private'), false);
    assert.equal(JSON.stringify(outcome).includes(env.SEMAPHORE_TOKEN), false);
  }
});

test('previous exact green report pin remains valid after v149 source reconciliation', async () => {
  for (const [path, expected] of Object.entries(jobs)) {
    const mock = fakeProvider(previous, path);
    const outcome = await checkedRun(command(previous, path), mock.fetcher);
    assert.equal(outcome.revision, previous.source);
    assert.equal(outcome.pipelineId, previous.pipeline);
    assert.equal(outcome.type, expected.type);
    assert.equal(outcome.total, expected.total);
    assert.equal(outcome.passed, expected.total);
    assert.deepEqual(outcome.failed, []);
    assert.equal(mock.calls.length, 5);
  }
});

test('current SHA rejects wrong project, branch, revision and nonpassed pipeline before artifacts', async () => {
  const path = 'qa-intel/churchpro/agent-handoff.json';
  for (const mutation of [
    { project: otherProject },
    { branch: 'main' },
    { source: previous.source },
    { state: 'running' },
    { result: 'failed' },
  ]) {
    const mock = fakeProvider(latest, path, mutation);
    await assert.rejects(checkedRun(command(latest, path), mock.fetcher), /mismatch/);
    assert.equal(mock.calls.length, 1, 'deny before job metadata or signed artifact lookup');
  }
});

test('current SHA rejects wrong job selector, unauthorized path and escalation actions', async () => {
  const path = 'qa-intel/churchpro/agent-handoff.json';
  const mock = fakeProvider(latest, path);
  await assert.rejects(checkedRun(command(latest, path, {
    jobId: jobs[path].id,
  }), mock.fetcher), /selector mismatch/);
  assert.equal(mock.calls.length, 0);
  assert.throws(() => validateCommand(command(latest, 'qa-intel/churchpro/other.json'), id, now),
    /report access not permitted/i);
  assert.throws(() => validateCommand(command(latest, path, {
    commitSha: latest.source,
  }), id, now), /report access not permitted/i);
  const png = command(latest, path, {
    action: 'churchpro_png',
    jobId: jobs[path].id,
    artifactPath: 'visual-review/people-390.png',
  });
  let network = 0;
  await assert.rejects(checkedRun(png, async () => {
    network++;
    return Response.json({ pipeline: {
      ppl_id: latest.pipeline, wf_id: workflow, project_id: ownerProject,
      branch_name: branch, commit_sha: latest.source,
      state: 'done', result: 'passed',
    } });
  }), /mismatch|not permitted|not allowed/);
  assert(network <= 1, 'no current-SHA PNG artifact enumeration');
});

test('nonpassed named job and incorrect report totals fail closed', async () => {
  const path = 'qa-intel/churchpro/agent-handoff.json';
  const failedJob = fakeProvider(latest, path, { jobResult: 'failed' });
  await assert.rejects(checkedRun(command(latest, path), failedJob.fetcher), /mismatch/);
  assert.equal(failedJob.calls.length, 2, 'no artifact request after job mismatch');

  const incomplete = fakeReport(latest, path);
  incomplete.checks.pop();
  const invalid = fakeProvider(latest, path, { report: incomplete });
  await assert.rejects(checkedRun(command(latest, path), invalid.fetcher),
    /report evidence mismatch/);
  assert.equal(invalid.calls.length, 5);
});
