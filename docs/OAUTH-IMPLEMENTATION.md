# Access Managed OAuth implementation

## Active architecture

MCP client → Cloudflare Access Managed OAuth → stateless Worker → read-only CircleCI API.

The self-hosted Access app **NEN CircleCI MCP** retains its sole allow policy for `devops@amaraii.com` and its Worker destination. Managed OAuth supplies public metadata and client registration while protecting `/mcp`. The Worker does not run a second OAuth authorization server behind Access.

On every MCP request, `src/access-jwt.ts` verifies the Access assertion's RS256 signature using the team's `/cdn-cgi/access/certs`, exact team issuer, self-hosted application audience, expiry, not-before, non-empty subject and exact allowlisted email. Missing/forged assertion headers are rejected. A bare email header or caller-supplied bearer string cannot establish identity. Service tokens cannot impersonate the human identity because email and subject are required.

A new SDK server and Web Standard Streamable HTTP transport are created per request. No persisted MCP session or Worker OAuth token database is needed. The existing SaaS OIDC handlers/tests are historical and inactive; neither `/authorize` nor `/callback` is routed by the Worker. Preserve the SaaS app and OAuth KV namespace for rollback rather than deleting them.

## Approved Access configuration

The owner explicitly approved these settings on 2026-10-19:

- Managed OAuth enabled.
- Dynamic registration enabled for localhost/127.0.0.1 clients (Codex).
- Allowed hosted callback URIs: `https://chatgpt.com/connector_platform_oauth_redirect` and `https://chatgpt.com/connector/oauth/*`.
- Access token lifetime: 15 minutes; OAuth session duration: 24 hours.
- Existing `devops@amaraii.com` allow policy and protected Worker destination unchanged.

Readback confirmed those exact settings. Anonymous OAuth authorization-server and protected-resource metadata return 200 JSON. Anonymous `/mcp` now returns a 401 Bearer challenge pointing at Access metadata instead of an unusable HTML login redirect. Registration is not authorization: users must still satisfy the unchanged Access policy and the origin's signed-email check.

## Connect clients

Codex: register a Streamable HTTP MCP server named `nen-circleci` using `https://nen-circleci-mcp.devops-948.workers.dev/mcp`, then complete its OAuth sign-in as the allowlisted owner. The CLI supports `codex mcp add nen-circleci --url URL` and `codex mcp login nen-circleci`; inspect current help before using additional flags. Existing config must be preserved.

ChatGPT: create a private MCP connection using the same endpoint and OAuth, then complete the owner login. Use the exact callback URI displayed in its management UI. Do not claim the ChatGPT connection works until that connection initializes and lists the tools.

Never request or record the owner's password, email verification code, browser cookies or bearer tokens in handoff notes. The owner completes any required interactive sign-in.

## Manual deployment and rollback

Use the account pinned in `wrangler.toml`, retain encrypted `CIRCLE_TOKEN` and dashboard project configuration, and deploy manually with `npm run deploy`. Preview URLs are disabled. Anonymous/invalid identity checks and signed-in protocol tests are required after deployment; code/build success is not live proof.

The pre-change deployed Worker version is `957d1b68-32ee-4757-ba9b-daaf78a94229`. Before rollback, inspect the latest deployment history to confirm the target. Restore that version if the new origin fails, and disable Managed OAuth on the existing app only as part of a reviewed rollback while preserving its policies and destination. Never add a bypass policy or broaden allowed identities.

Sources: [Access Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/), [Access JWT verification](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [ChatGPT OAuth](https://developers.openai.com/plugins/build/auth).
