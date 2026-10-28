# Amaraii Learn validation-only bridge release — 28 October 2026

## Approval and scope

Founder approved **CI bridge deployment only** to unblock the isolated [Amaraii Learn Academy PR #37](https://github.com/dev-amaraii/amaraii-os/pull/37). No AmaraiiOS application merge, DNS, payments, database, or Learn deployment is authorized by this approval.

The only intended behavioral change is to allow `design/amaraii-learn-v1-spec-20261028` to run `mode:validation` on the existing AmaraiiOS CircleCI project. AmaraiiOS has **no release mode**. Jayson release behavior, existing project registrations, encrypted credentials, KV, Queue and ChurchPro QA are preserved.

## Source provenance

- [Bridge PR #8](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/pull/8), exact reviewed head: `5263c45b42ba33ea03b1fdac6749415d0e8668ca`.
- Squash-merged into `main`: `250adfeadf64123ebc960f351755f74a0b5a8027`.
- **Important:** the deployed Worker had newer ChurchPro/QA code not present in the former repository `main`. The full current live Worker source was read from the Cloudflare version content API, checked for an exact single allowlist occurrence, and synchronized into PR #8 **before** the tested merge. The merged `bridge/src/index.mjs` is that exact active source plus one allowlist entry, preserving the newer QA handlers.
- FNV-1a 32-bit source checksum for the merged JavaScript module: `add33880`, 38,644 characters. This checksum is a cross-source integrity check, not cryptographic artifact signing.
- Exact-head [test run #40772922296](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/actions/runs/40772922296): **41/41 tests passed**, zero failures. Independent allowlist tests reject preview, release, unauthorized branches; the existing queue, privacy and credential safety tests also passed.

## Cloudflare deployment

- Account: NEN DevOps `9483d072db9941b23fe0bcd92d76d0d6`.
- Worker: `nen-ci-bridge`; no public command endpoint, `workers.dev` and preview URLs disabled.
- Previous active version (retain as rollback): `a6eb1159-2374-4a08-9bf1-42f421b83346`; deployment `33d1086f-8ce3-48c3-a799-33de07f3e3de`. Unlike the much older October 24 rollback version, this previous version retains the current on-demand ChurchPro/QA handlers and Queue integration.
- New **uploaded** version: `e259af0e-5abb-42ab-9bd6-0a9aeda6c1e6`. Upload used Cloudflare Worker Versions multipart API with `bindings_inherit=strict`, `main_module:index.mjs`, compatibility date `2026-10-20`, and source hash checked against the merged commit. The version was inspected **before** activation to confirm inherited binding types.
- New **active deployment**: `731f093d-28aa-4958-8931-1d376ff697ca` at 100% of Worker traffic on version `e259af0e-5abb-42ab-9bd6-0a9aeda6c1e6`.
- Independently verified after deployment: active source contains the Learn branch, Amaraii modes still `{validation:'run_validation'}`, ChurchPro QA code still exists; bindings `CIRCLE_TOKEN:secret_text` and `QUEUE:kv_namespace` unchanged (no secret read); Worker Cron schedule empty.
- Command Queue: `nen-ci-bridge-commands` `ba62fb5b0b304d6591cf0a3605125807`. Consumer `e9155e34034b4e80aeeb012f4e022062`: batch 1, concurrency 1, zero retry. KV namespace `3ad53b33be4346a0b6cf1e1d3047ede4`.

## Live validation results

- Authenticated Queue `health` request ID `92d3f432-e4ea-44fb-b0de-6234817063e1`: **success**, `tokenConfigured:true`, Learn branch in `allowedBranches`, `availableModes:["validation"]`.
- Authorized single Queue `trigger` request ID `562e65b0-6dc3-4622-8c3b-cb2b347b1391`: **success**, created CircleCI pipeline **#98**, `5dfa553b-06c8-4301-9918-040d7823a3f8` for Learn branch, mode validation. No duplicate paid trigger issued.
- Workflow: `597ea5d6-1eb1-4c14-a411-7b1f3545afaf`; job `67d58e5f-d94e-412c-986f-f02f9d43a8e8` (#108).
- GitHub exact Learn PR head `4b96cead381480983c33a3af36a05fd07df29d7e`: **`ci/circleci: validate = success`** (target: [CircleCI job #108](https://app.circleci.com/workflow/597ea5d6-1eb1-4c14-a411-7b1f3545afaf/job/67d58e5f-d94e-412c-986f-f02f9d43a8e8)).
- Bridge-owned `job_steps` reports successful frozen installation, repository typecheck, API unit tests, Learn content/routes unit tests. The completed GitHub CircleCI check confirms the final monorepo build passed.

## Follow-up / rollback

- Academy PR #37 remains **draft/unmerged/undeployed**; dedicated browser Playwright, independent QA-Intel screenshots and accessibility testing, real instructional media and P-2 operational content review remain pending.
- Keep no scheduled polling. Do not retry a Queue trigger with a new command ID if the prior outcome is uncertain; read the recorded result and reconcile the pipeline first.
- If runtime failure is identified, **pause the queue consumer before switching versions**, then use the immediately previous Worker version `a6eb1159-2374-4a08-9bf1-42f421b83346`, preserving KV and secret bindings. Inspect in-flight requests and restore the private Queue consumer configuration. Do not switch to pre-Queue October 24 versions or activate Cron merely to roll back.
