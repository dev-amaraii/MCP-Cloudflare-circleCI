# Security release gates

This file separates local implementation and test evidence from live service verification. The production Worker remains unchanged.

## Previously observed Cloudflare state

The Cloudflare inspection recorded on 2026-10-19 found the `nen-circleci-mcp` Worker running bootstrap-only code, a self-hosted Access application with an allow policy limited to `devops@amaraii.com`, the OAuth SaaS application with the same intended email restriction, and the existing encrypted `CIRCLE_TOKEN` binding. This turn did not make or verify new Cloudflare changes.

## Implemented and locally tested

- [x] The callback verifies OIDC discovery and configured endpoints before trusting the SaaS OIDC ID token.
- [x] The callback requires RS256 and validates signature, issuer, audience, expiry, not-before, subject, and allowlisted email.
- [x] The callback uses a configured public URL rather than the incoming Host header.
- [x] Pipeline, workflow, and job requests are scoped to `CIRCLE_PROJECT_SLUG` by validating parent ownership.
- [x] Log output URLs are restricted to HTTPS CircleCI artifact hosts, fetched without redirects, and size bounded.
- [x] The MCP server registers read-only pipeline, workflow, job-detail, and log tools only.
- [x] Unit tests use generated signing keys and mocked API responses; they do not call live services or trigger pipelines.

## Still required before deployment

- [ ] Install dependencies and generate the lockfile.
- [ ] Run `npm run check`, `npm test`, and `npx wrangler deploy --dry-run` from the checked-out project.
- [ ] Review lockfile/package compatibility and confirm the Cloudflare OAuth Provider version/migration path.
- [ ] Verify live Access OIDC discovery metadata and JWKS for the SaaS application.
- [ ] Verify the Access SaaS and self-hosted policies and their actual enforcement.
- [ ] Confirm the self-hosted application does not prevent OAuth discovery, client registration, authorization, token exchange, callback, or MCP requests.
- [ ] Confirm `OAUTH_KV`, the Durable Object binding and migration, Worker URL, callback URL, and encrypted secret bindings for the intended account and Worker.
- [ ] Test anonymous requests, wrong identity, invalid/expired token, MCP initialization, tool listing, and read-only CircleCI calls in a safe environment.
- [ ] Review the legacy CircleCI v1.1 log-output behavior and artifact host formats against the actual project.
- [ ] Deploy only after every preceding gate passes. Do not deploy this isolated working copy from the current session.

## Explicitly out of scope for this release

- [x] Pipeline triggering, cancellation, approval, and rerun tools are absent.
- [ ] Do not implement or enable triggering until authenticated read-only calls pass end-to-end review and the user separately authorizes the trigger milestone.
- [ ] Do not claim ChatGPT connectivity until a real ChatGPT MCP connection has been completed.

## Evidence recorded for this turn

- `npm test`: 16 tests passed, 0 failed; test calls were mocked/local.
- `npm install`: blocked by `ENOTFOUND registry.npmjs.org`; no dependency lockfile was generated.
- `npm run check`: not run because dependencies are unavailable.
- Wrangler dry run: not run because dependencies are unavailable.
- Production deploy: not performed.
- Live OIDC / CircleCI calls: not performed.
