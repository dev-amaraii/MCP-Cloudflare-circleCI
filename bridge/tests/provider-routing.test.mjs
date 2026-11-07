import test from 'node:test';
import assert from 'node:assert/strict';
import {PROJECTS,validateCommand,executeCommand,processRequest} from '../src/index.mjs';
import {selectProvider} from '../src/provider-routing.mjs';

const id='515abef0-9ab1-43c0-80af-7c7295bca2ac';
const pipelineId='b8930171-8f1c-43b2-8a99-f93c49274c43';
const projectId='925087aa-0460-4cd0-8759-8eb25335c6e7';
const workflowId='6b8846a9-067f-4a06-abd6-a450ea16f7e2';
const SHA='a'.repeat(40);
const base=()=>({v:1,id,project:'amaraii-os',provider:'auto',action:'trigger',
  branch:'development',mode:'validation',commitSha:SHA,
  requestedAt:new Date().toISOString(),approved:true});
const env={CI_AUTO_ROUTING_ENABLED:'true',CIRCLE_TOKEN:'synthetic-circle-token',
  SEMAPHORE_TOKEN:'synthetic-semaphore-token',SEMAPHORE_PROJECT_ID:projectId};
const nextHour=()=>new Date(Date.now()+60*60*1000).toISOString();
const checked=c=>validateCommand(c,id,Date.parse(c.requestedAt));
const fetchResponse=(data,status=200)=>Response.json(data,{status});
const circlePipelineUrl='https://circleci.com/api/v2/project/'+PROJECTS['amaraii-os'].slug+'/pipeline/run';

test('only exact Amaraii development, validation mode, full commit SHA can use auto',()=>{
  assert.equal(checked(base()).project,PROJECTS['amaraii-os']);
  assert.equal(checked({...base(),action:'route'}).project,PROJECTS['amaraii-os']);
  for(const patch of [
    {project:'churchpro'},{branch:'staging'},{branch:'ci/semaphore-validation-20261106'},
    {mode:'preview_qa'},{commitSha:'bad'},{commitSha:undefined},
    {action:'release'},{action:'inspect'},{action:'health'},
    {action:'trigger',jobId:'x'},
    {action:'trigger',artifactPath:'qa-intel/x.png'},
    {action:'route',startNumber:1}
  ])assert.throws(()=>checked({...base(),...patch}));
});

test('old implicit CircleCI health/trigger contracts continue to work',()=>{
  const health={...base(),provider:undefined,action:'health',branch:undefined,
    commitSha:undefined,mode:undefined};
  assert.equal(checked(health).project,PROJECTS['amaraii-os']);
  assert.equal(checked({...base(),provider:undefined}).project,PROJECTS['amaraii-os']);
});

test('operator-confirmed exhaustion marker must be parseable and short-lived',()=>{
  const now=Date.parse('2026-11-07T00:00:00.000Z'),command=base();
  assert.equal(selectProvider(env,command,now).provider,'circleci');
  for(const marker of ['tomorrow','2027-12-01T00:00:00Z',
    '2026-12-31T00:00:00Z','2026-11-08T12:00:00+01:00']) {
    assert.throws(()=>selectProvider({...env,CI_CIRCLECI_EXHAUSTED_UNTIL:marker},command,now),
      /Invalid CircleCI exhaustion marker/);
  }
  assert.equal(selectProvider({...env,CI_CIRCLECI_EXHAUSTED_UNTIL:'2026-11-06T23:59:59Z'},
    command,now).provider,'circleci');
  assert.deepEqual(selectProvider({...env,CI_CIRCLECI_EXHAUSTED_UNTIL:'2026-11-07T12:00:00Z',
    CI_SEMAPHORE_FALLBACK_ENABLED:'true'},command,now).provider,'semaphore');
});

test('no automatic routing unless explicitly enabled',()=>{
  assert.throws(()=>selectProvider({},base()),/Automatic CI routing disabled/);
  assert.throws(()=>selectProvider({...env,CI_CIRCLECI_EXHAUSTED_UNTIL:nextHour()},base()),
    /Semaphore fallback not enabled/);
});

test('route preview does not call either CI service and reveals no secrets',async()=>{
  const c={...base(),action:'route'};
  const selected=await executeCommand(env,c,checked(c).project,()=>{throw Error('network not allowed')});
  assert.equal(selected.provider,'circleci');
  assert.equal(selected.revisionVerificationRequired,true);
  assert.equal(JSON.stringify(selected).includes(env.CIRCLE_TOKEN),false);
  const alt=await executeCommand({...env,CI_CIRCLECI_EXHAUSTED_UNTIL:nextHour(),
    CI_SEMAPHORE_FALLBACK_ENABLED:'true'},c,checked(c).project,
    ()=>{throw Error('network not allowed')});
  assert.equal(alt.provider,'semaphore');
  assert.equal(alt.revisionVerificationRequired,false);
});

test('when no exhaustion is confirmed, auto triggers exactly one CircleCI pipeline',async()=>{
  const c=base(),calls=[];
  const out=await executeCommand(env,c,checked(c).project,async(url,options)=>{
    calls.push({url,options});
    return fetchResponse({id:pipelineId,number:101,state:'created'});
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,circlePipelineUrl);
  assert.equal(calls[0].options.headers['Circle-Token'],env.CIRCLE_TOKEN);
  assert.equal(out.provider,'circleci');
  assert.equal(out.requestedRevision,SHA);
  assert.equal(out.revisionVerificationRequired,true);
});

test('when operator marks credits exhausted, auto triggers Semaphore once with exact SHA',async()=>{
  const c=base(),calls=[];
  const selectedEnv={...env,CI_CIRCLECI_EXHAUSTED_UNTIL:nextHour(),
    CI_SEMAPHORE_FALLBACK_ENABLED:'true'};
  const out=await executeCommand(selectedEnv,c,checked(c).project,async(url,options)=>{
    calls.push({url,options});
    return fetchResponse({workflow_id:workflowId,pipeline_id:pipelineId});
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://amaraii.semaphoreci.com/api/v1alpha/plumber-workflows');
  assert.equal(calls[0].options.headers.Authorization,'Token '+env.SEMAPHORE_TOKEN);
  assert.deepEqual(JSON.parse(calls[0].options.body),{
    project_id:projectId,reference:'refs/heads/development',
    commit_sha:SHA,pipeline_file:'.semaphore/semaphore.yml'
  });
  assert.equal(out.provider,'semaphore');
  assert.equal(out.selectionReason,'confirmed_circleci_exhaustion');
});

test('CircleCI rejection, authorization errors and ambiguous POSTs never trigger a second provider',async()=>{
  const c=base();
  for(const mode of ['http','network']){
    let count=0;
    await assert.rejects(executeCommand(env,c,checked(c).project,async()=>{
      count++;
      if(mode==='network') throw new TypeError('network');
      return fetchResponse({message:'Permission denied'},403);
    }));
    assert.equal(count,1);
  }
});

test('queue result remains sanitized on ambiguous failure and does not retry',async()=>{
  const c=base();
  const kv=new Map();let calls=0;
  const service={QUEUE:{async get(k){return kv.get(k)??null;},
    async put(k,v){kv.set(k,v);},async delete(k){kv.delete(k);}} ,...env};
  const res=await processRequest(service,id,JSON.stringify(c),Date.parse(c.requestedAt),
    async()=>{calls++;throw new TypeError('service unavailable');});
  assert.equal(res.status,'error');
  assert.equal(res.error,'Network or API transport failure');
  const again=await processRequest(service,id,JSON.stringify(c),Date.parse(c.requestedAt),
    ()=>{calls++;throw Error('unexpected replay');});
  assert.equal(again.skipped,true);
  assert.equal(calls,1);
  assert.equal(JSON.stringify(res).includes(env.CIRCLE_TOKEN),false);
});
