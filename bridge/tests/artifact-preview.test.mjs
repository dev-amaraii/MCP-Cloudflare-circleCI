import test from 'node:test';
import assert from 'node:assert/strict';
import {PROJECTS,validateCommand,executeCommand} from '../src/index.mjs';

const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const pipelineId='22222222-3333-4444-8555-666666666666';
const jobId='33333333-4444-4555-8666-777777777777';
const pngPath='nen-customer-operations-qa/customer-pending-light-1440.png';
const artifactUrl='https://output.circle-artifacts.com/output/job/'+jobId+'/artifacts/0/'+pngPath;
const project=PROJECTS['amaraii-os'];
const command={v:1,id,action:'artifact_preview',project:'amaraii-os',
  pipelineId,jobId,jobNumber:49,artifactPath:pngPath,approved:true,
  requestedAt:'2026-10-24T08:00:00.000Z'};
const bytes=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
function reply(value){return Response.json(value);}
function transport({foreign=false,location=artifactUrl,payload=bytes,mime='image/png',length}={}){
  const requests=[];
  const send=async (url,options)=>{
    requests.push({url,headers:options?.headers});
    if(url.endsWith('/pipeline/'+pipelineId))
      return reply({project_slug:foreign?'wrong/project':project.slug});
    if(url.endsWith('/pipeline/'+pipelineId+'/workflow'))
      return reply({items:[{id:'workflow-test'}]});
    if(url.endsWith('/workflow/workflow-test/job'))
      return reply({items:[{id:jobId,job_number:49,project_slug:project.slug}]});
    if(url.includes('/49/artifacts'))
      return reply({items:[{path:pngPath,url:location}],next_page_token:null});
    if(url===location) return new Response(payload,{headers:{
      'Content-Type':mime,...(length?{'Content-Length':String(length)}:{})
    }});
    throw Error('Unexpected URL in mock: '+url);
  };
  return {send,requests};
}
test('artifact preview validates the request and rejects arbitrary paths and projects',()=>{
  assert.equal(validateCommand(command,id,Date.parse(command.requestedAt)).project,project);
  for (const patch of [
    {artifactPath:'../../billing-secrets.png'},
    {artifactPath:'bank-transfer-qa/payment.json'},
    {artifactPath:'https://example.test/image.png'},
    {artifactPath:'qa-intel/transactions/private/../secret.png'},
    {project:'jayson-storefront'},
    {pipelineId:'invalid'},
    {jobId:'invalid'},
    {jobNumber:0},
  ]) assert.throws(()=>validateCommand({...command,...patch},id,Date.parse(command.requestedAt)),/Artifact preview not permitted/);
});
test('reads one owned QA screenshot, returns PNG bytes but never the signed URL',async()=>{
  const t=transport();
  const result=await executeCommand({CIRCLE_TOKEN:'synthetic-only'},command,project,t.send);
  assert.equal(result.mediaType,'image/png');
  assert.equal(result.bytes,bytes.length);
  assert.equal(result.path,pngPath);
  assert.deepEqual(Buffer.from(result.dataBase64,'base64'),Buffer.from(bytes));
  assert.equal(JSON.stringify(result).includes('circle-artifacts.com'),false);
  assert.equal(JSON.stringify(result).includes('synthetic-only'),false);
  assert.equal(t.requests.at(-1).headers['Circle-Token'],'synthetic-only');
});
test('rejects a foreign project without fetching artifacts',async()=>{
  const t=transport({foreign:true});
  await assert.rejects(()=>executeCommand({CIRCLE_TOKEN:'synthetic-only'},command,project,t.send),/Pipeline project mismatch/);
  assert.equal(t.requests.some(r=>r.url.includes('/artifacts')),false);
});
test('rejects a forged non-CircleCI download host',async()=>{
  const t=transport({location:'https://evil.example/private.png'});
  await assert.rejects(()=>executeCommand({CIRCLE_TOKEN:'synthetic-only'},command,project,t.send),/Unsafe artifact URL/);
  assert.equal(t.requests.some(r=>r.url.includes('evil.example')),false);
});
test('rejects oversized screenshots before reading the body',async()=>{
  const t=transport({length:900001});
  await assert.rejects(()=>executeCommand({CIRCLE_TOKEN:'synthetic-only'},command,project,t.send),/Artifact too large/);
});
test('rejects non-image responses and invalid image signatures',async()=>{
  const html=transport({payload:Buffer.from('<html>not an image</html>'),mime:'text/html'});
  await assert.rejects(()=>executeCommand({CIRCLE_TOKEN:'synthetic-only'},command,project,html.send),/Artifact format not supported/);
  const forged=transport({payload:Buffer.from('<html>not an image</html>'),mime:'image/png'});
  await assert.rejects(()=>executeCommand({CIRCLE_TOKEN:'synthetic-only'},command,project,forged.send),/Artifact format not supported/);
});
