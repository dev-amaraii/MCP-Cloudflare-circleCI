import test from "node:test";
import assert from "node:assert/strict";
import {executePr109Evidence,PR109,PR109_LATEST} from "../src/amaraii-pr109-evidence.mjs";
import {validateCommand} from "../src/index.mjs";
import {executeSemaphore} from "../src/semaphore.mjs";

const projectId="11111111-1111-4111-8111-111111111111";
const pipelineId="22222222-2222-4222-8222-222222222222";
const workflowId="33333333-3333-4333-8333-333333333333";
const origin="https://amaraii.semaphoreci.com/api/v1alpha";
const pngPath="historical-service/screenshots/historical-service-390.png";
const reportPath="historical-service/REPORT.md";
const env={SEMAPHORE_PROJECT_ID:projectId,SEMAPHORE_TOKEN:"SENSITIVE_TEST_TOKEN"};
const base={project:"amaraii-os",provider:"semaphore"};
const cmd=(action,more={})=>({...base,action,pipelineId,...more});
const response=(value,status=200,headers={"content-type":"application/json"})=>
  new Response(JSON.stringify(value),{status,headers});
function fakePng(){
  const bytes=new Uint8Array(40);bytes.set([137,80,78,71,13,10,26,10]);
  const v=new DataView(bytes.buffer);v.setUint32(16,390);v.setUint32(20,900);
  return bytes;
}
function fake(overrides={}){
 const calls=[];
 const files=[
  {path:"historical-service/screenshots",is_directory:true},
  {path:"historical-service/qa-intel",is_directory:true},
  {path:reportPath,is_directory:false,size:150},
  {path:pngPath,is_directory:false,size:40},
 ];
 const fetchFn=async (url, options={})=>{
  calls.push({url,options});
  if (url.startsWith(origin+"/pipelines?")) return response({pipelines:[
    {ppl_id:pipelineId},{ppl_id:"77777777-7777-4777-8777-777777777777"},
  ]});
  if (url===origin+"/pipelines/"+pipelineId) return response({pipeline:{
    ppl_id:pipelineId,project_id:projectId,branch_name:overrides.branch||PR109.branch,
    commit_sha:overrides.sha||PR109.sha, wf_id:workflowId,
    state:"done",result:"passed",
  }});
  if (url===origin+"/pipelines/"+pipelineId+"?detailed=true")return response({
    pipeline:{project_id:projectId,wf_id:workflowId},
    blocks:[{jobs:[{job_id:PR109.jobId,name:PR109.jobName,
      status:"finished",result:"passed"}]}],
  });
  if (url.startsWith(origin+"/artifacts/signed_url?")) {
    const target=overrides.signedUrl||"https://storage.googleapis.com/synthetic-qa/pr109";
    return response({items:[{path:url.includes(encodeURIComponent(pngPath))?pngPath:reportPath,url:target}]});
  }
  if (url.startsWith(origin+"/artifacts?")) {
    const folder=new URL(url).searchParams.get("path");
    const entries=folder==="historical-service" ? files.slice(0,3) :
      files.filter(x=>x.path.startsWith(folder+"/"));
    return response({artifacts:entries});
  }
  if(url.startsWith("https://")){
    if (overrides.fileTooBig) return new Response(fakePng(),{
      headers:{"content-type":"image/png","content-length":"2000000"}});
    if(overrides.mime) return new Response(fakePng(),{
      headers:{"content-type":overrides.mime}});
    if(overrides.redirect) return new Response(null,{
      status:302,headers:{location:"https://evil.example/artifact"}});
    return new Response(url===overrides.reportUrl||overrides.mode==="report" ?
      "# Synthetic QA report\nPASS\n":fakePng(),{
      headers:{"content-type":overrides.mode==="report"?"text/plain":"image/png"},
    });
  }
  return response({error:"not mocked",url},404);
 };
 return {calls,fetchFn};
}
test("reads only the new exact passed PT screenshot pipeline and preserves old access",async()=>{
 const fetchFn=async(url)=>{
  if(url===origin+"/pipelines/"+PR109_LATEST.pipelineId) return response({pipeline:{
    ppl_id:PR109_LATEST.pipelineId,project_id:projectId,
    branch_name:PR109_LATEST.branch,commit_sha:PR109_LATEST.sha,
    wf_id:workflowId,state:"done",result:"passed",
  }});
  if(url===origin+"/pipelines/"+PR109_LATEST.pipelineId+"?detailed=true")
   return response({pipeline:{project_id:projectId,wf_id:workflowId},blocks:[{jobs:[{
    job_id:PR109_LATEST.jobId,name:PR109_LATEST.jobName,
    status:"finished",result:"passed",
   }]}]});
  if(url.startsWith(origin+"/artifacts?"))return response({artifacts:[
    {path:"historical-service/screenshots/historical-service-390.png",
     is_directory:false,size:40},
  ]});
  return response({error:"unexpected request"},404);
 };
 const actual=await executePr109Evidence(env,cmd("pr109_artifacts",{
  pipelineId:PR109_LATEST.pipelineId,
  artifactPath:"historical-service/screenshots",
 }),fetchFn);
 assert.equal(actual.revision,PR109_LATEST.sha);
 assert.equal(actual.jobId,PR109_LATEST.jobId);
 assert.equal(actual.artifacts.length,1);
 const old=await executePr109Evidence(env,cmd("pr109_artifacts"),fake().fetchFn);
 assert.equal(old.revision,PR109.sha);
 assert.equal(old.jobId,PR109.jobId);
});

test("discovers only a passed SHA-pinned Amaraii job",async()=>{
 const mock=fake();
 const found=await executePr109Evidence(env,{...base,action:"pr109_discover"},mock.fetchFn);
 assert.equal(found.pipelineId,pipelineId);
 assert.equal(found.revision,PR109.sha);
 assert.equal(found.jobId,PR109.jobId);
 assert(mock.calls.every(c=>!c.url.includes(env.SEMAPHORE_TOKEN)));
});
test("lists only owned job-scope artifacts and no signed URLs",async()=>{
 const mock=fake();
 const v=await executePr109Evidence(env,cmd("pr109_artifacts"),mock.fetchFn);
 assert.equal(v.scope,undefined);
 assert(v.artifacts.some(f=>f.path===reportPath));
 assert(!JSON.stringify(v).includes(env.SEMAPHORE_TOKEN));
 assert(!JSON.stringify(v).includes("storage.googleapis.com"));
});
test("returns a checked, synthetic PNG but no provider URL",async()=>{
 const mock=fake();
 const v=await executePr109Evidence(env,cmd("pr109_png",{artifactPath:pngPath}),mock.fetchFn);
 assert.equal(v.mediaType,"image/png");
 assert.equal(v.width,390);
 assert.equal(v.height,900);
 assert(v.dataBase64.length>10);
 assert(!JSON.stringify(v).includes("storage.googleapis.com"));
 assert(mock.calls.filter(c=>c.url.startsWith("https://storage.googleapis.com")).every(c=>
   !c.options.headers?.Authorization));
});
test("rejects scope escape, path traversal, and arbitrary file downloads",async()=>{
 const bad=["../REPORT.md","historical-service/private.png",
  "historical-service/qa-intel/../sensitive.png",
  "historical-service/screenshots/any.png",
  "historical-service/screenshots/historical-service-390.png?x=1"];
 for(const path of bad){
  await assert.rejects(executePr109Evidence(env,cmd("pr109_png",{artifactPath:path}),fake().fetchFn));
 }
 await assert.rejects(executePr109Evidence(env,cmd("pr109_report",{artifactPath:"historical-service/qa-intel/secret.env"}),fake().fetchFn));
 await assert.rejects(executePr109Evidence(env,cmd("pr109_artifacts",{artifactPath:"historical-service/../../"}),fake().fetchFn));
});
test("rejects wrong branch and wrong revision before any signed URL request",async()=>{
 for(const values of [{branch:"development"},{sha:"a".repeat(40)}]){
   const mock=fake(values);
   await assert.rejects(executePr109Evidence(env,cmd("pr109_png",{artifactPath:pngPath}),mock.fetchFn),
     /ownership mismatch/);
   assert(!mock.calls.some(c=>c.url.includes("/artifacts/signed_url")));
 }
});
test("rejects untrusted signed hosts, redirects and oversized content",async()=>{
 for(const overrides of [{signedUrl:"https://evil.example/qa.png"},
   {redirect:true},{fileTooBig:true}]){
   const mock=fake(overrides);
   await assert.rejects(executePr109Evidence(env,cmd("pr109_png",{artifactPath:pngPath}),mock.fetchFn));
 }
});
test("returns a bounded text report with no signed URL",async()=>{
 const mock=fake({mode:"report"});
 const v=await executePr109Evidence(env,cmd("pr109_report",{artifactPath:reportPath}),mock.fetchFn);
 assert.match(v.report,/Synthetic QA report/);
 assert.equal(v.action,"pr109_report");
 assert(!JSON.stringify(v).includes("https://storage.googleapis.com"));
});
test("cannot act as deployment, provider trigger, or cross-tenant proxy",async()=>{
 for(const wrong of [
   {...base,action:"trigger"}, {...base,project:"churchpro",action:"pr109_discover"},
   {...base,provider:"circleci",action:"pr109_discover"},
 ])await assert.rejects(executePr109Evidence(env,wrong,fake().fetchFn));
});

test("admits bounded QA-Intel run JSON for this pinned job only",()=>{
 const now=Date.now(),id="66666666-6666-4666-8666-666666666666";
 const common={v:1,id,project:"amaraii-os",provider:"semaphore",approved:true,
   requestedAt:new Date(now).toISOString(),pipelineId};
 assert.doesNotThrow(()=>validateCommand({...common,action:"pr109_report",
   artifactPath:"historical-service/qa-intel/run.json"},id,now));
 assert.doesNotThrow(()=>validateCommand({...common,action:"pr109_artifacts",
   artifactPath:"historical-service/qa-intel/artifacts"},id,now));
 assert.throws(()=>validateCommand({...common,action:"pr109_report",
   artifactPath:"historical-service/qa-intel/results.db"},id,now));
});

test("Queue validator accepts only reviewed, bounded PR109 command shapes",()=>{
 const now=Date.now();
 const id="66666666-6666-4666-8666-666666666666";
 const baseEnvelope={id,v:1,project:"amaraii-os",provider:"semaphore",
   approved:true,requestedAt:new Date(now).toISOString()};
 assert.doesNotThrow(()=>validateCommand({...baseEnvelope,action:"pr109_discover"},id,now));
 assert.doesNotThrow(()=>validateCommand({...baseEnvelope,action:"pr109_artifacts",
   pipelineId,artifactPath:"historical-service/screenshots"},id,now));
 assert.doesNotThrow(()=>validateCommand({...baseEnvelope,action:"pr109_png",
   pipelineId,artifactPath:pngPath},id,now));
 for(const bad of [
   {action:"pr109_discover",branch:"development"},
   {action:"pr109_discover",commitSha:PR109.sha},
   {action:"pr109_report",pipelineId,artifactPath:"../../private.env"},
   {action:"pr109_artifacts",pipelineId,artifactPath:"qa-intel"},
   {action:"pr109_png",pipelineId,jobNumber:12,artifactPath:pngPath},
   {action:"pr109_artifacts",pipelineId,jobId:PR109.jobId},
   {action:"pr109_png",pipelineId,artifactPath:pngPath,provider:"circleci"},
   {action:"pr109_png",pipelineId,artifactPath:pngPath,project:"churchpro"},
 ])assert.throws(()=>validateCommand({...baseEnvelope,...bad},id,now));
});

test("PR110 integration validation cannot trigger for another revision or project",async()=>{
 const id="66666666-6666-4666-8666-666666666666",now=Date.now();
 const branch="feat/gym-historical-reconciliation-integration-20261113";
 const commitSha="712cd7c414ae332f3cfbc026ca699567920f0994";
 const command={v:1,id,action:"trigger",project:"amaraii-os",provider:"semaphore",
   branch,commitSha,mode:"validation",approved:true,requestedAt:new Date(now).toISOString()};
 assert.doesNotThrow(()=>validateCommand(command,id,now));
 assert.throws(()=>validateCommand({...command,commitSha:"a".repeat(40)},id,now),
   /PR110 validation revision not permitted/);
 const calls=[];
 const mock=async(url,options)=>{calls.push({url,options});
   return response({workflow_id:"33333333-3333-4333-8333-333333333333",
     pipeline_id:"22222222-2222-4222-8222-222222222222"});};
 const result=await executeSemaphore(env,command,mock);
 assert.equal(result.requestedRevision,commitSha);
 assert.equal(calls.length,1);
 const body=JSON.parse(calls[0].options.body);
 assert.deepEqual(body,{project_id:projectId,reference:"refs/heads/"+branch,
   commit_sha:commitSha,pipeline_file:".semaphore/semaphore.yml"});
 await assert.rejects(executeSemaphore(env,{...command,commitSha:"b".repeat(40)},mock),
   /PR110 validation revision not permitted/);
 assert.equal(calls.length,1);
});

test("PR109 Semaphore run is exactly pinned and never accepts another branch revision",async()=>{
 const now=Date.now(),id="66666666-6666-4666-8666-666666666666";
 const branch="feat/gym-historical-service-review-20261112";
 const commitSha="43690eef91cf5fa1e35bee7257312c2cb2586f48";
 const envelope={v:1,id,action:"trigger",project:"amaraii-os",
   provider:"semaphore",branch,commitSha,mode:"validation",
   approved:true,requestedAt:new Date(now).toISOString()};
 assert.doesNotThrow(()=>validateCommand(envelope,id,now));
 assert.throws(()=>validateCommand({...envelope,commitSha:"a".repeat(40)},id,now),
   /PR109 validation revision not permitted/);
 assert.throws(()=>validateCommand({...envelope,artifactPath:"secret.env"},id,now));
 const calls=[];
 const mock=async(url,options)=>{
   calls.push({url,options});
   return response({workflow_id:"33333333-3333-4333-8333-333333333333",
     pipeline_id:"22222222-2222-4222-8222-222222222222"});
 };
 const allowed=await executeSemaphore(env,envelope,mock);
 assert.equal(allowed.requestedRevision,commitSha);
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,origin+"/plumber-workflows");
 assert.deepEqual(JSON.parse(calls[0].options.body),{
   project_id:projectId,
   reference:"refs/heads/"+branch,
   commit_sha:commitSha,
   pipeline_file:".semaphore/semaphore.yml",
 });
 await assert.rejects(executeSemaphore(env,{...envelope,commitSha:"b".repeat(40)},mock),
   /PR109 validation revision not permitted/);
 assert.equal(calls.length,1);
});
