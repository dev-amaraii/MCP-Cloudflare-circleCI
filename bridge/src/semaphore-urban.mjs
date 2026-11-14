/** Strictly scoped, validation-only Semaphore adapter for Urban Paints.
 * No release, arbitrary URL, raw log or artifact transfer capability.
 */
const API='https://amaraii.semaphoreci.com/api/v1alpha';
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{40}$/;
export const URBAN_SEMAPHORE=Object.freeze({
  project:'urban-design-paint',
  branch:'feat/site-foundation-homepage',
  pipelineFile:'.semaphore/semaphore.yml',
});

function projectId(env) {
  const id=env.SEMAPHORE_PROJECT_ID_URBAN_DESIGN_PAINT;
  if(typeof id!=='string'||!UUID.test(id))throw Error('Urban Paints Semaphore project not configured');
  return id;
}
async function semaphoreRequest(env,path,body,requestFn) {
  if(typeof env.SEMAPHORE_TOKEN!=='string'||!env.SEMAPHORE_TOKEN)
    throw Error('Semaphore token not configured');
  const response=await requestFn(API+path,{
    method:body===undefined?'GET':'POST',redirect:'manual',
    headers:{Authorization:'Token '+env.SEMAPHORE_TOKEN,Accept:'application/json',
      'User-Agent':'SemaphoreCI v2.0 Client',
      ...(body===undefined?{}:{'Content-Type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  if(!response.ok)throw Error('Urban Paints Semaphore API HTTP '+response.status);
  const data=await response.json();
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid Semaphore response');
  return data;
}
const safe=(v,allowed)=>typeof v==='string'&&allowed.includes(v.toLowerCase())?v.toLowerCase():null;

export async function executeSemaphoreUrban(env,command,requestFn=fetch) {
  if(command.project!==URBAN_SEMAPHORE.project||command.provider!=='semaphore')
    throw Error('Urban Paints project mismatch');
  if(command.action==='health')return {
    provider:'semaphore',project:URBAN_SEMAPHORE.project,
    tokenConfigured:typeof env.SEMAPHORE_TOKEN==='string'&&!!env.SEMAPHORE_TOKEN,
    projectConfigured:typeof env.SEMAPHORE_PROJECT_ID_URBAN_DESIGN_PAINT==='string'&&
      UUID.test(env.SEMAPHORE_PROJECT_ID_URBAN_DESIGN_PAINT),
    allowedBranches:[URBAN_SEMAPHORE.branch],availableModes:['validation']
  };
  const id=projectId(env);
  if(command.action==='trigger'){
    if(command.mode!=='validation'||command.branch!==URBAN_SEMAPHORE.branch||
        typeof command.commitSha!=='string'||!SHA.test(command.commitSha))
      throw Error('Urban Paints validation revision not permitted');
    const data=await semaphoreRequest(env,'/plumber-workflows',{
      project_id:id,reference:'refs/heads/'+URBAN_SEMAPHORE.branch,
      commit_sha:command.commitSha,pipeline_file:URBAN_SEMAPHORE.pipelineFile
    },requestFn);
    if(!UUID.test(data.workflow_id||'')||!UUID.test(data.pipeline_id||''))
      throw Error('Invalid Semaphore response');
    return {provider:'semaphore',project:URBAN_SEMAPHORE.project,
      workflowId:data.workflow_id,pipelineId:data.pipeline_id,
      branch:URBAN_SEMAPHORE.branch,requestedRevision:command.commitSha,mode:'validation'};
  }
  if(command.action==='inspect'){
    if(typeof command.pipelineId!=='string'||!UUID.test(command.pipelineId))
      throw Error('Invalid pipeline ID');
    const basic=await semaphoreRequest(env,'/pipelines/'+command.pipelineId,undefined,requestFn);
    if(!basic.pipeline||basic.pipeline.project_id!==id||
        (basic.pipeline.ppl_id&&basic.pipeline.ppl_id!==command.pipelineId))
      throw Error('Urban Paints pipeline project mismatch');
    const detail=await semaphoreRequest(env,'/pipelines/'+command.pipelineId+'?detailed=true',undefined,requestFn);
    if(!detail.pipeline||(detail.pipeline.project_id&&detail.pipeline.project_id!==id))
      throw Error('Urban Paints pipeline project mismatch');
    return {provider:'semaphore',project:URBAN_SEMAPHORE.project,pipelineId:command.pipelineId,
      state:safe(basic.pipeline.state,['pending','running','done','stopping','stopped','queued']),
      result:safe(basic.pipeline.result,['passed','failed','stopped','canceled','skipped']),
      vcs:{branch:basic.pipeline.branch_name===URBAN_SEMAPHORE.branch?URBAN_SEMAPHORE.branch:null,
        revision:SHA.test(basic.pipeline.commit_sha||'')?basic.pipeline.commit_sha:null},
      blocks:(Array.isArray(detail.blocks)?detail.blocks:[]).slice(0,12).map(block=>({
        name:typeof block.name==='string'?block.name.slice(0,100):null,
        state:safe(block.state,['pending','running','done','stopping','stopped','queued']),
        result:safe(block.result,['passed','failed','stopped','canceled','skipped']),
        jobs:(Array.isArray(block.jobs)?block.jobs:[]).slice(0,20).map(job=>({
          id:UUID.test(job.job_id||'')?job.job_id:null,
          name:typeof job.name==='string'?job.name.slice(0,100):null,
          status:safe(job.status,['pending','queued','running','finished','stopped']),
          result:safe(job.result,['passed','failed','stopped','canceled','skipped'])
        }))
      }))
    };
  }
  throw Error('Urban Paints Semaphore action not permitted');
}
