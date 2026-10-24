import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';

const id = '11111111-2222-4333-8444-555555555555';
const pipelineId = '22222222-3333-4444-8555-666666666666';
function setup(fields = {}) {
  const values = new Map();
  const kv = {
    get: async key => values.get(key) ?? null,
    put: async (key, value) => { values.set(key, value); },
    list: async () => { throw Error('On-demand delivery must never list KV'); },
    delete: async () => { throw Error('Queue requests must not touch legacy keys'); },
  };
  let acks = 0;
  const message = { body: { v:1, id, project:'amaraii-os', action:'health',
    requestedAt:new Date().toISOString(), approved:true, ...fields }, ack() { acks++; } };
  return { values, kv, message, batch:{messages:[message]}, acks:() => acks };
}

test('queue delivers directly, keeps private results, and never lists idle KV', async () => {
  const s = setup();
  await worker.queue(s.batch, {QUEUE:s.kv, CIRCLE_TOKEN:'synthetic'});
  const result = JSON.parse(s.values.get('results/'+id));
  assert.equal(result.status, 'success');
  assert.equal(result.outcome.tokenConfigured, true);
  assert.equal(s.acks(), 1);
  assert.equal(typeof worker.scheduled, 'undefined');
  assert.equal((await worker.fetch()).status, 404);
});

test('empty deliveries perform no storage work', async () => {
  await worker.queue({messages:[]}, {});
});

test('re-delivery of a claimed command does not call CircleCI again', async t => {
  const s = setup({action:'trigger',branch:'development',mode:'validation'});
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({id:pipelineId,number:1});
  });
  await worker.queue(s.batch, {QUEUE:s.kv,CIRCLE_TOKEN:'synthetic'});
  await worker.queue(s.batch, {QUEUE:s.kv,CIRCLE_TOKEN:'synthetic'});
  assert.equal(calls, 1);
  assert.equal(s.acks(), 2);
});

test('an uncertain paid trigger is acknowledged and never automatically replayed', async t => {
  const s = setup({action:'trigger',branch:'development',mode:'validation'});
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    throw new TypeError('sensitive transport response');
  });
  await worker.queue(s.batch, {QUEUE:s.kv,CIRCLE_TOKEN:'synthetic'});
  const result = JSON.parse(s.values.get('results/'+id));
  assert.equal(result.error, 'Network or API transport failure');
  await worker.queue(s.batch, {QUEUE:s.kv,CIRCLE_TOKEN:'synthetic'});
  assert.equal(calls, 1);
  assert.equal(s.acks(), 2);
});

test('a failed result write still acknowledges the message without a retry', async () => {
  const s = setup();
  s.kv.put = async () => { throw Error('storage unavailable'); };
  await assert.rejects(worker.queue(s.batch, {QUEUE:s.kv}), /storage unavailable/);
  assert.equal(s.acks(), 1);
});

test('malformed identities are dropped without storage or network calls', async () => {
  const s = setup({id:'../not-a-request'});
  await worker.queue(s.batch, {});
  assert.equal(s.values.size, 0);
  assert.equal(s.acks(), 1);
});

test('unapproved, expired, oversized and arbitrary-project commands are denied', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw Error('Must not call'); });
  for (const fields of [{approved:false}, {requestedAt:'2020-01-01'},
    {project:'foreign'}, {extra:'x'.repeat(4097)}]) {
    const s = setup(fields);
    await worker.queue(s.batch, {QUEUE:s.kv});
    assert.equal(JSON.parse(s.values.get('results/'+id)).status, 'error');
    assert.equal(s.values.has('claims/'+id), false);
    assert.equal(s.acks(), 1);
  }
});

test('Jayson exact-SHA release survives on-demand transport; Amaraii release is denied', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({url, body:JSON.parse(options.body)});
    return Response.json({id:pipelineId,number:1});
  });
  const s = setup({project:'jayson-storefront',action:'release',
    branch:'feat/storefront-demo',commitSha:'a'.repeat(40)});
  await worker.queue(s.batch, {QUEUE:s.kv,CIRCLE_TOKEN:'synthetic'});
  assert.equal(JSON.parse(s.values.get('results/'+id)).status, 'success');
  assert.deepEqual(requests[0].body.parameters,
    {run_preview_release:true,release_sha:'a'.repeat(40)});
  const denied = setup({action:'release',branch:'development',commitSha:'a'.repeat(40)});
  await worker.queue(denied.batch, {QUEUE:denied.kv,CIRCLE_TOKEN:'synthetic'});
  assert.equal(JSON.parse(denied.values.get('results/'+id)).error, 'Action not permitted');
  assert.equal(requests.length, 1);
});
