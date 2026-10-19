# NEN CircleCI MCP — release security gates

Last audited against Cloudflare API: **2026-10-19**.

## Verified facts

- Existing Worker `nen-circleci-mcp`, version `dcaea5a5`, deployed 09:20 UTC. Bundle markers include four read-only CircleCI tools, **not** the OAuth `/authorize`/`/callback` routes from this GitHub branch.
- Cloudflare Access self-hosted and SaaS OIDC applications both exist. Each has an Allow policy restricted to `devops@amaraii.com`; no broad Allow or Bypass observed in policy inspection.
- SaaS OIDC app callback: `https://nen-circleci-mcp.devops-948.workers.dev/callback`. Granted scopes `openid email profile`. OIDC public keys available.
- Worker contains `CIRCLE_TOKEN` plus Access OAuth credentials and URLs as encrypted secrets. Do not read/print or copy credential values.
- Jayson CI pipeline `85624194-342e-4aea-8aa1-f7cdf5153f51` and workflow `7451fa90-9a37-4bc2-bfc2-881e58b7cd69` previously completed successfully via CircleCI. This **does not validate this MCP branch**.

## Release checklist (none of the unchecked items may be inferred)

- [x] Verify existing Cloudflare account, Access policies and bindings.
- [x] Add fail-closed app-pinned SaaS OIDC verification and unit tests on a separate branch.
- [x] Protect OAuth client consent from unsigned request state; avoid persisting upstream Access token.
- [x] Stage browser-bound `__Host-OAUTH_STATE` cookie checks on callback, remove cookie on success, and reject upstream token endpoint redirects; 6 exact-source isolated cookie checks passed.
- [x] Stage atomic SQLite Durable Object nonce-consumption gate for OAuth callback and consent; isolated tests 5/5 and 20-request SQLite race check passed (1 accepted).
- [x] Restrict read-only CircleCI tools to the configured project; expose workflow jobs/job metadata.
- [x] Keep CircleCI trigger tool disabled and **do not deploy** the unverified security branch.
- [x] Run isolated exact-blob test coverage for OIDC/JWT, project-scoped CircleCI reads, and nonce guard: **49/49 passed** on Node 22.16 with experimental TS stripping; focused typecheck with test-only shims passed.
- [x] Run `oauth-state.test.mjs` against the latest GitHub source in an isolated JS harness with TypeScript annotations removed and test adapters: **10/10 passed**. New handler tests passed syntax parsing but were not executed.
- [x] Refreshed npm lockfile generated via successful CircleCI bootstrap #34 and reviewed against current `package.json`; new commit `fe9cbb97`, blob `483b7c0f8a0f4f14ffc212c3935741210fc83224`. 290 package records, root SDK `1.29.0` and **no nested SDK**, 289 registry resolutions with SHA-512 integrity metadata. Prior lockfile `052a61c9` is superseded. This is not proof of tarball content, npm installation, typecheck or runtime tests.
- [x] Lockfile structurally verified to contain one root MCP SDK `1.29.0`, no nested SDK, and exact root manifest/engine requirements. Confirmation of installed SDK behavior awaits `npm ci` and TypeScript.
- [ ] Re-run `npm ci` and **full** `npm run check` (CircleCI #33 reached typecheck but failed with TS2307, TS2345 and TS2416). Staged fixes: include `node` TS types, copy BufferSource into owned ArrayBuffer, and align SDK version.
- [ ] After full `check` passes, run `npm test` including the handler suite, then Wrangler `deploy --dry-run` and record results.
- [ ] Run the full OAuth handler tests under real Node 22.18+ and workerd; verify browser-bound cookies on both consent and prior-approval flows. Isolated state tests are not a substitute.
- [ ] Verify new `OAuthReplayGuard` Durable Object binding and v2 migration in workerd; inspect callback and consent integration under real concurrent requests. The code mitigation is staged, not live.
- [ ] Verify Access for SaaS discovery issuer and actual OIDC token shape against strict validation.
- [ ] Verify that self-hosted Access does not break OAuth metadata, registration, token or callback routes.
- [ ] Manually test anonymous `/mcp` denial and unauthorized identity rejection.
- [ ] Review code and obtain authorization to deploy OAuth implementation (prefer isolated staging).
- [ ] Validate actual ChatGPT OAuth registration + authorization code/PKCE/callback + token use.
- [ ] Validate read-only status, workflow, jobs, and cross-project rejection end-to-end.
- [ ] Design scoped, explicitly confirmed and audited trigger with rate limit; obtain separate authorization before any charged pipeline.
- [ ] Review safe job output/log retrieval without leaking pre-signed links or credentials.

## Operational rules

Never merge or deploy without tests and review. Do not relax Access policies just to establish OAuth. Never commit secrets or paste logs containing credentials. CircleCI runs must be manual/on-demand rather than GitHub push-triggered. Report exact evidence when a checklist item is completed.

See `docs/OAUTH-IMPLEMENTATION.md` for known route and token pitfalls and `README.md` for project identifiers and verification commands.
