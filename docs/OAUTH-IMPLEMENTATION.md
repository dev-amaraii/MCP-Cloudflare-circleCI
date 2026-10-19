# Remote MCP OAuth implementation decision

## Current state (verified 2026-10-19)
- Cloudflare self-hosted Access application `NEN CircleCI MCP` protects Worker `nen-circleci-mcp`, restricted to `devops@amaraii.com`.
- Worker is **bootstrap-only**. No MCP routes, OAuth endpoints, or CircleCI actions are live.
- The Worker has the CircleCI token as `secret_text`; other bindings exist.
- A self-hosted Access application is **not** equivalent to an Access for SaaS OIDC application. The existing `ACCESS_AUD` identifies the self-hosted app; it does **not** supply OAuth client credentials or discovery endpoints for ChatGPT.

## Chosen path
Follow Cloudflare's official `remote-mcp-cf-access` implementation using **Access for SaaS (OIDC)**, with its OAuth 2.0 authorization code flow and MCP-compatible discovery. Avoid rolling our own token issuance and consent.

### Required Cloudflare configuration (not yet created)
1. Create **a separate Access for SaaS application**, protocol OIDC, named `NEN CircleCI MCP OAuth`.
2. Set callback URL to the Worker implementation's `/callback` endpoint on its final HTTPS hostname.
3. Restrict its access policy to the same NEN email. Enable the existing One-time PIN identity provider.
4. Obtain and store in Worker **secrets**:
   - `ACCESS_CLIENT_ID`
   - `ACCESS_CLIENT_SECRET`
   - `ACCESS_TOKEN_URL`
   - `ACCESS_AUTHORIZATION_URL`
   - `ACCESS_JWKS_URL`
   - `COOKIE_ENCRYPTION_KEY` (cryptographically random, 32 bytes or stronger).
5. Provision `OAUTH_KV` as required by the official example. Do not commit KV IDs if policy forbids them; KV ID is not a credential.
6. Adapt the example's authenticated MCP tools to our CircleCI client, with allowlisted project/branch and explicit confirmation on trigger.
7. Check whether the existing self-hosted Worker Access app intercepts OAuth metadata, `/authorize`, `/callback`, or `/mcp` and prevents MCP clients from completing discovery. Adjust routing/protection only after verifying end-to-end token validation; **do not disable access merely to make the endpoint connect**.

## Release tests
- Unauthenticated MCP tool requests denied; no token leakage in logs.
- OAuth discovery and dynamic client registration (where required by ChatGPT) work.
- Authorization code + PKCE, redirect URI checks, token audience/issuer/signature/expiry, and replay handling verified.
- Identity not on allowlist denied.
- Read-only CircleCI API tool works for configured project.
- Trigger tool refuses invalid project/branch, and requires explicit confirmation.
- A single confirmed test pipeline can be inspected end to end.

## Docs
- https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/
- https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/
