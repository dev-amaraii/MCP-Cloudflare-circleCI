/**
 * Explicit, validation-only Semaphore adapter for Amaraii.
 * This never receives caller-supplied URLs, project IDs or YAML paths.
 * A small, explicit branch-to-pipeline allowlist prevents arbitrary CI YAML
 * execution. No automatic billable failover or deploy access is granted.
 */
const API = 'https://amaraii.semaphoreci.com/api/v1alpha';
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SHA = /^[a-f0-9]{40}$/;
const SEMAPHORE_PIPELINES = Object.freeze({
  'ci/semaphore-validation-20261106': '.semaphore/semaphore.yml',
  'feat/gym-historical-service-review-20261112': '.semaphore/semaphore.yml',
  'feat/gym-historical-reconciliation-integration-20261113': '.semaphore/semaphore.yml',
  'codex/historical-minimum-records-review-20261114': '.semaphore/semaphore.yml',
  'codex/gym-editable-membership-dates-implementation-20261115': '.semaphore/semaphore.yml',
  'codex/gym-history-date-fixes-20261116': '.semaphore/semaphore.yml',
  development: '.semaphore/semaphore.yml',
  'codex/bar-bill-summary-20261107': '.semaphore/bar-bill-review.yml',
  'codex/bar-bill-staging-live-base-20261108': '.semaphore/bar-bill-review.yml',
  'codex/qa-intel-hosted-observation-20261108': '.semaphore/hosted-observer-review.yml',
  'ci/qa-intel-hosted-auth-20261108': '.semaphore/hosted-auth-observe.yml',
  'codex/qa-intel-full-walkthrough-20261109': '.semaphore/qa-walkthrough-review.yml',
  'ci/qa-intel-walkthrough-survey-20261109': '.semaphore/qa-walkthrough-run.yml',
  'codex/qa-intel-bar-synthetic-transactions-20261109': '.semaphore/qa-bar-synthetic-review.yml',
});
export const SEMAPHORE_BRANCHES = Object.freeze(Object.keys(SEMAPHORE_PIPELINES));

function projectId(env) {
  if (typeof env.SEMAPHORE_PROJECT_ID !== 'string' || !UUID.test(env.SEMAPHORE_PROJECT_ID)) {
    throw new Error('Semaphore project not configured');
  }
  return env.SEMAPHORE_PROJECT_ID;
}

async function semaphoreRequest(env, path, body, requestFn) {
  if (typeof env.SEMAPHORE_TOKEN !== 'string' || !env.SEMAPHORE_TOKEN) {
    throw new Error('Semaphore token not configured');
  }
  const res = await requestFn(API + path, {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'manual',
    headers: {
      Authorization: 'Token ' + env.SEMAPHORE_TOKEN,
      Accept: 'application/json',
      'User-Agent': 'SemaphoreCI v2.0 Client',
      ...(body === undefined ? {} : {'Content-Type':'application/json'}),
    },
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  });
  if (!res.ok) throw new Error('Semaphore API HTTP ' + res.status);
  const data = await res.json();
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid Semaphore response');
  }
  return data;
}

// Semaphore API signed artifact links are consumed inside this private Worker.
// Never return a signed URL, redirect to caller-supplied hosts, or send the
// Semaphore API credential to cloud storage. Synthetic QA screenshots only.
const PNG_MAX_BYTES=1600000;
function trustedSemaphoreArtifactHost(url){
  const host=url.hostname.toLowerCase();
  return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&(
    host==='storage.googleapis.com'||host.endsWith('.storage.googleapis.com')||
    host==='s3.amazonaws.com'||host.endsWith('.s3.amazonaws.com')||
    /^[a-z0-9.-]+\.s3\.[a-z0-9-]+\.amazonaws\.com$/.test(host)||
    host==='artifacts.semaphoreci.com'||host.endsWith('.artifacts.semaphoreci.com')
  );
}
async function downloadSyntheticQaPng(signedUrl,requestFn=fetch){
  let url;
  try{url=new URL(signedUrl);}catch{throw Error('Unsafe artifact URL');}
  for(let i=0;i<3;i++){
    if(!trustedSemaphoreArtifactHost(url))throw Error('Unsafe artifact URL');
    const response=await requestFn(url.toString(),{
      method:'GET',redirect:'manual',headers:{Accept:'image/png'}});
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get('location');
      if(!location)throw Error('Artifact download failed');
      url=new URL(location,url);
      continue;
    }
    if(!response.ok||!response.body)throw Error('Artifact download failed');
    const announced=Number(response.headers.get('content-length')||0);
    if(!Number.isFinite(announced)||announced>PNG_MAX_BYTES)throw Error('Artifact too large');
    const type=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()||'';
    if(type&&!['image/png','application/octet-stream'].includes(type))
      throw Error('Artifact format not supported');
    const chunks=[],reader=response.body.getReader();
    let count=0;
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      count+=value.length;
      if(count>PNG_MAX_BYTES){await reader.cancel();throw Error('Artifact too large');}
      chunks.push(value);
    }
    if(count<33)throw Error('Artifact format not supported');
    const bytes=new Uint8Array(count);let p=0;
    for(const part of chunks){bytes.set(part,p);p+=part.length;}
    const png=[137,80,78,71,13,10,26,10];
    if(!png.every((v,i)=>bytes[i]===v))throw Error('Artifact format not supported');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const width=view.getUint32(16),height=view.getUint32(20);
    if(width<320||width>2000||height<400||height>20000)
      throw Error('Artifact format not supported');
    let binary='';
    for(let i=0;i<bytes.length;i+=16000)
      binary+=String.fromCharCode(...bytes.subarray(i,i+16000));
    return {mediaType:'image/png',width,height,bytes:count,dataBase64:btoa(binary)};
  }
  throw Error('Artifact download failed');
}

function safeValue(value, allowed) {
  return typeof value === 'string' && allowed.includes(value.toLowerCase())
    ? value.toLowerCase() : null;
}

// Only a bounded subset of failed job output is returned to the private bridge.
// Do not expose full logs, environment dumps, URLs, credentials or artifact links.
function failureSummary(payload) {
  const events=Array.isArray(payload.events)?payload.events.slice(0,6000):[];
  let current=null,lastFailure=null;
  for(const event of events){
    if(!event||typeof event!=='object')continue;
    if(event.event==='cmd_started') current={command:typeof event.directive==='string'?event.directive.slice(0,160):'',output:''};
    if(event.event==='cmd_output'&&current&&typeof event.output==='string'){
      current.output=(current.output+event.output.slice(0,4000)).slice(-64000);
    }
    if(event.event==='cmd_finished'&&current){
      if(Number.isInteger(event.exit_code)&&event.exit_code!==0){
        if(!lastFailure)lastFailure={command:current.command,exitCode:event.exit_code,output:current.output};
      }
      current=null;
    }
  }
  if(!lastFailure)return null;
  const scrub=s=>s.replace(/\bAuthorization\s*:\s*(?:Bearer|Token)\s+\S+/gi,'Authorization: [redacted]')
    .replace(/\b(?:Bearer|Token)\s+\S+/gi,'[redacted]')
    .replace(/\b(?:SEMAPHORE_TOKEN|CIRCLE_TOKEN|API_KEY|PASSWORD|SECRET|TOKEN)\s*[:=]\s*\S+/gi,'[redacted]')
    .replace(/(?:https?|postgres(?:ql)?):\/\/\S+/gi,'[url]')
    .replace(/\b(?:Authorization|Bearer|Token|Password|Secret|ApiKey)\s*(?:[:=]|\s)\s*[^\s]+/gi,'[redacted]')
    .replace(/\b(?:ghp_|github_pat_|sk-|semaphore_)[A-Za-z0-9_-]+/gi,'[redacted]')
    .slice(0,800);
  const lines=lastFailure.output.split(/\r?\n/).filter(Boolean);
  const focus=lines.filter(line=>/BAR_TABS_OVERFLOW|BAR_TABS_(?:QA|OPEN_RETRY)_STAGE|BAR_TAB_SETTLEMENT_QA_STAGE|P2_DESKTOP_STAGE|MANAGER_BROWSER_ERROR/i.test(line)||
    (lastFailure.command.includes('gym-reconciliation-workbench.browser.spec.ts')&&/Locator:|waiting for|toBeVisible()/i.test(line)));
  const relevant=lines.filter(line=>/\berror\b|ERR_|fail|cannot |not found|missing|ENOENT|TS\d+|assert|expected|denied|invalid|EACCES|SyntaxError|TypeError|\bfatal\b/i.test(line));
  const targetBrowser=lastFailure.command.includes('historical-import-workspace.browser.spec.ts') ?
    lines.findLastIndex(line=>line.includes('preserves unsaved manual edits while switching P2 source review at 1280px')) : -1;
  const browserDetails=targetBrowser<0?[]:lines.slice(targetBrowser, targetBrowser+24);

  // Only exact, synthetic source-review viewport figures; never pass raw logs, DOM text or URLs.
  const sourceOverflows=[];
  if(lastFailure.command.includes('gym-source-review.browser.spec.ts')){
    const rx=/\{"viewport":(?:320|390|1280),"scrollWidth":\d+,"offenders":\[/g;
    for(const match of lastFailure.output.matchAll(rx)){
      const begin=match.index;
      let depth=0,inString=false,escaped=false,end=-1;
      for(let i=begin;i<Math.min(lastFailure.output.length,begin+11000);i++){
        const c=lastFailure.output[i];
        if(inString){
          if(escaped)escaped=false;
          else if(c==='\\')escaped=true;
          else if(c==='"')inString=false;
        } else {
          if(c==='"')inString=true;
          else if(c==='{')depth++;
          else if(c==='}'&&--depth===0){end=i+1;break;}
        }
      }
      if(end<0)continue;
      try{
        const record=JSON.parse(lastFailure.output.slice(begin,end));
        if(![320,390,1280].includes(record.viewport)||!Number.isInteger(record.scrollWidth)||
           record.scrollWidth>30000||!Array.isArray(record.offenders))continue;
        sourceOverflows.push({
          viewport:record.viewport,scrollWidth:record.scrollWidth,
          offenders:record.offenders.slice(0,8).map(x=>({
            tag:typeof x.tag==='string'&&/^[a-z]+$/i.test(x.tag)?x.tag:'unknown',
            testId:typeof x.testId==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(x.testId)?x.testId:null,
            className:typeof x.className==='string'
              ?x.className.replace(/[^a-zA-Z0-9 _:/\[\].%#(),+!=\-]/g,'').slice(0,100):'',
            left:Number.isFinite(x.left)?Math.round(x.left):null,
            right:Number.isFinite(x.right)?Math.round(x.right):null,
            width:Number.isFinite(x.width)?Math.round(x.width):null,
            whiteSpace:['normal','nowrap','pre','pre-wrap','pre-line','break-spaces'].includes(x.whiteSpace)?x.whiteSpace:null,
          })),
        });
        if(sourceOverflows.length===3)break;
      }catch{}
    }
  }


  // Only whitelisted test-file locations (line/column); no log text or customer content.
  const sourceReviewLocations=lastFailure.command.includes('gym-source-review.browser.spec.ts')
    ? [...lastFailure.output.replace(/\x1b\[[0-9;]*m/g,'')
      .matchAll(/(?:test\/)?gym-source-review\.browser\.spec\.ts:(\d{1,4}):(\d{1,4})/g)]
        .slice(0,15).map(m=>({line:Number(m[1]),column:Number(m[2])}))
        .filter(x=>x.line>0&&x.line<=2000&&x.column>0&&x.column<=2000)
    : [];

  return {...(sourceReviewLocations.length?{sourceReviewLocations}:{}),...(sourceOverflows.length?{sourceOverflows}:{}),failedCommand:scrub(lastFailure.command),exitCode:lastFailure.exitCode,
    diagnosticLines:[...new Set([...focus.slice(-6),...browserDetails,...(relevant.length?relevant.slice(-18):lines.slice(-6))])].slice(-32).map(scrub)};
}

/**
 * Extract only bounded, non-sensitive QA results from the job's stdout.
 * The underlying logs can contain tokens, URLs and customer data; never return
 * them, and only inspect exact project-owned protected-survey jobs.
 */
function safeQaSurveySummary(logs) {
  const events=Array.isArray(logs?.events)?logs.events.slice(-6000):[];
  const tail=events.filter(e=>e?.event==='cmd_output'&&typeof e.output==='string')
    .map(e=>e.output.slice(0,2500)).join('').slice(-32000);
  for(const line of tail.split(/\r?\n/).slice(-250).reverse()){
    const sample=line.trim();
    if(!sample.startsWith('{"runId":')||sample.length>4000)continue;
    let data;
    try { data=JSON.parse(sample); } catch { continue; }
    const valid=Number.isInteger(data.completed)&&data.completed>=0&&data.completed<=500&&
      Number.isInteger(data.blocked)&&data.blocked>=0&&data.blocked<=500&&
      Number.isInteger(data.findings)&&data.findings>=0&&data.findings<=500;
    if(!UUID.test(data.runId||'')||!valid||
      !['SURVEY_COMPLETED_WITH_VISUAL_FINDINGS_TRACKED','PARTIAL_WITH_BLOCKERS','BLOCKED'].includes(data.outcome))continue;
    const allowedApps=['gymnalysis','bookings','hospitality','games'];
    const allowedReasons=['not-admitted','not-entitled','branch-not-admitted'];
    const skipped=(Array.isArray(data.skippedApps)?data.skippedApps:[]).slice(0,4)
      .filter(x=>allowedApps.includes(x?.app)&&allowedReasons.includes(x?.reason))
      .map(x=>({app:x.app,reason:x.reason}));
    return {runId:data.runId,outcome:data.outcome,
      completed:data.completed,blocked:data.blocked,findings:data.findings,
      skippedApps:skipped};
  }
  return null;
}

export async function executeSemaphore(env, command, requestFn = fetch) {
  if (command.action === 'health') {
    return {
      provider:'semaphore', project:command.project,
      tokenConfigured:typeof env.SEMAPHORE_TOKEN === 'string' && !!env.SEMAPHORE_TOKEN,
      projectConfigured:typeof env.SEMAPHORE_PROJECT_ID === 'string' &&
        UUID.test(env.SEMAPHORE_PROJECT_ID),
      allowedBranches:SEMAPHORE_BRANCHES, availableModes:['validation'],
    };
  }
  const id = projectId(env);
  if(command.action==='semaphore_report'){
    const data=await semaphoreRequest(env,'/pipelines/'+command.pipelineId,undefined,requestFn),p=data.pipeline;
    const isPr114QaSummary=!!p&&p.project_id===id&&p.ppl_id==='d3f2362e-e86b-486d-8f92-15051b9e01a2'&&command.pipelineId===p.ppl_id&&p.branch_name==='codex/gym-editable-membership-dates-implementation-20261115'&&p.commit_sha==='efa5ecf3970a7e6788ea36b03a6895256c3b7bd5'&&p.wf_id==='14f52965-4f08-4969-8a20-0f7737ca8cdb'&&String(p.result).toLowerCase()==='passed'&&command.artifactPath==='gym-editable-dates/qa-intel-summary.json';
    if(isPr114QaSummary){
      const jobId='1637c04f-5524-4467-b111-052596f9a6fc';
      const detail=await semaphoreRequest(env,'/pipelines/'+command.pipelineId+'?detailed=true',undefined,requestFn);
      if((detail.pipeline?.project_id&&detail.pipeline.project_id!==id)||(detail.pipeline?.wf_id&&detail.pipeline.wf_id!==p.wf_id)||!Array.isArray(detail.blocks)||!detail.blocks.flatMap(b=>b.jobs||[]).some(j=>j.job_id===jobId&&j.name==='Contracts, Gym preview, workspace checks'&&j.status==='finished'&&j.result==='passed'))throw Error('Semaphore QA artifact access not permitted');
      const q='?scope=jobs&scope_id='+jobId,artifact='gym-editable-dates/qa-intel-summary.json';
      const urls=await semaphoreRequest(env,'/artifacts/signed_url'+q+'&path='+encodeURIComponent(artifact)+'&method=GET',undefined,requestFn);
      const signed=urls.items?.find(x=>x.path===artifact);if(!signed?.url)throw Error('Artifact not found');
      let url=new URL(signed.url);
      for(let redirects=0;redirects<3;redirects++){
        if(!trustedSemaphoreArtifactHost(url))throw Error('Unsafe artifact host');
        const response=await requestFn(url.toString(),{method:'GET',redirect:'manual'});
        if([301,302,303,307,308].includes(response.status)){url=new URL(response.headers.get('location')||'',url);continue;}
        if(!response.ok||!response.body)throw Error('Artifact not found');
        const reader=response.body.getReader(),chunks=[];let size=0;
        for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>100000){await reader.cancel();throw Error('Report too large');}chunks.push(value);}
        const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
        const steps=JSON.parse(new TextDecoder().decode(bytes));if(!Array.isArray(steps)||steps.length>500)throw Error('Invalid QA report');
        const normalized=steps.map(s=>({type:typeof s?.type==='string'&&/^[a-zA-Z_.:-]{1,64}$/.test(s.type)?s.type:'unknown',result:['success','passed','failed','error','skipped','pending'].includes(s?.result)?s.result:'unknown',hasError:!!s?.error}));
        return {pipelineId:command.pipelineId,revision:p.commit_sha,path:artifact,review:{totalSteps:normalized.length,failures:normalized.filter(s=>s.hasError||s.result==='failed'||s.result==='error').length,steps:normalized}};
      }throw Error('Artifact download failed');
    }
    if(!p||p.project_id!==id||p.ppl_id!==command.pipelineId||p.branch_name!=='codex/historical-minimum-records-review-20261114'||!['cca30cb3499d86f2ec30267c1a28cc9204548235','a09e9fb5954a535283848ee1b64f021d07cdf7fa'].includes(p.commit_sha)||(p.commit_sha==='cca30cb3499d86f2ec30267c1a28cc9204548235'&&command.pipelineId!=='27cc6e15-7019-4e64-8545-188460a20905')||(p.commit_sha==='a09e9fb5954a535283848ee1b64f021d07cdf7fa'&&command.pipelineId!=='abb31093-0d10-4171-8a6f-330e267d2c89')||String(p.result).toLowerCase()!=='passed'||!UUID.test(p.wf_id||''))throw Error('PR112 report ownership mismatch');
    if(!['historical-service/REPORT.md','historical-service/qa-intel/run.json'].includes(command.artifactPath))throw Error('PR112 report path not permitted');
    const q='?scope=workflows&scope_id='+p.wf_id;
    const urls=await semaphoreRequest(env,'/artifacts/signed_url'+q+'&path='+encodeURIComponent(command.artifactPath)+'&method=GET',undefined,requestFn);
    const signed=urls.items?.find(x=>x.path===command.artifactPath);let url=new URL(signed?.url||'');
    for(let n=0;n<3;n++){
      if(!trustedSemaphoreArtifactHost(url))throw Error('Unsafe artifact host');
      const response=await requestFn(url.toString(),{method:'GET',redirect:'manual'});
      if([301,302,303,307,308].includes(response.status)){url=new URL(response.headers.get('location')||'',url);continue;}
      if(!response.ok||!response.body)throw Error('Artifact unavailable');
      const reader=response.body.getReader(),chunks=[];let size=0;
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2100000){await reader.cancel();throw Error('Report too large');}chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
      if(command.artifactPath==='historical-service/qa-intel/run.json'){
        const parsed=JSON.parse(new TextDecoder().decode(bytes)),run=parsed.data;
        if(!run||!Array.isArray(run.contracts)||run.contracts.length>200||!run.summary)throw Error('Invalid QA report');
        const status=value=>['passed','failed','skipped','pending','running','error'].includes(value)?value:'unknown';
        const key=value=>typeof value==='string'&&/^[a-zA-Z_.:-]{1,64}$/.test(value)?value:'other';
        const count=value=>Number.isInteger(value)&&value>=0?value:0;
        const domains={},types={},stepTypes={};let assertionCount=0,failedAssertions=0,failedSteps=0;
        const contracts=run.contracts.map((c,index)=>{
          const assertions=Array.isArray(c.assertions)?c.assertions:[],steps=Array.isArray(c.steps)?c.steps:[];
          for(const a of assertions){const d=key(a.domain),t=key(a.type);domains[d]=(domains[d]||0)+1;types[t]=(types[t]||0)+1;assertionCount++;if(a.status!=='passed')failedAssertions++;}
          for(const step of steps){const t=key(step.type);stepTypes[t]=(stepTypes[t]||0)+1;if(step.status!=='passed')failedSteps++;}
          return {index:index+1,status:status(c.status),durationMs:count(c.durationMs),stepCount:steps.length,assertionCount:assertions.length};
        });
        return {pipelineId:command.pipelineId,revision:p.commit_sha,path:command.artifactPath,review:{status:status(run.status),summary:{totalContracts:count(run.summary.totalContracts),passed:count(run.summary.passed),failed:count(run.summary.failed)},failureCount:Array.isArray(run.failures)?run.failures.length:0,assertionCount,failedAssertions,failedSteps,domains,types,stepTypes,contracts}};
      }
      let binary='';for(let i=0;i<bytes.length;i+=16000)binary+=String.fromCharCode(...bytes.subarray(i,i+16000));
      return {pipelineId:command.pipelineId,revision:p.commit_sha,path:command.artifactPath,bytes:size,dataBase64:btoa(binary)};
    }throw Error('Artifact redirects exceeded');
  }
  if(command.action==='semaphore_png'){
    const base=await semaphoreRequest(env,'/pipelines/'+command.pipelineId,
      undefined,requestFn);
    const pipeline=base.pipeline;
    if(!pipeline||pipeline.project_id!==id||
      (pipeline.ppl_id&&pipeline.ppl_id!==command.pipelineId))
      throw Error('Semaphore project mismatch');
    const isPr112=pipeline.branch_name==='codex/historical-minimum-records-review-20261114'&&
      ['cca30cb3499d86f2ec30267c1a28cc9204548235','a09e9fb5954a535283848ee1b64f021d07cdf7fa'].includes(pipeline.commit_sha)&&
      (pipeline.commit_sha!=='cca30cb3499d86f2ec30267c1a28cc9204548235'||command.pipelineId==='27cc6e15-7019-4e64-8545-188460a20905')&&
      (pipeline.commit_sha!=='a09e9fb5954a535283848ee1b64f021d07cdf7fa'||command.pipelineId==='abb31093-0d10-4171-8a6f-330e267d2c89')&&
      /^historical-service\/screenshots\/(?:source-(?:evidence|review|holds)|legacy-history-(?:import|preview|actions-fallback)|integrated-archive-(?:preview|import|profile|expired)|manager-mapping|historical-service)-(?:320|390|1280)\.png$/.test(command.artifactPath);
    const isPr114=pipeline.branch_name==='codex/gym-editable-membership-dates-implementation-20261115'&&pipeline.commit_sha==='efa5ecf3970a7e6788ea36b03a6895256c3b7bd5'&&command.pipelineId==='d3f2362e-e86b-486d-8f92-15051b9e01a2'&&/^gym-editable-dates\/screenshots\/(?:correction-preview|correction-confirmation|saved-amendment)-(?:1280|390|320)\.png$/.test(command.artifactPath);
    if(!isPr112&&!isPr114&&pipeline.branch_name!=='ci/qa-intel-walkthrough-survey-20261109')
      throw Error('Semaphore QA artifact access not permitted');
    const workflowId=pipeline.wf_id;
    if(!UUID.test(workflowId||''))throw Error('Semaphore project mismatch');
    const detailed=await semaphoreRequest(env,'/pipelines/'+command.pipelineId+
      '?detailed=true',undefined,requestFn);
    if(detailed.pipeline?.project_id&&detailed.pipeline.project_id!==id)
      throw Error('Semaphore project mismatch');
    if(detailed.pipeline?.wf_id&&detailed.pipeline.wf_id!==workflowId)
      throw Error('Semaphore project mismatch');
    const jobs=(Array.isArray(detailed.blocks)?detailed.blocks:[])
      .flatMap(x=>Array.isArray(x.jobs)?x.jobs:[]);
    if(!jobs.some(x=>x.name===
      ((isPr112||isPr114)?'Contracts, Gym preview, workspace checks':
        'Authenticated four-viewport survey; preserve findings without UI fixes')&&
      x.status?.toLowerCase()==='finished'&&
      UUID.test(x.job_id||'')))
      throw Error('Semaphore QA artifact access not permitted');
    const q='?scope=workflows&scope_id='+workflowId;
    const listing=await semaphoreRequest(env,'/artifacts'+q+
      '&path='+(isPr114?'gym-editable-dates%2Fscreenshots':isPr112?'historical-service%2Fscreenshots':'qa-intel%2Fscreenshots'),undefined,requestFn);
    const entry=(Array.isArray(listing.artifacts)?listing.artifacts:[])
      .find(x=>x.path===command.artifactPath&&x.is_directory===false);
    if(!entry)throw Error('Artifact not found');
    if(Number.isInteger(entry.size)&&entry.size>PNG_MAX_BYTES)
      throw Error('Artifact too large');
    const urls=await semaphoreRequest(env,'/artifacts/signed_url'+q+
      '&path='+encodeURIComponent(command.artifactPath)+'&method=GET',
      undefined,requestFn);
    const signed=(Array.isArray(urls.items)?urls.items:[])
      .find(x=>x.path===command.artifactPath&&typeof x.url==='string');
    if(!signed)throw Error('Artifact not found');
    const png=await downloadSyntheticQaPng(signed.url,requestFn);
    return {project:'amaraii-os',provider:'semaphore',pipelineId:command.pipelineId,
      path:command.artifactPath,...png};
  }

  if (command.action === 'semaphore_artifacts') {
    // Verify tenant and an exact protected QA browser branch BEFORE reading
    // any artifact metadata. No artifact URL or raw file content is returned.
    const basics=await semaphoreRequest(env,'/pipelines/'+command.pipelineId,undefined,requestFn);
    const pipeline=basics.pipeline;
    if (!pipeline||pipeline.project_id!==id||
        (pipeline.ppl_id&&pipeline.ppl_id!==command.pipelineId))
      throw new Error('Semaphore project mismatch');
    const pr112=pipeline.branch_name==='codex/historical-minimum-records-review-20261114'&&
      ['cca30cb3499d86f2ec30267c1a28cc9204548235','a09e9fb5954a535283848ee1b64f021d07cdf7fa'].includes(pipeline.commit_sha)&&
      (pipeline.commit_sha!=='cca30cb3499d86f2ec30267c1a28cc9204548235'||command.pipelineId==='27cc6e15-7019-4e64-8545-188460a20905')&&
      (pipeline.commit_sha!=='a09e9fb5954a535283848ee1b64f021d07cdf7fa'||command.pipelineId==='abb31093-0d10-4171-8a6f-330e267d2c89')&&
      command.jobId===undefined&&
      ['historical-service','historical-service/screenshots','historical-service/qa-intel'].includes(command.artifactPath);
    const pr114=pipeline.branch_name==='codex/gym-editable-membership-dates-implementation-20261115'&&pipeline.commit_sha==='efa5ecf3970a7e6788ea36b03a6895256c3b7bd5'&&command.pipelineId==='d3f2362e-e86b-486d-8f92-15051b9e01a2'&&command.jobId===undefined&&['gym-editable-dates','gym-editable-dates/screenshots'].includes(command.artifactPath);
    if (!pr112&&!pr114&&!['ci/qa-intel-walkthrough-survey-20261109',
          'ci/qa-intel-hosted-auth-20261108'].includes(pipeline.branch_name))
      throw new Error('Semaphore QA artifact access not permitted');
    const detailed=await semaphoreRequest(env,'/pipelines/'+command.pipelineId+'?detailed=true',
      undefined,requestFn);
    if (detailed.pipeline?.project_id&&detailed.pipeline.project_id!==id)
      throw new Error('Semaphore project mismatch');
    const workflowId=pipeline.wf_id;
    if (!UUID.test(workflowId||'')||
        (detailed.pipeline?.wf_id&&detailed.pipeline.wf_id!==workflowId))
      throw new Error('Semaphore project mismatch');
    if (command.jobId) {
      const jobs=(Array.isArray(detailed.blocks)?detailed.blocks:[])
        .flatMap(block=>Array.isArray(block.jobs)?block.jobs:[]);
      if (!jobs.some(job=>job.job_id===command.jobId&&
          ['Authenticated four-viewport survey; preserve findings without UI fixes',
           'Protected hosted QA auth walkthrough'].includes(job.name)))
        throw new Error('Semaphore QA artifact access not permitted');
    }
    const scope=command.jobId?'jobs':'workflows';
    const scopeId=command.jobId||workflowId;
    const path=command.artifactPath||'qa-intel';
    const params='?scope='+scope+'&scope_id='+scopeId+'&path='+encodeURIComponent(path);
    const data=await semaphoreRequest(env,'/artifacts'+params,undefined,requestFn);
    const safePath=p=>typeof p==='string'&&p.length<=240&&!p.includes('..')&&!p.includes('//')&&(pr114
      ? /^gym-editable-dates\/screenshots(?:\/(?:manifest\.json|(?:correction-preview|correction-confirmation|saved-amendment)-(?:1280|390|320)\.png))?$/.test(p)
      : /^(?:qa-intel|historical-service)\/[a-zA-Z0-9._/-]+$/.test(p));
    const artifacts=(Array.isArray(data.artifacts)?data.artifacts:[])
      .filter(x=>safePath(x?.path))
      .slice(0,80).map(x=>({path:x.path,directory:x.is_directory===true,
        size:x.is_directory===true?null:
          Number.isInteger(x.size)&&x.size>=0&&x.size<=10000000?x.size:null}));
    return {project:'amaraii-os',provider:'semaphore',pipelineId:command.pipelineId,
      scope,scopeId,folder:path,artifacts};
  }
  if (command.action === 'trigger') {
    if (command.branch === 'feat/gym-historical-service-review-20261112' && command.commitSha !== '43690eef91cf5fa1e35bee7257312c2cb2586f48') throw Error('PR109 revision not permitted');
    if (command.branch === 'feat/gym-historical-reconciliation-integration-20261113' && command.commitSha !== 'adc44c8f72cc4a5b861042cb0f98ea6ae48b44e8') throw Error('PR110 revision not permitted');
    if (command.branch === 'codex/historical-minimum-records-review-20261114' && command.commitSha !== 'a09e9fb5954a535283848ee1b64f021d07cdf7fa') throw Error('PR112 revision not permitted');
    if (command.branch === 'codex/gym-editable-membership-dates-implementation-20261115' && command.commitSha !== 'efa5ecf3970a7e6788ea36b03a6895256c3b7bd5') throw Error('PR114 revision not permitted');
    const response = await semaphoreRequest(env, '/plumber-workflows', {
      project_id:id,
      reference:'refs/heads/' + command.branch,
      commit_sha:command.commitSha,
      pipeline_file:SEMAPHORE_PIPELINES[command.branch],
    }, requestFn);
    if (!UUID.test(response.workflow_id || '') || !UUID.test(response.pipeline_id || '')) {
      throw new Error('Invalid Semaphore response');
    }
    return {provider:'semaphore',workflowId:response.workflow_id,pipelineId:response.pipeline_id,
      branch:command.branch,requestedRevision:command.commitSha,mode:'validation'};
  }
  if (command.action === 'inspect') {
    // First read the minimal response and enforce tenant/project ownership
    // before asking for detailed jobs. No arbitrary job logs or artifact URLs.
    const basic = await semaphoreRequest(env, '/pipelines/' + command.pipelineId,
      undefined, requestFn);
    const pipeline = basic.pipeline;
    if (!pipeline || pipeline.project_id !== id ||
        (pipeline.ppl_id && pipeline.ppl_id !== command.pipelineId)) {
      throw new Error('Semaphore project mismatch');
    }
    const detailed = await semaphoreRequest(env, '/pipelines/' + command.pipelineId +
      '?detailed=true', undefined, requestFn);
    if (!detailed.pipeline || (detailed.pipeline.project_id &&
        detailed.pipeline.project_id !== id) ||
        (detailed.pipeline.wf_id && !UUID.test(detailed.pipeline.wf_id))) {
      throw new Error('Semaphore project mismatch');
    }
    const blocks = (Array.isArray(detailed.blocks) ? detailed.blocks : []).slice(0,12)
      .map(block => ({
        name:typeof block.name === 'string' ? block.name.slice(0,100) : null,
        state:safeValue(block.state,['pending','running','done','stopping','stopped','queued']),
        result:safeValue(block.result,['passed','failed','stopped','canceled','skipped']),
        jobs:(Array.isArray(block.jobs) ? block.jobs : []).slice(0,20).map(job=>({
          id:UUID.test(job.job_id || '') ? job.job_id : null,
          name:typeof job.name === 'string' ? job.name.slice(0,100) : null,
          status:safeValue(job.status,['queued','pending','running','finished','stopped']),
          result:safeValue(job.result,['passed','failed','stopped','canceled','skipped']),
        })),
      }));
    const failed=blocks.flatMap(block=>block.jobs).find(job=>job.id&&job.result==='failed');
    // Survey summaries are read only after the same project/branch ownership
    // validation above. Never return arbitrary job logs or signed artifact URLs.
    const surveyJob=pipeline.branch_name==='ci/qa-intel-walkthrough-survey-20261109'&&
      pipeline.state?.toLowerCase()==='done'?
      blocks.flatMap(block=>block.jobs).find(job=>job.id&&
        job.name==='Authenticated four-viewport survey; preserve findings without UI fixes'&&
        job.status==='finished'):null;
    let survey=null;
    if(surveyJob){
      try { survey=safeQaSurveySummary(await semaphoreRequest(env,'/logs/'+surveyJob.id,undefined,requestFn)); }
      catch { survey=null; }
    }
    let failure=null;
    if(failed) {
      try {
        const logs=await semaphoreRequest(env,'/logs/'+failed.id,undefined,requestFn);
        const summary=failureSummary(logs);
        failure=summary?{jobId:failed.id,...summary}:{jobId:failed.id,diagnostics:'No failed-command output available'};
      } catch {
        failure={jobId:failed.id,diagnostics:'Job diagnostic API unavailable'};
      }
    }
    return {
      ...(failure?{failure}:{}),
      ...(survey?{survey}:{}),
      provider:'semaphore',pipelineId:command.pipelineId,
      workflowId:UUID.test(pipeline.wf_id || '') ? pipeline.wf_id : null,
      project:'amaraii-os',
      state:safeValue(pipeline.state,['pending','running','done','stopping','stopped','queued']),
      result:safeValue(pipeline.result,['passed','failed','stopped','canceled','skipped']),
      vcs:{
        branch:SEMAPHORE_BRANCHES.includes(pipeline.branch_name) ? pipeline.branch_name : null,
        revision:SHA.test(pipeline.commit_sha || '') ? pipeline.commit_sha : null,
      },
      blocks,
    };
  }
  throw new Error('Semaphore action not permitted');
}
