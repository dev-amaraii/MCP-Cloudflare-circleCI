import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECTS, validateCommand, executeCommand } from '../src/index.mjs';

const id='11111111-2222-4333-8444-555555555555';
const pipelineId='22222222-3333-4444-8555-666666666666';
const jobId='33333333-4444-4555-8666-777777777777';
const path='qa-intel/churchpro/agent-handoff.json';
const sourceUrl='https://output.circle-artifacts.com/private/report.json';
const time='2026-10-25T08:00:00.000Z';
const project=PROJECTS.churchpro;
const cmd={v:1,id,project:'churchpro',action:'artifact_report',pipelineId,jobId,jobNumber:49,
  artifactPath:path,requestedAt:time,approved:true};
const report={schemaVersion:1,product:'ChurchPro',phase:'phase-0',revision:'a'.repeat(40),
  evidenceStatus:'passed',productAcceptance:'pending_independent_qa_review',
  checks:[{intent:'guest_can_find_the_accessible_phone_and_password_signin',
    status:'passed',failureLayer:null,rootCause:'private stack details'}],
  private:'never return arbitrary report keys'};
const response=x=>Response.json(x);
function transport({foreign=false,body=report,source=sourceUrl}={}) {
  const requests=[];
  const send=async (url,options)=>{
    requests.push({url,headers:options?.headers});
    if(url.endsWith('/pipeline/'+pipelineId))
      return response({project_slug:foreign?'another-project':project.slug});
    if(url.endsWith('/pipeline/'+pipelineId+'/workflow'))
      return response({items:[{id:'flow'}]});
    if(url.endsWith('/workflow/flow/job'))
      return response({items:[{id:jobId,job_number:49,project_slug:project.slug}]});
    if(url.endsWith('/49/artifacts'))
      return response({items:[{path,url:source}]});
    if(url===source)
      return new Response(new TextEncoder().encode(JSON.stringify(body)),
        {headers:{'content-type':'application/json'}});
    throw Error('Unexpected mock request: '+url);
  };
  return {send,requests};
}
test('strictly restrict the QA report to the ChurchPro handoff',()=>{
  assert.equal(validateCommand(cmd,id,Date.parse(time)).project,project);
  for(const changes of [
    {project:'amaraii-os'}, {project:'jayson-storefront'},
    {artifactPath:'qa-intel/churchpro/member-data.json'},
    {artifactPath:'qa-intel/transactions/report.json'},
    {artifactPath:'../private.json'}, {pipelineId:'wrong'},
    {jobNumber:0}, {mode:'validation'},
  ]) assert.throws(()=>validateCommand({...cmd,...changes},id,Date.parse(time)),
    /Artifact report not permitted/);
});
test('return only sanitized QA decisions, never arbitrary raw keys or artifact URL',async()=>{
  const t=transport();
  const value=await executeCommand({CIRCLE_TOKEN:'synthetic'},cmd,project,t.send);
  assert.equal(value.evidenceStatus,'passed');
  assert.equal(value.productAcceptance,'pending_independent_qa_review');
  assert.equal(value.checks[0].intent,report.checks[0].intent);
  assert.equal(value.checks[0].status,'passed');
  assert.equal(JSON.stringify(value).includes('private stack details'),false);
  assert.equal(JSON.stringify(value).includes('never return'),false);
  assert.equal(JSON.stringify(value).includes('circle-artifacts.com'),false);
});
test('do not retrieve foreign-pipeline reports',async()=>{
  const t=transport({foreign:true});
  await assert.rejects(()=>executeCommand({CIRCLE_TOKEN:'synthetic'},cmd,project,t.send),
    /Pipeline project mismatch/);
  assert.equal(t.requests.some(x=>x.url.includes('/artifacts')),false);
});
test('reject invalid acceptance schema even when JSON is parseable',async()=>{
  for(const body of [{...report,product:'other'}, {...report,checks:[]},
    {...report,productAcceptance:'accepted'},
    {...report,checks:[{intent:'../../secrets',status:'passed'}]}]) {
    const t=transport({body});
    await assert.rejects(()=>executeCommand({CIRCLE_TOKEN:'synthetic'},cmd,project,t.send),
      /Invalid QA handoff/);
  }
});
test('never forward CircleCI credentials to redirected signed storage',async()=>{
  const t=transport();
  const signed='https://circleci-tasks-prod.s3.us-east-1.amazonaws.com/qa.json';
  const requests=[];
  const send=async(url,options)=>{
    if(url===sourceUrl)return new Response(null,{status:302,headers:{location:signed}});
    if(url===signed){
      requests.push(options.headers);
      return new Response(new TextEncoder().encode(JSON.stringify(report)),
        {headers:{'content-type':'application/json'}});
    }
    return t.send(url,options);
  };
  const value=await executeCommand({CIRCLE_TOKEN:'synthetic'},cmd,project,send);
  assert.equal(value.evidenceStatus,'passed');
  assert.equal(Object.hasOwn(requests[0],'Circle-Token'),false);
});
test('reject oversized reports before consuming their contents',async()=>{
  const t=transport();
  const send=async(url,options)=>{
    if(url===sourceUrl)return new Response('{}',{headers:{'content-type':'application/json','content-length':'65537'}});
    return t.send(url,options);
  };
  await assert.rejects(()=>executeCommand({CIRCLE_TOKEN:'synthetic'},cmd,project,send),
    /Artifact too large/);
});
