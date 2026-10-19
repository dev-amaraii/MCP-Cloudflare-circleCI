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
- [x] Restrict read-only CircleCI tools to the configured project; expose workflow jobs/job metadata.
- [x] Keep CircleCI trigger tool disabled and **do not deploy** the unverified security branch.
- [ ] Pin/lock dependencies; run `npm run check` and `npm test` using Node >=22.18 and record results.
- [ ] Review state replay for concurrent callbacks (KV get/delete not atomic) and remediate before production.
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
