# Security release gates

This file separates local implementation and test evidence from live service verification. The production Worker remains unchanged.

## Current verification

See [deployment verification — 2026-10-19](DEPLOYMENT-VERIFICATION.md) for reproducible evidence. Both Access allow policies still restrict identity to `devops@amaraii.com`. Public SaaS discovery/JWKS work, but the outer Access layer redirects OAuth metadata, registration, token, callback and MCP requests to login. This blocks standard MCP bootstrap. Live settings lack OAuth KV/DO bindings and `MCP_PUBLIC_URL`; the KV namespace exists, while the DO namespace/migration is not yet applied. No remote configuration or deployment was changed.

## Implemented and locally tested

- [x] The callback verifies OIDC discovery and configured endpoints before trusting the SaaS OIDC ID token.
- [x] The callback requires RS256 and validates signature, issuer, audience, expiry, not-before, subject, and allowlisted email.
- [x] The callback uses a configured public URL rather than the incoming Host header.
- [x] Pipeline, workflow, and job requests are scoped to `CIRCLE_PROJECT_SLUG` by validating parent ownership.
- [x] Log output URLs are restricted to HTTPS CircleCI artifact hosts, fetched without redirects, and size bounded.
- [x] The MCP server registers read-only pipeline, workflow, job-detail, and log tools only.
- [x] Unit tests use generated signing keys and mocked API responses; they do not call live services or trigger pipelines.

## Still required before deployment

- [x] Install dependencies and generate the lockfile.
- [x] Run `npm run check`, `npm test`, and `npx wrangler deploy --dry-run` from the checked-out project.
- [x] Review lockfile/package compatibility and confirm the Cloudflare OAuth Provider version/migration path (0.8.3 retained; 1.0 migration deferred).
- [x] Verify live Access OIDC discovery metadata and JWKS for the SaaS application. Encrypted endpoint binding values still require an owner-side match.
- [ ] Verify the Access SaaS and self-hosted policies and their actual enforcement.
- [ ] Confirm the self-hosted application does not prevent OAuth discovery, client registration, authorization, token exchange, callback, or MCP requests.
- [ ] Confirm `OAUTH_KV`, the Durable Object binding and migration, Worker URL, callback URL, and encrypted secret bindings for the intended account and Worker.
- [ ] Test anonymous requests, wrong identity, invalid/expired token, MCP initialization, tool listing, and read-only CircleCI calls in a safe environment.
- [ ] Review the legacy CircleCI v1.1 log-output behavior and artifact host formats against the actual project.
- [ ] Deploy only after every preceding gate passes. The current Access routing blocker must be resolved and verified first.

## Explicitly out of scope for this release

- [x] Pipeline triggering, cancellation, approval, and rerun tools are absent.
- [ ] Do not implement or enable triggering until authenticated read-only calls pass end-to-end review and the user separately authorizes the trigger milestone.
- [ ] Do not claim ChatGPT connectivity until a real ChatGPT MCP connection has been completed.

## Evidence recorded for this continuation

- `npm run check`: passed.
- `npm test`: 23 passed, 0 failed; CircleCI calls use mocks.
- Wrangler dry run: passed; no upload or deployment.
- Dependency audit after SDK deduplication: zero reported vulnerabilities.
- Local Worker simulator: discovery 200, client registration 201, unauthenticated MCP 401, missing-state callback 400.
- Live public SaaS discovery and JWKS: 200; no signed-in OAuth exchange completed.
- Live anonymous OAuth/MCP requests: 302 to Access login, including metadata endpoints (blocking).
- Production deploy and live CircleCI calls: not performed.
- NEN Context OS: read and searched; no matching CircleCI project note found and no update made.
