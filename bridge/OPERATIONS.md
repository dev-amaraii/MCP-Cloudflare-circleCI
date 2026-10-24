# NEN private CI bridge — operations and agent contract

**Accepted operating policy (22 October 2026):** Use the native GitHub `run-ci` PR-label → CircleCI path for ordinary AmaraiiOS developer validation. Inspect GitHub `ci/circleci: validate` on the exact *current* head SHA and open its CircleCI job link on demand. The KV mailbox below remains a **legacy fallback / Jayson separately gated preview-release path**, not the preferred testing path. No new gateway, KV cache, Cloudflare Queue, scheduler or background polling is approved. Consult [NEN Context OS](https://app.notion.com/p/3fffa5e3c90581ceab86f62e1b1fb5a5), [issue #4](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/issues/4), and [AGENTS.md](AGENTS.md).

**Implementation source:** [src/index.mjs](src/index.mjs), [wrangler.toml](wrangler.toml), and tests in `tests/`. Mirror checkpoint `a642430e` (20 Oct) was not separately revalidated by new bridge-source CI. **Live evidence from 22 October 2026:** deployed Worker version `332c29dd-5363-4626-a18f-fb0575ae32da`; bindings `CIRCLE_TOKEN: secret_text` and `QUEUE: kv_namespace`; Cron `*/5 * * * *` after a schedule-only API change, with NO Worker code redeploy. Draft [PR #3](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/pull/3) contains matching Wrangler config and docs but is not merged. Always recheck Cloudflare before changes.

## Ownership, system layout, endpoints

- Owner: **NEN International (NEN Context OS)**. Distinguish this project from the experimental `nen-circleci-mcp` (read-only OAuth/MCP, not the execution bridge).
- Cloudflare Worker script: `nen-ci-bridge`, Workers `fetch` returns **404**; `workers.dev` and preview URLs disabled. **There is no public /trigger URL.**
- Cloudflare account: NEN DevOps; identify its current `account_id` from the connected Cloudflare tool or account settings. Worker binding `QUEUE` points to Workers KV `NEN_CI_BRIDGE_QUEUE_V1` (current namespace ID in `wrangler.toml`). Worker binding `CIRCLE_TOKEN` is a **secret_text**; never read, export or write its value to Git, Notion, logs or chat.
- **Live** Cron (verified 22 Oct) is `*/5 * * * *`; one KV list per tick even when idle and at most **one queued command per tick**. Previous `* * * * *` could cause 1,440 idle list calls/day vs Free 1,000/day allowance. Five-minute cadence is ~288 expected idle lists/day (80% reduction) but is not zero usage, and account-wide quotas remain unmeasured. Pickup can take ~5 minutes; sustained queues can expire because requests have a 30-minute maximum age. This schedule is a temporary mitigation only. Requests still require fresh UTC time, v1, matching UUID, scoped project/action/branch, and `approved:true`.
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

### Default agent recipe: native GitHub → CircleCI on demand (approved)

1. Read the target app's `AGENTS.md` and native `.circleci/config.yml`, current NEN Context OS decision and current PR state. Distinguish source validation from UAT, hosted integration, migrations, payments and releases.
2. Read the PR's current **head SHA** and its exact `ci/circleci: validate` commit status through connected GitHub tools. Never pass an older green SHA off as validation of a changed revision.
3. When a run is explicitly requested and still needed, use GitHub's `run-ci` **label-added event** to invoke the CircleCI GitHub App trigger. If the label is already present, remove and re-add it **only** for a deliberately requested fresh run. Each run can use CircleCI credits; all-push auto triggers remain disabled.
4. Read the commit status for the **same current SHA** and follow its CircleCI workflow/job URL only when needed. Do not set up storage polling or unattended status checks. GitHub commit statuses do not themselves expose detailed CircleCI step logs; consult the linked job page before considering a new read-only connector.
5. Record exact SHA, tests and state. A successful label event, pipeline creation or historical status does not mean the new commit passed or that production is ready.

Historical proof: [AmaraiiOS Games PR #8](https://github.com/dev-amaraii/amaraii-os/pull/8), SHA `adf2480ee9867acbc1f903a42a7c395cc872715f`, reported `ci/circleci: validate = success` on 21 October 2026; verify anew for any later revision.


### Proposed read-only UI artifact preview (24 October 2026; not yet deployed)

A narrowly scoped capability implemented on branch `codex/ci-artifact-preview-20261024`.
It remains **candidate source**, not proof of the active Worker. Do not enqueue this
action until the Worker is independently tested, deployed and verified.

CircleCI supports `GET /api/v2/project/{project-slug}/{job-number}/artifacts`
and authenticated retrieval of an individual listed artifact. Ordinary `inspect`
already returns artifact path metadata. The new `artifact_preview` action retrieves
the bytes for **one explicitly selected disposable NEN QA PNG** and stores a
base64-encoded response in the existing private `results/<UUID>` KV slot:

```json
{
  "v": 1,
  "id": "<fresh UUID matching requests/<UUID>>",
  "action": "artifact_preview",
  "project": "amaraii-os",
  "pipelineId": "<confirmed CircleCI pipeline UUID>",
  "jobId": "<confirmed CircleCI job UUID>",
  "jobNumber": 49,
  "artifactPath": "nen-customer-operations-qa/customer-pending-light-1440.png",
  "requestedAt": "<current ISO UTC timestamp>",
  "approved": true
}
```

This is a **read-only operation**, not a pipeline trigger or deployment. The
backend verifies the pipeline's pinned AmaraiiOS project, the job's membership in
that pipeline, and an exact artifact path from the CircleCI artifact manifest.
Allowed artifact prefixes: `nen-customer-operations-qa/`,
`bank-transfer-qa/`, `qa-intel/transactions/`; only `.png`.
Responses are capped at 900,000 binary bytes and checked for PNG signature and
content type. CircleCI access credentials stay inside the Worker, and temporary
artifact download URLs are **never returned**. Redirects are not followed unless
the destination is an approved HTTPS artifact host. No public Worker endpoint,
general-purpose proxy, new binding, background scanner or Cron change is added.
The Jayson preview-release workflow remains unchanged and does not gain access
to this preview operation.

A successful result is shaped:
`{id,status:"success",action:"artifact_preview",outcome:{path,jobNumber,mediaType:"image/png",bytes,dataBase64}}`.
Decode `dataBase64` **only inside the authenticated operator session** and render
the resulting image in the inspection tool; do not paste base64 screenshots or
signed URLs into GitHub issues, chat transcripts, Cloudflare logs or Context OS.
Artifacts may contain test data: use disposable/synthetic screenshots only.
A failed CircleCI job can have **zero stored artifacts** if it failed before its
`store_artifacts` steps. A screenshot artifact also does not establish
authenticated production UI correctness.

**Release gate:** execute `cd bridge && node --test tests/*.test.mjs` against
the reviewed source; confirm the GitHub branch is reconciled with the actual
active Worker version; stage a Worker version preserving `CIRCLE_TOKEN`
`secret_text` and `QUEUE` KV bindings; verify staged bindings and version;
then, after approval, activate and smoke-test a read-only preview against an
existing disposable CircleCI job. Preserve and test rollback to the previous
active version. Never update the Worker based on a stale GitHub mirror.


### Legacy private KV recipe: explicit fallback / Jayson gated preview release only

Use only when the needed capability **cannot** be completed with GitHub and the specific action is explicitly authorized. The Jayson SHA-pinned preview release remains separately protected; AmaraiiOS `run-ci` is **not** a Jayson release trigger.

1. Verify the *live* Cloudflare account, `nen-ci-bridge` active Worker version, Cron and binding names/types. Follow the hardcoded allowlists; `approved:true` is not a substitute for authenticated access.
2. Using the authorized Cloudflare API tool, enqueue a single fresh UUID+timestamp command at `requests/<UUID>` with the documented request protocol. Do not expose a public Worker trigger.
3. For **this explicit command only**, read `results/<UUID>` with bounded attempts that account for five-minute pickup and the 30-minute command age; never run a continuous background poller. Treat a returned pipeline ID as acceptance, **not** a successful test or release.
4. If needed, send separately authorized read-only `inspect`/`job_steps` commands and verify actual CircleCI identity, current SHA, QA/workflow outcome and release artifact. For uncertain paid triggers, reconcile with `audit`/`inspect`; do **not** blindly retry.
5. Do not disable Cron/delete KV until **all** remaining users, including Jayson exact-`release_sha`, QA gates, restricted deploy credentials and recovery path, have a reviewed, proven on-demand replacement.

### Safety, rollout and recovery

- This private Worker has **no HTTP commands**, does not expose token values, does not accept arbitrary URLs, and does not run shell commands. `approved:true` **is not an authentication mechanism**: actual authorization is Cloudflare API credentials and the Worker allowlist. Keep the Cloudflare connection least privilege.
- Reconcile this file and tested source changes **in GitHub before redeploying**. Do not overwrite Cloudflare with stale branch code. To update, use Cloudflare Versions API to stage a new module version, preserving the existing `CIRCLE_TOKEN` `secret_text` and `QUEUE` `kv_namespace` bindings; inspect staged version before explicit percentage deployment. Recheck active deployment, Cron, subdomain disabled and `health`.
- If deploy breaks CI, use the previous **known-good version** from the deployments API, with deliberate rollback and binding checks; do not blindly redeploy latest. Never edit/write the secret value.
- No background monitoring or continuous polling by ChatGPT is implicit. Native GitHub CI is requested and checked **on demand**; legacy KV requests are processed by a **temporary** five-minute Cron and incur queue pickup delay, finite retention and possible CircleCI credits. Never disable Cron until its remaining consumers have tested alternatives.
- NEN Context OS canonical remote CI standard: https://app.notion.com/p/3fffa5e3c90581ceab86f62e1b1fb5a5
- NEN CI handoff: https://app.notion.com/p/3fefa5e3c90581f2a932c140fb432d4e

## Proven evidence (historical checkpoint)

- **AmaraiiOS**: CircleCI [pipeline #4](https://app.circleci.com/pipelines/circleci/B65DMdC1ZhAJQM74t7SrZ1/LGszExeHMrkJtuxPVvDpjw/4), commit `542dbfc37dc953ed97d8a8c6b0fb30ea80e01284`, validated on 20 October 2026: frozen pnpm install, repository typecheck, API tests, and build all passed. No release was requested.
- **Jayson storefront**: CircleCI [pipeline #11](https://app.circleci.com/pipelines/circleci/B65DMdC1ZhAJQM74t7SrZ1/CRNFjZzLKeZdypYW5EWkyL/11) passed QA and a separately approved preview release. It is not real e-commerce production.
- All historical IDs and statuses must be rechecked for current work. Do not mistake a previously green SHA for a newly modified branch HEAD.
