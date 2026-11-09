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
const barBranch='codex/bar-bill-summary-20261107';
const liveBranch='codex/bar-bill-staging-live-base-20261108';
const observeBranch='codex/qa-intel-hosted-observation-20261108';
const protectedObserveBranch='ci/qa-intel-hosted-auth-20261108';
const walkthroughBranch='codex/qa-intel-full-walkthrough-20261109';
const protectedSurveyBranch='ci/qa-intel-walkthrough-survey-20261109';
const barSyntheticReview='codex/qa-intel-bar-synthetic-transactions-20261109';
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
 assert.deepEqual(SEMAPHORE_BRANCHES,[branch,'development',barBranch,liveBranch,observeBranch,protectedObserveBranch,walkthroughBranch,protectedSurveyBranch,barSyntheticReview]);
 assert.equal(validate(command('trigger',{branch:barBranch,mode:'validation',commitSha:revision})).project,PROJECTS['amaraii-os']);
 assert.equal(validate(command('trigger',{branch:liveBranch,mode:'validation',commitSha:revision})).project,PROJECTS['amaraii-os']);
 assert.equal(validate(command('trigger',{branch:observeBranch,mode:'validation',commitSha:revision})).project,PROJECTS['amaraii-os']);
 assert.equal(validate(command('trigger',{branch:protectedObserveBranch,mode:'validation',commitSha:revision})).project,PROJECTS['amaraii-os']);
 assert.equal(validate(command('trigger',{branch:walkthroughBranch,mode:'validation',commitSha:revision})).project,PROJECTS['amaraii-os']);
 assert.equal(validate(command('trigger',{branch:protectedSurveyBranch,mode:'validation',commitSha:revision})).project,PROJECTS['amaraii-os']);
 assert.equal(validate(command('trigger',{branch:barSyntheticReview,mode:'validation',commitSha:revision})).project,PROJECTS['amaraii-os']);
 assert.equal(validate(command('trigger',{branch,mode:'validation',commitSha:revision})).project,PROJECTS['amaraii-os']);
 for(const patch of [
  {branch:'staging',mode:'validation',commitSha:revision},
  {branch:'codex/other-branch',mode:'validation',commitSha:revision},
  {branch:'codex/bar-bill-staging-isolated-20261108',mode:'validation',commitSha:revision},
  {branch:barBranch,mode:'validation',commitSha:revision,pipeline_file:'.semaphore/semaphore.yml'},
  {branch:barBranch,mode:'validation',commitSha:revision,modeOverride:'release'},
  {branch:barBranch,mode:'qa_intel',commitSha:revision},
  {branch:liveBranch,mode:'validation',commitSha:revision,pipeline_file:'.semaphore/semaphore.yml'},
  {branch:liveBranch,mode:'release',commitSha:revision},
  {branch:observeBranch,mode:'release',commitSha:revision},
  {branch:protectedObserveBranch,mode:'release',commitSha:revision},
  {branch:walkthroughBranch,mode:'release',commitSha:revision},
  {branch:protectedSurveyBranch,mode:'release',commitSha:revision},
  {branch:barSyntheticReview,mode:'release',commitSha:revision},
  {branch:barSyntheticReview,mode:'validation',commitSha:revision,pipeline_file:'.semaphore/qa-walkthrough-run.yml'},
  {branch:protectedSurveyBranch,mode:'validation',commitSha:revision,pipeline_file:'.semaphore/qa-walkthrough-review.yml'},
  {branch:walkthroughBranch,mode:'validation',commitSha:revision,pipeline_file:'.semaphore/semaphore.yml'},
  {branch:protectedObserveBranch,mode:'validation',commitSha:revision,pipeline_file:'.semaphore/hosted-observer-review.yml'},
  {branch:observeBranch,mode:'validation',commitSha:revision,pipeline_file:'.semaphore/semaphore.yml'},
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

test('Bar PR97 trigger selects only its fixed synthetic-only pipeline and SHA',async()=>{
 const seen=[];
 const result=await execute(command('trigger',{branch:barBranch,mode:'validation',commitSha:revision}),async(url,init)=>{
   seen.push({url,init});
   return response({workflow_id:workflowId,pipeline_id:pipelineId});
 });
 assert.equal(result.branch,barBranch);
 assert.equal(result.requestedRevision,revision);
 assert.equal(seen.length,1);
 assert.equal(seen[0].url,'https://amaraii.semaphoreci.com/api/v1alpha/plumber-workflows');
 assert.deepEqual(JSON.parse(seen[0].init.body),{
   project_id:projectId,reference:'refs/heads/'+barBranch,
   commit_sha:revision,pipeline_file:'.semaphore/bar-bill-review.yml',
 });
});

test('live-base Bar PR99 is restricted to its reviewed pipeline and exact SHA',async()=>{
 const sent=[];
 const outcome=await execute(command('trigger',{branch:liveBranch,mode:'validation',commitSha:revision}),async(url,init)=>{
  sent.push({url,body:JSON.parse(init.body)});
  return response({workflow_id:workflowId,pipeline_id:pipelineId});
 });
 assert.equal(outcome.requestedRevision,revision);
 assert.equal(sent.length,1);
 assert.equal(sent[0].url,'https://amaraii.semaphoreci.com/api/v1alpha/plumber-workflows');
 assert.deepEqual(sent[0].body,{project_id:projectId,reference:'refs/heads/'+liveBranch,
  commit_sha:revision,pipeline_file:'.semaphore/bar-bill-review.yml'});
});

test('hosted observer validation is confined to its fixed credential-free YAML and exact SHA',async()=>{
 const sent=[];
 const outcome=await execute(command('trigger',{branch:observeBranch,mode:'validation',commitSha:revision}),async(url,init)=>{
  sent.push({url,body:JSON.parse(init.body)});
  return response({workflow_id:workflowId,pipeline_id:pipelineId});
 });
 assert.equal(outcome.requestedRevision,revision);
 assert.deepEqual(sent[0].body,{project_id:projectId,reference:'refs/heads/'+observeBranch,
  commit_sha:revision,pipeline_file:'.semaphore/hosted-observer-review.yml'});
 assert.equal(sent.length,1);
});

test('protected hosted observer is manual, exact-sha and fixed secret-scoped pipeline only',async()=>{
 const sent=[];
 const outcome=await execute(command('trigger',{branch:protectedObserveBranch,mode:'validation',commitSha:revision}),async(url,init)=>{
  sent.push({url,body:JSON.parse(init.body)});
  return response({workflow_id:workflowId,pipeline_id:pipelineId});
 });
 assert.equal(outcome.requestedRevision,revision);
 assert.deepEqual(sent[0].body,{project_id:projectId,reference:'refs/heads/'+protectedObserveBranch,
  commit_sha:revision,pipeline_file:'.semaphore/hosted-auth-observe.yml'});
 assert.equal(sent.length,1);
 assert.throws(()=>validate(command('trigger',{branch:protectedObserveBranch,mode:'validation',commitSha:'bad'})));
});

test('walkthrough pipeline is restricted to fixed secret-free source review, not hosted execution',async()=>{
 const sent=[];
 const out=await execute(command('trigger',{branch:walkthroughBranch,mode:'validation',commitSha:revision}),async(url,init)=>{
  sent.push(JSON.parse(init.body));return response({workflow_id:workflowId,pipeline_id:pipelineId});
 });
 assert.equal(out.requestedRevision,revision);
 assert.deepEqual(sent,[{project_id:projectId,reference:'refs/heads/'+walkthroughBranch,
  commit_sha:revision,pipeline_file:'.semaphore/qa-walkthrough-review.yml'}]);
});

test('protected QA survey trigger uses exact commit and one fixed secret-scoped YAML',async()=>{
 const requests=[];
 const outcome=await execute(command('trigger',{branch:protectedSurveyBranch,mode:'validation',commitSha:revision}),async(url,init)=>{
  requests.push(JSON.parse(init.body));return response({workflow_id:workflowId,pipeline_id:pipelineId});
 });
 assert.equal(outcome.requestedRevision,revision);
 assert.deepEqual(requests,[{project_id:projectId,reference:'refs/heads/'+protectedSurveyBranch,
  commit_sha:revision,pipeline_file:'.semaphore/qa-walkthrough-run.yml'}]);
});

test('PR106 transaction source review has no secrets and cannot deploy',async()=>{
 const requests=[];
 const r=await execute(command('trigger',{branch:barSyntheticReview,mode:'validation',commitSha:revision}),async(url,init)=>{
  requests.push(JSON.parse(init.body));return response({workflow_id:workflowId,pipeline_id:pipelineId});
 });
 assert.equal(r.requestedRevision,revision);
 assert.deepEqual(requests,[{project_id:projectId,reference:'refs/heads/'+barSyntheticReview,
  commit_sha:revision,pipeline_file:'.semaphore/qa-bar-synthetic-review.yml'}]);
});

test('trigger rejects absent credentials, project IDs, upstream failures and malformed responses',async()=>{
 const cmd=command('trigger',{branch,mode:'validation',commitSha:revision});
 await assert.rejects(execute(cmd,()=>{throw Error('network')},{}),/Semaphore project not configured/);
 await assert.rejects(execute(cmd,()=>{throw Error('network')},{SEMAPHORE_PROJECT_ID:projectId}),/Semaphore token not configured/);
 await assert.rejects(execute(cmd,async()=>response({error:'sensitive-token'},403)),/Semaphore API HTTP 403/);
 await assert.rejects(execute(cmd,async()=>response({workflow_id:'bad',pipeline_id:pipelineId})),/Invalid Semaphore response/);
});

test('Semaphore PNG preview requires synthetic QA screenshot path and exact owned workflow',async()=>{
 const filename='qa-intel/screenshots/hospitality-tabs-390.png';
 const commandInput=command('semaphore_png',{pipelineId,artifactPath:filename});
 assert.equal(validate(commandInput).project,PROJECTS['amaraii-os']);
 for(const path of ['qa-intel/survey-report','qa-intel/screenshots/../env.png',
  'qa-intel/screenshots/customer.txt','qa-intel/screenshots/s3cr3t.png?url=evil',
  'other/screenshots/hospitality-tabs-390.png'])
  assert.throws(()=>validate(command('semaphore_png',{pipelineId,artifactPath:path})),
    /preview not permitted/);
 assert.throws(()=>validate(command('semaphore_png',{pipelineId,artifactPath:filename,
   jobId:'99999999-1111-4111-8111-111111111111'})));
 const data=new Uint8Array(120);
 data.set([137,80,78,71,13,10,26,10],0);
 // PNG header width 390, height 900.
 data.set([0,0,1,134,0,0,3,132],16);
 const privateSignedUrl='https://storage.googleapis.com/semaphore-signed/qa.png?X-Goog-Signature=PRIVATE';
 const called=[];
 const result=await execute(commandInput,async url=>{
  called.push(url);
  if(url===privateSignedUrl)return new Response(data,{status:200,headers:{
    'Content-Type':'image/png','Content-Length':String(data.length)}});
  if(url.includes('/artifacts/signed_url?'))return response({items:[
    {path:filename,url:privateSignedUrl}]});
  if(url.includes('/artifacts?'))return response({artifacts:[
    {name:'hospitality-tabs-390.png',path:filename,is_directory:false,size:data.length}]});
  if(url.endsWith('?detailed=true'))return response({pipeline:{wf_id:workflowId,
    project_id:projectId},blocks:[{jobs:[{job_id:'99999999-1111-4111-8111-111111111111',
    name:'Authenticated four-viewport survey; preserve findings without UI fixes',
    status:'FINISHED'}]}]});
  return response({pipeline:{ppl_id:pipelineId,wf_id:workflowId,
    project_id:projectId,branch_name:protectedSurveyBranch}});
 });
 assert.equal(called.length,5);
 assert.equal(result.width,390);
 assert.equal(result.height,900);
 assert.equal(result.bytes,120);
 assert.equal(result.mediaType,'image/png');
 assert.equal(Buffer.from(result.dataBase64,'base64').length,120);
 assert.equal(JSON.stringify(result).includes('X-Goog-Signature'),false);
 assert.equal(JSON.stringify(result).includes(env.SEMAPHORE_TOKEN),false);
});
test('Semaphore screenshot preview cannot access wrong branch or unsafe signed URL',async()=>{
 const filename='qa-intel/screenshots/hospitality-tabs-390.png';
 await assert.rejects(execute(command('semaphore_png',{pipelineId,artifactPath:filename}),
  async()=>response({pipeline:{ppl_id:pipelineId,wf_id:workflowId,
    project_id:projectId,branch_name:'development'}})),/access not permitted/);
 const fn=async url=>{
  if(url.includes('/artifacts/signed_url?'))return response({items:[{path:filename,
    url:'http://127.0.0.1/private'}]});
  if(url.includes('/artifacts?'))return response({artifacts:[{path:filename,
    is_directory:false,size:120}]});
  if(url.endsWith('?detailed=true'))return response({pipeline:{
    wf_id:workflowId,project_id:projectId},blocks:[{jobs:[{job_id:id,
      name:'Authenticated four-viewport survey; preserve findings without UI fixes',
      status:'finished'}]}]});
  return response({pipeline:{ppl_id:pipelineId,wf_id:workflowId,
    project_id:projectId,branch_name:protectedSurveyBranch}});
 };
 await assert.rejects(execute(command('semaphore_png',{pipelineId,
   artifactPath:filename}),fn),/Unsafe artifact URL/);
});

test('Semaphore QA artifact listing verifies owned pipeline and only returns safe filenames',async()=>{
 const jobId='99999999-1111-4111-8111-111111111111';
 const c=command('semaphore_artifacts',{
  pipelineId,jobId,artifactPath:'qa-intel/survey-report'});
 assert.equal(validate(c).project,PROJECTS['amaraii-os']);
 const called=[];
 const output=await execute(c,async url=>{
  called.push(url);
  if(url.endsWith('/artifacts?scope=jobs&scope_id='+jobId+
      '&path=qa-intel%2Fsurvey-report'))
    return response({artifacts:[
      {name:'report.json',path:'qa-intel/survey-report/report.json',size:256,is_directory:false},
      {name:'invalid',path:'qa-intel/../private/token.txt',size:99,is_directory:false},
      {name:'private',path:'other/private.json',size:2,is_directory:false}
    ]});
  if(url.endsWith('?detailed=true'))return response({pipeline:{
    wf_id:workflowId,project_id
   },blocks:[{name:'Protected survey',jobs:[{job_id:jobId,
     name:'Authenticated four-viewport survey; preserve findings without UI fixes'}]}]});
  return response({pipeline:{ppl_id:pipelineId,wf_id:workflowId,
    project_id:projectId,branch_name:protectedSurveyBranch}});
 });
 assert.equal(called.length,3);
 assert.equal(output.scope,'jobs');
 assert.deepEqual(output.artifacts,[{path:'qa-intel/survey-report/report.json',
   directory:false,size:256}]);
 assert.ok(!JSON.stringify(output).includes('private/token'));
});
test('Semaphore artifact listing rejects unsafe paths, foreign branches and foreign jobs',async()=>{
 for(const artifactPath of ['../secrets','qa-intel/../../secrets','agent',
   '/qa-intel','qa-intel/foo','qa-intel/survey-report/../../../env']) {
  assert.throws(()=>validate(command('semaphore_artifacts',{pipelineId,artifactPath})),
   /listing not permitted/);
 }
 assert.throws(()=>validate(command('semaphore_artifacts',{pipelineId,
  jobId:'not-a-uuid'})));
 const basic=fields=>response({pipeline:{ppl_id:pipelineId,wf_id:workflowId,
  project_id:projectId,...fields}});
 await assert.rejects(execute(command('semaphore_artifacts',{pipelineId}),
  async()=>basic({branch_name:'development'})),/access not permitted/);
 await assert.rejects(execute(command('semaphore_artifacts',{pipelineId}),
  async()=>basic({project_id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    branch_name:protectedSurveyBranch})),/project mismatch/);
 await assert.rejects(execute(command('semaphore_artifacts',{
  pipelineId,jobId:'99999999-1111-4111-8111-111111111111'}),
  async url=>url.endsWith('?detailed=true')?
    response({pipeline:{wf_id:workflowId,project_id:projectId},blocks:[]}):
    basic({branch_name:protectedSurveyBranch})),/access not permitted/);
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

test('protected survey inspection reveals only numeric QA results, not full logs',async()=>{
 const id='55555555-6666-4777-8888-999999999999';
 const runId='14bcf147-725e-49ee-aed3-b54faf93df1c';
 const sent=[];
 const r=await execute(command('inspect',{pipelineId}),async url=>{
  sent.push(url);
  if(url.endsWith('/logs/'+id))return response({events:[
    {event:'cmd_started',directive:'pnpm qa:intel:hosted:survey'},
    {event:'cmd_output',output:'Bearer SECRET_DO_NOT_RETURN\n'+JSON.stringify({
      runId,outcome:'SURVEY_COMPLETED_WITH_VISUAL_FINDINGS_TRACKED',
      completed:28,blocked:0,findings:2,output:'/tmp/private/qa-results',
      skippedApps:[{app:'games',reason:'not-admitted'}],
      rawSecret:'SECRET_DO_NOT_RETURN'})+'\n'},
    {event:'cmd_finished',exit_code:0},
  ]});
  if(url.endsWith('?detailed=true'))return response({pipeline:{wf_id:workflowId,project_id:projectId},
    blocks:[{name:'Protected survey',state:'DONE',result:'PASSED',jobs:[
      {job_id:id,name:'Authenticated four-viewport survey; preserve findings without UI fixes',
        status:'FINISHED',result:'PASSED'}
    ]}]});
  return response({pipeline:{ppl_id:pipelineId,wf_id:workflowId,project_id:projectId,
    state:'done',result:'passed',branch_name:protectedSurveyBranch,commit_sha:revision}});
 });
 assert.equal(sent.length,3);
 assert.deepEqual(r.survey,{runId,outcome:'SURVEY_COMPLETED_WITH_VISUAL_FINDINGS_TRACKED',
  completed:28,blocked:0,findings:2,skippedApps:[{app:'games',reason:'not-admitted'}]});
 assert.equal(JSON.stringify(r).includes('SECRET_DO_NOT_RETURN'),false);
 assert.equal(JSON.stringify(r).includes('/tmp/private'),false);
});

test('failed owned Semaphore job yields bounded redacted command diagnostics',async()=>{
 const jobId='55555555-6666-4777-8888-999999999999';
 const calls=[];
 const cmd=command('inspect',{pipelineId});
 const result=await execute(cmd,async(url)=>{
  calls.push(url);
  if(url.endsWith('/logs/'+jobId))return response({events:[
   {event:'cmd_started',directive:'pnpm typecheck'},
   {event:'cmd_output',output:'Error: cannot find module @example\\nBAR_TABS_OVERFLOW viewport=320 documentWidth=342\\nError: Authorization: Bearer super-secret-value\\nERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL\\n'},
   {event:'cmd_finished',directive:'pnpm typecheck',exit_code:1},
  ]});
  if(url.endsWith('?detailed=true'))return response({
   pipeline:{wf_id:workflowId,project_id:projectId},
   blocks:[{name:'Bar validation',state:'DONE',result:'FAILED',jobs:[
    {job_id:jobId,name:'Tests',status:'FINISHED',result:'FAILED'},
   ]}],
  });
  return response({pipeline:{ppl_id:pipelineId,wf_id:workflowId,project_id:projectId,
   state:'done',result:'failed',branch_name:barBranch,commit_sha:revision}});
 });
 assert.equal(calls.length,3);
 assert.equal(result.result,'failed');
 assert.equal(result.failure.jobId,jobId);
 assert.equal(result.failure.failedCommand,'pnpm typecheck');
 assert.equal(result.failure.exitCode,1);
 assert.match(result.failure.diagnosticLines.join(' '),/cannot find module/);
 assert.match(result.failure.diagnosticLines.join(' '),/BAR_TABS_OVERFLOW/);
 assert.equal(JSON.stringify(result).includes('super-secret-value'),false);
 assert.equal(JSON.stringify(result).includes(env.SEMAPHORE_TOKEN),false);
 assert.equal(JSON.stringify(result).includes('https://'),false);
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
