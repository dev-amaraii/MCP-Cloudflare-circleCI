import OAuthProvider from "@cloudflare/workers-oauth-provider";
export { OAuthReplayGuard } from "./oauth-replay-guard.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { handleAccessRequest } from "./access-handler";
import { readPipeline, readPipelineWorkflows, readWorkflowJobs, readJobDetails } from "./circleci-client";
import type { Props } from "./workers-oauth-utils";

const result = (text: string, isError = false) => ({ content: [{ type: "text" as const, text }], isError });
const output = (data: unknown) => result(JSON.stringify(data));

export class CircleMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({ name: "nen-circleci-mcp", version: "0.2.0" });
  async init() {
    if (this.props?.email?.toLowerCase() !== "devops@amaraii.com") return;
    this.server.tool("circleci_pipeline_status", "Read a pipeline belonging to the configured NEN CircleCI project.", { pipeline_id: z.string().uuid() }, async ({ pipeline_id }) => {
      try {
        const p = await readPipeline(this.env, pipeline_id);
        return output({ id: p.id, number: p.number, state: p.state, project_slug: p.project_slug, created_at: p.created_at, trigger: p.trigger });
      } catch { return result("Unable to retrieve project pipeline", true); }
    });
    this.server.tool("circleci_pipeline_workflows", "List workflows for a pipeline in the configured CircleCI project.", { pipeline_id: z.string().uuid() }, async ({ pipeline_id }) => {
      try {
        const response = await readPipelineWorkflows(this.env, pipeline_id);
        return output({
          items: (response.items || []).map((w: any) => ({ id: w.id, name: w.name, status: w.status, created_at: w.created_at, stopped_at: w.stopped_at })),
          next_page_token: response.next_page_token,
        });
      } catch { return result("Unable to retrieve project workflows", true); }
    });
    this.server.tool("circleci_workflow_jobs", "List jobs and their statuses in a workflow belonging to the configured CircleCI project.", { workflow_id: z.string().uuid() }, async ({ workflow_id }) => {
      try {
        const response = await readWorkflowJobs(this.env, workflow_id);
        return output({
          items: (response.items || []).map((j: any) => ({
            id: j.id, name: j.name, status: j.status, job_number: j.job_number,
            started_at: j.started_at, stopped_at: j.stopped_at,
          })),
          next_page_token: response.next_page_token,
        });
      } catch { return result("Unable to retrieve project workflow jobs", true); }
    });
    this.server.tool("circleci_job_details", "Read a numbered job's metadata in the configured CircleCI project (no log URLs).", { job_number: z.number().int().positive() }, async ({ job_number }) => {
      try {
        const j = await readJobDetails(this.env, job_number);
        return output({
          number: j.number, name: j.name, status: j.status, duration: j.duration,
          queued_at: j.queued_at, started_at: j.started_at, stopped_at: j.stopped_at,
          executor: j.executor && { type: j.executor.type, resource_class: j.executor.resource_class },
          pipeline_id: j.pipeline?.id,
          messages: (j.messages || []).map((m: any) => ({ type: m.type, reason: m.reason })),
        });
      } catch { return result("Unable to retrieve project job details", true); }
    });
    // Mutating operations deliberately withheld until authentication is tested end-to-end.
  }
}

export default new OAuthProvider({
  apiHandler: CircleMCP.serve("/mcp"),
  apiRoute: "/mcp",
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: { fetch: handleAccessRequest as any },
  tokenEndpoint: "/token",
});
