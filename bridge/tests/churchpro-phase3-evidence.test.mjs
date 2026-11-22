import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readCircleCiChurchProPhase3, CHURCHPRO_PHASE3_PIN,CHURCHPRO_PHASE3_PATHS,
} from '../src/circleci-churchpro-phase3.mjs';

const PIN=CHURCHPRO_PHASE3_PIN;
const env={CIRCLE_TOKEN:'synthetic-token-not-a-secret'};
const cmd=(path=CHURCHPRO_PHASE3_PATHS[0])=>({
  project:'churchpro',provider:'circleci',action:'churchpro_phase3_artifact',
  pipelineId:PIN.workflowId,jobId:PIN.jobId,artifactPath:path,
});
const ids=[
  ...Array.from({length:12},(_,i)=>'UAT-'+String(i+1).padStart(2,'0')),
  ...Array.from({length:12},(_,i)=>'A'+String(i+1).padStart(2,'0')),
];
const proof=()=>({
  kind:'restricted_runtime_rls_target_correlated_summary',
  state:'consistent',
  assertions:['services','sessions','buckets','marks','counts','countUpdates','requests',
    'affiliations','suspended','audits','linkedAudits']
    .map(key=>({key,expected:0,observed:0,passed:true})),
});
function report(){
  return {
    schemaVersion:1,revision:PIN.sourceRevision,
    evidenceKind:'synthetic_execution_not_human_uat',status:'completed',
    humanUatExecuted:0,humanAcceptance:'not_started',
    processExit:'success',runId:'ee5f0000-0000-4000-8000-000000000001',
    cases:ids.map(id=>id==='UAT-12'||id==='A12'
      ? {id,status:'not_exercised'}
      : {id,status:'http_rehearsed',observedHttp:[200],caseProof:proof(),
        observationKind:'automated_aggregate_read_only_not_human_approval',dbDelta:{}}),
  };
}
function intake(){
  return {
    schemaVersion:1,revision:PIN.sourceRevision,project:'ChurchPro',
    phase:'phase-3-independent-acceptance-intake',
    acceptancePolicy:'independent_qa_intel_v1',independentAgentReviewPerformed:false,
    releaseAuthorized:false,accepted:0,blocked:24,rejected:0,
    cases:ids.map(id=>({id,verdict:'blocked'})),
  };
}
function handoff(){
  return {schemaVersion:1,sourceRevision:PIN.sourceRevision,project:'ChurchPro',
    kind:'independent_qa_agent_review_handoff_not_a_verdict',
    independentReviewPerformed:false,independentApiAcceptance:'NOT_YET_GRANTED',
    releaseAuthorized:false,ordinaryCases:22,originalCaseCount:24,
    originalArtifactSha256:'a'.repeat(64),intakeArtifactSha256:'b'.repeat(64),
    cases:ids.map(id=>({id,preliminaryDisposition:'BLOCKED'})),
  };
}
function mock(path,value,opts={}){
  const calls=[];
  const artifactUrl=opts.url||'https://test-gh.circle-artifacts.com/qa.json';
  const respond=async (url,init={})=>{
    calls.push({url,headers:init.headers});
    if(url==='https://circleci.com/api/v2/workflow/'+PIN.workflowId)
      return Response.json({id:PIN.workflowId,pipeline_id:opts.pipelineId||PIN.pipelineId});
    if(url==='https://circleci.com/api/v2/pipeline/'+PIN.pipelineId)
      return Response.json({id:PIN.pipelineId,project_slug:opts.projectSlug||
        'circleci/B65DMdC1ZhAJQM74t7SrZ1/HQvs3kNUw3sJb4jVVJizHu',
        vcs:{revision:opts.revision||PIN.sourceRevision}});
    if(url==='https://circleci.com/api/v2/workflow/'+PIN.workflowId+'/job')
      return Response.json({items:[{id:PIN.jobId,name:'gather_browser',
        project_slug:'circleci/B65DMdC1ZhAJQM74t7SrZ1/HQvs3kNUw3sJb4jVVJizHu',
        status:opts.jobStatus||'success'}]});
    if(url==='https://circleci.com/api/v3/jobs/'+PIN.jobId+'/artifacts')
      return Response.json({data:[{attributes:{path,url:artifactUrl,size:100}}]});
    if(url===artifactUrl)return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
    throw Error('unexpected mock request '+url);
  };
  return {request:respond,calls};
}

test('three source-pinned private reports are read-only, unapproved and SHA-digested',async()=>{
  for(const [path,data] of [[CHURCHPRO_PHASE3_PATHS[0],report()],
    [CHURCHPRO_PHASE3_PATHS[1],intake()],
    [CHURCHPRO_PHASE3_PATHS[2],handoff()]]){
    const f=mock(path,data);
    const result=await readCircleCiChurchProPhase3(env,cmd(path),f.request);
    assert.equal(result.artifactPath,path);
    assert.equal(result.sourceRevision,PIN.sourceRevision);
    assert.equal(result.independentAcceptance,'NOT_YET_GRANTED');
    assert.equal(result.releasePermitted,false);
    assert.match(result.artifactSha256,/^[0-9a-f]{64}$/);
    assert.equal(result.content.cases.length,24);
    assert.ok(f.calls.every(c=>!c.url.includes('evil')));
  }
});

test('rejects arbitrary paths, wrong job and caller-provided fields before provider access',async()=>{
  const f=mock(CHURCHPRO_PHASE3_PATHS[0],report());
  for(const invalid of [
    {...cmd(),artifactPath:'qa-intel/churchpro/agent-handoff.json'},
    {...cmd(),jobId:'11111111-1111-4111-8111-111111111111'},
    {...cmd(),branch:'main'},
    {...cmd(),commitSha:PIN.sourceRevision},
    {...cmd(),provider:'semaphore'},
  ])await assert.rejects(readCircleCiChurchProPhase3(env,invalid,f.request),
    /ChurchPro Phase3 artifact action denied/);
  assert.equal(f.calls.length,0);
});

test('rejects forged pipeline source, cross-project ownership and failing job',async()=>{
  for(const opts of [
    {pipelineId:'11111111-1111-4111-8111-111111111111'},
    {revision:'a'.repeat(40)},
    {projectSlug:'circleci/foreign/project'},
    {jobStatus:'failed'},
  ])await assert.rejects(readCircleCiChurchProPhase3(env,cmd(),
    mock(CHURCHPRO_PHASE3_PATHS[0],report(),opts).request),
    /ChurchPro Phase3 (workflow identity|project or source|job ownership) mismatch/);
});

test('rejects unsafe extra case payload and unsolicited acceptance',async()=>{
  const a=report();a.cases[0].rawEmail='person@real.example';
  await assert.rejects(readCircleCiChurchProPhase3(env,cmd(),
    mock(CHURCHPRO_PHASE3_PATHS[0],a).request),/unsafe case field/);
  const b=handoff();b.independentApiAcceptance='ACCEPTED';
  await assert.rejects(readCircleCiChurchProPhase3(env,cmd(CHURCHPRO_PHASE3_PATHS[2]),
    mock(CHURCHPRO_PHASE3_PATHS[2],b).request),/review handoff invalid/);
});

test('never follows artifact redirects to an arbitrary host',async()=>{
  const f=mock(CHURCHPRO_PHASE3_PATHS[0],report(),{url:'https://evil.example/artifact.json'});
  await assert.rejects(readCircleCiChurchProPhase3(env,cmd(),f.request),
    /artifact URL denied/);
  assert.equal(f.calls.some(x=>x.url==='https://evil.example/artifact.json'),false);
});
