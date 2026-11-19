import test from "node:test";
import assert from "node:assert/strict";
import {readCircleCiNenEvidence} from "../src/circleci-nen-evidence.mjs";
const projectId="caca1e1a-b73c-4d44-b8fa-112233445566";
const definitionId="caca1e1a-b73c-4d44-b8fa-112233445567";
const pipelineId="caca1e1a-b73c-4d44-b8fa-112233445568";
const jobId="caca1e1a-b73c-4d44-b8fa-112233445569";
const workflowId="caca1e1a-b73c-4d44-b8fa-112233445570";
const branch="codex/nen-approved-overview-hero-20261118";
const revision="7b9f3ff8d9cf906d4a9df6578d54ddfe44c29d9f";
const projectSlug="circleci/B65DMdC1ZhAJQM74t7SrZ1/EXAMPLE_PROJECT_ONLY";
const env={NEN_CIRCLECI_PROJECT_SLUG:projectSlug,CIRCLE_TOKEN:"mock-private-token"};
const cmd=(action,extra={})=>({project:"nen-website-cms",provider:"circleci",action,jobId,pipelineId:workflowId,...extra});
const artifactUrl="https://test-gh.circle-artifacts.com/0/nen-security-preview-qa/report.json";
const artifactPath="nen-security-preview-qa/report.json";
const pngUrl="https://test-gh.circle-artifacts.com/0/nen-security-preview-qa/security-1280-light-security-cctv.png";
const pngPath="nen-security-preview-qa/security-1280-light-security-cctv.png";
const report={count:2,results:[{id:"security-1280-light",failures:[]},
  {id:"security-320-dark",failures:["AssertionError: hero overflow"]}]};
const json=v=>Response.json(v);
function mock(options={}){
  const calls=[];
  const request=async (url, init={})=>{
    calls.push({url,method:init.method,redirect:init.redirect,auth:init.headers?.Authorization});
    const projectUrl="https://circleci.com/api/v2/project/"+projectSlug;
    if(url===projectUrl)return json({id:projectId,slug:options.projectSlug||projectSlug,name:"nen-website"});
    if(url===`https://circleci.com/api/v2/projects/${projectId}/pipeline-definitions`)return json({
      items:options.definitions||[{id:definitionId,config_source:{provider:"github_app",file_path:".circleci/config.yml",
        repo:{full_name:"dev-amaraii/nen-website-cms"}}}],
    });
    if(url===`https://circleci.com/api/v2/workflow/${workflowId}`)return json({
      id:workflowId,pipeline_id:pipelineId
    });
    if(url===`https://circleci.com/api/v2/workflow/${workflowId}/job`)return json({items:[{
      id:jobId,project_slug:options.jobProject||projectSlug,
      name:options.jobName||"nen-security-preview-source-qa",status:"failed",job_number:21
    }]});
    if(url===`https://circleci.com/api/v3/jobs/${jobId}`)return json({
      data:{id:jobId,attributes:{
        parallel_executions:[{index:0,steps:[{name:"checkout",status:"success",exit_code:0,num:0},
          {name:"Web unit tests",outcome:"failed",exit_code:1,num:1}]}],
      }},
    });
    if(url===`https://circleci.com/api/v2/pipeline/${pipelineId}`)return json({
      id:pipelineId,project_slug:options.pipelineProject||projectSlug,
      vcs:{branch:options.branch||branch,revision:options.revision||revision},
    });
    if(url.includes("/stdout/condensed?")) return new Response(
      "AssertionError: Approved Cloudinary asset missing: security_irqhzc.webp\n" +
      "Authorization: Bearer mock-private-token\n" +
      "Error: command exited with code 1\n",{status:200});
    if(url===`https://circleci.com/api/v3/jobs/${jobId}/artifacts`)return json({
      data:options.artifacts||[
        {attributes:{path:artifactPath,url:artifactUrl,size:300}},
        {attributes:{path:pngPath,url:pngUrl,size:8}},
        {attributes:{path:"nen-security-preview-qa/secret.env",url:"https://evil.com/steal"}},
      ],page:{next:null},
    });
    if(url===artifactUrl)return new Response(JSON.stringify(report));
    if(url===pngUrl)return new Response(new Uint8Array([137,80,78,71,13,10,26,10]));
    throw Error("Unexpected URL requested");
  };
  return {calls,request};
}
test("diagnostics are NEN-owned, revision-pinned, and redact log credentials",async()=>{
  const m=mock();
  const result=await readCircleCiNenEvidence(env,cmd("job_diagnostics"),m.request);
  assert.equal(result.revisionVerified,true);
  assert.equal(result.revision,revision);
  assert.equal(result.failedSteps.length,1);
  assert.equal(result.failedSteps[0].exitCode,1);
  const lines=result.failedSteps[0].diagnostics.join("\n");
  assert.match(lines,/Approved Cloudinary asset missing/);
  assert.doesNotMatch(lines,/Authorization|Bearer|mock-private-token/);
  assert.equal(m.calls.filter(x=>x.url.includes("/stdout/condensed")).length,1);
  assert.ok(m.calls.every(x=>x.method==="GET" && x.redirect==="manual"));
});
test("project slug, GitHub App repo, job owner and revision are mandatory",async()=>{
  const variants=[
    {projectSlug:"circleci/other/other"},
    {definitions:[{id:definitionId,config_source:{provider:"github_app",
      file_path:".circleci/config.yml",repo:{full_name:"dev-amaraii/amaraii-os"}}}]},
    {jobProject:"circleci/other/other"},
    {jobName:"amaraii-marketing-qa"},
    {pipelineProject:"circleci/other/other"},
    {branch:"main"},
    {revision:"invalid"},
  ];
  for (const x of variants) {
    const m=mock(x);
    await assert.rejects(()=>readCircleCiNenEvidence(env,cmd("job_diagnostics"),m.request));
    assert.equal(m.calls.some(y=>y.url.includes("/stdout/condensed")),false);
  }
});
test("arbitrary action/path/URL never reaches CircleCI",async()=>{
  const m=mock();
  for (const c of [
    cmd("trigger"),cmd("release"),cmd("job_diagnostics",{pipelineId:"bogus"}),
    cmd("artifact_png",{artifactPath:"../../secret.env"}),
    cmd("artifact_png",{artifactPath:"nen-security-preview-qa/secret.env"}),
    cmd("artifact_report",{artifactPath:"report.json"}),
    cmd("artifact_png",{artifactPath:"https://evil.com/attack.png"}),
  ]) await assert.rejects(()=>readCircleCiNenEvidence(env,c,m.request));
  assert.equal(m.calls.length,0);
});
test("artifact listing strips private URLs and unknown file types",async()=>{
  const m=mock();
  const result=await readCircleCiNenEvidence(env,cmd("artifact_list"),m.request);
  assert.deepEqual(result.artifacts.map(x=>x.path),[artifactPath,pngPath]);
  assert.equal(JSON.stringify(result).includes("circle-artifacts.com"),false);
  assert.equal(JSON.stringify(result).includes("secret.env"),false);
});
test("report reader returns bounded sanitized failures rather than raw report",async()=>{
  const m=mock();
  const result=await readCircleCiNenEvidence(env,cmd("artifact_report"),m.request);
  assert.equal(result.caseCount,2);
  assert.equal(result.failureCount,1);
  assert.equal(result.failures[0].id,"security-320-dark");
  assert.match(result.failures[0].messages.join(" "),/hero overflow/);
  assert.equal(JSON.stringify(result).includes("circle-artifacts.com"),false);
  assert.equal(m.calls.filter(x=>x.url===artifactUrl).length,1);
  assert.equal(m.calls.find(x=>x.url===artifactUrl).auth,undefined);
});
test("PNG preview is limited to an exact named path with valid PNG signature",async()=>{
  const m=mock();
  const result=await readCircleCiNenEvidence(env,cmd("artifact_png",{artifactPath:pngPath}),m.request);
  assert.equal(result.mimeType,"image/png");
  assert.equal(result.bytes,8);
  assert.equal(result.base64,"iVBORw0KGgo=");
  assert.equal(result.artifactPath,pngPath);
  assert.equal(m.calls.find(x=>x.url===pngUrl).auth,undefined);
});
test("unknown artifact host is denied without fetching it",async()=>{
  const m=mock({artifacts:[{attributes:{path:artifactPath,url:"https://evil.example/hijack.json"}}]});
  await assert.rejects(()=>readCircleCiNenEvidence(env,cmd("artifact_report"),m.request),
    /artifact host not permitted/);
  assert.ok(!m.calls.some(x=>x.url.includes("evil.example")));
});
