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

test('ChurchPro G4b QA evidence is pinned to one green exact-revision pipeline and authorized job IDs', async () => {
  const pinned = 'f7a562d4-0e09-4c86-8c71-a5dcc942f19d';
  const exact = '36aa0d03a7a2da8522156e6297eb6e8288e318c0';
  const branch = 'codex/churchpro-p2-g4b-private-profile-duplicate-ui-20261113';
  const apiJob = '6bbc9c99-a1ab-4bb5-8ffe-4d17d89cd30a';
  const browserJob = '9d366a24-951c-4c95-8ef7-847d96970671';
  const reportPath = 'qa-intel/churchpro/agent-handoff.json';
  const browserPath = 'qa-intel/churchpro/gather-browser-handoff.json';
  const base = { ppl_id: pinned, wf_id: workflowId, project_id: projectId,
    branch_name: branch, commit_sha: exact, state: 'done', result: 'passed' };
  const tests = [
    { job: apiJob, artifactPath: reportPath,
      data: { schemaVersion:1, project:'churchpro', product:'ChurchPro', revision:exact,
        evidenceStatus:'passed', checks: [{ intent:'synthetic_first', status:'passed' }] },
      type:'qa-intel-api' },
    { job: browserJob, artifactPath: browserPath,
      data: { sourceSha:exact, evidence:'disposable-real-postgresql-nest-browser',
        status:'passed', cases: [{ id:'synthetic_browser', status:'passed' }] },
      type:'gather-browser' },
  ];
  for (const row of tests) {
    const actualPath = row.artifactPath.slice('qa-intel/churchpro/'.length);
    const calls = [];
    const out = await execute(command('churchpro_report', {
      pipelineId:pinned, jobId:row.job, artifactPath:row.artifactPath,
    }), async (url) => {
      calls.push(url);
      if (url.endsWith('/pipelines/' + pinned)) return response({pipeline:base});
      if (url.endsWith('?detailed=true')) return response({
        pipeline:{ wf_id:workflowId, branch_name:branch },
        blocks:[{jobs:[{job_id:row.job, result:'passed'}]}],
      });
      if (url.includes('/artifacts/signed_url')) return response({items:[
        {path:actualPath,url:'https://storage.googleapis.com/synthetic/only.json?sig=private'},
      ]});
      if (url.includes('/artifacts?')) return response({artifacts:[
        {path:actualPath,is_directory:false,size:180},
      ]});
      if (url.includes('storage.googleapis.com')) return response(row.data);
      throw Error('unexpected upstream URL');
    });
    assert.equal(out.type,row.type);
    assert.equal(out.total,1);
    assert.equal(out.passed,1);
    assert.equal(out.revision,exact);
    assert.equal(JSON.stringify(out).includes('sig=private'),false);
    assert.equal(JSON.stringify(out).includes(env.SEMAPHORE_TOKEN),false);
    assert.equal(calls.length,5);
  }
  for (const broken of [
    { ...base, commit_sha:revision },
    { ...base, branch_name:'main' },
    { ...base, result:'failed' },
    { ...base, project_id:otherProjectId },
  ]) {
    const calls = [];
    await assert.rejects(execute(command('churchpro_report', {
      pipelineId:pinned,jobId:apiJob,artifactPath:reportPath,
    }),async url=>{ calls.push(url);return response({pipeline:broken}); }),
    /mismatch/);
    assert.equal(calls.length,1,'Wrong source must fail before browsing artifacts');
  }
  for (const wrongJob of [id,browserJob]) {
    const calls = [];
    await assert.rejects(execute(command('churchpro_report',{
      pipelineId:pinned,jobId:wrongJob,artifactPath:reportPath,
    }),async url=>{calls.push(url);return response({pipeline:base});}),
    /mismatch/);
    assert.equal(calls.length,1,'Wrong job must fail before artifact lookup');
  }
  assert.throws(()=>valid(command('trigger',{
    branch, commitSha:exact,mode:'validation',
  })),/Branch not permitted/);
  assert.throws(()=>valid(command('churchpro_png',{
    pipelineId:pinned,jobId:browserJob,artifactPath:'visual-review/arbitrary-secret.png',
  })),/not permitted/);
});

test('ChurchPro G4b PNG retrieval requires exact synthetic manifest, job and dimensions',async()=>{
  const pinned='f7a562d4-0e09-4c86-8c71-a5dcc942f19d';
  const exact='36aa0d03a7a2da8522156e6297eb6e8288e318c0';
  const branch='codex/churchpro-p2-g4b-private-profile-duplicate-ui-20261113';
  const browserJob='9d366a24-951c-4c95-8ef7-847d96970671';
  const file='g4b-contact-hidden-390.png', path='visual-review/'+file;
  const png=new Uint8Array(33);
  png.set([137,80,78,71,13,10,26,10],0);
  png.set([73,72,68,82],12);
  new DataView(png.buffer).setUint32(16,390);
  new DataView(png.buffer).setUint32(20,844);
  const base={ppl_id:pinned,wf_id:workflowId,project_id:projectId,
    branch_name:branch,commit_sha:exact,state:'done',result:'passed'};
  const fetcher=async(url)=>{
    if(url.endsWith('/pipelines/'+pinned))return response({pipeline:base});
    if(url.endsWith('?detailed=true'))return response({pipeline:{wf_id:workflowId,branch_name:branch},
      blocks:[{jobs:[{job_id:browserJob,status:'finished',result:'passed'}]}]});
    if(url.includes('/artifacts/signed_url')){
      const target=url.includes('manifest.json')?'visual-review/manifest.json':path;
      return response({items:[{path:target,url:'https://storage.googleapis.com/synthetic/'+
        (target.endsWith('.png')?'qa.png':'manifest.json')+'?secret=not-for-output'}]});
    }
    if(url.includes('/artifacts?'))return response({artifacts:[
      {path,is_directory:false,size:png.length},
      {path:'visual-review/manifest.json',is_directory:false,size:190},
    ]});
    if(url.includes('storage.googleapis.com')&&url.includes('qa.png'))return new Response(png,
      {status:200,headers:{'Content-Type':'image/png'}});
    if(url.includes('storage.googleapis.com'))return response({sourceSha:exact,
      fixture:'disposable-synthetic',status:'passed',files:[file]});
    throw Error('unexpected upstream URL '+url);
  };
  const out=await execute(command('churchpro_png',{
    pipelineId:pinned,jobId:browserJob,artifactPath:path,
  }),fetcher);
  assert.equal(out.width,390);
  assert.equal(out.height,844);
  assert.equal(out.bytes,33);
  assert.equal(out.mediaType,'image/png');
  assert.equal(out.path,path);
  assert.equal(JSON.stringify(out).includes('secret=not-for-output'),false);
  assert.equal(JSON.stringify(out).includes(env.SEMAPHORE_TOKEN),false);

  for(const wrongJob of [id,'6bbc9c99-a1ab-4bb5-8ffe-4d17d89cd30a']){
    const calls=[];
    await assert.rejects(execute(command('churchpro_png',{
      pipelineId:pinned,jobId:wrongJob,artifactPath:path,
    }),async url=>{calls.push(url);return response({pipeline:base});}),/not allowed|mismatch/);
    assert.equal(calls.length,1);
  }
  for(const forbiddenPath of ['visual-review/staff-1280.png',
    'visual-review/another-private.png']) {
    const cmd=command('churchpro_png',{pipelineId:pinned,jobId:browserJob,
      artifactPath:forbiddenPath});
    if(forbiddenPath.endsWith('another-private.png'))assert.throws(()=>valid(cmd),/not permitted/);
    else await assert.rejects(execute(cmd,async()=>response({pipeline:base})),/not allowed/);
  }
});

test('G4c private QA report retrieval is exact project, passed revision, job and sanitized schema', async()=>{
  const pinned='a9b6c056-91bc-49cd-b619-17de2aa6efac';
  const exact='6a2a3e319c6c1c3d7afc305e2c855c253d18fcbb';
  const branch='codex/churchpro-p2-g4c-person-capabilities-20261114';
  const apiJob='a7c79e89-85e7-4556-ae67-ada5f1fde952';
  const browserJob='6c915990-ba7b-4ea7-ad43-62379accf03a';
  const base={ppl_id:pinned,wf_id:workflowId,project_id:projectId,
    branch_name:branch,commit_sha:exact,state:'done',result:'passed'};
  for(const row of [
    {job:apiJob,path:'qa-intel/churchpro/agent-handoff.json',type:'qa-intel-api',
      data:{schemaVersion:1,project:'churchpro',product:'ChurchPro',revision:exact,
        evidenceStatus:'passed',checks:[{intent:'synthetic_only',status:'passed'}]}},
    {job:browserJob,path:'qa-intel/churchpro/gather-browser-handoff.json',type:'gather-browser',
      data:{sourceSha:exact,evidence:'disposable-real-postgresql-nest-browser',
        status:'passed',cases:[{id:'synthetic_browser',status:'passed'}]}},
  ]){
    const actual=row.path.split('/').at(-1); const calls=[];
    const out=await execute(command('churchpro_report',{pipelineId:pinned,
      jobId:row.job,artifactPath:row.path}),async url=>{
      calls.push(url);
      if(url.endsWith('/pipelines/'+pinned))return response({pipeline:base});
      if(url.endsWith('?detailed=true'))return response({pipeline:{wf_id:workflowId,
        branch_name:branch},blocks:[{jobs:[{job_id:row.job,result:'passed'}]}]});
      if(url.includes('/artifacts/signed_url'))return response({items:[
        {path:actual,url:'https://storage.googleapis.com/synthetic/'+actual+'?secret=hidden'}]});
      if(url.includes('/artifacts?'))return response({artifacts:[
        {path:actual,is_directory:false,size:180}]});
      if(url.includes('storage.googleapis.com'))return response(row.data);
      throw Error('Unexpected upstream request');
    });
    assert.equal(out.type,row.type);
    assert.equal(out.total,1);
    assert.equal(out.passed,1);
    assert.equal(out.revision,exact);
    assert.equal(calls.length,5);
    assert.equal(JSON.stringify(out).includes('secret=hidden'),false);
    assert.equal(JSON.stringify(out).includes(env.SEMAPHORE_TOKEN),false);
  }
  for(const invalid of [
    {...base,commit_sha:revision},
    {...base,branch_name:'main'},
    {...base,project_id:otherProjectId},
    {...base,result:'failed'},
  ]) {
    let requests=0;
    await assert.rejects(execute(command('churchpro_report',{
      pipelineId:pinned,jobId:apiJob,artifactPath:'qa-intel/churchpro/agent-handoff.json',
    }),async()=>{requests++;return response({pipeline:invalid});}),/mismatch/);
    assert.equal(requests,1,'Reject unauthorized evidence before artifact listing');
  }
  for(const job of [id,browserJob]){
    let requests=0;
    await assert.rejects(execute(command('churchpro_report',{
      pipelineId:pinned,jobId:job,artifactPath:'qa-intel/churchpro/agent-handoff.json',
    }),async()=>{requests++;return response({pipeline:base});}),/mismatch/);
    assert.equal(requests,1);
  }
  assert.throws(()=>valid(command('trigger',{branch,commitSha:exact,mode:'validation'})),
    /Branch not permitted/);
});

test('G4c synthetic PNGs require exact job, approved file and verified manifest',async()=>{
  const pinned='a9b6c056-91bc-49cd-b619-17de2aa6efac';
  const exact='6a2a3e319c6c1c3d7afc305e2c855c253d18fcbb';
  const branch='codex/churchpro-p2-g4c-person-capabilities-20261114';
  const browserJob='6c915990-ba7b-4ea7-ad43-62379accf03a';
  const files=['g4c-owner-actions-390.png','g4c-basic-actions-hidden-390.png'];
  const png=new Uint8Array(33); png.set([137,80,78,71,13,10,26,10],0);
  png.set([73,72,68,82],12);new DataView(png.buffer).setUint32(16,390);
  new DataView(png.buffer).setUint32(20,844);
  const base={ppl_id:pinned,wf_id:workflowId,project_id:projectId,
    branch_name:branch,commit_sha:exact,state:'done',result:'passed'};
  for(const file of files){
    const path='visual-review/'+file;
    const out=await execute(command('churchpro_png',{pipelineId:pinned,
      jobId:browserJob,artifactPath:path}),async url=>{
      if(url.endsWith('/pipelines/'+pinned))return response({pipeline:base});
      if(url.endsWith('?detailed=true'))return response({pipeline:{wf_id:workflowId,
        branch_name:branch},blocks:[{jobs:[{job_id:browserJob,result:'passed'}]}]});
      if(url.includes('/artifacts/signed_url')){
        const target=url.includes('manifest.json')?'visual-review/manifest.json':path;
        return response({items:[{path:target,url:'https://storage.googleapis.com/synthetic/'+
          (target.endsWith('.png')?'qa.png':'manifest.json')+'?sig=hidden'}]});
      }
      if(url.includes('/artifacts?'))return response({artifacts:[
        {path,is_directory:false,size:png.length},
        {path:'visual-review/manifest.json',is_directory:false,size:220}]});
      if(url.includes('storage.googleapis.com')&&url.includes('qa.png'))
        return new Response(png,{status:200,headers:{'Content-Type':'image/png'}});
      if(url.includes('storage.googleapis.com'))
        return response({sourceSha:exact,fixture:'disposable-synthetic',
          status:'passed',files});
      throw Error('Unexpected upstream request');
    });
    assert.equal(out.width,390);
    assert.equal(out.path,path);
    assert.equal(out.revision,exact);
    assert.equal(JSON.stringify(out).includes('sig=hidden'),false);
  }
  for(const badFile of ['visual-review/g4b-contact-hidden-390.png',
    'visual-review/other-sensitive.png']) {
    const cmd=command('churchpro_png',{pipelineId:pinned,jobId:browserJob,artifactPath:badFile});
    if(badFile.includes('other-sensitive'))assert.throws(()=>valid(cmd),/not permitted/);
    else await assert.rejects(execute(cmd,async()=>response({pipeline:base})),
      /not allowed|not permitted/);
  }
  for(const wrongJob of [id,'a7c79e89-85e7-4556-ae67-ada5f1fde952']){
    let calls=0;
    await assert.rejects(execute(command('churchpro_png',{pipelineId:pinned,
      jobId:wrongJob,artifactPath:'visual-review/'+files[0]}),
    async()=>{calls++;return response({pipeline:base});}),/not allowed|not permitted/);
    assert.equal(calls,1);
  }
  let network=0;
  await assert.rejects(execute(command('churchpro_png',{pipelineId:pinned,
    jobId:browserJob,artifactPath:'visual-review/'+files[0]}),
  async()=>{network++;return response({pipeline:{...base,commit_sha:revision}});}),/mismatch/);
  assert.equal(network,1);
});

test('G4d evidence readers accept only exact green source, job and sanitized report', async () => {
  const pipeline='7f560488-5a76-46c2-b1af-fc2c07012afa';
  const exact='f1e6c9a299614d83eae53c521af1b30ea1463e14';
  const branch='codex/churchpro-p2-g4d-record-capabilities-readonly-20261114';
  const apiJob='eff790d5-c0a0-48cc-b9cb-76535faca26c';
  const browserJob='458871e1-f51f-4a17-b02c-e98a92fce137';
  const validPipeline={ppl_id:pipeline,wf_id:workflowId,project_id:projectId,
    branch_name:branch,commit_sha:exact,state:'done',result:'passed'};
  for(const row of [
    {job:apiJob,path:'qa-intel/churchpro/agent-handoff.json',type:'qa-intel-api',
      data:{schemaVersion:1,project:'churchpro',product:'ChurchPro',revision:exact,
        evidenceStatus:'passed',checks:[{intent:'synthetic',status:'passed'}]}},
    {job:browserJob,path:'qa-intel/churchpro/gather-browser-handoff.json',type:'gather-browser',
      data:{sourceSha:exact,evidence:'disposable-real-postgresql-nest-browser',
        status:'passed',cases:[{id:'synthetic_browser',status:'passed'}]}},
  ]){
    const stored=row.path.split('/').at(-1);
    const answer=await execute(command('churchpro_report',{
      pipelineId:pipeline,jobId:row.job,artifactPath:row.path,
    }), async url=>{
      if(url.endsWith('/pipelines/'+pipeline))return response({pipeline:validPipeline});
      if(url.endsWith('?detailed=true'))return response({
        pipeline:{wf_id:workflowId,branch_name:branch},
        blocks:[{jobs:[{job_id:row.job,result:'passed'}]}]});
      if(url.includes('/artifacts/signed_url'))return response({items:[
        {path:stored,url:'https://storage.googleapis.com/synthetic/'+stored+'?sig=never-return'}]});
      if(url.includes('/artifacts?'))return response({artifacts:[
        {path:stored,is_directory:false,size:180}]});
      if(url.includes('storage.googleapis.com'))return response(row.data);
      throw Error('Unexpected upstream');
    });
    assert.equal(answer.revision,exact);
    assert.equal(answer.type,row.type);
    assert.equal(answer.total,1);
    assert.equal(answer.passed,1);
    assert.equal(JSON.stringify(answer).includes('never-return'),false);
    assert.equal(JSON.stringify(answer).includes(env.SEMAPHORE_TOKEN),false);
  }
  for(const invalid of [
    {...validPipeline,commit_sha:revision},
    {...validPipeline,project_id:otherProjectId},
    {...validPipeline,branch_name:'main'},
    {...validPipeline,result:'failed'},
  ]){
    let calls=0;
    await assert.rejects(execute(command('churchpro_report',{pipelineId:pipeline,
      jobId:apiJob,artifactPath:'qa-intel/churchpro/agent-handoff.json'}),
    async()=>{calls++;return response({pipeline:invalid});}),/mismatch/);
    assert.equal(calls,1,'Wrong source rejected before touching job artifacts');
  }
  await assert.rejects(execute(command('churchpro_report',{pipelineId:pipeline,
    jobId:browserJob,artifactPath:'qa-intel/churchpro/agent-handoff.json'}),
    async()=>response({pipeline:validPipeline})),/mismatch/);
  assert.throws(()=>valid(command('trigger',{branch,commitSha:exact,mode:'validation'})),
    /Branch not permitted/);
});

test('G4d PNG reader accepts only three manifest-backed synthetic images', async()=>{
  const pipeline='7f560488-5a76-46c2-b1af-fc2c07012afa';
  const exact='f1e6c9a299614d83eae53c521af1b30ea1463e14';
  const branch='codex/churchpro-p2-g4d-record-capabilities-readonly-20261114';
  const browserJob='458871e1-f51f-4a17-b02c-e98a92fce137';
  const files=['g4d-editor-record-390.png','g4d-reader-record-320.png','g4d-branch-cell-390.png'];
  const png=new Uint8Array(33);
  png.set([137,80,78,71,13,10,26,10],0); png.set([73,72,68,82],12);
  new DataView(png.buffer).setUint32(16,390);
  new DataView(png.buffer).setUint32(20,844);
  const base={ppl_id:pipeline,wf_id:workflowId,project_id:projectId,
    branch_name:branch,commit_sha:exact,state:'done',result:'passed'};
  for(const file of files){
    const path='visual-review/'+file;
    const answer=await execute(command('churchpro_png',{pipelineId:pipeline,
      jobId:browserJob,artifactPath:path}),async url=>{
      if(url.endsWith('/pipelines/'+pipeline))return response({pipeline:base});
      if(url.endsWith('?detailed=true'))return response({
        pipeline:{wf_id:workflowId,branch_name:branch},
        blocks:[{jobs:[{job_id:browserJob,result:'passed'}]}]});
      if(url.includes('/artifacts/signed_url')){
        const target=url.includes('manifest.json')?'visual-review/manifest.json':path;
        return response({items:[{path:target,url:'https://storage.googleapis.com/synthetic/'+
          (target.endsWith('.png')?'example.png':'manifest.json')+'?sig=private'}]});
      }
      if(url.includes('/artifacts?'))return response({artifacts:[
        {path,is_directory:false,size:png.length},
        {path:'visual-review/manifest.json',is_directory:false,size:240}]});
      if(url.includes('storage.googleapis.com')&&url.includes('example.png'))
        return new Response(png,{status:200,headers:{'Content-Type':'image/png'}});
      if(url.includes('storage.googleapis.com'))return response({
        sourceSha:exact,fixture:'disposable-synthetic',status:'passed',files});
      throw Error('Unexpected upstream');
    });
    assert.equal(answer.revision,exact);
    assert.equal(answer.width,390);
    assert.equal(answer.path,path);
    assert.equal(JSON.stringify(answer).includes('sig=private'),false);
  }
  await assert.rejects(execute(command('churchpro_png',{pipelineId:pipeline,
    jobId:browserJob,artifactPath:'visual-review/g4c-owner-actions-390.png'}),
    async()=>response({pipeline:base})),/not allowed|not permitted/);
  let touched=0;
  await assert.rejects(execute(command('churchpro_png',{pipelineId:pipeline,
    jobId:browserJob,artifactPath:'visual-review/'+files[0]}),
    async()=>{touched++;return response({pipeline:{...base,commit_sha:revision}});}),
    /mismatch/);
  assert.equal(touched,1);
  for(const wrong of [id,'eff790d5-c0a0-48cc-b9cb-76535faca26c']){
    let calls=0;
    await assert.rejects(execute(command('churchpro_png',{pipelineId:pipeline,
      jobId:wrong,artifactPath:'visual-review/'+files[0]}),
      async()=>{calls++;return response({pipeline:base});}),/not allowed|not permitted/);
    assert.equal(calls,1);
  }
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
  const branchConversion = 'codex/churchpro-p2-3h-classification-policy-20261113';
  const branchPrivate = 'codex/churchpro-p2-g1-private-profile-20261113';
  const branchDuplicateReview = 'codex/churchpro-p2-g2-duplicate-review-20261113';
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
  const conversionPipeline = { pipeline: { ...basic.pipeline, branch_name: branchConversion } };
  const validConversion = [];
  const conversion = await execute(command('inspect', { pipelineId }), async url => {
    validConversion.push(url);
    return response(validConversion.length === 1 ? conversionPipeline : {
      pipeline: conversionPipeline.pipeline, blocks: [],
    });
  });
  assert.equal(conversion.vcs.branch, branchConversion);
  const privatePipeline = { pipeline: { ...basic.pipeline, branch_name: branchPrivate } };
  const requestsPrivate = [];
  const privateInspection = await execute(command('inspect', { pipelineId }), async url => {
    requestsPrivate.push(url);
    return response(requestsPrivate.length === 1 ? privatePipeline : {
      pipeline: privatePipeline.pipeline, blocks: [],
    });
  });
  assert.equal(privateInspection.vcs.branch, branchPrivate);
  const reviewPipeline = { pipeline: { ...basic.pipeline, branch_name: branchDuplicateReview } };
  const reviewRequests = [];
  const reviewInspection = await execute(command('inspect', { pipelineId }), async url => {
    reviewRequests.push(url);
    return response(reviewRequests.length === 1 ? reviewPipeline : {
      pipeline: reviewPipeline.pipeline, blocks: [],
    });
  });
  assert.equal(reviewInspection.vcs.branch, branchDuplicateReview);
  assert.equal(reviewRequests.length, 2);
  const g3Branch = 'codex/churchpro-p2-g3-protected-person-lifecycle-20261113';
  const g3Pipeline = { pipeline: { ...basic.pipeline, branch_name: g3Branch } };
  const g3Requests = [];
  const g3Inspection = await execute(command('inspect', { pipelineId }), async url => {
    g3Requests.push(url);
    return response(g3Requests.length === 1 ? g3Pipeline : {
      pipeline: g3Pipeline.pipeline, blocks: [],
    });
  });
  assert.equal(g3Inspection.vcs.branch, g3Branch);
  assert.equal(g3Requests.length, 2);
  // G4a is a separate exact-branch, read-only inspect exception. Its tests
  // must not allow triggering paid jobs or granting artifact/screenshot access.
  const g4aBranch = 'codex/churchpro-p2-g4a-person-lifecycle-ui-20261113';
  const g4aPipeline = { pipeline: { ...basic.pipeline, branch_name: g4aBranch } };
  const g4aRequests = [];
  const g4aInspection = await execute(command('inspect', { pipelineId }), async url => {
    g4aRequests.push(url);
    return response(g4aRequests.length === 1 ? g4aPipeline : {
      pipeline: g4aPipeline.pipeline, blocks: [],
    });
  });
  assert.equal(g4aInspection.vcs.branch, g4aBranch);
  assert.equal(g4aInspection.vcs.revision, revision);
  assert.equal(g4aRequests.length, 2);
  assert.throws(() => valid(command('trigger', {
    branch: g4aBranch, commitSha: revision, mode: 'validation',
  })), /Branch not permitted/);
  await assert.rejects(execute(command('churchpro_artifact_probe', {
    pipelineId, jobId: id,
  }), async () => response(g4aPipeline)), /ownership mismatch/);
  await assert.rejects(execute(command('churchpro_report', {
    pipelineId, jobId: id, artifactPath: 'qa-intel/churchpro/agent-handoff.json',
  }), async () => response(g4aPipeline)), /ownership mismatch/);
  // G4b must be a separately scoped read-only exception, never a paid trigger,
  // signed report, artifact browse, or foreign branch/project disclosure.
  const g4bBranch = 'codex/churchpro-p2-g4b-private-profile-duplicate-ui-20261113';
  const g4bPipeline = { pipeline: { ...basic.pipeline, branch_name: g4bBranch } };
  const g4bRequests = [];
  const g4bInspection = await execute(command('inspect', { pipelineId }), async url => {
    g4bRequests.push(url);
    return response(g4bRequests.length === 1 ? g4bPipeline : {
      pipeline: g4bPipeline.pipeline, blocks: [],
    });
  });
  assert.equal(g4bInspection.vcs.branch, g4bBranch);
  assert.equal(g4bInspection.vcs.revision, revision);
  assert.equal(g4bRequests.length, 2);
  assert.throws(() => valid(command('trigger', {
    branch: g4bBranch, commitSha: revision, mode: 'validation',
  })), /Branch not permitted/);
  await assert.rejects(execute(command('churchpro_artifact_probe', {
    pipelineId, jobId: id,
  }), async () => response(g4bPipeline)), /ownership mismatch/);
  await assert.rejects(execute(command('churchpro_report', {
    pipelineId, jobId: id, artifactPath: 'qa-intel/churchpro/agent-handoff.json',
  }), async () => response(g4bPipeline)), /ownership mismatch/);

  // G4c is read-only and project/branch-bound; paid jobs and evidence remain denied.
  const g4cBranch = 'codex/churchpro-p2-g4c-person-capabilities-20261114';
  const g4cPipeline = { pipeline: { ...basic.pipeline, branch_name: g4cBranch } };
  const g4cRequests = [];
  const g4cInspection = await execute(command('inspect', { pipelineId }), async url => {
    g4cRequests.push(url);
    return response(g4cRequests.length === 1 ? g4cPipeline : {
      pipeline: g4cPipeline.pipeline, blocks: [],
    });
  });
  assert.equal(g4cInspection.vcs.branch, g4cBranch);
  assert.equal(g4cInspection.vcs.revision, revision);
  assert.equal(g4cRequests.length, 2);
  assert.throws(() => valid(command('trigger', {
    branch: g4cBranch, commitSha: revision, mode: 'validation',
  })), /Branch not permitted/);
  await assert.rejects(execute(command('churchpro_artifact_probe', {
    pipelineId, jobId: id,
  }), async () => response(g4cPipeline)), /ownership mismatch/);
  await assert.rejects(execute(command('churchpro_report', {
    pipelineId, jobId: id, artifactPath: 'qa-intel/churchpro/agent-handoff.json',
  }), async () => response(g4cPipeline)), /ownership mismatch/);

  // G4d is also exact-branch inspect-only, with no paid CI trigger or QA artifact access.
  const g4dBranch = 'codex/churchpro-p2-g4d-record-capabilities-readonly-20261114';
  const g4dPipeline = { pipeline: { ...basic.pipeline, branch_name: g4dBranch } };
  const g4dRequests = [];
  const g4dInspection = await execute(command('inspect', { pipelineId }), async url => {
    g4dRequests.push(url);
    return response(g4dRequests.length === 1 ? g4dPipeline : {
      pipeline: g4dPipeline.pipeline, blocks: [],
    });
  });
  assert.equal(g4dInspection.vcs.branch, g4dBranch);
  assert.equal(g4dInspection.vcs.revision, revision);
  assert.equal(g4dRequests.length, 2);
  assert.throws(() => valid(command('trigger', {
    branch: g4dBranch, commitSha: revision, mode: 'validation',
  })), /Branch not permitted/);
  await assert.rejects(execute(command('churchpro_artifact_probe', {
    pipelineId, jobId: id,
  }), async () => response(g4dPipeline)), /ownership mismatch/);
  await assert.rejects(execute(command('churchpro_report', {
    pipelineId, jobId: id, artifactPath: 'qa-intel/churchpro/agent-handoff.json',
  }), async () => response(g4dPipeline)), /ownership mismatch/);
  await assert.rejects(execute(command('churchpro_png', {
    pipelineId, jobId: id, artifactPath: 'visual-review/g4c-owner-actions-390.png',
  }), async () => response(g4dPipeline)), /ownership mismatch|not allowed|not permitted/);

  assert.throws(() => valid(command('trigger', {
    branch: g3Branch, commitSha: revision, mode: 'validation',
  })), /Branch not permitted/);
  await assert.rejects(execute(command('churchpro_artifact_probe', {
    pipelineId, jobId: id,
  }), async () => response(g3Pipeline)), /ownership mismatch/);

  assert.throws(() => valid(command('trigger', {
    branch: branchDuplicateReview, commitSha: revision, mode: 'validation',
  })), /Branch not permitted/);
  assert.equal(requestsPrivate.length, 2);
  assert.throws(() => valid(command('trigger', {
    branch: branchPrivate, commitSha: revision, mode: 'validation',
  })), /Branch not permitted/);
  assert.equal(validConversion.length, 2);
  assert.throws(() => valid(command('trigger', {
    branch: branchConversion, commitSha: revision, mode: 'validation',
  })), /Branch not permitted/);

  assert.equal(validOperations.length, 2);
  assert.throws(() => valid(command('trigger', {
    branch: branchOperations, commitSha: revision, mode: 'validation',
  })), /Branch not permitted/);

  await assert.rejects(execute(command('churchpro_artifact_probe', {
    pipelineId, jobId: id,
  }), async () => response(basic)), /ownership mismatch/,
  'PR #20 must not acquire PR #18 artifact access');
});
