# NEN CircleCI MCP

Read-only remote MCP server for CircleCI, running on Cloudflare Workers. It uses Cloudflare Access for SaaS as the OIDC identity provider and the Cloudflare Workers OAuth Provider for MCP client authorization.

## Current implementation status

The local implementation exposes six read-only tools. It does not register pipeline trigger, cancellation, approval, or rerun tools. The production Worker has not been updated by this work.

| Area | Local code status | Verification status |
| --- | --- | --- |
| OAuth authorization code flow, PKCE, client registration, and consent | Uses Cloudflare's OAuth Provider and existing helper flow | Not verified end to end |
| Access ID token verification | Discovery, configured endpoint matching, RS256 signature, issuer, audience, time, subject, and allowlisted email | Unit tested with generated keys; not tested against the live Access SaaS app |
| CircleCI project isolation | Pipeline → workflow → job ownership checks | Unit tested with API mocks; not tested against the live CircleCI project |
| Read-only MCP tools | Pipeline/workflow/job details and job logs | Type check and dry run pass; in-memory MCP initialization/listing/calls pass; live transport unverified |
| Production deploy and ChatGPT connection | Not performed | Not verified |

## Tools

- `circleci_pipeline_status`
- `circleci_pipeline_workflows`
- `circleci_workflow_status`
- `circleci_workflow_jobs`
- `circleci_job_details`
- `circleci_job_logs`

Every pipeline lookup is checked against `CIRCLE_PROJECT_SLUG`. Workflow IDs are resolved back to their pipeline before use, and jobs are resolved from a project-owned workflow before the job-number endpoint is called. List tools return one API page at a time. Job logs use CircleCI's v1.1 job-output endpoint where available; output URLs must use HTTPS and an approved CircleCI artifact host, redirects are rejected, and output is bounded to 120 KB total.

## Configuration

`MCP_PUBLIC_URL` is a non-secret Worker variable in `wrangler.toml`. It pins the callback URI to the registered hostname and prevents callback URL construction from trusting the incoming Host header. Update it before using a different hostname.

Keep credentials in Cloudflare Worker encrypted secrets. Required bindings:

- `CIRCLE_TOKEN`
- `CIRCLE_PROJECT_SLUG`
- `ACCESS_TEAM_DOMAIN`
- `ACCESS_CLIENT_ID`
- `ACCESS_CLIENT_SECRET`
- `ACCESS_TOKEN_URL`
- `ACCESS_AUTHORIZATION_URL`
- `ACCESS_JWKS_URL`
- `COOKIE_ENCRYPTION_KEY`

`CIRCLE_DEFINITION_ID` and `ACCESS_AUD` are retained in the binding type for compatibility with existing configuration. The OIDC ID token audience check uses the **SaaS application's `ACCESS_CLIENT_ID`**, not the self-hosted Access application's audience tag. No secret values belong in source, logs, or documentation.

The existing OAuth KV binding is `OAUTH_KV`. The MCP Durable Object binding and SQLite class migration remain configured in `wrangler.toml`.

## Development and checks

Use Node.js 22.6 or newer and npm:

```sh
npm ci
npm run check
npm test
npx wrangler deploy --dry-run
```

The committed lockfile aligns Workers types with Wrangler and deduplicates Agents onto the patched MCP SDK; see [verification evidence](docs/DEPLOYMENT-VERIFICATION.md). The tests use mocked CircleCI and OIDC endpoints. They do not call CircleCI, Cloudflare, or trigger pipelines. `npm run deploy` uses `wrangler deploy --keep-vars` to preserve dashboard-managed non-secret configuration and publishes to production and must only be used after the release gates in `docs/SECURITY-RELEASE-GATES.md` are cleared.

## Cloudflare Access and OAuth routing

The Worker expects the separate `NEN CircleCI MCP OAuth` Access for SaaS OIDC application for the authorization code flow. The self-hosted Access application protects the Worker hostname. Before deployment, verify how that application handles `/authorize`, `/register`, `/callback`, OAuth discovery, and `/mcp`. Do not weaken or bypass its allowlist to make an OAuth test pass. See `docs/OAUTH-IMPLEMENTATION.md` for the required checks.

Live verification on 2026-10-19 found that the outer Access layer redirects OAuth discovery and registration/token requests to its login page. Production deployment remains blocked; keep PR #1 in draft. Public SaaS discovery/JWKS and anonymous denial were verified. See [deployment verification](docs/DEPLOYMENT-VERIFICATION.md) for exact evidence and remaining gates.
