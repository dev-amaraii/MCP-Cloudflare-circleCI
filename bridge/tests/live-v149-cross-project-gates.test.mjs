import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCommand,PROJECTS} from '../src/index.mjs';
import {NEN_CMS_POLICY_44} from '../src/semaphore-nen.mjs';
import {URBAN_SEMAPHORE} from '../src/semaphore-urban.mjs';

const id='f2d20123-3644-49a5-a26a-05cddcf47981';
const now=Date.parse('2026-11-14T22:20:00Z');
const base=(project,action,extra={})=>({
  v:1,id,requestedAt:new Date(now).toISOString(),approved:true,
  provider:'semaphore',project,action,...extra,
});
const check=(command)=>validateCommand(command,id,now);

test('NEN CMS PR44 trigger remains exact branch+SHA, validation-only and project-scoped',()=>{
  const valid=base('nen-website-cms','nen_trigger_cms_policy',{
    branch:NEN_CMS_POLICY_44.branch,
    commitSha:NEN_CMS_POLICY_44.commitSha,
    mode:'validation',
  });
  assert.equal(check(valid).project,PROJECTS['nen-website-cms']);
  for(const extra of [
    {branch:'main'},
    {commitSha:'f'.repeat(40)},
    {mode:'release'},
    {pipelineId:'d176a479-60d4-463d-99e9-7a0a5cdecbb9'},
    {jobId:'6a30ebf7-388f-4039-8d34-3d7bc3708459'},
    {artifactPath:'qa-intel/private-secret'},
    {project:'churchpro'},
    {provider:'circleci'},
  ]) assert.throws(()=>check({...valid,...extra}));
});

test('Urban Paints preview bundle denies wrong project, branch, path and unbounded fields',()=>{
  const valid=base('urban-design-paint','urban_preview_bundle',{
    pipelineId:'d176a479-60d4-463d-99e9-7a0a5cdecbb9',
    branch:URBAN_SEMAPHORE.branch,
    commitSha:'a'.repeat(40),
    artifactPath:'preview-bundle/urban-paints-preview.tgz',
  });
  assert.equal(check(valid).project,PROJECTS['urban-design-paint']);
  for(const extra of [
    {project:'nen-website-cms'},
    {branch:'main'},
    {commitSha:'bad'},
    {artifactPath:'../.env'},
    {artifactPath:'qa-intel/churchpro/agent-handoff.json'},
    {jobId:'6a30ebf7-388f-4039-8d34-3d7bc3708459'},
    {mode:'release'},
    {provider:'circleci'},
  ]) assert.throws(()=>check({...valid,...extra}));
});

test('P3.1 attendance branch cannot piggyback on legacy ChurchPro trigger permission',()=>{
  const candidate=base('churchpro','trigger',{
    branch:'codex/churchpro-p3-p31-manual-sessions-20261114',
    commitSha:'a374d8ec02b7e3a0b73c25a129fae577649a856d',
    mode:'validation',
  });
  assert.throws(()=>check(candidate),/Branch not permitted/);
  assert.throws(()=>check({...candidate,project:'amaraii-os'}));
  assert.throws(()=>check({...candidate,project:'nen-website-cms'}));
});
