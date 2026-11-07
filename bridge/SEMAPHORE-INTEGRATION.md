# NEN CI bridge — Semaphore pilot (source-only)

**Owner:** NEN International | **Project:** `dev-amaraii/amaraii-os`

## Status and boundaries

Semaphore provider support is an **explicit opt-in** on the private Queue bridge.
The existing CircleCI behavior is the default when `provider` is omitted.
There is **no automatic fallback**, no extra schedule, no public HTTP trigger,
no production deployment or promotion, and no raw log / artifact proxy.

- Semaphore organization API is pinned to `https://amaraii.semaphoreci.com/api/v1alpha`.
- Only `project:"amaraii-os"`, `provider:"semaphore"`, and
  `action:"health"|"trigger"|"inspect"` are permitted.
- Pilot triggers only `ci/semaphore-validation-20261106` at a required full
  lowercase commit SHA and `mode:"validation"`.
- This branch contains the draft PR #95 validation-only YAML; do not allow
  `development` until that YAML is merged and tested there.
- Project ID comes from a Worker binding `SEMAPHORE_PROJECT_ID` (UUID).
  API token is an encrypted Worker secret `SEMAPHORE_TOKEN`, **not KV**.
- No caller-supplied API origin, project ID, workflow path or parameters.
- Pipeline inspection first verifies Semaphore's `project_id`, then emits only
  bounded job metadata, result, branch and SHA, without raw stdout or signed URLs.
- Failed/ambiguous trigger responses are not automatically retried. Reconcile
  an uncertain request using existing Queue claim/result records and Semaphore UI.

## Operator prerequisites — not yet performed

1. Obtain a Semaphore API token using the authenticated Semaphore account
   (prefer a restricted service account if the account permits it).
   Do not paste the token into GitHub, Notion, KV results, or chat.
2. Determine the UUID of the *existing* `amaraii-os` Semaphore project from
   an authenticated API lookup; for example, read the already-known pilot
   workflow `ce43323f-4fe3-4ff9-ac11-aa48633ac4e6` via
   `GET /api/v1alpha/plumber-workflows/{workflow_id}` and take
   `workflow.project_id`. Never guess this ID from the GitHub repository ID.
3. Configure `SEMAPHORE_TOKEN` as a Cloudflare Worker encrypted secret and
   `SEMAPHORE_PROJECT_ID` as a Worker variable/secret in `nen-ci-bridge`.
   Preserve existing `CIRCLE_TOKEN` secret and `QUEUE` KV binding.
4. Before deploying **anything**, reconcile live Worker script/version with
   this repository: as of 6 November 2026, live deployment
   `4ca64a9b-c51e-47f8-aae4-1093a851879c` uses version
   `4cc2de5e-c58e-47d0-8b23-f0d12eea78e0`, while open bridge PRs
   may be ahead of `main`. Do not replace the deployed runtime with stale
   repository source. Preserve the private Queue consumer (batch 1,
   concurrency 1, retries 0), disabled Cron, public and preview URLs.
5. Validate with native Node 24 tests:
   `cd bridge && node --test tests/*.test.mjs`, then inspect and stage
   a non-active Worker version for review. Only activate after deployment approval.
6. After a safe deployment and **no earlier than then**, send one read-only
   `health` request, then a single explicitly approved SHA-pinned pilot
   `trigger` if not already validated on that exact SHA; follow it with
   `inspect` and review Semaphore job/artifact evidence.

## Command examples (private Cloudflare Queue only)

Standard envelope: `v:1`, fresh UUID `id`, `project:"amaraii-os"`,
`provider:"semaphore"`, `approved:true`, and fresh ISO `requestedAt`.

Read-only:
```json
{"v":1,"id":"<fresh UUID>","project":"amaraii-os","provider":"semaphore","action":"health","approved":true,"requestedAt":"<fresh ISO UTC>"}
```

SHA-pinned validation, explicitly approved:
```json
{"v":1,"id":"<fresh UUID>","project":"amaraii-os","provider":"semaphore","action":"trigger","branch":"ci/semaphore-validation-20261106","commitSha":"<verified current 40-character lowercase SHA>","mode":"validation","approved":true,"requestedAt":"<fresh ISO UTC>"}
```

Inspect the returned pipeline ID:
```json
{"v":1,"id":"<fresh UUID>","project":"amaraii-os","provider":"semaphore","action":"inspect","pipelineId":"<owned Semaphore UUID>","approved":true,"requestedAt":"<fresh ISO UTC>"}
```

Submit only using the existing authenticated Cloudflare Queue control-plane API
and inspect sanitized `results/<UUID>` in the existing private KV result store.
Never attempt `POST` to the Worker's public HTTP handler.

## Acceptance / open gates

- [x] Source adapter written, strict branch and project allowlists.
- [x] New mocked contract checks passed 7/7 in isolated V8 execution using
  exact GitHub source; **not native Node 24**.
- [ ] Full native `node --test tests/*.test.mjs` green.
- [ ] Semaphore project UUID and service token configured privately.
- [ ] Live Worker source and GitHub branch reconciled.
- [ ] Worker version deployed with bindings/Queue/Cron/public settings verified.
- [ ] Private health/trigger/inspect verified against a known disposable run.
- [ ] QA-Intel DB-backed, browser and artifact equivalence established.
- [ ] Automatic provider routing policy reviewed and approved separately.

**Release gate:** Do not treat a successful Semaphore basic pipeline as full
Amaraii product QA acceptance, or automatically retry an ambiguous build.
