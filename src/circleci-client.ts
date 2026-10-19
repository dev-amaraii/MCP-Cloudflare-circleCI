const API_V2 = "https://circleci.com/api/v2";
const API_V1 = "https://circleci.com/api/v1.1";
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MAX_PAGES = 10;
const MAX_LOG_STEPS = 20;
const MAX_STEP_BYTES = 24_000;
const MAX_TOTAL_LOG_BYTES = 120_000;

export interface CircleCIEnv {
	CIRCLE_TOKEN: string;
	CIRCLE_PROJECT_SLUG: string;
}

export class CircleCIError extends Error {
	readonly status?: number;
	readonly retryAfterSeconds?: number;
	constructor(message: string, status?: number, retryAfterSeconds?: number) {
		super(message);
		this.name = "CircleCIError";
		this.status = status;
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

export function isValidUuid(value: string): boolean {
	return UUID.test(value);
}

export function isSafeCircleCIOutputUrl(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;
		const host = url.hostname.toLowerCase();
		if (host === "circle-artifacts.com" || host.endsWith(".circle-artifacts.com")) return true;
		return /^(?:[a-z0-9-]+\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(host);
	} catch {
		return false;
	}
}

function validateProjectSlug(slug: string): string[] {
	const parts = slug.split("/");
	if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_.-]{1,128}$/.test(part))) {
		throw new CircleCIError("Configured CircleCI project slug is invalid");
	}
	return parts;
}

function encodeProjectSlug(slug: string): string {
	return validateProjectSlug(slug).map(encodeURIComponent).join("/");
}

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new CircleCIError("CircleCI returned an invalid response");
	return value as Record<string, unknown>;
}

function asItems(value: unknown): Array<Record<string, unknown>> {
	const record = asRecord(value);
	if (!Array.isArray(record.items)) throw new CircleCIError("CircleCI returned an invalid list response");
	return record.items.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
}

function projectSlugFromPipeline(pipeline: Record<string, unknown>): string | undefined {
	if (typeof pipeline.project_slug === "string") return pipeline.project_slug;
	const project = pipeline.project;
	if (project && typeof project === "object" && !Array.isArray(project) && typeof (project as Record<string, unknown>).slug === "string") {
		return (project as Record<string, unknown>).slug as string;
	}
	return undefined;
}

function safeError(status: number, retryAfter: string | null): CircleCIError {
	if (status === 401 || status === 403) return new CircleCIError("CircleCI rejected the configured credentials or access", status);
	if (status === 404) return new CircleCIError("CircleCI resource was not found in the configured project", status);
	if (status === 429) {
		const seconds = retryAfter && /^\d{1,4}$/.test(retryAfter) ? Number(retryAfter) : undefined;
		return new CircleCIError(seconds === undefined ? "CircleCI rate limit reached" : `CircleCI rate limit reached; retry after ${seconds} seconds`, status, seconds);
	}
	if (status >= 500) return new CircleCIError(`CircleCI service error (HTTP ${status})`, status);
	return new CircleCIError(`CircleCI request failed (HTTP ${status})`, status);
}

export class CircleCIClient {
	private readonly fetcher: typeof fetch;
	private readonly projectPath: string;
	private readonly env: CircleCIEnv;

	constructor(env: CircleCIEnv, fetcher: typeof fetch = fetch) {
		this.env = env;
		if (!env.CIRCLE_TOKEN) throw new CircleCIError("CircleCI credentials are not configured");
		this.projectPath = encodeProjectSlug(env.CIRCLE_PROJECT_SLUG);
		this.fetcher = fetcher;
	}

	private async getJson(url: string): Promise<unknown> {
		let response: Response;
		try {
			response = await this.fetcher(url, {
				method: "GET",
				headers: { "Circle-Token": this.env.CIRCLE_TOKEN, Accept: "application/json" },
				signal: AbortSignal.timeout(10_000),
				redirect: "error",
			});
		} catch (error) {
			if (error instanceof CircleCIError) throw error;
			throw new CircleCIError("CircleCI request failed or timed out");
		}
		if (!response.ok) throw safeError(response.status, response.headers.get("Retry-After"));
		try {
			return await response.json();
		} catch {
			throw new CircleCIError("CircleCI returned invalid JSON", response.status);
		}
	}

	private async getV2(path: string): Promise<unknown> {
		return this.getJson(`${API_V2}${path}`);
	}

	private async assertProjectPipeline(pipelineId: string): Promise<Record<string, unknown>> {
		if (!isValidUuid(pipelineId)) throw new CircleCIError("Invalid pipeline ID");
		const pipeline = asRecord(await this.getV2(`/pipeline/${encodeURIComponent(pipelineId)}`));
		if (projectSlugFromPipeline(pipeline) !== this.env.CIRCLE_PROJECT_SLUG) {
			throw new CircleCIError("Pipeline does not belong to the configured project");
		}
		return pipeline;
	}

	private async assertProjectWorkflow(workflowId: string): Promise<Record<string, unknown>> {
		if (!isValidUuid(workflowId)) throw new CircleCIError("Invalid workflow ID");
		const workflow = asRecord(await this.getV2(`/workflow/${encodeURIComponent(workflowId)}`));
		if (typeof workflow.pipeline_id !== "string" || !isValidUuid(workflow.pipeline_id)) {
			throw new CircleCIError("CircleCI workflow does not include a valid pipeline reference");
		}
		await this.assertProjectPipeline(workflow.pipeline_id);
		return workflow;
	}

	async getProjectStatus(pageToken?: string): Promise<Record<string, unknown>> {
		const project = asRecord(await this.getV2(`/project/${this.projectPath}`));
		const pipelines = await this.getPage(`/project/${this.projectPath}/pipeline`, pageToken);
		return { project, pipelines };
	}

	async getPipeline(pipelineId: string): Promise<Record<string, unknown>> {
		return this.assertProjectPipeline(pipelineId);
	}

	async listPipelineWorkflows(pipelineId: string, pageToken?: string): Promise<Record<string, unknown>> {
		await this.assertProjectPipeline(pipelineId);
		return this.getPage(`/pipeline/${encodeURIComponent(pipelineId)}/workflow`, pageToken);
	}

	async getWorkflow(workflowId: string): Promise<Record<string, unknown>> {
		return this.assertProjectWorkflow(workflowId);
	}

	async listWorkflowJobs(workflowId: string, pageToken?: string): Promise<Record<string, unknown>> {
		await this.assertProjectWorkflow(workflowId);
		return this.getPage(`/workflow/${encodeURIComponent(workflowId)}/job`, pageToken);
	}

	private async getPage(path: string, pageToken?: string): Promise<Record<string, unknown>> {
		if (pageToken !== undefined && (pageToken.length === 0 || pageToken.length > 1024 || /[\u0000-\u001f]/.test(pageToken))) {
			throw new CircleCIError("Invalid page token");
		}
		const url = new URL(`${API_V2}${path}`);
		if (pageToken) url.searchParams.set("page-token", pageToken);
		const result = asRecord(await this.getJson(url.href));
		asItems(result);
		return result;
	}

	private async findJob(workflowId: string, jobId: string): Promise<Record<string, unknown>> {
		if (!isValidUuid(jobId)) throw new CircleCIError("Invalid job ID");
		await this.assertProjectWorkflow(workflowId);
		let pageToken: string | undefined;
		for (let page = 0; page < MAX_PAGES; page++) {
			const result = await this.getPage(`/workflow/${encodeURIComponent(workflowId)}/job`, pageToken);
			const job = asItems(result).find((item) => item.id === jobId);
			if (job) {
				if (!Number.isSafeInteger(job.job_number) || (job.job_number as number) < 1) {
					throw new CircleCIError("CircleCI job has an invalid job number");
				}
				return job;
			}
			pageToken = typeof result.next_page_token === "string" ? result.next_page_token : undefined;
			if (!pageToken) break;
		}
		throw new CircleCIError("Job is not part of the selected workflow");
	}

	async getJobDetails(workflowId: string, jobId: string): Promise<Record<string, unknown>> {
		const job = await this.findJob(workflowId, jobId);
		const result = asRecord(await this.getV2(`/project/${this.projectPath}/job/${job.job_number}`));
		if (typeof result.id === "string" && result.id !== jobId) throw new CircleCIError("CircleCI job details did not match the selected job");
		return result;
	}

	async getJobLogs(workflowId: string, jobId: string): Promise<{ job_id: string; steps: Array<{ name: string; output: string; truncated: boolean }> }> {
		const job = await this.findJob(workflowId, jobId);
		const legacyProjectPath = this.legacyProjectPath();
		const jobDetails = asRecord(await this.getJson(`${API_V1}${legacyProjectPath}/${job.job_number}`));
		if (!Array.isArray(jobDetails.steps)) throw new CircleCIError("CircleCI did not return job log steps for this project");
		const steps: Array<{ name: string; output: string; truncated: boolean }> = [];
		let totalBytes = 0;
		for (const rawStep of jobDetails.steps.slice(0, MAX_LOG_STEPS)) {
			if (!rawStep || typeof rawStep !== "object" || !Array.isArray((rawStep as Record<string, unknown>).actions)) continue;
			for (const rawAction of (rawStep as Record<string, unknown>).actions as unknown[]) {
				if (steps.length >= MAX_LOG_STEPS || totalBytes >= MAX_TOTAL_LOG_BYTES) break;
				if (!rawAction || typeof rawAction !== "object") continue;
				const action = rawAction as Record<string, unknown>;
				if (typeof action.output_url !== "string") continue;
				if (!isSafeCircleCIOutputUrl(action.output_url)) throw new CircleCIError("CircleCI returned an unsafe log output URL");
				const remaining = Math.min(MAX_STEP_BYTES, MAX_TOTAL_LOG_BYTES - totalBytes);
				const output = await this.readLogOutput(action.output_url, remaining);
				const outputBytes = new TextEncoder().encode(output.text).byteLength;
				totalBytes += outputBytes;
				steps.push({
					name: typeof action.name === "string" ? action.name.slice(0, 200) : "Job step",
					output: output.text,
					truncated: output.truncated,
				});
			}
		}
		return { job_id: jobId, steps };
	}

	private legacyProjectPath(): string {
		const [vcs, org, project] = validateProjectSlug(this.env.CIRCLE_PROJECT_SLUG);
		const legacyVcs = vcs === "gh" ? "github" : vcs === "bb" ? "bitbucket" : undefined;
		if (!legacyVcs) throw new CircleCIError("Job log retrieval is unavailable for this CircleCI project slug type");
		return `/project/${legacyVcs}/${encodeURIComponent(org!)}/${encodeURIComponent(project!)}`;
	}

	private async readLogOutput(url: string, limit: number): Promise<{ text: string; truncated: boolean }> {
		let response: Response;
		try {
			response = await this.fetcher(url, {
				method: "GET",
				headers: { Accept: "application/json, text/plain" },
				signal: AbortSignal.timeout(10_000),
				redirect: "error",
			});
		} catch {
			throw new CircleCIError("Unable to fetch CircleCI job output");
		}
		if (!response.ok) throw safeError(response.status, response.headers.get("Retry-After"));
		const declaredLength = Number(response.headers.get("Content-Length"));
		if (Number.isFinite(declaredLength) && declaredLength > limit) {
			await response.body?.cancel();
			return { text: "[Log output truncated at configured size limit]", truncated: true };
		}
		if (!response.body) return { text: "", truncated: false };
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		let truncated = false;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const remaining = limit - size;
			if (value.byteLength > remaining) {
				chunks.push(value.subarray(0, Math.max(0, remaining)));
				size = limit;
				truncated = true;
				await reader.cancel();
				break;
			}
			chunks.push(value);
			size += value.byteLength;
		}
		const output = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			output.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return { text: new TextDecoder().decode(output), truncated };
	}
}
