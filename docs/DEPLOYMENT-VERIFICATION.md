# Deployment verification — 2026-10-19

Historical snapshot before the approved Managed OAuth continuation. See [current verification](MANAGED-OAUTH-VERIFICATION.md) and [current release gates](SECURITY-RELEASE-GATES.md); the earlier routing result below has been superseded.

## Scope and source

Continued draft PR #1 from head `35b495168297906d9fd65ad02b962f1a13b46179` on `codex/circleci-read-only-oauth-hardening`, using a clean checkout. The older working copy was compared byte-for-byte with the PR's 14 changed files and left intact. No GitHub Actions, production deployment, Access policy change, or pipeline mutation was performed.

The NEN Notion connection resolved **Context OS — NEN International**. Searches for CircleCI/MCP, including within that page and its Projects data source, found no matching project record. Context OS was read, not updated. The original Library attachment `Pasted text.txt` was unavailable in the supplied project files and located local copies; this report relies on the current request and repository brief.

## Dependency and build evidence

The initial network-enabled `npm install` failed with `ERESOLVE`: Wrangler 4.151.1 requires Workers types 5.x, while the manifest requested 4.x. Workers types now use the compatible 5.x range.

Agents 0.17.4 pins MCP SDK 1.29.0, while the direct SDK resolved to 1.32.1. Their distinct private class types caused `npm run check` to fail. The manifest now pins Agents 0.17.4 and SDK 1.32.1, and overrides only Agents' SDK dependency to use the direct version. `npm ls @modelcontextprotocol/sdk` confirms a single deduplicated SDK. This also removes the nested SDK covered by [GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h); the advisory concerns OAuth clients, and does not establish that this server was exploited.

OAuth Provider resolves to 0.8.3. The existing single-Worker integration remains; no 1.0 migration was attempted. Commit `package-lock.json` and use `npm ci` for subsequent verification. Do not replace dependency compatibility checks with `--force` or `--legacy-peer-deps`.

- `npm run check`: passed.
- `npm test`: 23 passed, 0 failed. Three new protocol tests initialize an in-memory MCP client, list exactly six tools, exercise all six against mocked CircleCI responses, reject mutation tool names without API requests, and deny tools for missing/wrong identity.
- `wrangler deploy --dry-run`: passed with Wrangler 4.151.1; bundle 2468.06 KiB, gzip 447.17 KiB. This does not validate remote credentials or provision bindings.
- Dependency install/audit after SDK deduplication: zero reported vulnerabilities.
- `git diff --check`: passed.

For restricted filesystem environments, direct Wrangler logs to the ignored local folder:

```sh
WRANGLER_LOG_PATH=.wrangler/logs npx wrangler deploy --dry-run
```

## Local Worker runtime evidence

Wrangler local mode used simulated KV and Durable Objects, without production credentials:

| Request | Result |
| --- | --- |
| GET `/.well-known/oauth-authorization-server` | 200, JSON metadata |
| GET `/.well-known/oauth-protected-resource` | 200, JSON metadata |
| POST `/register` with temporary localhost client | 201, registered in local KV only |
| GET `/mcp` without bearer token | 401, Bearer challenge |
| GET `/callback` without state | 400 |

These are protocol/runtime checks, not a live Access login or production MCP session. Full signed-in OAuth, consent, PKCE callback, token exchange, and the Durable Object transport remain unverified end to end. Local discovery advertises dynamic registration; Client ID Metadata Documents are disabled under the current compatibility flags.

## Live configuration and anonymous enforcement

Read-only Cloudflare API inspection confirmed the intended account and Worker `nen-circleci-mcp` at `https://nen-circleci-mcp.devops-948.workers.dev`. The Worker was last modified at `2026-10-19T06:55:28.152573Z` before this continuation.

Both the SaaS app **NEN CircleCI MCP OAuth** and self-hosted app **NEN CircleCI MCP** have a single allow policy including only `devops@amaraii.com`. The self-hosted application targets a Worker destination. No allowlist was broadened or bypassed. Policy configuration and anonymous enforcement were checked; an actual wrong-identity login was not attempted.

The SaaS redirect URI matches `MCP_PUBLIC_URL` plus `/callback`. Public OIDC discovery and JWKS both returned 200. Discovery's issuer uses the SaaS client path, and the advertised authorization/token/JWKS endpoints share that path. JWKS contains RSA/RS256 signature keys with key IDs. Encrypted Worker endpoint/client bindings are opaque: their presence was verified, but their values were not extracted or compared with discovery.

The existing OAuth KV namespace exists and matches the repository's configured ID. Live Worker settings do **not** currently bind `OAUTH_KV` or `MCP_OBJECT`, and no Durable Object namespaces exist in this account. The local configuration declares the missing bindings and `v1` SQLite class migration; these have not been applied remotely. `MCP_PUBLIC_URL` is also absent from current live bindings.

Required credential binding names are present, including encrypted `CIRCLE_TOKEN`, OAuth client credentials, endpoint URLs and cookie key. Some non-secret configuration is dashboard-managed plain text, including team domain and project slug. The manual deploy script uses `--keep-vars` to preserve those variables while adding the repository's `MCP_PUBLIC_URL`; encrypted secret values must remain in Cloudflare.

## Blocking live result

Anonymous requests to all of the following returned **302 HTML redirects to the outer Access login**:

- GET `/.well-known/oauth-authorization-server`
- GET `/.well-known/oauth-protected-resource`
- POST `/register` with an empty JSON body
- GET `/authorize`
- POST `/token` with an empty JSON body
- GET `/callback`
- POST `/mcp` with an empty JSON body

Anonymous access is denied, but OAuth metadata and token/registration endpoints are intercepted before they reach the Worker. A standard MCP client cannot bootstrap discovery through this configuration. A browser Access session alone does not demonstrate that the MCP client's separate HTTP requests can pass the outer layer.

**Release is blocked.** Keep PR #1 in draft and do not deploy production. The owner must select and verify a client/Access integration that preserves the existing identity restriction. Do not add bypass policies, remove Access, use service credentials as the human identity, or temporarily publish an unprotected endpoint to get a passing test.

After routing is resolved, use an explicitly selected protected test environment with its own KV/DO state and registered callback to verify the authorized identity, wrong identity, consent, PKCE, token exchange, expired/invalid tokens, actual MCP initialization/listing, and all six CircleCI calls. No such test environment was created during this continuation. CircleCI credentials are currently only available as opaque Worker secrets; live project/log behavior remains unverified.

Only after all release gates pass, run the manual deploy workflow (`npm run deploy`, which preserves dashboard variables) in the confirmed account. Confirm remote bindings/migration, repeat deployed endpoint and signed-in MCP checks, and record the deployment version. No automated deployment workflow is required or added.
