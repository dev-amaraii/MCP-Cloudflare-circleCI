import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { registerCircleCITools } from "./circleci-tools";
import { handleAccessRequest } from "./access-handler";
import type { Props } from "./workers-oauth-utils";

export class CircleMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({ name: "nen-circleci-mcp", version: "0.3.0" });

	async init() {
		registerCircleCITools(this.server, this.env, this.props);
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
