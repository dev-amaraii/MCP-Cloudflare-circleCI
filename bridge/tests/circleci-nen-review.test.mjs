import test from "node:test";
import assert from "node:assert/strict";
import {executeCircleCiNen,NEN_CIRCLECI_REVIEW} from "../src/circleci-nen.mjs";

const UUIDS = {
  project:"caca1e1a-b73c-4d44-b8fa-112233445566",
  definition:"caca1e1a-b73c-4d44-b8fa-112233445567",
  pipeline:"caca1e1a-b73c-4d44-b8fa-112233445568",
};
const slug="circleci/B65DMdC1ZhAJQM74t7SrZ1/EXAMPLE_PROJECT_ONLY";
const environment={
  CIRCLE_TOKEN:"mock-test-token",
  NEN_CIRCLECI_PROJECT_SLUG:slug,
  NEN_CIRCLECI_TRIGGER_ENABLED:"true",
};
const cmd=(action,fields={})=>({project:"nen-website-cms",provider:"circleci",action,...fields});
const exact=cmd("trigger",{approved:true,mode:"validation",branch:NEN_CIRCLECI_REVIEW.branch,commitSha:NEN_CIRCLECI_REVIEW.reviewSha});
const json=value=>Response.json(value);
function mockApi(options={}){
  const calls=[];
  const send=async (url, init={})=>{
    calls.push({url,method:init.method,redirect:init.redirect,
      tokenAttached:init.headers?.["Circle-Token"]==="mock-test-token",body:init.body?JSON.parse(init.body):null});
    if(url.endsWith("/project/"+slug) && init.method==="GET")
      return json({slug:options.projectSlug??slug,id:UUIDS.project});
    if(url.endsWith("/projects/"+UUIDS.project+"/pipeline-definitions"))
      return json({items:options.definitions??[{
        id:UUIDS.definition, config_source:{provider:"github_app",file_path:".circleci/config.yml",
          repo:{full_name:"dev-amaraii/nen-website-cms"}},
      }]});
    if(url.endsWith("/project/"+slug+"/pipeline/run"))
      return json(options.triggerResponse??{id:UUIDS.pipeline,number:9,state:"pending"});
    if(url.endsWith("/pipeline/"+UUIDS.pipeline))
      return json({id:UUIDS.pipeline,project_slug:options.pipelineProject??slug,
        vcs:{branch:options.branch??NEN_CIRCLECI_REVIEW.branch,
          revision:options.revision??NEN_CIRCLECI_REVIEW.reviewSha},
        state:"success"});
    throw Error("Unexpected CircleCI test URL");
  };
  return {send,calls};
}

test("NEN health never contacts provider, discloses tokens, or grants release",async()=>{
  const mocked=mockApi();
  const result=await executeCircleCiNen(environment,cmd("health"),mocked.send);
  assert.equal(mocked.calls.length,0);
  assert.deepEqual(result.allowedBranches,[NEN_CIRCLECI_REVIEW.branch]);
  assert.deepEqual(result.allowedModes,["validation"]);
  assert.equal(result.releasePermitted,false);
  assert.equal(result.sourceStatus,"review-only-not-wired");
  assert.equal(JSON.stringify(result).includes("mock-test-token"),false);
  const disabled=await executeCircleCiNen({},cmd("health"),mocked.send);
  assert.equal(disabled.projectConfigured,false);
  assert.equal(disabled.tokenConfigured,false);
  assert.equal(disabled.triggerEnabled,false);
});

test("default trigger denied before any CircleCI API request",async()=>{
  const mocked=mockApi();
  await assert.rejects(()=>executeCircleCiNen({...environment,NEN_CIRCLECI_TRIGGER_ENABLED:"false"},exact,mocked.send),
    /trigger disabled/);
  assert.equal(mocked.calls.length,0);
});

test("wrong branch, SHA, provider, mode and arbitrary actions are denied before network",async()=>{
  const mocked=mockApi();
  const altered=[
    {...exact,branch:"main"},
    {...exact,commitSha:"0".repeat(40)},
    {...exact,mode:"preview_release"},
    {...exact,approved:false},
    {...exact,provider:"auto"},
    cmd("release"),
    cmd("trigger",{...exact,secret:"unexpected"}),
    cmd("inspect",{pipelineId:"../../secret"}),
  ];
  for(const item of altered)
    await assert.rejects(()=>executeCircleCiNen(environment,item,mocked.send));
  assert.equal(mocked.calls.length,0);
});

test("verification requires a matching GitHub App project and unique NEN definition",async()=>{
  const ok=mockApi();
  const res=await executeCircleCiNen(environment,cmd("verify_project"),ok.send);
  assert.equal(res.verified,true);
  assert.equal(res.definitionVerified,true);
  assert.equal(ok.calls.length,2);
  assert.ok(ok.calls.every(x=>x.method==="GET" && x.redirect==="manual" && x.tokenAttached));
  const wrongProject=mockApi({projectSlug:"circleci/OTHER/REPO"});
  await assert.rejects(()=>executeCircleCiNen(environment,cmd("verify_project"),wrongProject.send),
    /project identity mismatch/);
  const wrongRepo=mockApi({definitions:[{id:UUIDS.definition,config_source:{
    provider:"github_app",file_path:".circleci/config.yml",repo:{full_name:"dev-amaraii/amaraii-os"}}}]});
  await assert.rejects(()=>executeCircleCiNen(environment,cmd("verify_project"),wrongRepo.send),
    /definition not verified uniquely/);
  const duplicate=mockApi({definitions:[{
    id:UUIDS.definition,config_source:{provider:"github_app",file_path:".circleci/config.yml",
      repo:{full_name:"dev-amaraii/nen-website-cms"}},
    },{
      id:UUIDS.pipeline,config_source:{provider:"github_app",file_path:".circleci/config.yml",
        repo:{full_name:"dev-amaraii/nen-website-cms"}},
    }]});
  await assert.rejects(()=>executeCircleCiNen(environment,cmd("verify_project"),duplicate.send),
    /definition not verified uniquely/);
});

test("inspect rejects cross-project, wrong branch, and wrong or missing SHA",async()=>{
  const command=cmd("inspect",{pipelineId:UUIDS.pipeline});
  const good=mockApi();
  const result=await executeCircleCiNen(environment,command,good.send);
  assert.equal(result.revisionVerified,true);
  assert.equal(result.revision,NEN_CIRCLECI_REVIEW.reviewSha);
  assert.equal(result.releasePermitted,false);
  for(const options of [
    {pipelineProject:"circleci/OTHER/REPO"},
    {branch:"main"},
    {revision:"0".repeat(40)},
    {revision:""},
  ]) {
    const mock=mockApi(options);
    await assert.rejects(()=>executeCircleCiNen(environment,command,mock.send));
    assert.equal(mock.calls.length,1);
  }
});

test("explicit gated trigger posts one validation-only GitHub App pipeline and requires SHA verification",async()=>{
  const mock=mockApi();
  const result=await executeCircleCiNen(environment,exact,mock.send);
  assert.equal(result.pipelineId,UUIDS.pipeline);
  assert.equal(result.requestedRevision,NEN_CIRCLECI_REVIEW.reviewSha);
  assert.equal(result.revisionVerificationRequired,true);
  assert.equal(result.automaticRetryPermitted,false);
  assert.equal(result.releasePermitted,false);
  assert.equal(mock.calls.length,3);
  const last=mock.calls[2];
  assert.equal(last.method,"POST");
  assert.equal(last.redirect,"manual");
  assert.equal(last.tokenAttached,true);
  assert.deepEqual(last.body,{
    definition_id:UUIDS.definition,
    config:{branch:NEN_CIRCLECI_REVIEW.branch},
    checkout:{branch:NEN_CIRCLECI_REVIEW.branch},
  });
  assert.equal(JSON.stringify(last.body).includes("release"),false);
  assert.equal(JSON.stringify(last.body).includes("deploy"),false);
});

test("invalid trigger result does not retry and a missing project slug fails closed",async()=>{
  const bad=mockApi({triggerResponse:{id:"not-a-pipeline"}});
  await assert.rejects(()=>executeCircleCiNen(environment,exact,bad.send),
    /Invalid NEN CircleCI trigger response/);
  assert.equal(bad.calls.filter(x=>x.method==="POST").length,1);
  const unset=mockApi();
  await assert.rejects(()=>executeCircleCiNen({...environment,NEN_CIRCLECI_PROJECT_SLUG:""},exact,unset.send),
    /project not configured/);
  assert.equal(unset.calls.length,0);
});
