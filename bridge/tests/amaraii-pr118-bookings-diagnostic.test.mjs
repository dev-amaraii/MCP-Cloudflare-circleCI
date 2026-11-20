import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizePr118WorkspaceVitest,PROJECTS,validateCommand,executeCommand} from '../src/index.mjs';

const pipelineId='1ae4b8bb-100f-41aa-845c-9c5b7a128c0a';
const jobId='9a3479e5-bead-4022-a454-fb5b9c638c76';
const requestId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const now=Date.parse('2026-11-20T02:00:00Z');
const command=(props={})=>({
 v:1,id:requestId,action:'job_steps',project:'amaraii-os',provider:'circleci',
 approved:true,requestedAt:new Date(now).toISOString(),pipelineId,jobId,jobNumber:313,...props
});
const fakeOutput=[
 'FAIL  test/bookings-pitches.integration.spec.ts > Bookings UI > shows a correct price',
 'AssertionError: expected 201 to be 403',
 '  at test/bookings-pitches.integration.spec.ts:456:17',
 'Authorization: Bearer private-very-secret',
 'https://example.invalid/private',
 'CIRCLE_TOKEN=secret',
].join('\n');

test('Bookings sanitizer returns only bounded failure titles, numeric assertions and source line',()=>{
 const data=summarizePr118WorkspaceVitest(fakeOutput);
 assert.deepEqual(data.failedTests,['Bookings UI  shows a correct price']);
 assert.deepEqual(data.sourceLocations,['456:17']);
 assert.deepEqual(data.errorKinds,['AssertionError']);
 assert.deepEqual(data.numericComparisons,[{actual:201,expected:403}]);
 assert.equal(JSON.stringify(data).includes('private-very-secret'),false);
 assert.equal(JSON.stringify(data).includes('example.invalid'),false);
 assert.equal(JSON.stringify(data).includes('CIRCLE_TOKEN'),false);
 assert.deepEqual(summarizePr118WorkspaceVitest(''),{failedTests:[],sourceLocations:[],errorKinds:[],numericComparisons:[],timeoutDetected:false});
 assert.equal(summarizePr118WorkspaceVitest('Test timed out').timeoutDetected,true);
});

test('one exact Bookings pipeline/job/step receives sanitized assertion, no other job does',async()=>{
 async function diagnose(props={}){
  const checked=validateCommand(command(props),requestId,now);
  const calls=[];
  const response=await executeCommand({CIRCLE_TOKEN:'private-circle-token'},checked.command,checked.project,async(url,init)=>{
   calls.push(url);
   if(url.endsWith('/pipeline/'+pipelineId)) return Response.json({project_slug:PROJECTS['amaraii-os'].slug});
   if(url.endsWith('/pipeline/'+pipelineId+'/workflow')) return Response.json({items:[{id:'11111111-2222-4333-8444-555555555555'}]});
   if(url.endsWith('/workflow/11111111-2222-4333-8444-555555555555/job'))return Response.json({items:[{id:props.jobId??jobId,job_number:props.jobNumber??313,project_slug:PROJECTS['amaraii-os'].slug}]});
   if(url.includes('/stdout/condensed'))return new Response(fakeOutput,{status:200});
   if(url.includes('/api/v3/jobs/'))return Response.json({data:{id:props.jobId??jobId,attributes:{status:'failed',parallel_executions:[{attributes:{index:0,steps:[{attributes:{num:145,outcome:'failed',exit_code:1,name:'Bookings pitch inheritance and region acceptance'}}]}}]}}});
   throw Error('Unexpected call '+url);
  });
  assert.equal(calls.length,5);
  return response;
 }
 const matching=await diagnose();
 assert.deepEqual(matching.failedStepDiagnostic.pinnedVitest.failedTests,['Bookings UI  shows a correct price']);
 assert.equal(JSON.stringify(matching).includes('private-circle-token'),false);
 assert.equal(JSON.stringify(matching).includes('Bearer private'),false);
 const other=await diagnose({jobId:'eeeeeeee-bbbb-4ccc-8ddd-aaaaaaaaaaaa'});
 assert.equal(Object.hasOwn(other.failedStepDiagnostic,'pinnedVitest'),false);
});
