# Deployment security gate — 2026-10-19

## Verified via Cloudflare API
- Worker `nen-circleci-mcp` exists and currently runs **bootstrap-only** code; `/mcp` is not implemented in the deployed script.
- Access application `NEN CircleCI MCP` exists; its single associated allow policy includes **only** `devops@amaraii.com`. No Everyone or Bypass policy was returned.
- Worker bindings `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`, `CIRCLE_PROJECT_SLUG`, `CIRCLE_DEFINITION_ID` exist as plain text; `CIRCLE_TOKEN` exists as **secret_text**.
- Do not copy secret values to this repository, issues, logs or chat.

## Do not confuse authentication layers
1. Cloudflare Access self-hosted Worker protection (verified policy).
2. MCP OAuth 2.1 discovery, dynamic client registration, authorization code + PKCE, token issuance, consent and token verification (**NOT implemented**).
3. CircleCI API credential (secret binding; **NOT yet exercised**).

## Release gates
- [x] Access policy restricted to the NEN identity.
- [x] CircleCI token binding encrypted.
- [ ] Review official Cloudflare Workers OAuth Provider / Access for SaaS example and implement complete remote MCP OAuth.
- [ ] Build, typecheck and test with locked dependencies.
- [ ] Confirm Worker Access interception and unauthenticated `POST /mcp` rejection externally.
- [ ] Deploy authenticated MCP; test initialize, tools/list and read-only tools.
- [ ] Enable trigger only after read-only validation and explicit human approval.
- [ ] Connect ChatGPT and validate an end-to-end trigger.

**Caution:** `src/index.ts` is an unverified prototype and must not be deployed as production MCP. In particular, direct `Cf-Access-Jwt-Assertion` validation alone does not provide an OAuth login flow to ChatGPT. Cloudflare Access may intercept requests before the Worker, so both edge Access and in-Worker authorization need integration tests.

Reference: https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/
