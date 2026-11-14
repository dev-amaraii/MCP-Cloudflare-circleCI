import test from 'node:test';
import assert from 'node:assert/strict';
import {executeSemaphoreUrban,URBAN_SEMAPHORE} from '../src/semaphore-urban.mjs';
const id='4c489f68-230b-4303-b59e-ebaa633e8f77',pipelineId='c28d0d18-8935-4c73-ae64-3613a8b3f1f9',workflowId='cc4f55f5-c85b-4079-8fe1-883978b4c42f';
const sha='4a3f2c895f5938e3028535f8a6710fc89708f9fa';
const env={SEMAPHORE_TOKEN:'synthetic-never-real',SEMAPHORE_PROJECT_ID_URBAN_DESIGN_PAINT:id};
const cmd=(action,extras={})=>({project:'urban-design-paint',provider:'semaphore',action,...extras});
const ok=data=>({ok:true,json:async()=>data});
test('health does not reveal credentials',async()=>{
  const r=await executeSemaphoreUrban(env,cmd('health'),()=>{throw Error('unexpected fetch');});
  assert.equal(r.projectConfigured,true);assert.equal(r.tokenConfigured,true);
  assert.equal(JSON.stringify(r).includes(env.SEMAPHORE_TOKEN),false);
});
test('trigger is limited to a pinned branch and trusted workflow path',async()=>{
  let request;
  const r=await executeSemaphoreUrban(env,cmd('trigger',{branch:URBAN_SEMAPHORE.branch,mode:'validation',commitSha:sha}),
    async(url,options)=>{request={url,options};return ok({workflow_id:workflowId,pipeline_id:pipelineId});});
  assert.equal(request.url,'https://amaraii.semaphoreci.com/api/v1alpha/plumber-workflows');
  assert.deepEqual(JSON.parse(request.options.body),{project_id:id,reference:'refs/heads/feat/site-foundation-homepage',commit_sha:sha,pipeline_file:'.semaphore/semaphore.yml'});
  assert.equal(r.pipelineId,pipelineId);
});
test('reject wrong branch and malformed SHA before contacting provider',async()=>{
  for(const extras of [{branch:'main',mode:'validation',commitSha:sha},{branch:URBAN_SEMAPHORE.branch,mode:'validation',commitSha:'abc'}]){
    await assert.rejects(executeSemaphoreUrban(env,cmd('trigger',extras),()=>{throw Error('unexpected fetch');}),/revision not permitted/);
  }
});
test('reject foreign-project inspection',async()=>{
  await assert.rejects(executeSemaphoreUrban(env,cmd('inspect',{pipelineId}),async()=>ok({pipeline:{project_id:workflowId,ppl_id:pipelineId}})),/project mismatch/);
});
test('inspection returns bounded and sanitised results only',async()=>{
  let calls=0;
  const result=await executeSemaphoreUrban(env,cmd('inspect',{pipelineId}),async()=>{
    calls++;
    return ok(calls===1?{pipeline:{project_id:id,ppl_id:pipelineId,state:'done',result:'passed',branch_name:URBAN_SEMAPHORE.branch,commit_sha:sha}}:{pipeline:{project_id:id},blocks:[{name:'Validation',state:'done',result:'passed',jobs:[{job_id:workflowId,name:'Tests',status:'finished',result:'passed'}]}]});
  });
  assert.equal(result.vcs.revision,sha);assert.equal(result.blocks[0].jobs[0].result,'passed');
});

test('bundle download requires proven passed pipeline, exact path and trusted host',async()=>{
  let calls=0;
  const cmdBundle=cmd('urban_preview_bundle',{pipelineId,branch:URBAN_SEMAPHORE.branch,commitSha:sha,artifactPath:'preview-bundle/urban-paints-preview.tgz'});
  const bytes=new Uint8Array([31,139,8,0,1,2,3,4,5,6,7,8,9,10]);
  const fetchMock=async(url)=>{
    calls++;
    if(url.includes('/pipelines/'))return ok({pipeline:{project_id:id,ppl_id:pipelineId,wf_id:workflowId,branch_name:URBAN_SEMAPHORE.branch,commit_sha:sha,state:'done',result:'passed'}});
    if(url.includes('/artifacts/signed_url'))return ok({items:[{path:'preview-bundle/urban-paints-preview.tgz',url:'https://storage.googleapis.com/test/urban-preview.tar.gz?signature=synthetic'}]});
    if(url.startsWith('https://storage.googleapis.com/'))return new Response(bytes,{status:200,headers:{'content-type':'application/octet-stream'}});
    throw Error('Unexpected fetch path');
  };
  const result=await executeSemaphoreUrban(env,cmdBundle,fetchMock);
  assert.equal(calls,3);assert.equal(result.bytes,bytes.length);
  assert.equal(result.encoding,'gzip+tar');
  assert.equal(JSON.stringify(result).includes('signature='),false);
});
test('bundle cannot be obtained from foreign pipeline',async()=>{
  const bundle=cmd('urban_preview_bundle',{pipelineId,branch:URBAN_SEMAPHORE.branch,commitSha:sha,artifactPath:'preview-bundle/urban-paints-preview.tgz'});
  await assert.rejects(executeSemaphoreUrban(env,bundle,async()=>ok({pipeline:{project_id:workflowId,ppl_id:pipelineId,wf_id:workflowId,state:'done',result:'passed'}})),/provenance mismatch/);
});
test('bundle rejects untrusted signed hosts',async()=>{
  const bundle=cmd('urban_preview_bundle',{pipelineId,branch:URBAN_SEMAPHORE.branch,commitSha:sha,artifactPath:'preview-bundle/urban-paints-preview.tgz'});
  await assert.rejects(executeSemaphoreUrban(env,bundle,async(url)=>{
    if(url.includes('/pipelines/'))return ok({pipeline:{project_id:id,ppl_id:pipelineId,wf_id:workflowId,branch_name:URBAN_SEMAPHORE.branch,commit_sha:sha,state:'done',result:'passed'}});
    if(url.includes('/artifacts/signed_url'))return ok({items:[{path:'preview-bundle/urban-paints-preview.tgz',url:'https://evil.example/asset'}]});
    throw Error('Should not fetch untrusted host');
  }),/Unsafe Urban artifact URL/);
});
