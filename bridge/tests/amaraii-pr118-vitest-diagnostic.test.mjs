import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizePr118WorkspaceVitest,PROJECTS,validateCommand,executeCommand} from '../src/index.mjs';

const pipelineId='22ee7e5b-0122-47dd-99ec-316eefd3e9e0';
const jobId='42f5d301-950e-481c-80b2-9549ddd912c4';
const requestId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const now=Date.parse('2026-11-20T02:00:00Z');
const command=(props={})=>({
 v:1,id:requestId,action:'job_steps',project:'amaraii-os',provider:'circleci',
 approved:true,requestedAt:new Date(now).toISOString(),pipelineId,jobId,jobNumber:312,...props
});
const fakeOutput=[
 'FAIL  test/workspace.integration.spec.ts > tenant access > denies missing user',
 'AssertionError: expected 201 to be 403',
 '  at test/workspace.integration.spec.ts:123:17',
 'Authorization: Bearer private-very-secret',
 'https://example.invalid/private',
 'CIRCLE_TOKEN=secret',
].join('\n');

test('PR118 sanitizer returns only bounded failure titles, numeric assertions and source line',()=>{
 const data=summarizePr118WorkspaceVitest(fakeOutput);
 assert.deepEqual(data.failedTests,['tenant access  denies missing user']);
 assert.deepEqual(data.sourceLocations,['123:17']);
 assert.deepEqual(data.errorKinds,['AssertionError']);
 assert.deepEqual(data.numericComparisons,[{actual:201,expected:403}]);
 assert.equal(JSON.stringify(data).includes('private-very-secret'),false);
 assert.equal(JSON.stringify(data).includes('example.invalid'),false);
 assert.equal(JSON.stringify(data).includes('CIRCLE_TOKEN'),false);
 assert.deepEqual(summarizePr118WorkspaceVitest(''),{failedTests:[],sourceLocations:[],errorKinds:[],numericComparisons:[]});
});

test('one exact Amaraii pipeline/job/step receives sanitized assertion, no other job does',async()=>{
 async function diagnose(props={}){
  const checked=validateCommand(command(props),requestId,now);
  const calls=[];
  const response=await executeCommand({CIRCLE_TOKEN:'private-circle-token'},checked.command,checked.project,async(url,init)=>{
   calls.push(url);
   if(url.endsWith('/pipeline/'+pipelineId)) return Response.json({project_slug:PROJECTS['amaraii-os'].slug});
   if(url.endsWith('/pipeline/'+pipelineId+'/workflow')) return Response.json({items:[{id:'11111111-2222-4333-8444-555555555555'}]});
   if(url.endsWith('/workflow/11111111-2222-4333-8444-555555555555/job'))return Response.json({items:[{id:props.jobId??jobId,job_number:props.jobNumber??312,project_slug:PROJECTS['amaraii-os'].slug}]});
   if(url.includes('/api/v3/jobs/'))return Response.json({data:{id:props.jobId??jobId,attributes:{status:'failed',parallel_executions:[{attributes:{index:0,steps:[{attributes:{num:143,outcome:'failed',exit_code:1,name:'Workspace and branch region regressions'}}]}}]}}});
   if(url.includes('/stdout/condensed'))return new Response(fakeOutput,{status:200});
   throw Error('Unexpected call '+url);
  });
  assert.equal(calls.length,5);
  return response;
 }
 const matching=await diagnose();
 assert.deepEqual(matching.failedStepDiagnostic.pinnedVitest.failedTests,['tenant access  denies missing user']);
 assert.equal(JSON.stringify(matching).includes('private-circle-token'),false);
 assert.equal(JSON.stringify(matching).includes('Bearer private'),false);
 const other=await diagnose({jobId:'eeeeeeee-bbbb-4ccc-8ddd-aaaaaaaaaaaa'});
 assert.equal(Object.hasOwn(other.failedStepDiagnostic,'pinnedVitest'),false);
});
