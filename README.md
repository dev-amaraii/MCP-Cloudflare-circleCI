# NEN CircleCI MCP — Cloudflare Workers

A single-project, private NEN integration for **read-only CircleCI diagnostics** through a protected MCP server. Pipeline triggering is **not implemented** in this branch. Keep CircleCI execution strictly on demand.

## Status — 2026-10-19

- **Live Cloudflare Worker:** `nen-circleci-mcp`, version 19 (`dcaea5a5`), deployed 09:20 UTC. Its bundle has read-only CircleCI tool markers but **no OAuth `/authorize` or `/callback` handlers**. The deployed code is not the current GitHub OAuth branch.
- **Access self-hosted:** `NEN CircleCI MCP`, Allow policy for `devops@amaraii.com` only.
- **Access for SaaS OIDC:** `NEN CircleCI MCP OAuth`, same Allow identity; redirect URL `https://nen-circleci-mcp.devops-948.workers.dev/callback`; scopes `openid email profile`.
- **Bindings:** CircleCI token, Access OAuth client credentials, Access endpoint URLs, cookie key are secret-type bindings; project slug and definition ID are plaintext. **Binding presence is not evidence of a completed OAuth flow.**
- **This branch:** source-level fail-closed OIDC issuer/signature validation, consent state protection, and read-only project-scoped pipeline, workflow, and job tools. **CircleCI validation #37 PASSED on commit `fb1b6dc1`: locked npm install, full Worker TypeScript check, all committed tests and Wrangler `deploy --dry-run` bundle. The previous consent-cookie test issue is resolved in CI. Real Cloudflare/workerd OAuth integration and Access policy routing remain unverified; no deployment.**

## CircleCI identifiers — NEN MCP project

- Project slug: `circleci/B65DMdC1ZhAJQM74t7SrZ1/4QT9iy1PpGnXx8VQDfdzLm`
- Project ID: `1b91a371-7988-4bb9-bc61-4d790c8015be`
- Definition: `efb046dd-5d13-43b7-a979-a7bf66243da6` (`build-and-test`)
- Automatic GitHub PR/push trigger: disabled, confirmed by CircleCI screenshot.

The earlier Jayson storefront project/definition IDs are **not** valid for this MCP repository.

IDs are identifiers, **not credentials**. Never commit or print the CircleCI token or OAuth secrets.

## Remote validation without a Mac or Work

On-demand CircleCI validation is staged in [`.circleci/config.yml`](.circleci/config.yml). It defines two **disabled-by-default** parameter-gated workflows: `bootstrap_lockfile=true` produces a reviewed `package-lock.json` artifact, and `run_validation=true` runs `npm ci`, the full TypeScript check and tests, and a Wrangler **dry run**. See [Remote validation runbook](docs/REMOTE-VALIDATION.md) for the CircleCI GitHub App project connection, disabling default push triggers, and manual trigger parameters. **CircleCI project is connected and GitHub push trigger disabled. Bootstrap #34 succeeded. Manual validation #37 succeeded on `fb1b6dc1` in 31 seconds, including `npm ci`, `npm run check`, all tests and Wrangler dry-run. No deployment or PR merge. Next: approve and exercise an isolated Cloudflare staging integration, after a separate security review.**

## Local/isolated security validation before deployment

Requires Node >=22.18 (native TypeScript type stripping). **The refreshed lockfile from CircleCI #34 is committed at `fe9cbb97` (Git blob `483b7c0f8a0f4f14ffc212c3935741210fc83224`) and matches `package.json`. It pins MCP SDK `1.29.0` without nested duplicate SDKs. Those CI checks all passed in manually triggered CircleCI pipeline #37 on `fb1b6dc1`; this is not a live OAuth integration test.** 49 tests covering OIDC/JWT, CircleCI project scoping and replay-guard nonce consumption passed in an isolated Node 22.16 runtime using `--experimental-strip-types`; the `oauth-state.test.mjs` suite additionally passed **10/10 in an isolated JavaScript harness** (runtime TypeScript stripping, test-only stubs, exact GitHub source and test blobs). The native OAuth handler tests, including corrected consent-cookie assertions, passed in CircleCI #37. **Full Worker `npm run check`, `npm test`, and Wrangler `deploy --dry-run` all passed on commit `fb1b6dc1`.** Live workerd callback/Access/OAuth connectivity remains unverified.

```sh
npm install --ignore-scripts
npm run check
npm test
```

Review [OAuth implementation](docs/OAUTH-IMPLEMENTATION.md) and [security release gates](docs/SECURITY-RELEASE-GATES.md). The security suite covers path-scoped Access for SaaS issuer, JWT alg/kid/signature/JWKS, audience/expiry/identity, signed OAuth state/CSRF/replay, and project-scoped CircleCI reads. Do **not** claim success before running it.

## Safe production sequence

1. Review branch and dependency supply chain; lock versions and execute the full test suite and Worker typecheck. Staged nonce guard has 5 passing unit tests and a 20-request SQLite concurrency check (1 claim succeeded, 19 rejected).
2. Verify the new `__Host-OAUTH_STATE` browser-bound callback cookie, signed nonce replay protection, and upstream OAuth POST `redirect: error` in a real browser/workerd environment. These source changes and new handler tests are staged only.
3. Validate the staged `OAuthReplayGuard` Durable Object migration and `OAUTH_REPLAY_GUARD` binding under a real Workers runtime. Both consent POST and callback now require atomic state consumption; the live Worker has none of the OAuth KV or Durable Object bindings yet.
4. Check SaaS OIDC discovery (issuer, endpoints, audience), and verify real Worker/Access route interception without removing protection.
5. Validate unauthorized `/mcp` rejection, then OAuth discovery, registration, PKCE, callback, token issuance, expiration, and `tools/list` using an authorized client.
6. Verify read-only pipeline/workflow/job tools on NEN's known successful pipeline and reject cross-project IDs.
7. Only after separate approval and a verified auth path, design an explicit, allowlisted, rate-limited, auditable `circleci_trigger`. No chargeable CI trigger without authorization.

**Do not deploy this branch yet.** No GitHub Actions or per-commit CircleCI triggers are required.

## Architecture

`src/access-handler.ts` — OAuth delegation and consent; `src/access-jwt.ts` and `src/oidc-claims.ts` — Access for SaaS ID-token checks; `src/circleci-client.ts` — project-scoped API reads; `src/index.ts` — OAuthProvider and MCP tools.

Official guidance: https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/
