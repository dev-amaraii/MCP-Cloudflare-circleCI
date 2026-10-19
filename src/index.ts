import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { CircleCIClient, CircleCIError } from "./circleci-client";
import { handleAccessRequest } from "./access-handler";
import type { Props } from "./workers-oauth-utils";

const AUTHORIZED_EMAIL = "devops@amaraii.com";
const result = (value: unknown, isError = false) => ({
	content: [{ type: "text" as const, text: JSON.stringify(value) }],
	isError,
});

export class CircleMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({ name: "nen-circleci-mcp", version: "0.3.0" });

	async init() {
		if (this.props?.email?.toLowerCase() !== AUTHORIZED_EMAIL) return;
		const client = new CircleCIClient(this.env);

		this.server.tool(
			"circleci_pipeline_status",
			"Get the status and summary of a pipeline in the configured CircleCI project.",
			{ pipeline_id: z.string().uuid() },
			async ({ pipeline_id }) => this.invoke(() => client.getPipeline(pipeline_id)),
		);
		this.server.tool(
			"circleci_pipeline_workflows",
			"List one page of workflows for a pipeline in the configured CircleCI project.",
			{ pipeline_id: z.string().uuid(), page_token: z.string().max(1024).optional() },
			async ({ pipeline_id, page_token }) => this.invoke(() => client.listPipelineWorkflows(pipeline_id, page_token)),
		);
		this.server.tool(
			"circleci_workflow_status",
			"Get the status of a workflow after verifying it belongs to the configured CircleCI project.",
			{ workflow_id: z.string().uuid() },
			async ({ workflow_id }) => this.invoke(() => client.getWorkflow(workflow_id)),
		);
		this.server.tool(
			"circleci_workflow_jobs",
			"List one page of jobs for a workflow in the configured CircleCI project.",
			{ workflow_id: z.string().uuid(), page_token: z.string().max(1024).optional() },
			async ({ workflow_id, page_token }) => this.invoke(() => client.listWorkflowJobs(workflow_id, page_token)),
		);
		this.server.tool(
			"circleci_job_details",
			"Get details for a job only after verifying the job belongs to the selected workflow and project.",
			{ workflow_id: z.string().uuid(), job_id: z.string().uuid() },
			async ({ workflow_id, job_id }) => this.invoke(() => client.getJobDetails(workflow_id, job_id)),
		);
		this.server.tool(
			"circleci_job_logs",
			"Retrieve bounded log output for a job in the configured project. Logs are truncated at 120 KB total.",
			{ workflow_id: z.string().uuid(), job_id: z.string().uuid() },
			async ({ workflow_id, job_id }) => this.invoke(() => client.getJobLogs(workflow_id, job_id)),
		);
		// No trigger, cancel, approve, or rerun operations are registered in the read-only release.
	}

	private async invoke(operation: () => Promise<unknown>) {
		try {
			return result(await operation());
		} catch (error) {
			const message = error instanceof CircleCIError ? error.message : "CircleCI operation failed";
			return result({ error: message }, true);
		}
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
