import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizePinnedChurchProLookupFailure } from '../src/churchpro-lookup-ci-diagnostic.mjs';

const pipelineId='0a9f358e-5947-4737-99ca-50cebc4a99fa';
const db={project:'churchpro',provider:'circleci',pipelineId,
  jobId:'c2119a08-51c7-4c1f-9344-3c79408fdfa6',jobNumber:1224};
const api={project:'churchpro',provider:'circleci',pipelineId,
  jobId:'5409d92d-ead1-424a-b3a2-6c09a9cfb477',jobNumber:1231};

test('exact database test job reports only allowlisted classifications, not raw private text',()=>{
  const raw='FAIL src/internal/attendance-capture-store.test.ts > escapes wildcard and escape metacharacters\n' +
    'AssertionError: expected private-person-name@example.test to equal sk_live_SECRET\n';
  const result=summarizePinnedChurchProLookupFailure(raw,db,107);
  assert.equal(result?.job,'database');
  assert.deepEqual(result?.failedTestIds,['literal_escape_unit']);
  assert.ok(result?.diagnosticClasses.includes('assertion_mismatch'));
  assert.ok(result?.diagnosticClasses.includes('database_unit_related'));
  assert.doesNotMatch(JSON.stringify(result),/private-person|sk_live|expected .*equal/i);
});

test('API test identifiers are fixed source labels, no search payload or stdout is returned',()=>{
  const raw='● P3.2b literal candidate query escapes LIKE metacharacters\n' +
    'PostgresError 42601: invalid SQL value for private visitor contact\n';
  const result=summarizePinnedChurchProLookupFailure(raw,api,111);
  assert.equal(result?.job,'api');
  assert.deepEqual(result?.failedTestIds,['literal_index_api']);
  assert.ok(result?.diagnosticClasses.includes('api_literal_index_test_related'));
  assert.deepEqual(result?.sqlStateOrTsCodes,['42601']);
  assert.doesNotMatch(JSON.stringify(result),/visitor contact|invalid SQL value/iu);
});

test('scope cannot be widened to unrelated pipelines, arbitrary CircleCI jobs or steps',()=>{
  for(const [args,step] of [
    [{...db,pipelineId:'4e1440de-5cc8-4384-8144-ed9e6227451c'},107],
    [{...db,jobId:'af7106a1-ab5a-4539-a1f8-8abd2fd54376'},107],
    [{...db,jobNumber:1225},107],[db,108],
    [{...db,provider:'semaphore'},107],
    [{...db,project:'amaraii-os'},107],
  ])assert.equal(summarizePinnedChurchProLookupFailure('test',args,step),null);
});
