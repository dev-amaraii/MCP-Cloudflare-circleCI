import test from 'node:test';
import assert from 'node:assert/strict';
import {executeSemaphoreNen,NEN_SCREENSHOT,NEN_PREVIEW} from '../src/semaphore-nen.mjs';
import {validateCommand,executeCommand,processRequest} from '../src/index.mjs';
const id='11111111-2222-4333-8444-555555555555';
const pipeline='11111111-2222-4333-8444-555555555551';
const workflow='11111111-2222-4333-8444-555555555552';
const job='11111111-2222-4333-8444-555555555553';
const projectId='11111111-2222-4333-8444-555555555554';
const otherProject='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const env={SEMAPHORE_NEN_PROJECT_ID:projectId,SEMAPHORE_TOKEN:'private-test-token'};
const now=Date.parse('2026-11-10T00:00:00Z');
const command=(action,other={})=>({v:1,id,action,project:'nen-website-cms',provider:'semaphore',
  requestedAt:new Date(now).toISOString(),approved:true,...other});
const valid=x=>validateCommand(x,id,now);
const base='https://amaraii.semaphoreci.com/api/v1alpha';
const response=payload=>Response.json(payload);
const sampleReport={base:'https://www.neninternational.com',count:1,failures:1,
 results:[{id:'home-320-light',viewport:{width:320},horizontalOverflow:19,
   failures:['horizontal overflow 19px'],overflowCandidates:[{tag:'div',excessRight:19,width:340,
   parentOverflow:'visible',className:'untrusted-private-css'}]}]};
const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
function mocked(opts={}) {
  const calls=[];
  const read=async(url,init)=>{
    calls.push({url,method:init?.method,headers:init?.headers});
    if(url===base+'/pipelines/'+pipeline) return response({pipeline:{
      ppl_id:pipeline,project_id:opts.project||projectId,wf_id:workflow,
      state:'done',result:'failed',commit_sha:'a'.repeat(40),branch_name:'set-up-semaphore'}});
    if(url===base+'/pipelines/'+pipeline+'?detailed=true')return response({pipeline:{
      project_id:projectId,wf_id:workflow},blocks:[{name:'NEN test',jobs:[{
      job_id:job,name:'Browser',result:'FAILED'}]}]});
    if(url===base+'/logs/'+job) return response({events:[
      {event:'cmd_output',output:'OVERFLOW_DIAGNOSTICS home-320-light secret='+env.SEMAPHORE_TOKEN},
      {event:'cmd_finished',directive:'node scripts/qa/nen-production.mjs',exit_code:1}]});
    if(url.startsWith(base+'/artifacts?'))return response({artifacts:[
      {name:'report.json',path:'qa-intel/nen-production/report.json',size:200},
      {name:'home-320-light.png',path:'qa-intel/nen-production/home-320-light.png',size:12},
      {name:'secret.env',path:'qa-intel/nen-production/secret.env',size:5}]});
    if(url.startsWith(base+'/artifacts/signed_url?')){
      const path=new URL(url).searchParams.get('path');
      return response({items:[{path,url:opts.host||'https://storage.googleapis.com/approved/test'}]});
    }
    if(url.startsWith('https://storage.googleapis.com/')){
      const data=opts.bytes||new TextEncoder().encode(JSON.stringify(sampleReport));
      return new Response(data,{status:200,headers:{'content-type':'application/octet-stream'}});
    }
    throw Error('Unexpected mock URL');
  };
  return {read,calls};
}
test('NEN command registry is Semaphore-only, deny trigger, release, arbitrary fields and cross-project access',()=>{
  assert.equal(valid(command('health')).project.modes.validation,undefined);
  for(const action of ['route','trigger','release','job','recent','artifact_preview','artifact_report','audit','probe'])
    assert.throws(()=>valid(command(action,{pipelineId:pipeline})));
  assert.throws(()=>valid(command('health',{provider:'circleci'})));
  assert.throws(()=>valid(command('health',{provider:'auto'})));
  assert.throws(()=>valid(command('health',{branch:'main'})));
  assert.throws(()=>valid(command('inspect',{pipelineId:pipeline,branch:'main'})));
  assert.throws(()=>valid(command('nen_artifact_preview',{pipelineId:pipeline,artifactPath:'../secret.env'})));
  assert.throws(()=>valid(command('nen_job_diagnostics',{pipelineId:pipeline,jobId:'invalid'})));
  assert.doesNotThrow(()=>valid(command('inspect',{pipelineId:pipeline})));
  assert.doesNotThrow(()=>valid(command('nen_artifact_list',{pipelineId:pipeline})));
  assert.doesNotThrow(()=>valid(command('nen_artifact_report',{pipelineId:pipeline})));
  assert.doesNotThrow(()=>valid(command('nen_job_diagnostics',{pipelineId:pipeline,jobId:job})));
  assert.doesNotThrow(()=>valid(command('nen_artifact_preview',{pipelineId:pipeline,artifactPath:'home-320-light.png'})));
});
test('health uses distinct NEN binding without network access or secret disclosure',async()=>{
  const result=await executeCommand(env,command('health'),valid(command('health')).project,()=>{throw Error('No network')});
  assert.equal(result.project,'nen-website-cms');assert.equal(result.projectConfigured,true);
  assert.equal(result.releasePermitted,false);assert.equal(result.triggerPermitted,true);
  assert.equal(result.triggerScope,'single-reviewed-branch-and-exact-sha');
  assert.ok(!JSON.stringify(result).includes(env.SEMAPHORE_TOKEN));
});
test('cross-project pipeline cannot access details or logs',async()=>{
  const {read,calls}=mocked({project:otherProject});
  await assert.rejects(executeSemaphoreNen(env,command('inspect',{pipelineId:pipeline}),read),/project identity mismatch/);
  assert.equal(calls.length,1);
});
test('owned NEN pipeline reports bounded jobs, exact revision and no secrets',async()=>{
  const {read}=mocked();const result=await executeSemaphoreNen(env,command('inspect',{pipelineId:pipeline}),read);
  assert.equal(result.workflowId,workflow);assert.equal(result.revision,'a'.repeat(40));
  assert.equal(result.blocks[0].jobs[0].id,job);
  assert.ok(!JSON.stringify(result).includes(env.SEMAPHORE_TOKEN));
});
test('NEN job logs return only allowlisted diagnostics, not raw output',async()=>{
  const {read}=mocked();
  const r=await executeSemaphoreNen(env,command('nen_job_diagnostics',{pipelineId:pipeline,jobId:job}),read);
  assert.deepEqual(r.errorKinds,['horizontal_overflow']);
  assert.equal(r.failedCommands[0].exitCode,1);
  assert.ok(!JSON.stringify(r).includes(env.SEMAPHORE_TOKEN));
});
test('an unowned job is denied before log API request',async()=>{
  const {read,calls}=mocked();await assert.rejects(
    executeSemaphoreNen(env,command('nen_job_diagnostics',{pipelineId:pipeline,jobId:otherProject}),read),
    /job ownership mismatch/);
  assert.equal(calls.length,2);
});
test('artifact listing hides unapproved files and signed URLs',async()=>{
  const {read}=mocked();const r=await executeSemaphoreNen(env,command('nen_artifact_list',{pipelineId:pipeline}),read);
  assert.deepEqual(r.files.map(f=>f.name),['report.json','home-320-light.png']);
  assert.ok(!JSON.stringify(r).includes('secret.env'));
});
test('report returns sanitized overflow evidence, not raw page content',async()=>{
  const {read}=mocked();const r=await executeSemaphoreNen(env,command('nen_artifact_report',{pipelineId:pipeline}),read);
  assert.equal(r.failures,1);assert.equal(r.failuresDetail[0].overflowPx,19);
  assert.ok(!JSON.stringify(r).includes('untrusted-private-css'));
});
test('untrusted artifact signing host is rejected before any outbound request',async()=>{
  const {read,calls}=mocked({host:'https://evil.example/exfil'});
  await assert.rejects(executeSemaphoreNen(env,command('nen_artifact_report',{pipelineId:pipeline}),read),/storage host/);
  assert.equal(calls.length,3);
});
test('only named synthetic PNGs can be read',async()=>{
  assert.equal(NEN_SCREENSHOT.test('../.env'),false);
  const {read}=mocked({bytes:png});
  const r=await executeSemaphoreNen(env,command('nen_artifact_preview',{pipelineId:pipeline,artifactPath:'home-320-light.png'}),read);
  assert.equal(r.mediaType,'image/png');assert.equal(r.bytes,png.length);
});
test('malformed QA JSON rejected',async()=>{
  const {read}=mocked({bytes:new TextEncoder().encode(JSON.stringify({...sampleReport,base:'https://evil.example'}))});
  await assert.rejects(executeSemaphoreNen(env,command('nen_artifact_report',{pipelineId:pipeline}),read),/Invalid NEN QA report/);
});

test('missing NEN project binding fails before any Semaphore API request',async()=>{
  let called=false;
  await assert.rejects(executeSemaphoreNen({SEMAPHORE_TOKEN:'private-test-token'},
    command('inspect',{pipelineId:pipeline}),()=>{called=true;throw Error('API must not be called');}),
    /NEN Semaphore project not configured/);
  assert.equal(called,false);
});

test('NEN API permission failure returns only typed HTTP status through private queue',async()=>{
  const values=new Map();
  const kv={get:async key=>values.get(key)??null,put:async(key,val)=>{values.set(key,val);},
    delete:async key=>values.delete(key)};
  const c=command('inspect',{pipelineId:pipeline});
  const result=await processRequest({QUEUE:kv,...env},id,JSON.stringify(c),now,
    async()=>new Response('sensitive response not permitted',{status:403}));
  assert.equal(result.status,'error');
  assert.equal(result.error,'NEN Semaphore API HTTP 403');
  assert.ok(!JSON.stringify(result).includes('sensitive response'));
  assert.ok(!JSON.stringify(result).includes(env.SEMAPHORE_TOKEN));
});

test('NEN artifact summary never permits a caller-selected report path',()=>{
  assert.throws(()=>valid(command('nen_artifact_report',{
    pipelineId:pipeline,artifactPath:'qa-intel/amaraii-os/report.json'})));
  assert.throws(()=>valid(command('nen_artifact_list',{
    pipelineId:pipeline,artifactPath:'qa-intel/nen-production/../private'})));
});

test('typed NEN ownership failures reveal neither foreign IDs nor signed data',async()=>{
  const cases=[
    ['project identity mismatch',{project:otherProject}],
    ['pipeline identity mismatch',{ppl:'11111111-2222-4333-8444-555555555559'}],
    ['workflow identity missing',{wf:'not-a-uuid'}],
  ];
  for(const [kind,fixture] of cases){
    const calls=[];
    const read=async(url)=>{
      calls.push(url);
      return response({pipeline:{ppl_id:fixture.ppl??pipeline,
        project_id:fixture.project??projectId,wf_id:fixture.wf??workflow}});
    };
    await assert.rejects(executeSemaphoreNen(env,command('inspect',{pipelineId:pipeline}),read),
      new RegExp('NEN Semaphore '+kind));
    assert.equal(calls.length,1,'not allowed to query child resources after '+kind);
  }
});
test('detailed NEN pipeline mismatch fails before reading child jobs and artifacts',async()=>{
  const calls=[];
  const read=async(url)=>{
    calls.push(url);
    if(url.endsWith('?detailed=true'))return response({pipeline:{
      project_id:otherProject,wf_id:workflow},blocks:[]});
    return response({pipeline:{ppl_id:pipeline,project_id:projectId,wf_id:workflow}});
  };
  await assert.rejects(executeSemaphoreNen(env,command('inspect',{pipelineId:pipeline}),read),
    /detailed pipeline identity mismatch/);
  assert.equal(calls.length,2);
});

test('typed NEN ownership category is private even if an upstream pipeline refers to another project',async()=>{
  const values=new Map();
  const kv={get:async key=>values.get(key)??null,put:async(key,val)=>{values.set(key,val);},
    delete:async key=>values.delete(key)};
  const c=command('inspect',{pipelineId:pipeline});
  const result=await processRequest({QUEUE:kv,...env},id,JSON.stringify(c),now,
    async()=>response({pipeline:{ppl_id:pipeline,project_id:otherProject,wf_id:workflow,
      internalSecret:env.SEMAPHORE_TOKEN}}));
  assert.equal(result.status,'error');
  assert.equal(result.error,'NEN Semaphore project identity mismatch');
  assert.ok(!JSON.stringify(result).includes(otherProject));
  assert.ok(!JSON.stringify(result).includes(env.SEMAPHORE_TOKEN));
});

test('NEN preview trigger cannot select a different branch, revision, mode or pipeline file',()=>{
  const approved=command('nen_trigger_preview',{branch:NEN_PREVIEW.branch,
    commitSha:NEN_PREVIEW.commitSha,mode:'validation'});
  assert.doesNotThrow(()=>valid(approved));
  for(const input of [
    {branch:'main'}, {branch:'development'},
    {commitSha:'a'.repeat(40)}, {commitSha:'invalid'},
    {mode:'release'}, {mode:null}, {pipelineId:pipeline},
    {artifactPath:'qa-intel/nen-production/report.json'}, {jobId:job},
    {startNumber:1},{jobNumber:1},
  ]) assert.throws(()=>valid({...approved,...input}),/NEN preview revision not permitted/);
  for(const action of ['trigger','release','route']) assert.throws(()=>valid(
    {...approved,action}),/Semaphore action not permitted/);
});
test('NEN preview trigger uses one fixed project, branch, file and exact SHA',async()=>{
  const calls=[];
  const read=async(url,opts)=>{
    calls.push({url,opts});
    return response({workflow_id:workflow,pipeline_id:pipeline});
  };
  const commandInput=command('nen_trigger_preview',{branch:NEN_PREVIEW.branch,
    commitSha:NEN_PREVIEW.commitSha,mode:'validation'});
  const result=await executeCommand(env,commandInput,valid(commandInput).project,read);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,base+'/plumber-workflows');
  assert.equal(calls[0].opts.method,'POST');
  assert.equal(calls[0].opts.redirect,'manual');
  assert.deepEqual(JSON.parse(calls[0].opts.body),{
    project_id:projectId,
    reference:'refs/heads/'+NEN_PREVIEW.branch,
    commit_sha:NEN_PREVIEW.commitSha,
    pipeline_file:'.semaphore/semaphore.yml',
  });
  assert.equal(result.pipelineId,pipeline);
  assert.equal(result.workflowId,workflow);
  assert.equal(result.validationOnly,true);
  assert.equal(result.releasePermitted,false);
  assert.ok(!JSON.stringify(result).includes(env.SEMAPHORE_TOKEN));
});
test('failed or malformed NEN workflow trigger returns only bounded categories',async()=>{
  const c=command('nen_trigger_preview',{branch:NEN_PREVIEW.branch,
    commitSha:NEN_PREVIEW.commitSha,mode:'validation'});
  await assert.rejects(executeSemaphoreNen(env,c,async()=>new Response('secret',{status:403})),
    /NEN Semaphore API HTTP 403/);
  await assert.rejects(executeSemaphoreNen(env,c,async()=>response({workflow_id:'broken',pipeline_id:pipeline})),
    /Invalid NEN preview workflow response/);
  let called=false;
  await assert.rejects(executeSemaphoreNen({SEMAPHORE_NEN_PROJECT_ID:projectId},c,async()=>{called=true;return response({})}),
    /token not configured/);
  assert.equal(called,false);
});
test('NEN QA report accepts only production or pinned corporate PR40 preview origin',async()=>{
  const safe={...sampleReport,base:NEN_PREVIEW.base};
  const bytes=new TextEncoder().encode(JSON.stringify(safe));
  const {read}=mocked({bytes});
  const r=await executeSemaphoreNen(env,command('nen_artifact_report',{pipelineId:pipeline}),read);
  assert.equal(r.passed,0);
  const invalid=new TextEncoder().encode(JSON.stringify({...safe,base:'https://attacker.vercel.app'}));
  const {read:invalidRead}=mocked({bytes:invalid});
  await assert.rejects(executeSemaphoreNen(env,command('nen_artifact_report',{pipelineId:pipeline}),invalidRead),
    /Invalid NEN QA report/);
});

test('NEN preview submission requires approval and cannot switch CI providers',()=>{
  const c=command('nen_trigger_preview',{branch:NEN_PREVIEW.branch,
    commitSha:NEN_PREVIEW.commitSha,mode:'validation'});
  assert.throws(()=>valid({...c,approved:false}),/Explicit approval required/);
  assert.throws(()=>valid({...c,provider:'circleci'}),/NEN website is Semaphore-only/);
  assert.throws(()=>valid({...c,provider:'auto'}),/Automatic CI route not permitted/);
});
