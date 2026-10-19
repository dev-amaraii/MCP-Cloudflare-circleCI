# NEN Cloudflare CircleCI MCP OAuth implementation

## Verified 2026-10-19, live account (not inferred from repo)

- Worker: `nen-circleci-mcp`. Deployed version `dcaea5a5-c331-4d0b-9ba5-b00b8754d8ff` (09:20 UTC). The deployed script includes four read-only CircleCI tool names but no OAuth `/authorize` or `/callback` route markers; source branch and live deployment **differ**.
- Self-hosted Access app `NEN CircleCI MCP` and SaaS OIDC app `NEN CircleCI MCP OAuth` are **both created**. Both have a single Allow policy for `devops@amaraii.com` and no observed Bypass/Everyone rules.
- SaaS OIDC callback configured as `https://nen-circleci-mcp.devops-948.workers.dev/callback`, scopes `openid email profile`, OIDC keys available. Binding names for upstream credentials, token URL, authorization URL, JWKS URL and cookie key are present as Worker secrets. Their values are not shown or copied.
- Existing Worker also has encrypted `CIRCLE_TOKEN`. This does **not** prove a successful end-to-end API request through ChatGPT.
- ChatGPT authentication is **not yet verified**. Never claim that a Worker with an Access policy automatically implements MCP OAuth 2.1.

## Staged source — branch fix/oauth-claims-hardening

The source uses Cloudflare Workers OAuth Provider with client registration, consent, Access for SaaS authorization code + PKCE, `/authorize`, `/callback`, and protected `/mcp` tools.

Security improvements staged in GitHub:
- Exact **path-scoped** Access for SaaS issuer, derived from the configured authorization endpoint and checked against team domain, client ID, token endpoint and JWKS endpoint. Using just `new URL(issuer).origin` would reject valid SaaS ID tokens.
- RS256-only ID-token signature verification, explicit key ID and unique RSA JWKS key, pinned JWKS URL, and issuer/audience/authorized party, expiration, issued-at, not-before, subject and allowed email validation.
- Signed, single-use KV approval state: no unsigned authorization request objects are accepted from a consent form. Existing form CSRF token retained. The upstream callback additionally requires the browser-scoped `__Host-OAUTH_STATE` HttpOnly/Secure/Lax cookie before consuming its nonce; the cookie is cleared on successful authorization. Single flight per browser is assumed; concurrent initiations may invalidate the earlier flow rather than silently accept the wrong session.
- Upstream OAuth error text redacted. Upstream Access token is no longer persisted inside MCP props. The token POST explicitly sets `redirect: error` to prevent forwarding client credentials on 307/308 redirects.
- Read-only tools are project-scoped: `circleci_pipeline_status`, `circleci_pipeline_workflows`, `circleci_workflow_jobs`, `circleci_job_details`. Trigger remains intentionally absent.

Three isolated test files (`access-oidc`, `circleci-read`, `oauth-replay-guard`) were executed as exact GitHub blob copies: **49/49 passing**. A real SQLite 20-attempt concurrency test accepted exactly one nonce. The `oauth-state` suite additionally passed **10/10** when run on the latest GitHub source in a temporary JavaScript harness with TypeScript types removed and test-only adapters. The new HTTP authorization-handler tests passed JavaScript syntax checks only and have **not been executed**. The **full** native `npm test`, dependency install, and Worker typecheck remain **unexecuted**. There is no lockfile and no deployment authorization.

## Release and integration steps

1. Lock and audit dependencies, use Node >=22.18, run `npm run check` and `npm test` including `oauth-state` tests. The local isolated test runtime was Node 22.16 with experimental TS stripping and a focused TypeScript check using test-only Cloudflare type shims. **Neither substitutes for a full Worker compile.**
2. Exercise the `__Host-OAUTH_STATE` cookie, the newly added first-time/previously-approved client flow tests, and upstream redirect rejection in workerd; route and cookie behavior have not been tested against the actual Access application.
3. Validate the new singleton SQLite Durable Object `OAuthReplayGuard`, `OAUTH_REPLAY_GUARD` binding and v2 migration under workerd/Miniflare. Existing OAuth KV namespace `b27a78e5d8a8447ea233f0e7c92459d4` exists in the account but is **not bound on the live Worker**. No Durable Object namespaces were returned by the live account lookup.
4. Inspect OIDC discovery issuer and values in SaaS app without exposing credentials. The ID token's `iss` must be the full `https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client-id>` issuer; `aud` must identify the exact SaaS client.
5. Test the existing self-hosted Access application against OAuth discovery, `/authorize`, `/callback`, `/register`, `/token`, and `/mcp`. Access could intercept client discovery even if the SaaS app is configured. Do **not** disable protection merely to get a connection.
6. Deploy only after security-review approval. Verify unauthenticated denial, no open redirects, cookie and PKCE behavior, correct user allowlist, and callback replay denial. Exercise ChatGPT registration and initial read-only tools.
7. Verify the previously successful CircleCI pipeline/workflow and job metadata; ensure foreign-project UUIDs fail.
8. Implement mutating pipeline trigger **separately**, with approval, project and branch allowlists, audit logging, rate limiting, and explicit per-execution confirmation. Keep remote CI on demand.

## Remaining risks / unknowns

- **Mitigation staged, not deployed:** OAuth state validation now requires `claimStateOnce` against a singleton SQLite-backed Durable Object, using an atomic unique-nonce insert. Replay-guard unit tests (5/5) and a 20-request SQLite race check passed. Workerd/runtime migration and end-to-end OAuth tests are still required.
- Self-hosted Access route interception versus OAuth discovery has not been tested in a browser or ChatGPT. A read-only fetch from this tool's restricted environment returned its own outbound-policy 403 (`Forbidden: requests ... are not allowed`), **not evidence that Cloudflare Access responded 403**.
- Cookie/session binding and upstream redirect denial are now implemented and unit-smoke-checked, but require real browser/Worker end-to-end tests.
- Full suite execution, dependency lock, deployment and chargeable CI verification remain outstanding.
- Raw step logs may contain secrets and pre-signed temporary URLs; do not expose raw output until a guarded retrieval/redaction design is reviewed.

References:
- https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/saas-apps/generic-oidc-saas/
- https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/
