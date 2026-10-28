# NEN CI bridge — on-demand operations

**Owner-approved direction, 24 October 2026:** agents can run QA and inspect artifacts on demand through the existing private bridge. Five-minute polling is removed. This supersedes the older KV/Cron protocol and the earlier proposal restriction on Cloudflare Queues for this bridge.

## Authoritative resources

- NEN DevOps account: `9483d072db9941b23fe0bcd92d76d0d6`.
- Existing Worker: `nen-ci-bridge`. Its HTTP handler always returns 404; workers.dev and preview URLs remain disabled.
- Command Queue: `nen-ci-bridge-commands`, ID `ba62fb5b0b304d6591cf0a3605125807`.
- Existing result KV: `NEN_CI_BRIDGE_QUEUE_V1`, ID `3ad53b33be4346a0b6cf1e1d3047ede4`, Worker binding `QUEUE`.
- Existing encrypted Worker secret: `CIRCLE_TOKEN`. Never read/export/print it. Cloudflare-account permissions authorize callers; `approved:true` alone does not.
- Source: `bridge/src/index.mjs`; configuration: `bridge/wrangler.toml`. The experimental root `nen-circleci-mcp` is distinct.

## Send a command

Use the connected **NEN Cloudflare API**, never a public Worker URL. First verify the target project's current HEAD and relevant existing CI status. Test requests within the user's QA task are on demand; a Jayson release always needs separate explicit approval. Avoid duplicate runs on an already verified SHA.

`POST /accounts/{account_id}/queues/{queue_id}/messages`

```json
{
  "content_type": "json",
  "body": {
    "v": 1,
    "id": "<fresh UUID>",
    "action": "trigger",
    "project": "amaraii-os",
    "branch": "development",
    "mode": "validation",
    "requestedAt": "<current ISO UTC timestamp>",
    "approved": true
  }
}
```

Use the known Queue ID above. A successful Queue submission means accepted for delivery, not a completed test. Keep the command UUID. Messages are processed as they arrive: batch size 1, wait 0, concurrency 1, max retries 0. There are no Cron schedules and no idle KV list calls. **Writing `requests/<UUID>` in KV alone no longer executes anything.** Legacy `processOne()` remains only as a tested migration helper and has no registered timer.

Read the result through:

`POST /accounts/{account_id}/storage/kv/namespaces/{namespace_id}/bulk/get`

```json
{"keys":["results/<same UUID>"],"type":"json"}
```

Read `result.values["results/<UUID>"]` with a bounded wait during the active task. KV propagation may delay visibility. No unattended polling or recurring check is needed. Results are `{id,status:"success",action,updatedAt,outcome}` or `{id,status:"error",action,updatedAt,error}`. Only the Worker writes `claims/` and `results/`; they expire after seven days.

If delivery/result is uncertain, never automatically retry a trigger/release or mint another UUID. Reconcile using read-only `audit`/`inspect` first. Claims are best effort because KV is eventually consistent, not atomic exactly-once. Zero retries reduces paid replay risk; a terminated invocation can leave only a claim or no result, requiring operator reconciliation.

## Project registry and commands

| Project | Branches | QA modes | Release |
| --- | --- | --- | --- |
| `amaraii-os` | `development`, `staging`, `codex/p2-live-billing-pilot`, `design/amaraii-learn-v1-spec-20261028` | `validation` | Denied |
| `jayson-storefront` | `feat/storefront-demo` | `validation`, `preview_qa` | Separately approved full-SHA preview only |

**Pending-review note (28 October 2026):** The Learn branch entry in this source tree is a *proposed* validation-only expansion; it is not present in the deployed Worker unless this change passes testing and is separately approved and activated. Its sole purpose is to unblock exact-head CI of Amaraii Learn draft PR #37. There is no new release mode, deployment action, credential, scheduled polling, or public endpoint. Do not treat the row above as live proof until the active Worker version and its allowed-branches health result are verified.

Definition IDs and project slugs are pinned in source. No caller-supplied API URL, shell command or arbitrary pipeline parameter is accepted. Native GitHub `run-ci` label-added validation remains an option for AmaraiiOS feature PRs outside the bridge's branch allowlist; verify the exact current PR SHA.

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

| `artifact_preview` | `pipelineId`, `jobId`, `jobNumber`, `artifactPath` | Owned AmaraiiOS QA PNG bytes; see below |

A validation request creates a pipeline, not a passing test. Follow with `inspect`, verify final workflow/job outcomes and the exact revision. For failed steps use `job_steps` with the owned pipeline/job identities. Validation and screenshots do not prove hosted UAT, payment, database migration or deployment acceptance.

## Screenshot preview

Send an `artifact_preview` command with the standard identity/time/approval fields, `project:"amaraii-os"`, exact pipeline UUID, job UUID, job number, and exact artifact path listed by `inspect`. Permitted paths end in `.png` under `nen-customer-operations-qa/`, `bank-transfer-qa/`, or `qa-intel/transactions/`. Path traversal, arbitrary URLs and cross-project jobs are denied. Downloads are capped at **900,000 bytes** and checked for PNG signature and MIME. CircleCI credentials and signed download URLs are never returned by the preview operation. Only allowed HTTPS origins/redirects are followed; S3 receives no CircleCI token.

Success includes `outcome:{path,jobNumber,mediaType:"image/png",bytes,dataBase64}`. Decode the base64 into a local PNG and inspect it with the image viewer. Keep private image bytes out of logs/Notion/PR descriptions. The current preview supports PNG screenshots; `inspect` lists other report artifacts but does not return their contents. CI cannot retrieve artifacts that failed jobs never uploaded.

## Jayson release

Keep Jayson `release` separate from QA. It requires `project:"jayson-storefront"`, `branch:"feat/storefront-demo"`, an explicitly approved lowercase 40-hex `commitSha` and standard fields. CircleCI receives only `run_preview_release:true` and `release_sha`. QA must pass before the deployment job receives restricted Pages credentials. Inspect both QA/deploy job outcomes, the exact revision, `preview-release/verified.json` and the Pages deployment before claiming release success. Do not issue a release as a bridge smoke test.

## Deployment and rollback

Run `node --test tests/*.test.mjs` from `bridge/`. Inspect live source before changing code. Upload a version retaining `secret_text` and `kv_namespace` bindings; verify it before activation. Verify active deployment, binding names/types, command consumer settings, empty schedules and disabled public URLs after deployment. Read [DEPLOYMENT-20261024.md](DEPLOYMENT-20261024.md).

If the new runtime fails, pause/remove the Queue consumer before changing deployments. The pre-change version `332c29dd-5363-4626-a18f-fb0575ae32da` is a rollback checkpoint for source/secrets but has no Queue handler; restoring it alone does not restore on-demand operation. Keep Cron disabled unless the owner explicitly requests temporary polling. Reconcile any in-flight paid requests read-only before retrying. Preserve KV and encrypted secrets throughout.
