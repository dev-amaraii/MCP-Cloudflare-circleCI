import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECTS, validateCommand } from '../src/index.mjs';

const id = '11111111-2222-4333-8444-555555555555';
const now = Date.parse('2026-10-28T19:00:00Z');
const base = {
  v:1,id,project:'amaraii-os',requestedAt:new Date(now).toISOString(),approved:true,
};
const learn = 'design/amaraii-learn-v1-spec-20261028';

test('allows exactly the requested Learn branch for Amaraii validation only', () => {
  assert.ok(PROJECTS['amaraii-os'].branches.includes(learn));
  assert.deepEqual(PROJECTS['amaraii-os'].modes, {validation:'run_validation'});
  assert.doesNotThrow(() => validateCommand({
    ...base,action:'trigger',branch:learn,mode:'validation'
  },id,now));
});

test('does not enable Learn deployments, preview or unrelated branch triggers', () => {
  for (const command of [
    {...base,action:'trigger',branch:learn,mode:'preview_qa'},
    {...base,action:'trigger',branch:'design/another-branch',mode:'validation'},
    {...base,action:'release',branch:learn,commitSha:'a'.repeat(40)},
  ]) assert.throws(()=>validateCommand(command,id,now));
  assert.equal(PROJECTS['amaraii-os'].releaseParameter,undefined);
});

test('does not weaken the existing projects or allowed modes', () => {
  for (const branch of ['development','staging','codex/p2-live-billing-pilot']) {
    assert.doesNotThrow(()=>validateCommand({...base,action:'trigger',branch,mode:'validation'},id,now));
  }
  assert.deepEqual(PROJECTS['jayson-storefront'].branches,['feat/storefront-demo']);
  assert.deepEqual(PROJECTS['jayson-storefront'].modes,{
    validation:'run_validation',preview_qa:'run_preview_qa'
  });
});
