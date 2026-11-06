import test from 'node:test';
import assert from 'node:assert/strict';
import {PROJECTS,validateCommand,executeCommand,processRequest} from '../src/index.mjs';
import {SEMAPHORE_BRANCHES} from '../src/semaphore.mjs';

const id='11111111-2222-4333-8444-555555555555';
const pipelineId='22222222-3333-4444-8555-666666666666';
const workflowId='33333333-4444-4555-8666-777777777777';
const projectId='44444444-5555-4666-8777-888888888888';
const revision='a'.repeat(40);
const now=Date.parse('2026-11-06T17:00:00Z');
const branch='ci/semaphore-validation-20261106';
const command=(action,fields={})=>({
 v:1,id,action,project:'amaraii-os',provider:'semaphore',
 requestedAt:new Date(now).toISOString(),approved:true,...fields,
});
const env={SEMAPHORE_TOKEN:'test-secret-token',SEMAPHORE_PROJECT_ID:projectId};
const validate=(c)=>validateCommand(c,id,now);
const execute=(c,fetcher,context=env)=>executeCommand(context,c,validate(c).project,fetcher);
const response=(body,status=200)=>Response.json(body,{status});
class KV {
 values=new Map();
 async get(key){return this.values.get(key)??null;}
 async put(key,value){this.values.set(key,value);}
 async delete(key){this.values.delete(key);}
}

test('Semaphore is opt-in, validation-only and pins the current pilot branch and exact revision',()=>{
 assert.deepEqual(SEMAPHORE_BRANCHES,[branch]);
 assert.equal(validate(command('trigger',{branch,mode:'validation',commitSha:revision})).project,PROJECTS['amaraii-os']);
 for(const patch of [
  {branch:'development',mode:'validation',commitSha:revision},
  {branch,mode:'validation'},
  {branch,mode:'qa_intel',commitSha:revision},
  {branch,mode:'validation',commitSha:'bad'},
  {branch,mode:'validation',commitSha:revision,project:'churchpro'},
  {branch,mode:'validation',commitSha:revision,provider:'other'},
  {branch,mode:'validation',commitSha:revision,unrecognized:'injection'},
 ]) assert.throws(()=>validate(command('trigger',patch)));
 for(const action of ['release','job','recent','artifact_preview','audit','job_steps','probe'])
  assert.throws(()=>validate(command(action)));
 // Existing CircleCI commands retain their implicit provider.
 const circle={...command('health'),provider:undefined};
 assert.equal(validate(circle).project,PROJECTS['amaraii-os']);
});

test('health is read-only and reports configuration without disclosing the secret',async()=>{
 const outcome=await execute(command('health'),()=>{throw Error('unexpected network')});
 assert.equal(outcome.provider,'semaphore');
 assert.equal(outcome.tokenConfigured,true);
 assert.equal(outcome.projectConfigured,true);
 assert.equal(JSON.stringify(outcome).includes(env.SEMAPHORE_TOKEN),false);
 assert.equal((await execute(command('health'),()=>{throw Error('network')},{})).tokenConfigured,false);
 assert.throws(()=>validate(command('health',{commitSha:revision})));
});

test('trigger sends only SHA-pinned Amaraii validation to the pinned Semaphore organization',async()=>{
 const seen=[];
 const result=await execute(command('trigger',{branch,mode:'validation',commitSha:revision}),async(url,init)=>{
  seen.push({url,init});
  return response({workflow_id:workflowId,pipeline_id:pipelineId});
 });
 assert.equal(result.pipelineId,pipelineId);
 assert.equal(result.workflowId,workflowId);
 assert.equal(result.requestedRevision,revision);
 assert.equal(seen.length,1);
 assert.equal(seen[0].url,'https://amaraii.semaphoreci.com/api/v1alpha/plumber-workflows');
 assert.equal(seen[0].init.method,'POST');
 assert.equal(seen[0].init.redirect,'manual');
 assert.equal(seen[0].init.headers.Authorization,'Token '+env.SEMAPHORE_TOKEN);
 assert.equal(seen[0].init.headers['User-Agent'],'SemaphoreCI v2.0 Client');
 assert.deepEqual(JSON.parse(seen[0].init.body),{
  project_id:projectId,reference:'refs/heads/'+branch,
  commit_sha:revision,pipeline_file:'.semaphore/semaphore.yml',
 });
 assert.equal(JSON.stringify(result).includes(env.SEMAPHORE_TOKEN),false);
});

test('trigger rejects absent credentials, project IDs, upstream failures and malformed responses',async()=>{
 const cmd=command('trigger',{branch,mode:'validation',commitSha:revision});
 await assert.rejects(execute(cmd,()=>{throw Error('network')},{}),/Semaphore project not configured/);
 await assert.rejects(execute(cmd,()=>{throw Error('network')},{SEMAPHORE_PROJECT_ID:projectId}),/Semaphore token not configured/);
 await assert.rejects(execute(cmd,async()=>response({error:'sensitive-token'},403)),/Semaphore API HTTP 403/);
 await assert.rejects(execute(cmd,async()=>response({workflow_id:'bad',pipeline_id:pipelineId})),/Invalid Semaphore response/);
});

test('inspect validates project ownership before detailed job lookup',async()=>{
 const calls=[];
 const cmd=command('inspect',{pipelineId});
 await assert.rejects(execute(cmd,async url=>{
  calls.push(url);
  return response({pipeline:{ppl_id:pipelineId,project_id:'99999999-9999-4999-8999-999999999999'}});
 }),/Semaphore project mismatch/);
 assert.equal(calls.length,1);
 assert.throws(()=>validate(command('inspect',{pipelineId,commitSha:revision})));
});

test('inspect returns bounded job metadata, verified revision, and no raw logs or signed links',async()=>{
 const calls=[];
 const cmd=command('inspect',{pipelineId});
 const result=await execute(cmd,async url=>{
  calls.push(url);
  if(url.endsWith('?detailed=true'))return response({
   pipeline:{wf_id:workflowId,project_id:projectId},
   blocks:[{name:'Test n Build',state:'done',result:'passed',
     jobs:[{job_id:'55555555-6666-4777-8888-999999999999',
       name:'QA safety',status:'FINISHED',result:'PASSED',
       secret:'DO_NOT_ECHO',log_url:'https://sensitive.example'}]}],
  });
  return response({pipeline:{ppl_id:pipelineId,wf_id:workflowId,project_id:projectId,
    state:'done',result:'passed',branch_name:branch,commit_sha:revision,
    signed_url:'https://sensitive.example'}});
 });
 assert.equal(calls.length,2);
 assert.equal(result.provider,'semaphore');
 assert.equal(result.vcs.revision,revision);
 assert.equal(result.result,'passed');
 assert.equal(result.blocks[0].jobs[0].result,'passed');
 assert.equal(JSON.stringify(result).includes('DO_NOT_ECHO'),false);
 assert.equal(JSON.stringify(result).includes('sensitive.example'),false);
});

test('failed provider requests are redacted in the queue result and never replayed',async()=>{
 const kv=new KV();
 const c=command('trigger',{branch,mode:'validation',commitSha:revision});
 const outcome=await processRequest({QUEUE:kv,...env},id,JSON.stringify(c),now,
  async()=>response({secret:env.SEMAPHORE_TOKEN},429));
 assert.equal(outcome.status,'error');
 assert.equal(outcome.error,'Semaphore API HTTP 429');
 assert.equal(JSON.stringify(outcome).includes(env.SEMAPHORE_TOKEN),false);
 const again=await processRequest({QUEUE:kv,...env},id,JSON.stringify(c),now,()=>{
  throw Error('should not repeat paid run');
 });
 assert.equal(again.skipped,true);
});
