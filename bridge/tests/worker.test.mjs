import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { PROJECTS, validateCommand, executeCommand, processOne } from '../src/index.mjs';

const id = '11111111-2222-4333-8444-555555555555';
const pipelineId = '22222222-3333-4444-8555-666666666666';
const now = Date.parse('2026-10-20T12:00:00.000Z');
const command = (action, fields = {}) => ({
  v: 1, id, action, project: 'jayson-storefront',
  requestedAt: new Date(now).toISOString(), approved: true, ...fields,
});
class MemoryKV {
  values = new Map();
  async get(key) { return this.values.get(key) ?? null; }
  async put(key, value) { this.values.set(key, value); }
  async delete(key) { this.values.delete(key); }
  async list({ prefix, limit }) {
    return { keys: [...this.values.keys()].filter(key => key.startsWith(prefix)).sort().slice(0, limit).map(name => ({name})) };
  }
}
function fakeFetch(log) {
  return async (url, init) => {
    log.push({url, init});
    if (url.endsWith('/pipeline/run')) return new Response(JSON.stringify({id:pipelineId,number:7,state:'pending'}), {status:201,headers:{'Content-Type':'application/json'}});
    if (url.endsWith('/pipeline?branch=feat%2Fstorefront-demo')) return Response.json({items:[{id:pipelineId,number:7,state:'created',created_at:'2026-10-20T12:50:00Z',project_slug:PROJECTS['jayson-storefront'].slug,vcs:{branch:'feat/storefront-demo',revision:'abc'}}]});
    if (url.endsWith('/pipeline/' + pipelineId)) return Response.json({id:pipelineId,number:7,state:'created',project_slug:PROJECTS['jayson-storefront'].slug,vcs:{branch:'feat/storefront-demo',revision:'abc'}});
    if (url.endsWith('/pipeline/' + pipelineId + '/workflow')) return Response.json({items:[{id:id,name:'manually-requested-preview-qa',status:'success'}]});
    if (url.endsWith('/workflow/' + id + '/job')) return Response.json({items:[{id:'job1',name:'preview-qa',status:'success',job_number:12}]});
    if (url.endsWith('/12/artifacts')) return Response.json({items:[{path:'qa-intel/qa-intel-output.json',url:'https://example.circle-artifacts.com/qa.json'}]});
    return new Response(null, {status:404});
  };
}

test('health is private and does not call CircleCI', async () => {
  assert.equal((await worker.fetch(new Request('https://example.test/'))).status,404);
  const outcome = await executeCommand({QUEUE:new MemoryKV()},command('health'),PROJECTS['jayson-storefront'],()=>{throw Error('should not fetch');});
  assert.equal(outcome.tokenConfigured,false);
  assert.deepEqual(outcome.allowedBranches,['feat/storefront-demo']);
});

test('validates only explicitly approved project, branch, actions and modes', () => {
  assert.ok(validateCommand(command('trigger',{branch:'feat/storefront-demo',mode:'preview_qa'}),id,now));
  assert.ok(validateCommand(command('inspect',{pipelineId}),id,now));
  const invalid = [
    command('trigger',{branch:'main',mode:'preview_qa'}),
    command('trigger',{branch:'feat/storefront-demo',mode:'deploy'}),
    command('deploy',{branch:'feat/storefront-demo'}),
    command('trigger',{branch:'feat/storefront-demo',mode:'preview_qa',approved:false}),
    command('trigger',{branch:'feat/storefront-demo',mode:'preview_qa',requestedAt:'2026-01-01T00:00:00Z'}),
    command('inspect',{pipelineId:'oops'}),
    command('health',{branch:'main'}),
    command('health',{unrecognized:'xxx'}),
    command('health',{project:'some-other-project'}),
  ];
  for (const item of invalid) assert.throws(()=>validateCommand(item,id,now));
});

test('trigger sends only the registered GitHub App definition and one boolean parameter',async()=>{
 const log=[];
 const validated=validateCommand(command('trigger',{branch:'feat/storefront-demo',mode:'preview_qa'}),id,now);
 const result=await executeCommand({CIRCLE_TOKEN:'placeholder-token'}, validated.command,validated.project,fakeFetch(log));
 assert.equal(result.pipelineId,pipelineId);
 assert.equal(log.length,1);
 assert.equal(log[0].url,'https://circleci.com/api/v2/project/circleci/B65DMdC1ZhAJQM74t7SrZ1/CRNFjZzLKeZdypYW5EWkyL/pipeline/run');
 assert.equal(log[0].init.headers['Circle-Token'],'placeholder-token');
 assert.deepEqual(JSON.parse(log[0].init.body),{
  definition_id:'b5a41026-8298-4976-956b-49fbca6de695',
  config:{branch:'feat/storefront-demo'}, checkout:{branch:'feat/storefront-demo'},
  parameters:{run_preview_qa:true},
 });
});

test('inspect reads restricted pipeline, jobs and QA artifact metadata',async()=>{
 const log=[];
 const validated=validateCommand(command('inspect',{pipelineId}),id,now);
 const result=await executeCommand({CIRCLE_TOKEN:'placeholder-token'},validated.command,validated.project,fakeFetch(log));
 assert.equal(result.number,7);
 assert.equal(result.workflows[0].name,'manually-requested-preview-qa');
 assert.equal(result.workflows[0].jobs[0].jobNumber,12);
 assert.equal(result.workflows[0].jobs[0].artifacts[0].path,'qa-intel/qa-intel-output.json');
 assert.equal(log.length,4);
});

test('processes one health command through KV, records claim and result, deletes request',async()=>{
 const kv=new MemoryKV();
 await kv.put('requests/'+id,JSON.stringify(command('health')));
 const result=await processOne({QUEUE:kv},now);
 assert.equal(result.status,'success');
 assert.equal(await kv.get('requests/'+id),null);
 assert.equal(JSON.parse(await kv.get('claims/'+id)).status,'claimed');
 assert.equal(JSON.parse(await kv.get('results/'+id)).outcome.tokenConfigured,false);
 assert.deepEqual(await processOne({QUEUE:kv},now),{empty:true});
});

test('never replays claimed pipeline request after uncertain previous invocation',async()=>{
 const kv=new MemoryKV();
 await kv.put('requests/'+id,JSON.stringify(command('trigger',{branch:'feat/storefront-demo',mode:'preview_qa'})));
 await kv.put('claims/'+id,JSON.stringify({status:'claimed'}));
 let calls=0;
 const result=await processOne({QUEUE:kv,CIRCLE_TOKEN:'placeholder-token'},now,async()=>{calls++;throw Error('should not call');});
 assert.equal(result.skipped,true);
 assert.equal(calls,0);
 assert.equal(await kv.get('requests/'+id),null);
});

test('rejects malformed and expired requests without CircleCI calls or secret disclosure',async()=>{
 const kv=new MemoryKV();
 const bad={...command('trigger',{branch:'feat/storefront-demo',mode:'preview_qa'}),requestedAt:'2020-01-01T00:00:00Z'};
 await kv.put('requests/'+id,JSON.stringify(bad));
 const result=await processOne({QUEUE:kv,CIRCLE_TOKEN:'super-secret'},now,async()=>{throw Error('Never call');});
 assert.equal(result.status,'error');
 assert.equal(result.error,'Command is expired or clock is invalid');
 assert.equal(JSON.stringify(result).includes('super-secret'),false);
});

test('rejects trigger request without token without leaking command details',async()=>{
 const kv=new MemoryKV();
 await kv.put('requests/'+id,JSON.stringify(command('trigger',{branch:'feat/storefront-demo',mode:'validation'})));
 const result=await processOne({QUEUE:kv},now,async()=>{throw Error('Never call');});
 assert.equal(result.status,'error');
 assert.equal(result.error,'CircleCI token not configured');
});

test('forwards only CircleCI HTTP status, not response payloads, on API errors',async()=>{
 const validated=validateCommand(command('inspect',{pipelineId}),id,now);
 await assert.rejects(
   executeCommand({CIRCLE_TOKEN:'placeholder-token'},validated.command,validated.project,async()=>new Response('sensitive upstream detail',{status:403})),
   /CircleCI API HTTP 403/
 );
});

test('inspect rejects a pipeline outside the registered project before revealing jobs',async()=>{
 const validated=validateCommand(command('inspect',{pipelineId}),id,now);
 let calls=0;
 await assert.rejects(executeCommand({CIRCLE_TOKEN:'placeholder-token'},validated.command,validated.project,async()=>{
  calls++;
  return Response.json({id:pipelineId,project_slug:'circleci/other-project/different-repo',state:'created'});
 }),/Pipeline project mismatch/);
 assert.equal(calls,1);
});

test('read-only recent pipeline query requires allowed branch and preserves project isolation', async () => {
  const recent=command('recent',{branch:'feat/storefront-demo'});
  const checked=validateCommand(recent,id,now);
  const log=[];
  const result=await executeCommand({CIRCLE_TOKEN:'placeholder-token'},checked.command,checked.project,fakeFetch(log));
  assert.equal(result.pipelines.length,1);
  assert.equal(result.pipelines[0].id,pipelineId);
  assert.equal(log.length,1);
  assert.equal(log[0].init.method,'GET');
  assert.throws(()=>validateCommand(command('recent',{branch:'main'}),id,now),/Branch not permitted/);
  assert.throws(()=>validateCommand(command('recent',{branch:'feat/storefront-demo',mode:'preview_qa'}),id,now),/Recent command has unexpected fields/);
});

test('unauthenticated egress probe never sends the CircleCI bearer token',async()=>{
 const checked=validateCommand(command('probe'),id,now);
 const outgoing=[];
 const result=await executeCommand({CIRCLE_TOKEN:'must-not-leak'},checked.command,checked.project,async(url,init)=>{
  outgoing.push({url,init});
  return new Response('',{status:url.includes('circleci.com')?401:200});
 });
 assert.equal(outgoing.length,2);
 assert.deepEqual(result.checks.map(x=>x.httpStatus),[401,200]);
 for(const request of outgoing){
  assert.equal(request.init.headers['Circle-Token'],undefined);
  assert.equal(request.init.redirect,'manual');
 }
});

test('numbered pipeline audit confirms existing runs and stops at first 404', async () => {
 const checked=validateCommand(command('audit',{startNumber:6}),id,now);
 const calls=[];
 const response=await executeCommand({CIRCLE_TOKEN:'placeholder'},checked.command,checked.project,async(url,init)=>{
  calls.push({url,init});
  if(url.endsWith('/pipeline/6'))return Response.json({project_slug:PROJECTS['jayson-storefront'].slug,id:pipelineId,state:'created',vcs:{branch:'feat/storefront-demo'}});
  return new Response('not found',{status:404});
 });
 assert.deepEqual(response.checked.map(x=>({number:x.number,found:x.found})),[{number:6,found:true},{number:7,found:false}]);
 assert.equal(calls.length,2);
 assert.throws(()=>validateCommand(command('audit',{startNumber:0}),id,now),/Invalid starting pipeline number/);
});
