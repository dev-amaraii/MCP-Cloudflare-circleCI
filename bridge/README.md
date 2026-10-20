# NEN CI bridge — Cloudflare Workers + KV

The **separate, minimal** NEN CI bridge runs CircleCI requests without a user's Mac or a remote MCP connection. It is **not** the former `nen-circleci-mcp`: this project lives under `bridge/`, uses no MCP dependency, and does not modify the old server or its Cloudflare Worker.

**Status (2026-10-20):** `nen-ci-bridge` Worker deployed; KV binding, private subdomain settings and 1-minute Cron Trigger verified. A live authenticated Cloudflare control-plane **health request passed** end-to-end (KV request -> scheduled Worker -> KV result). `CIRCLE_TOKEN` is **not configured**, so the CircleCI API integration is not yet validated and **no pipeline has been triggered**.

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

Only one registered project, `jayson-storefront`, branch `feat/storefront-demo`, with two on-demand CircleCI pipeline modes:
- `validation`: `run_validation=true`
- `preview_qa`: `run_preview_qa=true`

`inspect` is read-only and retrieves pipeline/workflow/jobs/artifact metadata for a caller-supplied UUID. `health` checks the setup without requiring the CircleCI token.

**No deploy, cancellation, rerun, arbitrary project names, arbitrary CircleCI API URL, arbitrary branch, custom parameters, shell execution or public API** is implemented. Other NEN projects require explicit reviewed registry entries. Do not add an automatic on-push trigger.

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
- Triggering a CI workflow must be explicitly authorized. Releases/deployments remain an independent approval and validation gate.

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

**Next gate:** operator creates and binds the encrypted `CIRCLE_TOKEN` secret using the Cloudflare Dashboard; run a fresh `health` request and require `tokenConfigured:true`, then test one explicitly authorized `preview_qa` trigger. Read-only workflow/status inspection must subsequently report the actual completed outcome.
