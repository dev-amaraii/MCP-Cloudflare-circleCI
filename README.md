# NEN CircleCI MCP

A read-only CircleCI MCP server on Cloudflare Workers, protected by Cloudflare Access Managed OAuth. Codex and ChatGPT authenticate through Access; the Worker verifies the signed `Cf-Access-Jwt-Assertion` on every request and accepts only `devops@amaraii.com`.

## Tools

- `circleci_pipeline_status`
- `circleci_pipeline_workflows`
- `circleci_workflow_status`
- `circleci_workflow_jobs`
- `circleci_job_details`
- `circleci_job_logs`

Pipeline, workflow and job calls verify ownership against `CIRCLE_PROJECT_SLUG`. Pagination and log output are bounded. No trigger, rerun, approve or cancellation tool is registered. Legacy v1.1 logs support `gh` and `bb` project slugs; the currently configured `circleci/...` project cannot use this log path. Live CircleCI project mapping and log support must be verified before claiming full operation.

## Authentication and deployment

Access Managed OAuth owns discovery, client registration, consent, PKCE and token storage. Its existing allow policy and Worker destination remain in place. The Worker uses the self-hosted app's `ACCESS_AUD`, the team issuer and `/cdn-cgi/access/certs` signing keys. The older SaaS OIDC implementation remains as historical source/tests, but is not routed by the active entry point.

The active server uses stateless Streamable HTTP: one authenticated server/transport per request, no shared session, KV binding, Durable Object or migration. The pre-existing OAuth KV namespace and SaaS app are retained; no resource deletion is required.

Required runtime settings:

- `CIRCLE_TOKEN`: encrypted Worker secret; never commit or log it.
- `CIRCLE_PROJECT_SLUG`: configured CircleCI project, retained as a dashboard variable.
- `MCP_PUBLIC_URL`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`: non-secret values pinned in `wrangler.toml`.

Use Node.js 24 and the committed npm lockfile:

```sh
npm ci
npm run check
npm test
npx wrangler deploy --dry-run
```

`.circleci/config.yml` runs install, type check, tests with JUnit results, and a Worker dry run on one small Docker executor. It does not deploy or need production secrets. No GitHub Actions are added. This workflow becomes live only when the CircleCI project is connected to this repository and its trigger is enabled.

`npm run deploy` is the manual Cloudflare deployment command and preserves dashboard variables with `--keep-vars`. Review [release gates](docs/SECURITY-RELEASE-GATES.md) before running it. See [OAuth architecture and setup](docs/OAUTH-IMPLEMENTATION.md) and [current verification](docs/MANAGED-OAUTH-VERIFICATION.md).
