import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CircleCIClient, CircleCIError, type CircleCIEnv } from "./circleci-client.ts";

const AUTHORIZED_EMAIL = "devops@amaraii.com";
const result = (value: unknown, isError = false) => ({
	content: [{ type: "text" as const, text: JSON.stringify(value) }],
	isError,
});

export function registerCircleCITools(server: McpServer, env: CircleCIEnv, props: { email?: string } | undefined, fetcher: typeof fetch = fetch) {
	if (props?.email?.toLowerCase() !== AUTHORIZED_EMAIL) return;
	const client = new CircleCIClient(env, fetcher);

	server.tool(
		"circleci_project_status",
		"Get the configured CircleCI project and one page of its pipelines, including IDs needed by the other read-only tools.",
		{ page_token: z.string().max(1024).optional() },
		async ({ page_token }) => invoke(() => client.getProjectStatus(page_token)),
	);
	server.tool(
		"circleci_pipeline_status",
		"Get the status and summary of a pipeline in the configured CircleCI project.",
		{ pipeline_id: z.string().uuid() },
		async ({ pipeline_id }) => invoke(() => client.getPipeline(pipeline_id)),
	);
	server.tool(
		"circleci_pipeline_workflows",
		"List one page of workflows for a pipeline in the configured CircleCI project.",
		{ pipeline_id: z.string().uuid(), page_token: z.string().max(1024).optional() },
		async ({ pipeline_id, page_token }) => invoke(() => client.listPipelineWorkflows(pipeline_id, page_token)),
	);
	server.tool(
		"circleci_workflow_status",
		"Get the status of a workflow after verifying it belongs to the configured CircleCI project.",
		{ workflow_id: z.string().uuid() },
		async ({ workflow_id }) => invoke(() => client.getWorkflow(workflow_id)),
	);
	server.tool(
		"circleci_workflow_jobs",
		"List one page of jobs for a workflow in the configured CircleCI project.",
		{ workflow_id: z.string().uuid(), page_token: z.string().max(1024).optional() },
		async ({ workflow_id, page_token }) => invoke(() => client.listWorkflowJobs(workflow_id, page_token)),
	);
	server.tool(
		"circleci_job_details",
		"Get details for a job only after verifying the job belongs to the selected workflow and project.",
		{ workflow_id: z.string().uuid(), job_id: z.string().uuid() },
		async ({ workflow_id, job_id }) => invoke(() => client.getJobDetails(workflow_id, job_id)),
	);
	server.tool(
		"circleci_job_logs",
		"Retrieve bounded log output for a job in the configured project. Logs are truncated at 120 KB total.",
		{ workflow_id: z.string().uuid(), job_id: z.string().uuid() },
		async ({ workflow_id, job_id }) => invoke(() => client.getJobLogs(workflow_id, job_id)),
	);
	// No trigger, cancel, approve, or rerun operations are registered in the read-only release.
}

async function invoke(operation: () => Promise<unknown>) {
	try {
		return result(await operation());
	} catch (error) {
		const message = error instanceof CircleCIError ? error.message : "CircleCI operation failed";
		return result({ error: message }, true);
	}
}
