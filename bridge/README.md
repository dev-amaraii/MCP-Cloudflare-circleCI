# NEN CI bridge — Cloudflare Workers + KV

The **separate, minimal** NEN CI bridge runs CircleCI requests without a user's Mac or a remote MCP connection. It is **not** the former `nen-circleci-mcp`: this project lives under `bridge/`, uses no MCP dependency, and does not modify the old server or its Cloudflare Worker.

**Status (2026-10-20):** `nen-ci-bridge` Worker deployed and end-to-end CircleCI integration **verified**. The encrypted `CIRCLE_TOKEN` secret is active, private subdomains remain disabled, KV + minute cron process requests, and an explicitly authorized `preview_qa` run of Jayson Tech created CircleCI pipeline #8 and returned a successful QA Intel workflow and job. The live storefront preview has **not** been redeployed.

## Why a KV mailbox

ChatGPT has an authorized Cloudflare API connector but **cannot invoke arbitrary URL endpoints** using that connector. An authenticated assistant can write a request to Cloudflare KV via its API and later read a result, while the Worker handles CircleCI API calls on a one-minute Cron Trigger.

```
Authorized ChatGPT Cloudflare connection
  -> Cloudflare KV: requests/<uuid>
  -> Cloudflare Worker scheduled() once per minute
  -> CircleCI v2 personal API token (encrypted Worker secret)
  -> Cloudflare KV: claims/<uuid>, results/<uuid>
  -> Authenticated ChatGPT Cloudflare connection reads result
```

There is **no public command endpoint**. The Worker returns HTTP 404 from `fetch()`, and `workers_dev=false`/preview URLs disabled.

## V1 scope

Only one registered project, `jayson-storefront`, branch `feat/storefront-demo`, with two on-demand CircleCI test pipeline modes:
- `validation`: `run_validation=true`
- `preview_qa`: `run_preview_qa=true`

`inspect` is read-only and retrieves pipeline/workflow/jobs/artifact metadata for a caller-supplied UUID. `health` checks the setup without requiring the CircleCI token.

**The Worker never deploys directly.** A distinct `action:release` command requires explicit approval and an exact 40-character Git SHA. It requests a separate QA-gated CircleCI release workflow. There is no arbitrary project, branch, parameter, shell or public command API; do not add automatic on-push triggers.

### Command contract (queue values only)

```json
{
  "v": 1,
  "id": "<unique UUID>",
  "action": "trigger",
  "project": "jayson-storefront",
  "branch": "feat/storefront-demo",
  "mode": "preview_qa",
  "requestedAt": "<current ISO timestamp>",
  "approved": true
}
```

For read-only inspection, use `"action":"inspect"` and `"pipelineId":"<UUID>"`, omitting `branch` and `mode`. For a no-token health check, use `"action":"health"`, omitting `branch`, `mode` and `pipelineId`. Requests expire after 30 minutes, must contain the fixed version and UUID, and require `approved:true`.

An authorized connection writes the JSON as the value at `requests/<same UUID>` in the single `NEN_CI_BRIDGE_QUEUE_V1` namespace with `expiration_ttl:900`. The Worker writes a result at `results/<UUID>` (and a one-time claim at `claims/<UUID>`) with a 7-day TTL. The result contains either `status:success,outcome` or `status:error,error`.

### Credential setup (once, no local Mac required)

1. In [CircleCI](https://app.circleci.com/settings/user/tokens), create a personal API token whose account has access to the required organization/project. CircleCI API v2 uses **personal API tokens**.
2. Open Cloudflare Dashboard -> Workers & Pages -> `nen-ci-bridge` -> Settings -> Variables and Secrets. Add an encrypted **Secret** named `CIRCLE_TOKEN` with that personal API token. **Do not paste it into ChatGPT, any GitHub repo, KV, or the public site.**
3. Confirm the Worker binding `QUEUE` points to KV namespace `NEN_CI_BRIDGE_QUEUE_V1` and the Cron Trigger runs once a minute.
4. First run a `health` command. The result must contain `tokenConfigured:true` before any live trigger.
5. Send one authorized `trigger` request, inspect its result and read the actual CircleCI workflow status via a second `inspect` command. Do not claim that a pending pipeline passed.

### Security and delivery constraints

- Only an account permitted to use the Cloudflare API can enqueue commands; `approved:true` is an intent check, not an authentication mechanism. The Cloudflare connector account must be treated as a privileged build operator.
- Script registry locks project, branch, CircleCI definition ID and boolean pipeline parameter.
- One request is processed per minute. The Worker records a claim **before** making an external call to reduce accidental duplicates; uncertain outcomes are **not auto-retried**. Workers KV is eventually consistent and does **not** provide exactly-once processing. Use a Durable Object later if strong coordination becomes necessary.
- Token is only passed outbound in CircleCI's `Circle-Token` header. Worker reports HTTP status but never response bodies, stack traces, tokens or credentials on errors.
- Workers KV, CircleCI project and artifact URLs are not intended for public distribution.
- Tests and releases must be separately approved. The `release` command requires `approved:true`, the approved branch and full SHA. CircleCI re-runs all QA on that exact revision and grants the release job its own restricted Cloudflare Pages secret only after success.

## Test and deployment

```bash
cd bridge
node --test tests/*.test.mjs
npx wrangler deploy --config wrangler.toml
```

Tests inject a fake CircleCI API; **running them never creates a CircleCI pipeline**. Cloudflare also supports deployment via its authenticated API without local Wrangler. Check remote Worker state, secret metadata and Cron after the deployment before declaring it ready.

## Example control-plane read/write

Use the already connected Cloudflare API tool, not a public Worker URL:

- Write: `PUT /accounts/<account-id>/storage/kv/namespaces/<namespace-id>/values/requests%2F<uuid>`, body of the command JSON and query `expiration_ttl=900`.
- Read: `GET /accounts/<account-id>/storage/kv/namespaces/<namespace-id>/values/results%2F<uuid>`.
- Prefixes `claims/` and `results/` are Worker-owned and must not be written by callers.

Jayson Tech CI source is `dev-amaraii/projects-ext-jayson-online-shop`, `feat/storefront-demo`. That pipeline includes unit/type tests, the Pages production build, QA Intel and responsive browser checks. Hosting of a new version stays manually approved until an independently gated release path is developed.

## Verified deployment evidence (2026-10-20)

- Cloudflare account: NEN DevOps; Worker script `nen-ci-bridge` (separate from frozen `nen-circleci-mcp`).
- KV namespace: `NEN_CI_BRIDGE_QUEUE_V1` / `3ad53b33be4346a0b6cf1e1d3047ede4`.
- Script uploaded using Cloudflare Workers API and updated to enforce pipeline project identity on inspection.
- GET Worker settings verified the `QUEUE` binding and no secrets. GET Worker subdomain verified `enabled:false`, `previews_enabled:false`.
- Cron configured: `* * * * *`; first observed health completion `2026-10-20T12:26:53.826Z`.
- Health request ID: `c1b0b693-53e3-4d7d-b4eb-11e73d0a1b88`. The returned `status:success` confirms mailbox execution and `tokenConfigured:false`. No request to CircleCI was made.
- Ten unit contract cases successfully exercised inside an isolated JS harness with mocked fetch/KV/Response (the exact committed Node test command has **not** been executed yet).

**Verified:** after token creation, the secret was on an uploaded Worker version that was not yet deployed. Activating that version resolved `tokenConfigured:false`. An initial CircleCI trigger with `redirect:'error'` failed with a transport error. We did not retry until the numbered-pipeline audit confirmed #6 and #7 existed and #8 did not. Replacing redirect rejection with `redirect:'manual'` enabled safe read-only CircleCI API access. One new authorized `preview_qa` trigger then created pipeline **#8**, which passed. Pipeline ID: `69ae77a7-cd37-486b-a671-45c73efa2637`; workflow `91afe355-5356-4d3b-9b13-07d9542d6ff4`; job #8 status **success**. Build/test/QA Intel and 320/390/1280px responsive screenshots were archived. No deployment request was issued.

## CI bridge launch — operational findings

- The Cloudflare dashboard secret is **versioned**. After editing a Worker secret, verify that the version with the secret is active in the `/deployments` API. `GET /secrets` alone does not prove an active Cron invocation sees the secret.
- Outbound HTTP with `redirect:'error'` can result in an uninformative transport failure. Use `redirect:'manual'` and reject non-2xx responses, without forwarding bearer tokens to redirected destinations.
- A failed trigger is not proof that a pipeline was not created. Before retrying, use the read-only `audit` command with a known pipeline number; CircleCI's pipeline number endpoint verifies which numbers exist. This prevented a duplicate request during first integration.
- `health`, `recent`, `audit`, `probe`, `trigger` and `inspect` are implemented for the registered project. `recent` can yield an empty filtered collection for GitHub App projects; prefer `audit` or a known `inspect` UUID for reliable verification.
- First successful remote trigger: CircleCI [pipeline #8](https://app.circleci.com/pipelines/circleci/B65DMdC1ZhAJQM74t7SrZ1/CRNFjZzLKeZdypYW5EWkyL/8) on 2026-10-20; job success and QA artifacts verified from CircleCI API via the Worker. It is **not** permission to automatically deploy production or preview.

## Approved remote Pages release (separate from QA-only triggers)

The Worker does not deploy Cloudflare Pages itself. A fresh command with `action:release`, project `jayson-storefront`, branch `feat/storefront-demo`, `approved:true` and an exact lowercase 40-character `commitSha` requests CircleCI `run_preview_release=true` and `release_sha=<commitSha>`. The ordinary `action:trigger` cannot select this release workflow.

The release workflow checks the pinned checkout SHA, re-runs build, unit/type checks, QA Intel and responsive browser tests, and passes the exact `apps/storefront/dist/pages` artifact by a CircleCI workspace to the gated `deploy-preview` job. Only that deployment job receives the Pages API secret, and it verifies the deployed SHA and live client preview after uploading. It does not enable real checkout or production orders.

**One-time setup required:** Create CircleCI context `jayson-pages-preview`. Restrict it to the Jayson storefront project and authorized operators. Add encrypted variable `CLOUDFLARE_API_TOKEN` from a least-privilege Cloudflare API token with Pages Edit permission on the existing NEN DevOps account. The token is separate from the Worker's `CIRCLE_TOKEN`; do not paste either token into GitHub, KV or ChatGPT.

Until this context is confirmed, do **not** submit a release trigger. QA-only triggers remain available and never deploy.

Example of an explicitly approved KV command:

```json
{
  "v": 1,
  "id": "<fresh UUID>",
  "action": "release",
  "project": "jayson-storefront",
  "branch": "feat/storefront-demo",
  "commitSha": "<reviewed 40-character Git SHA>",
  "requestedAt": "<current ISO timestamp>",
  "approved": true
}
```

After the release request, read its result via KV, inspect the CircleCI pipeline, verify that both `preview-qa` and `deploy-preview` succeeded, confirm the `verified.json` release artifact, and check the Cloudflare Pages deployment. On any failure, do not claim release success or blindly retry.
