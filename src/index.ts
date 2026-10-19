import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerCircleCITools } from "./circleci-tools.ts";
import { verifyAccessAssertion, type AccessEnv } from "./access-jwt.ts";
import type { CircleCIEnv } from "./circleci-client.ts";

export type RuntimeEnv = AccessEnv & CircleCIEnv & { MCP_PUBLIC_URL: string };

/** Access owns OAuth. The origin verifies the assertion again on every MCP request. */
export function createWorker(verify = verifyAccessAssertion, circleFetch: typeof fetch = fetch) {
	return {
		async fetch(request: Request, env: RuntimeEnv): Promise<Response> {
			if (new URL(request.url).pathname !== "/mcp") return new Response("Not Found", { status: 404 });
			let identity;
			try {
				identity = await verify(request, env);
			} catch {
				return Response.json({ error: "Authentication required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
			}
			// A fresh server/transport prevents identity or session state from crossing requests.
			const server = new McpServer({ name: "nen-circleci-mcp", version: "0.4.0" });
			const transport = new WebStandardStreamableHTTPServerTransport({
				sessionIdGenerator: undefined,
				enableJsonResponse: true,
				allowedOrigins: [new URL(env.MCP_PUBLIC_URL).origin],
			});
			try {
				registerCircleCITools(server, env, identity, circleFetch);
				await server.connect(transport);
				const response = await transport.handleRequest(request);
				response.headers.set("Cache-Control", "no-store");
				return response;
			} catch {
				return Response.json({ error: "MCP request failed" }, { status: 500 });
			} finally {
				await server.close();
			}
		},
	};
}

export default createWorker();
