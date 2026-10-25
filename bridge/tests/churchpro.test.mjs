import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECTS, validateCommand, executeCommand } from '../src/index.mjs';

const requestId = '11111111-2222-4333-8444-555555555555';
const projectId = 'abcdefab-1234-4567-8abc-abcdefabcdef';
const definitionId = 'eeeeeeee-1111-4222-8333-444444444444';
const pipelineId = '22222222-3333-4444-8555-666666666666';
const jobId = '33333333-4444-4555-8666-777777777777';
const now = '2026-10-25T08:00:00.000Z';
const project = PROJECTS.churchpro;
const command = (action, fields = {}) => ({
  v: 1, id: requestId, project: 'churchpro', action,
  requestedAt: now, approved: true, ...fields,
});
const definition = {
  id: definitionId, name: 'build-and-test',
  config_source: {
    provider: 'github_app', file_path: '.circleci/config.yml',
    repo: { full_name: 'dev-amaraii/ChurchPro' },
  },
};
const respond = value => Response.json(value);

function mockCircleCI({ definitions = [definition], projectSlug = project.slug } = {}) {
  const requests = [];
  const send = async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith('/project/' + project.slug)) {
      return respond({ id: projectId, slug: projectSlug });
    }
    if (url.endsWith('/projects/' + projectId + '/pipeline-definitions')) {
      return respond({ items: definitions });
    }
    if (url.endsWith('/project/' + project.slug + '/pipeline/run')) {
      return new Response(JSON.stringify({ id: pipelineId, number: 2, state: 'created' }), {
        status: 201, headers: { 'content-type': 'application/json' },
      });
    }
    throw Error('Unexpected request: ' + url);
  };
  return { send, requests };
}

test('ChurchPro has an isolated validation-only allowlist', () => {
  assert.equal(project.slug,
    'circleci/B65DMdC1ZhAJQM74t7SrZ1/HQvs3kNUw3sJb4jVVJizHu');
  assert.deepEqual(project.branches, ['circleci-project-setup']);
  assert.equal(project.modes.validation, null);
  const accepted = validateCommand(command('trigger', {
    branch: 'circleci-project-setup', mode: 'validation',
  }), requestId, Date.parse(now));
  assert.equal(accepted.project, project);
  for (const fields of [
    { branch: 'main', mode: 'validation' },
    { branch: 'development', mode: 'validation' },
    { branch: 'circleci-project-setup', mode: 'preview_qa' },
    { branch: 'circleci-project-setup', mode: 'release' },
  ]) assert.throws(() => validateCommand(command('trigger', fields), requestId, Date.parse(now)));
  assert.throws(() => validateCommand(command('release', {
    branch: 'circleci-project-setup', commitSha: 'a'.repeat(40),
  }), requestId, Date.parse(now)), /Action not permitted/);
});

test('ChurchPro resolves only its exact CircleCI definition and sends no pipeline parameters', async () => {
  const validated = validateCommand(command('trigger', {
    branch: 'circleci-project-setup', mode: 'validation',
  }), requestId, Date.parse(now));
  const network = mockCircleCI();
  const outcome = await executeCommand({ CIRCLE_TOKEN: 'synthetic-token' },
    validated.command, validated.project, network.send);
  assert.equal(outcome.pipelineId, pipelineId);
  assert.equal(network.requests.length, 3);
  assert.equal(network.requests[0].init.method, 'GET');
  assert.equal(network.requests[1].init.method, 'GET');
  const run = network.requests[2];
  assert.equal(run.init.method, 'POST');
  assert.deepEqual(JSON.parse(run.init.body), {
    definition_id: definitionId,
    config: { branch: 'circleci-project-setup' },
    checkout: { branch: 'circleci-project-setup' },
  });
  assert.equal(JSON.stringify(outcome).includes('synthetic-token'), false);
});

test('ChurchPro QA-Intel runs only with its explicit pipeline parameter', async () => {
  const cmd = command('trigger', { branch: 'circleci-project-setup', mode: 'qa_intel' });
  const valid = validateCommand(cmd, requestId, Date.parse(now));
  const network = mockCircleCI();
  const result = await executeCommand({ CIRCLE_TOKEN: 'synthetic-token' },
    valid.command, valid.project, network.send);
  assert.equal(result.mode, 'qa_intel');
  assert.deepEqual(JSON.parse(network.requests.at(-1).init.body), {
    definition_id: definitionId,
    config: { branch: 'circleci-project-setup' },
    checkout: { branch: 'circleci-project-setup' },
    parameters: { run_qa_intel: true },
  });
});

test('wrong or ambiguous definitions fail closed before any paid trigger', async () => {
  const cmd = command('trigger', { branch: 'circleci-project-setup', mode: 'validation' });
  const wrong = [
    { ...definition, config_source: { ...definition.config_source, file_path: '.circleci/other.yml' } },
    { ...definition, config_source: { ...definition.config_source, repo: { full_name: 'someone/Else' } } },
    { ...definition, name: 'some-other-definition' },
  ];
  for (const definitions of [[], wrong, [definition, definition]]) {
    const network = mockCircleCI({ definitions });
    await assert.rejects(() => executeCommand({ CIRCLE_TOKEN: 'synthetic-token' },
      cmd, project, network.send), /not found uniquely/);
    assert.equal(network.requests.some(x => x.init.method === 'POST'), false);
  }
  const foreign = mockCircleCI({ projectSlug: 'circleci/foreign/repository' });
  await assert.rejects(() => executeCommand({ CIRCLE_TOKEN: 'synthetic-token' },
    cmd, project, foreign.send), /project identity mismatch/);
  assert.equal(foreign.requests.length, 1);
});

test('ChurchPro PNG preview is constrained to its own QA-Intel prefix', async () => {
  const path = 'qa-intel/churchpro/members/overview-desktop.png';
  const preview = command('artifact_preview', {
    pipelineId, jobId, jobNumber: 3, artifactPath: path,
  });
  assert.equal(validateCommand(preview, requestId, Date.parse(now)).project, project);
  for (const badPath of [
    'qa-intel/transactions/customer.png',
    'bank-transfer-qa/customer.png',
    'qa-intel/churchpro/../private.png',
    'qa-intel/churchpro/result.json',
    'https://example.com/screenshot.png',
  ]) {
    assert.throws(() => validateCommand({ ...preview, artifactPath: badPath },
      requestId, Date.parse(now)), /Artifact preview not permitted/);
  }
  assert.throws(() => validateCommand({ ...preview, project: 'jayson-storefront' },
    requestId, Date.parse(now)), /Artifact preview not permitted/);

  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
  const artifactUrl = 'https://output.circle-artifacts.com/output/qa.png';
  const urls = [];
  const send = async (url, init) => {
    urls.push(url);
    if (url.endsWith('/pipeline/' + pipelineId)) return respond({ project_slug: project.slug });
    if (url.endsWith('/pipeline/' + pipelineId + '/workflow')) {
      return respond({ items: [{ id: 'workflow-1' }] });
    }
    if (url.endsWith('/workflow/workflow-1/job')) {
      return respond({ items: [{ id: jobId, job_number: 3, project_slug: project.slug }] });
    }
    if (url.endsWith('/3/artifacts')) {
      return respond({ items: [{ path, url: artifactUrl }] });
    }
    if (url === artifactUrl) {
      assert.equal(init.headers['Circle-Token'], 'synthetic-token');
      return new Response(bytes, { headers: { 'content-type': 'image/png' } });
    }
    throw Error('Unexpected request: ' + url);
  };
  const result = await executeCommand({ CIRCLE_TOKEN: 'synthetic-token' },
    preview, project, send);
  assert.equal(result.path, path);
  assert.equal(result.mediaType, 'image/png');
  assert.deepEqual(Buffer.from(result.dataBase64, 'base64'), Buffer.from(bytes));
  assert.equal(JSON.stringify(result).includes(artifactUrl), false);
  assert.equal(urls.length, 5);
});
