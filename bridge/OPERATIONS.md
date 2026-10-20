# NEN private CI bridge — operations and agent contract

**Authoritative implementation:** [`bridge/src/index.mjs`](src/index.mjs), [`wrangler.toml`](wrangler.toml), tests in `bridge/tests/`. This document describes the **deployed** `nen-ci-bridge` verified 20 October 2026. Source on this branch was synchronized from the active Worker at commit `a642430e`; that sync has not independently passed a new CircleCI bridge-source validation run.

## Ownership, system layout, endpoints

- Owner: **NEN International (NEN Context OS)**. Distinguish this project from the experimental `nen-circleci-mcp` (read-only OAuth/MCP, not the execution bridge).
- Cloudflare Worker script: `nen-ci-bridge`, Workers `fetch` returns **404**; `workers.dev` and preview URLs disabled. **There is no public /trigger URL.**
- Cloudflare account: NEN DevOps; identify its current `account_id` from the connected Cloudflare tool or account settings. Worker binding `QUEUE` points to Workers KV `NEN_CI_BRIDGE_QUEUE_V1` (current namespace ID in `wrangler.toml`). Worker binding `CIRCLE_TOKEN` is a **secret_text**; never read, export or write its value to Git, Notion, logs or chat.
- Cron `* * * * *`, at most **one queued command per tick**. Request must have a fresh current ISO date (30-minute max age), v1, matching UUID ID/key, allowlisted project/action/branch and `approved:true`.
- Cloudflare control-plane operations using an authenticated NEN Cloudflare connection:
  - `GET /accounts/{account_id}/workers/scripts/nen-ci-bridge/settings` — verify bindings **names/types only**.
  - `GET /accounts/{account_id}/workers/scripts/nen-ci-bridge/deployments` — identify **active version**; secret existence on an inactive version is not proof.
  - `GET /accounts/{account_id}/workers/scripts/nen-ci-bridge/schedules` — verify Cron.
  - `PUT /accounts/{account_id}/storage/kv/namespaces/{namespace_id}/values/requests/{UUID}?expiration_ttl=1800` — enqueue JSON. Use Cloudflare API `rawBody:true`, `contentType:'application/json'`.
  - `POST /accounts/{account_id}/storage/kv/namespaces/{namespace_id}/bulk/get` with JSON `{"keys":["results/<UUID>"],"type":"json"}` — read result. `GET .../values/results/<UUID>` can return a transient 404 even after the key appears; prefer bulk get with a bounded wait.
  - `GET .../keys?prefix=requests/`, `claims/`, or `results/` — discover queue status. **Never** write `claims/` or `results/` yourself.
- Internal Worker-to-CircleCI endpoints (not direct external tools): `POST https://circleci.com/api/v2/project/{project_slug}/pipeline/run`; `GET /api/v2/pipeline/{id}`, `/pipeline/{id}/workflow`, `/workflow/{id}/job`, `/project/{slug}/pipeline?branch=...`, `/project/{slug}/pipeline/{number}`, `/project/{slug}/job/{number}`; scoped job details `GET /api/v3/jobs/{job_uuid}` and failed-step condensed stdout `GET /api/v3/jobs/{job_uuid}/stdout/condensed?filter[execution]=...&filter[step_num]=...`. The Worker sends the secret outbound with **redirects not followed**, returning only sanitized metadata and known error categories.

## Supported allowlisted project capabilities

| Command project | CircleCI source | Branches | Modes | Release |
| --- | --- | --- | --- | --- |
| `amaraii-os` | `dev-amaraii/amaraii-os`, definition `c4c6aad9-03c1-4e9e-99ca-cd650deda730` | `codex/p2-live-billing-pilot`, `development`, `staging` | `validation` → `run_validation=true` | **Denied** |
| `jayson-storefront` | `dev-amaraii/projects-ext-jayson-online-shop`, definition `b5a41026-8298-4976-956b-49fbca6de695` | `feat/storefront-demo` | `validation`, `preview_qa` | Separately authorized, exact SHA-pinned preview release only |

CircleCI project slugs are pinned in `src/index.mjs`, never supplied by an agent. A standard `trigger` **cannot** pass arbitrary pipeline parameters or request a release. For AmaraiiOS, no release parameter exists and `release` is explicitly rejected. Never assume passing CircleCI validation implies production payment, migrations, hosted acceptance or deployment approval.

## Request/response protocol

JSON is stored **only** in KV `requests/<UUID>`. Sample validation request (do not reuse this sample ID or timestamp):

```json
{"v":1,"id":"<FRESH-UUID>","action":"trigger","project":"amaraii-os","branch":"codex/p2-live-billing-pilot","mode":"validation","approved":true,"requestedAt":"<CURRENT-ISO-UTC>"}
```

Common fields: `v:1`, `id` (same as KV key suffix), `project`, `action`, `approved:true`, `requestedAt`. Required action-specific fields:

| Action | Additional fields | Result / notes |
| --- | --- | --- |
| `health` | none | `tokenConfigured`, allowed branches/modes; **does not** call CircleCI |
| `trigger` | `branch`, `mode` | Creates a new pipeline; check `outcome.pipelineId`, then inspect its jobs |
| `inspect` | `pipelineId` (UUID) | Workflow/job statuses and IDs, project identity checked |
| `job` | `jobNumber` | Status and redacted job metadata, may lack step data |
| `job_steps` | `pipelineId`, `jobId`, `jobNumber` | Validates pipeline/job ownership; returns step outcomes and sanitized failure diagnostics, including TS error excerpts for AmaraiiOS |
| `recent` | `branch` | Up to 10 branch-matched pipelines, possibly empty for GitHub App projects |
| `audit` | `startNumber` (1–999999) | Checks up to five numbered pipelines to detect ambiguous duplicate triggers |
| `probe` | none | Unauthenticated network probes; no CircleCI token |
| `release` | `branch`, `commitSha` (40 hex) | **Jayson only**, separately approved and QA-gated. Never use for AmaraiiOS |

Result key is `results/<UUID>`, structure `{id,status:"success",action,updatedAt,outcome}` or `{id,status:"error",action,updatedAt,error}`. Worker uses `claims/<UUID>` before external calls and retains claim/result up to **7 days**. KV is eventually consistent; claims are best effort **not exactly-once**. If trigger status is uncertain, **read only** with `audit`/`inspect`; never blindly enqueue the same or a new trigger to retry.

### Minimal agent recipe (no Mac or GitHub Actions)

1. Read this document and the target repository's `AGENTS.md` and native `.circleci/config.yml`; fetch latest branch SHA via GitHub. Confirm the requested CI run is authorized before incurring credits.
2. Resolve authorized Cloudflare account and KV binding from `GET .../settings`. Do **not** accept arbitrary user-supplied project slugs/namespace destinations. Verify latest deployed version and Cron.
3. Generate a fresh UUID and timestamp through the authenticated Cloudflare tool, enqueue one scoped request with `PUT` as above. **Do not** call a public Worker URL.
4. Wait for Cron and poll `bulk/get` for `results/<UUID>`; check `status:error` as an error, and `outcome.pipelineId` only as an **accepted request**, never as passing tests.
5. Enqueue a separate `inspect` for that pipeline and, when needed, `job_steps` for the approved job UUID/number. Inspect the final actual CircleCI job result, compare the tested revision to GitHub and record evidence.
6. For failing validation, fix only the relevant code in a reviewable branch and request another separately authorized validation; do not change deployment/payment settings.

### Safety, rollout and recovery

- This private Worker has **no HTTP commands**, does not expose token values, does not accept arbitrary URLs, and does not run shell commands. `approved:true` **is not an authentication mechanism**: actual authorization is Cloudflare API credentials and the Worker allowlist. Keep the Cloudflare connection least privilege.
- Reconcile this file and tested source changes **in GitHub before redeploying**. Do not overwrite Cloudflare with stale branch code. To update, use Cloudflare Versions API to stage a new module version, preserving the existing `CIRCLE_TOKEN` `secret_text` and `QUEUE` `kv_namespace` bindings; inspect staged version before explicit percentage deployment. Recheck active deployment, Cron, subdomain disabled and `health`.
- If deploy breaks CI, use the previous **known-good version** from the deployments API, with deliberate rollback and binding checks; do not blindly redeploy latest. Never edit/write the secret value.
- No background monitoring by ChatGPT is implicit. An on-demand request processes within one Cron tick plus queue/consistency delay; result expiration is finite. Per-run CircleCI billing/credits may apply.
- NEN Context OS canonical remote CI standard: https://app.notion.com/p/3fffa5e3c90581ceab86f62e1b1fb5a5
- NEN CI handoff: https://app.notion.com/p/3fefa5e3c90581f2a932c140fb432d4e

## Proven evidence (historical checkpoint)

- **AmaraiiOS**: CircleCI [pipeline #4](https://app.circleci.com/pipelines/circleci/B65DMdC1ZhAJQM74t7SrZ1/LGszExeHMrkJtuxPVvDpjw/4), commit `542dbfc37dc953ed97d8a8c6b0fb30ea80e01284`, validated on 20 October 2026: frozen pnpm install, repository typecheck, API tests, and build all passed. No release was requested.
- **Jayson storefront**: CircleCI [pipeline #11](https://app.circleci.com/pipelines/circleci/B65DMdC1ZhAJQM74t7SrZ1/CRNFjZzLKeZdypYW5EWkyL/11) passed QA and a separately approved preview release. It is not real e-commerce production.
- All historical IDs and statuses must be rechecked for current work. Do not mistake a previously green SHA for a newly modified branch HEAD.
