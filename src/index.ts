import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { handleAccessRequest } from "./access-handler";
import type { Props } from "./workers-oauth-utils";

const API = "https://circleci.com/api/v2";
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const result = (text: string, isError = false) => ({ content: [{ type: "text" as const, text }], isError });

async function circle(env: Env, path: string, init: RequestInit = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      "Circle-Token": env.CIRCLE_TOKEN,
      "Accept": "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok) throw new Error("CircleCI request failed (HTTP " + res.status + ")");
  return res.json();
}

export class CircleMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({ name: "nen-circleci-mcp", version: "0.2.0" });
  async init() {
    if (this.props?.email?.toLowerCase() !== "devops@amaraii.com") return;
    this.server.tool("circleci_pipeline_status", "Read a CircleCI pipeline by UUID.", { pipeline_id: z.string().uuid() }, async ({ pipeline_id }) => {
      try { return result(JSON.stringify(await circle(this.env, "/pipeline/" + pipeline_id))); }
      catch { return result("Unable to retrieve pipeline", true); }
    });
    this.server.tool("circleci_pipeline_workflows", "List workflows in a CircleCI pipeline.", { pipeline_id: z.string().uuid() }, async ({ pipeline_id }) => {
      try { return result(JSON.stringify(await circle(this.env, "/pipeline/" + pipeline_id + "/workflow"))); }
      catch { return result("Unable to retrieve workflows", true); }
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
