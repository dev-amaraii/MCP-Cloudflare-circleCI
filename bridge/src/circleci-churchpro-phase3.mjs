/**
 * Narrow, read-only ChurchPro Phase 3 artifact retrieval.
 * Exact immutable CircleCI workflow/job/SHA only. No caller URL or project.
 * The returned source-pinned synthetic JSON stays in private Cloudflare KV.
 */
const API2='https://circleci.com/api/v2';
const API3='https://circleci.com/api/v3';
const SLUG='circleci/B65DMdC1ZhAJQM74t7SrZ1/HQvs3kNUw3sJb4jVVJizHu';
export const CHURCHPRO_PHASE3_PIN=Object.freeze({
  workflowId:'8ebee112-676d-49a2-bdd7-079efcddee37',
  pipelineId:'2f686f4e-9270-4603-b83a-f91c84885c4b',
  jobId:'044fbd4c-e1f8-4c2e-b79a-7abad2e7b2d6',
  sourceRevision:'317a55e8412def1fbfb53dee486b1c737c4e6361',
  jobName:'gather_browser',
});
export const CHURCHPRO_PHASE3_PATHS=Object.freeze([
  'qa-intel/churchpro/phase3-execution-smoke.json',
  'qa-intel/churchpro/phase3-independent-review-intake.json',
  'qa-intel/churchpro/phase3-reviewer-handoff.json',
]);
const MAX_BYTES=350000;
const CASES=Object.freeze([
  ...Array.from({length:12},(_,i)=>'UAT-'+String(i+1).padStart(2,'0')),
  ...Array.from({length:12},(_,i)=>'A'+String(i+1).padStart(2,'0')),
]);
const CASE_FIELDS=new Set(['id','status','observedHttp','dbDelta','observationKind','diagnostic','caseProof']);
const ASSERT_FIELDS=new Set(['services','sessions','buckets','marks','counts','countUpdates','requests','affiliations','suspended','audits','linkedAudits','expected_attendance_audit_action','expected_membership_audit_action','sibling_branch_mutations','authorized_branch_service','unexpected_record_removal']);
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const HEX64=/^[a-f0-9]{64}$/;
function check(ok,code){if(!ok)throw Error(code);}
function isObject(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function token(env){check(typeof env?.CIRCLE_TOKEN==='string'&&env.CIRCLE_TOKEN.length>0,'CircleCI token not configured');return env.CIRCLE_TOKEN;}
async function json(env,url,requestFn){
  check(url.startsWith(API2+'/')||url.startsWith(API3+'/'),'ChurchPro Phase3 API origin denied');
  const res=await requestFn(url,{method:'GET',redirect:'manual',headers:{Authorization:'Bearer '+token(env),Accept:'application/json'}});
  check(res.ok,'ChurchPro Phase3 upstream unavailable');
  const body=await res.json();
  check(isObject(body),'ChurchPro Phase3 invalid provider JSON');
  return body;
}
function checkedPath(command){
  check(isObject(command)&&command.project==='churchpro'&&command.provider==='circleci'&&
    command.action==='churchpro_phase3_artifact' &&
    command.pipelineId===CHURCHPRO_PHASE3_PIN.workflowId &&
    command.jobId===CHURCHPRO_PHASE3_PIN.jobId &&
    CHURCHPRO_PHASE3_PATHS.includes(command.artifactPath) &&
    Object.keys(command).every(k=>['project','provider','action','pipelineId','jobId','artifactPath'].includes(k)),
    'ChurchPro Phase3 artifact action denied');
}
function trusted(value){
  check(typeof value==='string','ChurchPro Phase3 artifact URL denied');
  let url;try{url=new URL(value);}catch{throw Error('ChurchPro Phase3 artifact URL denied');}
  const h=url.hostname.toLowerCase();
  check(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&
    (h==='circleci.com'||h==='circle-artifacts.com'||h.endsWith('.circle-artifacts.com')||
     h==='circleci-tasks-prod.s3.us-east-1.amazonaws.com'||h==='s3.amazonaws.com'||h.endsWith('.s3.amazonaws.com')),
    'ChurchPro Phase3 artifact URL denied');
  return url;
}
async function artifactBytes(env,origin,requestFn){
  let url=trusted(origin);
  for(let attempt=0;attempt<3;attempt++){
    const h=url.hostname;
    const auth=h==='circleci.com'||h==='circle-artifacts.com'||h.endsWith('.circle-artifacts.com');
    const headers=auth?{'Circle-Token':token(env),Accept:'application/json'}:{Accept:'application/json'};
    const res=await requestFn(url.href,{method:'GET',redirect:'manual',headers});
    if([301,302,303,307,308].includes(res.status)){
      check(!!res.headers.get('location'),'ChurchPro Phase3 artifact download denied');
      url=trusted(new URL(res.headers.get('location'),url).href);
      continue;
    }
    check(res.ok&&!!res.body&&typeof res.body.getReader==='function','ChurchPro Phase3 artifact download denied');
    const contentLength=Number(res.headers.get('content-length')||0);
    check(!contentLength||contentLength<=MAX_BYTES,'ChurchPro Phase3 artifact too large');
    const reader=res.body.getReader(),chunks=[];let bytes=0;
    try{for(;;){const item=await reader.read();if(item.done)break;bytes+=item.value.byteLength;check(bytes<=MAX_BYTES,'ChurchPro Phase3 artifact too large');chunks.push(item.value);}}
    finally{await reader.cancel().catch(()=>{});}
    check(bytes>0,'ChurchPro Phase3 artifact download denied');
    const out=new Uint8Array(bytes);let offset=0;
    for(const part of chunks){out.set(part,offset);offset+=part.length;}
    return out;
  }
  throw Error('ChurchPro Phase3 artifact redirect limit');
}
function validProof(proof){
  if(!isObject(proof)||proof.kind!=='restricted_runtime_rls_target_correlated_summary'||proof.state!=='consistent'||
    !Array.isArray(proof.assertions)||proof.assertions.length<11||proof.assertions.length>16)return false;
  const seen=new Set();
  for(const a of proof.assertions){
    if(!isObject(a)||Object.keys(a).length!==4||!ASSERT_FIELDS.has(a.key)||seen.has(a.key)||
      !Number.isSafeInteger(a.expected)||!Number.isSafeInteger(a.observed)||
      a.expected<0||a.observed<0||a.expected>500||a.observed>500||
      a.passed!==true||a.observed!==a.expected)return false;
    seen.add(a.key);
  }
  return true;
}
function validReport(path,value){
  const pin=CHURCHPRO_PHASE3_PIN;
  check(isObject(value)&&value.schemaVersion===1,'ChurchPro Phase3 invalid case schema');
  const rev=path===CHURCHPRO_PHASE3_PATHS[2]?value.sourceRevision:value.revision;
  check(rev===pin.sourceRevision,'ChurchPro Phase3 revision mismatch');
  check(Array.isArray(value.cases)&&value.cases.length===CASES.length&&
    value.cases.every((c,i)=>isObject(c)&&c.id===CASES[i]),'ChurchPro Phase3 invalid case schema');
  if(path===CHURCHPRO_PHASE3_PATHS[0]){
    check(value.environment===undefined&&value.evidenceKind==='synthetic_execution_not_human_uat'&&
      value.status==='completed'&&value.humanUatExecuted===0&&value.humanAcceptance==='not_started'&&
      UUID.test(value.runId||'')&&value.processExit==='success',
      'ChurchPro Phase3 synthetic source invalid');
    for(const [i,c] of value.cases.entries()){
      check(Object.keys(c).every(k=>CASE_FIELDS.has(k)),'ChurchPro Phase3 unsafe case field');
      const fault=i===11||i===23;
      check(fault?c.status==='not_exercised':c.status==='http_rehearsed'&&
        Array.isArray(c.observedHttp)&&c.observedHttp.length>0&&c.observedHttp.length<=12&&
        c.observedHttp.every(s=>Number.isInteger(s)&&s>=100&&s<=599)&&validProof(c.caseProof),
        'ChurchPro Phase3 unexpected case evidence');
    }
  }else if(path===CHURCHPRO_PHASE3_PATHS[1]){
    check(value.project==='ChurchPro'&&value.acceptancePolicy==='independent_qa_intel_v1'&&
      value.phase==='phase-3-independent-acceptance-intake'&&value.independentAgentReviewPerformed===false&&
      value.releaseAuthorized===false&&value.accepted===0&&value.blocked===24&&value.rejected===0&&
      value.cases.every(c=>c.verdict==='blocked'),
      'ChurchPro Phase3 review intake invalid');
  }else{
    check(value.project==='ChurchPro'&&value.kind==='independent_qa_agent_review_handoff_not_a_verdict'&&
      value.independentReviewPerformed===false&&value.independentApiAcceptance==='NOT_YET_GRANTED'&&
      value.releaseAuthorized===false&&value.ordinaryCases===22&&
      value.originalCaseCount===24&&HEX64.test(value.originalArtifactSha256||'')&&
      HEX64.test(value.intakeArtifactSha256||'')&&
      value.cases.every(c=>c.preliminaryDisposition==='BLOCKED'),
      'ChurchPro Phase3 review handoff invalid');
  }
  return value;
}
export async function readCircleCiChurchProPhase3(env,command,requestFn=fetch){
  checkedPath(command);
  const pin=CHURCHPRO_PHASE3_PIN;
  const workflow=await json(env,API2+'/workflow/'+pin.workflowId,requestFn);
  check(workflow.id===pin.workflowId&&workflow.pipeline_id===pin.pipelineId,
    'ChurchPro Phase3 workflow identity mismatch');
  const pipeline=await json(env,API2+'/pipeline/'+pin.pipelineId,requestFn);
  check(pipeline.id===pin.pipelineId&&pipeline.project_slug===SLUG&&
    (pipeline.vcs?.revision===undefined||pipeline.vcs.revision===pin.sourceRevision),
    'ChurchPro Phase3 project or source mismatch');
  const jobs=await json(env,API2+'/workflow/'+pin.workflowId+'/job',requestFn);
  check(Array.isArray(jobs.items)&&jobs.items.some(j=>j.id===pin.jobId&&j.name===pin.jobName&&
    j.project_slug===SLUG&&j.status==='success'),'ChurchPro Phase3 job ownership mismatch');
  const artifacts=await json(env,API3+'/jobs/'+pin.jobId+'/artifacts',requestFn);
  check(Array.isArray(artifacts.data)&&!artifacts.page?.next,'ChurchPro Phase3 artifact listing invalid');
  const matches=artifacts.data.filter(a=>a.attributes?.path===command.artifactPath);
  check(matches.length===1&&typeof matches[0].attributes?.url==='string',
    'ChurchPro Phase3 artifact not found');
  const bytes=await artifactBytes(env,matches[0].attributes.url,requestFn);
  let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw Error('ChurchPro Phase3 JSON invalid');}
  validReport(command.artifactPath,data);
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))
    .map(x=>x.toString(16).padStart(2,'0')).join('');
  return {project:'churchpro',provider:'circleci',sourceRevision:pin.sourceRevision,
    providerRevisionVerified:pipeline.vcs?.revision===pin.sourceRevision,
    jobId:pin.jobId,artifactPath:command.artifactPath,artifactSha256:sha,
    byteLength:bytes.length,evidenceKind:'private_synthetic_unreviewed',
    independentAcceptance:'NOT_YET_GRANTED',releasePermitted:false,content:data};
}
