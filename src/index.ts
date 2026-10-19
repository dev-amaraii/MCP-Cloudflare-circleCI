import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

interface Env {
  CIRCLE_TOKEN: string;
  CIRCLE_PROJECT_SLUG: string;
  CIRCLE_DEFINITION_ID: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  CIRCLE_ALLOWED_BRANCHES?: string;
}

const api = "https://circleci.com/api/v2";
const idPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
function response(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}
async function callCircle(env: Env, path: string, init: RequestInit = {}) {
  const result = await fetch(api + path, {
    ...init,
    headers: { "Circle-Token": env.CIRCLE_TOKEN, "Accept": "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}) }
  });
  const text = await result.text();
  if (!result.ok) throw new Error("CircleCI HTTP " + result.status + ": " + text.slice(0, 400));
  return JSON.parse(text);
}
// Cloudflare Access JWT validation via JWKS and WebCrypto, with audience/issuer enforcement.
// OAuth-capable MCP client authorization must be added before ChatGPT connection.
async function authorize(request: Request, env: Env): Promise<boolean> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const decode = (part: string) => JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
  try {
    const header = decode(parts[0]), payload = decode(parts[1]);
    const team = new URL(env.ACCESS_TEAM_DOMAIN).origin;
    if (payload.iss !== team || !Array.isArray(payload.aud) || !payload.aud.includes(env.ACCESS_AUD)) return false;
    if (payload.exp <= Date.now() / 1000 || payload.nbf > Date.now() / 1000) return false;
    const jwksResponse = await fetch(team + "/cdn-cgi/access/certs");
    if (!jwksResponse.ok) return false;
    const jwks = await jwksResponse.json() as { keys: JsonWebKey[] };
    const jwk = jwks.keys.find(k => (k as JsonWebKey & { kid?: string }).kid === header.kid);
    if (!jwk || header.alg !== "RS256") return false;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signature = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, new TextEncoder().encode(parts[0] + "." + parts[1]));
  } catch { return false; }
}
function createServer(env: Env) {
  const server = new McpServer({ name: "nen-circleci-mcp", version: "0.1.0" });
  server.tool("circleci_pipeline_status", "Read CircleCI pipeline status by UUID.", { pipeline_id: z.string().uuid() }, async ({ pipeline_id }) => {
    try { return response(JSON.stringify(await callCircle(env, "/pipeline/" + pipeline_id))); }
    catch (e) { return response(String(e), true); }
  });
  server.tool("circleci_pipeline_workflows", "List workflows in a CircleCI pipeline.", { pipeline_id: z.string().uuid() }, async ({ pipeline_id }) => {
    try { return response(JSON.stringify(await callCircle(env, "/pipeline/" + pipeline_id + "/workflow"))); }
    catch (e) { return response(String(e), true); }
  });
  server.tool("circleci_trigger", "Start one allowlisted CI validation pipeline. Requires explicit confirm=true.", {
    branch: z.string(), confirm: z.boolean()
  }, async ({ branch, confirm }) => {
    const allowed = (env.CIRCLE_ALLOWED_BRANCHES || "feat/storefront-demo,main").split(",").map(s => s.trim());
    if (!allowed.includes(branch)) return response("Branch not allowlisted", true);
    if (!confirm) return response("No pipeline started. Call again with confirm=true to explicitly authorize one run.");
    if (!idPattern.test(env.CIRCLE_DEFINITION_ID)) return response("Invalid CIRCLE_DEFINITION_ID", true);
    try {
      const body = { definition_id: env.CIRCLE_DEFINITION_ID, config: { branch }, checkout: { branch }, parameters: { run_validation: true } };
      return response(JSON.stringify(await callCircle(env, "/project/" + env.CIRCLE_PROJECT_SLUG + "/pipeline/run", { method: "POST", body: JSON.stringify(body) })));
    } catch (e) { return response(String(e), true); }
  });
  return server;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === "/health") return new Response("ok");
    if (new URL(request.url).pathname !== "/mcp") return new Response("Not found", { status: 404 });
    // This is defense-in-depth. Cloudflare Access policy must also guard /mcp.
    if (!await authorize(request, env)) return new Response("Unauthorized", { status: 401 });
    const server = createServer(env);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    return transport.handleRequest(request);
  }
};
