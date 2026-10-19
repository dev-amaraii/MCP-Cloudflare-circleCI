# Security release gates

Current architecture: Access Managed OAuth with a signed-assertion, stateless Streamable HTTP Worker. The previous SaaS OIDC/Worker-OAuth design is retained only as historical source/tests. See [current evidence](MANAGED-OAUTH-VERIFICATION.md); [earlier evidence](DEPLOYMENT-VERIFICATION.md) records the superseded routing blocker.

## Build and security checks

- [x] Locked dependencies install without force flags; npm reports zero advisories.
- [x] Type check passes.
- [x] 35 tests pass, including real HTTP MCP initialization/list/call through signed assertion verification.
- [x] Missing/forged/expired/wrong-issuer/wrong-audience/wrong-email assertions fail before CircleCI access.
- [x] Pipeline → workflow → job ownership checks and bounded log fetches remain in place.
- [x] Only six read-only tools are registered. Unknown mutation names make no API calls.
- [x] Worker dry run passes; the active entry point requires no KV/DO provisioning or migration.
- [x] Cloudflare account, team issuer, audience and public URL are explicit in configuration.
- [x] Production encrypted credentials remain in Cloudflare; no tokens or owner verification codes enter handoff notes.
- [x] CircleCI configuration validates with official CLI 1.7.0; JUnit command passes locally.
- [x] No GitHub Actions or automated production deployment workflow is added.

## Access routing

- [x] Owner explicitly approved exact Managed OAuth and callback registration settings.
- [x] Applied/read back settings: localhost/loopback clients, the two approved ChatGPT callback patterns, 15-minute tokens, 24-hour sessions.
- [x] Existing sole `devops@amaraii.com` allow policy and Worker destination verified unchanged.
- [x] Live OAuth discovery returns 200 JSON and anonymous `/mcp` returns 401 with OAuth metadata challenge.
- [x] Live registration accepts localhost and approved ChatGPT callback, rejects an unapproved external callback.
- [ ] Verify a real owner OAuth login and wrong-identity denial end to end.

## Manual deployment and acceptance

A protected manual deployment is authorized to complete live verification; it is not an assertion that client acceptance has passed. Preserve Access policy enforcement, encrypted CircleCI credentials and dashboard project variables. The old Worker bootstrap has no usable MCP implementation, so signed-in origin tests require deploying the tested origin. Keep the PR draft until those tests pass.

- [ ] Refresh expired local Cloudflare CLI login and verify the intended account.
- [ ] Deploy the tested commit manually with `npm run deploy` and record the version.
- [ ] Verify anonymous/invalid bearer denial on the deployed endpoint.
- [ ] Complete Codex OAuth, initialize the deployed MCP and list/call tools.
- [ ] Complete a real private ChatGPT MCP connection; initialization/tool listing must be observed.
- [ ] Confirm the configured CircleCI project maps to `dev-amaraii/MCP-Cloudflare-circleCI` and the existing token can read it.
- [ ] Observe a successful hosted CircleCI verification run for the deployed PR commit.
- [ ] Resolve and verify bounded log retrieval for the actual project type. The current legacy implementation rejects `circleci/...` log requests.

## Ship-gate assessment

Stack: TypeScript, Cloudflare Worker, MCP SDK, jose, managed Access auth. No application database, frontend, LLM calls, file uploads or payment flows; those checks do not apply. Authentication, input validation, project isolation, timeout/pagination/log bounds, generic error responses, lockfile, strict TypeScript, ignored secrets and dependency advisories were reviewed/tested. No exposed source credentials or registered write tool were found.

Live deployment/client/CircleCI acceptance remains pending. Cloudflare Access owns authentication rate controls; separate origin-level request throttling and detailed operational telemetry have not been added. Rollback target and procedure are recorded in [OAuth implementation](OAUTH-IMPLEMENTATION.md). Do not mark production-ready based only on local tests or the public metadata response.
