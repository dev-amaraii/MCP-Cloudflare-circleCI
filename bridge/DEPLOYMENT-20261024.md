# Verified on-demand bridge release — 24 October 2026

## Active deployment

- Worker: `nen-ci-bridge`, NEN DevOps account `9483d072db9941b23fe0bcd92d76d0d6`.
- Active version: `54a4b503-e2af-4bfd-b3b8-bf3e5c1fcc03` at 100%; deployment `ff98a54b-82cc-4fec-b830-1deb1a3b0a7a`.
- Runtime source commit: `4640e6582a3f2c1ae06c1cfda40b45f84c3ba70c`.
- Live source SHA-256 matches the checked-in `bridge/src/index.mjs`: `93e0bbbba11dd2c1a9f614fe4f4ef42e367e298d261427bdeb5fa67750799a7b`.
- Existing bindings preserved: `CIRCLE_TOKEN:secret_text`, `QUEUE:kv_namespace` (`3ad53b33be4346a0b6cf1e1d3047ede4`). No credential exported, replaced or added.
- Live schedules: **empty**. Worker registers `fetch` and `queue`, with no scheduled handler. `workers.dev` and preview URLs disabled; fetch always returns 404.
- Command Queue: `nen-ci-bridge-commands` / `ba62fb5b0b304d6591cf0a3605125807`; consumer `e9155e34034b4e80aeeb012f4e022062` targets the existing Worker. Batch size 1, batch wait 0, concurrency 1, retries 0.

## Verification performed

- `node --test bridge/tests/*.test.mjs`: **38/38 passed** on Node 24.15.0, plus `git diff --check`.
- Full pre-change live source retrieved and compared to artifact-preview branch. No omitted Jayson runtime behavior found; changes consisted of pending PNG preview code and comments. Source was never replaced with the older root OAuth/MCP experiment.
- On-demand health requests for AmaraiiOS and Jayson both succeeded with `tokenConfigured:true`, returning the preserved branch/mode registries.
- One authorized live validation-only trigger, request `6dc61639-61c8-44c2-a290-4e8333466f55`, created AmaraiiOS pipeline **#53**, `3bc2256f-0ee9-4278-b413-f31de68f8990` on `development`.
- GitHub reports `ci/circleci: validate = success` for exact development HEAD `880e1372106af3f0e25e4731f7562489752603ac`, linking workflow `104c7a36-a7e1-460e-8e5d-950a0f645149`, job `d402c7ba-6548-4acc-9d34-82c6adb94278` / #53. This smoke test validates bridge-to-CircleCI execution; it is not a hosted CI run of the bridge's own test suite.
- Existing pipeline #49 (`faa00371-0921-4abf-ace1-fd761fe5ea09`), owned job `d2969198-cc77-4212-bdbc-6fdf4a4f8a37` / #49, returned artifact metadata via on-demand `inspect`.
- Preview request `e63006a1-bdaa-446a-822d-e064a12ea6d7` successfully returned `bank-transfer-qa/customer-bank-confirmed-390.png`: **164,185 bytes**, `image/png`. Bytes decoded into a local PNG and visually inspected: disposable billing account with the confirmed bank-transfer state. No signed download URL or credential returned by preview.
- Live retrieval exposed CircleCI's current redirect host `circleci-tasks-prod.s3.us-east-1.amazonaws.com`. The final allowlist adds that exact regional host, with no CircleCI token forwarded to S3. A regression test covers the redirect and denies other regional buckets. Streamed bodies are size-limited even without Content-Length.
- No Jayson release or application production deployment was performed. Jayson release payload/gates passed mocked transport tests; live health passed. Existing release branches, exact-SHA requirements and CircleCI parameters are preserved.

## Limits and recovery

- Commands require authenticated Cloudflare account access and the pinned project/branch/mode registry. AmaraiiOS feature PRs can still use the native GitHub `run-ci` label-added path; this change does not broaden bridge branches.
- Preview currently returns approved QA **PNG screenshots** up to 900,000 bytes. Other report artifacts are listed but their contents are not previewed. Failed jobs cannot supply files they never uploaded.
- KV claims are eventually consistent, not atomic exactly-once. The single consumer and zero retries reduce duplicate paid requests. An uncertain trigger or failed result write requires read-only reconciliation before a deliberate new request. No automatic retry or background status poller exists.
- Restoring pre-change version `332c29dd-5363-4626-a18f-fb0575ae32da` alone cannot process Queue commands. For recovery, pause the consumer before switching versions, preserve KV/secrets, and keep Cron disabled unless explicitly approved. Reconcile in-flight commands first.
- Agent procedure is in [OPERATIONS.md](OPERATIONS.md). Writing legacy KV request keys alone no longer invokes the bridge.

## Final source synchronization — 24 October 2026

- Owner explicitly approved a squash merge of PR #6 only while its head remained `cfb30303ee44f9f0037f196eb4f2c4ec4f85f07a`. The head was checked immediately before merging, and GitHub enforced it with `expected_head_sha`.
- [PR #6](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/pull/6) was squash-merged into `main` as [`c7becad549544b6fffb6d1a6f546a2a463c8a8d8`](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/commit/c7becad549544b6fffb6d1a6f546a2a463c8a8d8). Its sole parent is `bec0df484923a0c5dee811275e0c2414fecf58de`; its entire file tree is identical to the approved PR head.
- The merged runtime source SHA-256 is `93e0bbbba11dd2c1a9f614fe4f4ef42e367e298d261427bdeb5fa67750799a7b`, matching the existing live Worker source byte for byte. Agent instructions, operation runbook, tests and on-demand configuration are now on `main`.
- **No redeployment or production mutation was performed for this merge.** Read-only before/after checks confirmed the same active version `54a4b503-e2af-4bfd-b3b8-bf3e5c1fcc03`, deployment `ff98a54b-82cc-4fec-b830-1deb1a3b0a7a`, encrypted-secret/KV binding metadata, compatibility settings, empty schedules, disabled public/preview URLs and Queue consumer configuration.
- This final record update is documentation only. Existing runtime commit annotations remain `4640e6582a3f2c1ae06c1cfda40b45f84c3ba70c`; squash-merge provenance is recorded here without changing Worker metadata. No additional CI run, application release, migration or billing change was requested or performed.
