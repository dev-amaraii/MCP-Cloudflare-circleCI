# ChurchPro on-demand CI bridge — deployment evidence (25 October 2026)

## Scope and ownership

NEN International private Cloudflare–CircleCI bridge, existing Worker `nen-ci-bridge`. This release adds ChurchPro to the existing on-demand validation-only registry. It does **not** create a new bridge, a public endpoint, a scheduler, a release workflow, or a QA-Intel screenshot generator.

Implementation review: [draft PR #7](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/pull/7). Source branch `feat/churchpro-on-demand-ci-20261025`; exact runtime source commit `0f1b2b3054f2faf67bf8f8b0395830502492a4ed`. Subsequent documentation-only commits do not change this deployed source.

## Verification before deployment

- The existing ChurchPro pipeline #1 had a green ten-job `verify` workflow at `2c0c96e97a662cfe658fa700e3260c2ac839a44a`.
- CircleCI v2 documentation confirms `GET /project/{project-slug}`, `GET /projects/{project_id}/pipeline-definitions`, and `POST /project/{project-slug}/pipeline/run`. The bridge verifies the exact pipeline definition name `build-and-test`, provider `github_app`, repo `dev-amaraii/ChurchPro`, and config path `.circleci/config.yml` before triggering.
- All **42 checked-in bridge test cases** passed in an isolated JavaScript/V8 harness using modeled `node:test`, fetch, Response, Stream and Buffer interfaces; this is **not** an execution of `node --test tests/*.test.mjs` on Node 24. The actual Node 24 suite remains a release-evidence gap. Existing Jayson release behavior and cross-project permission denial were also tested.
- Artifact inspection was tightened to return allowed artifact paths **without signed artifact URLs**. PNG preview remains ownership-verified, project-prefixed, MIME/signature-checked, origin-allowlisted and byte-limited.

## Cloudflare version and safeguards

- Account: `9483d072db9941b23fe0bcd92d76d0d6`.
- Worker: `nen-ci-bridge`.
- Previous active version: `54a4b503-e2af-4bfd-b3b8-bf3e5c1fcc03`; deployment `ff98a54b-82cc-4fec-b830-1deb1a3b0a7a`.
- New version uploaded using strict inherited binding checks: `fa8fd565-c921-4eb2-8e88-ab1443566d62` (version #18).
- Activated 100% via deployment `7de4af82-368f-472c-8556-b4f0d2b3e0f2`.
- Readback confirmed `CIRCLE_TOKEN:secret_text` inherited without reading or replacing its value, and `QUEUE:kv_namespace` kept namespace `3ad53b33be4346a0b6cf1e1d3047ede4`.
- Runtime compatibility date remains `2026-10-20`; handlers remain `fetch` and `queue`.
- Schedules are empty. `workers.dev` and preview URLs remain disabled; `fetch` remains a 404-only handler.
- Command Queue `nen-ci-bridge-commands` consumer unchanged: batch size 1, max wait 0, concurrency 1, retries 0. No background polling.

## Live on-demand smoke test

1. ChurchPro `health` command `651a18f0-a3bc-4e64-8352-c6226a41a802` returned `success`, `tokenConfigured:true`, allowed branch `circleci-project-setup`, and only `validation` mode.
2. Exactly one new `trigger` command `c96f654e-67bd-43fb-b6da-aa83f508d525` succeeded, creating ChurchPro CircleCI pipeline **#2**, UUID `5e4d409e-3f61-4b28-a905-8de242404518`, for branch `circleci-project-setup`. No optional pipeline parameters were sent.
3. Private on-demand `inspect` command `6029d85b-699a-4711-8389-e6616f5615c3` reported workflow UUID `54a19aef-c178-49f9-80c1-6f6b2dc2537d`, name `verify`, status `success`, with **10/10 successful jobs**: `api`, `web`, `worker`, `database`, `infrastructure`, `shared`, `domain_identity`, `domain_tenancy`, `domain_authorization`, and `domain_audit`.
4. Read-only post-deployment Cloudflare verification confirmed the same new active version, inherited bindings, unchanged Queue consumer, empty schedules and disabled public/preview URLs.

[ChurchPro CircleCI pipeline #2](https://app.circleci.com/pipelines/circleci/B65DMdC1ZhAJQM74t7SrZ1/HQvs3kNUw3sJb4jVVJizHu/2).

## Limits and next gates

- Existing ChurchPro starter CI checks only the project build/unit-test/lint scripts. Container-backed database and worker integration scripts remain separate. This live green run does **not** prove those integration suites, a hosted application or product QA.
- ChurchPro `artifact_preview` now authorizes only owned `qa-intel/churchpro/**/*.png` paths. Current ChurchPro CircleCI jobs uploaded **zero artifacts**; no QA-Intel screenshot producer exists yet. Add a separate opt-in QA job that generates disposable screenshots under this prefix and calls `store_artifacts` before testing preview.
- Native Node 24 `cd bridge && node --test tests/*.test.mjs` remains unverified and should be added as a dedicated bridge CI gate.
- PR #7 remains **draft/unmerged**, even though its source was deployed after regression-style validation. Bring `main` into parity by reviewing and merging the PR without modifying the deployed runtime.
- Retain the previous active version `54a4b503-e2af-4bfd-b3b8-bf3e5c1fcc03` as a rollback checkpoint. On operational failure, reconcile in-flight Queue commands and pause the consumer before changing deployments; never replay an uncertain paid trigger.
