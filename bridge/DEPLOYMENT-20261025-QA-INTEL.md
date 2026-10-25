# ChurchPro QA-Intel bridge extension — 25 October 2026

Status: private Worker deployed, QA-specific CircleCI execution **passed**, independent product acceptance still pending.

## Scope

ChurchPro `circleci-project-setup` now has an opt-in CircleCI `run_qa_intel` parameter and `qa_intel_phase0` job. It uses the existing published `@qutecoder/qa-intel@0.2.0` deterministic runner against current Phase 0 guest sign-in contracts. The report marks product acceptance as pending independent QA review, and future member/attendance/education features as deferred.

The NEN bridge supports an explicit `qa_intel` mode and an exact path-only `artifact_report` read action for `qa-intel/churchpro/agent-handoff.json`. It verifies CircleCI pipeline/job/project ownership, safe artifact hosts and redirects, file size and schema, and returns only the validated evidence status and contract identifiers. It never returns raw report keys, signed URLs or CircleCI credentials.

## Verified evidence

- Previous ChurchPro [pipeline #3](https://app.circleci.com/pipelines/circleci/B65DMdC1ZhAJQM74t7SrZ1/HQvs3kNUw3sJb4jVVJizHu/3): 10/10 baseline jobs passed after adding the optional workflow.
- Bridge contract suite: 49/49 cases passed in the isolated V8 harness, not the native Node 24 test runner. A `.circleci/config.yml` job now exists to execute the native suite once the bridge project is enabled in CircleCI.
- Worker active version: `a6eb1159-2374-4a08-9bf1-42f421b83346`. Deployment: `33d1086f-8ce3-48c3-a799-33de07f3e3de`. Runtime source commit: `3b23e7e2d5e8c3e703224136f138ca7401fd4b9e`.
- Read-only Cloudflare verification confirmed 100% new version, existing `CIRCLE_TOKEN:secret_text` and `QUEUE:kv_namespace` bindings, single command consumer (retries 0), empty schedules and disabled public and preview URLs.

## Verified QA-Intel smoke run — 25 October 2026

- User triggered ChurchPro CircleCI [pipeline #4](https://app.circleci.com/pipelines/circleci/B65DMdC1ZhAJQM74t7SrZ1/HQvs3kNUw3sJb4jVVJizHu/4), UUID `d6152699-a0ea-4e66-a718-5874d16dff18`, for source revision `6fba27e25e155ba348a804c816cf805bff3f452c`.
- The normal `verify` workflow passed all 10 jobs. The opt-in `qa_intel_acceptance` workflow and `qa_intel_phase0` job #41 both passed. Native job steps confirm dependency install, web build, pinned QA-Intel runner/browser installation, Phase 0 browser-contract execution, and artifact upload all succeeded.
- CircleCI produced two QA artifacts: `qa-intel/churchpro/agent-handoff.json` and `qa-intel/churchpro/phase-0-guest-auth.png`.
- The private bridge's new `artifact_report` operation successfully returned a sanitized, provenance-verified handoff for the exact pipeline/job: `evidenceStatus:passed`, `productAcceptance:pending_independent_qa_review`, and both guest sign-in contract intents `passed`. The bridge omitted arbitrary JSON fields and signed artifact URLs.
- The `artifact_preview` operation successfully retrieved the owned guest PNG (66,181 bytes). A reviewer inspected the image at 1280×720: left branded panel and right sign-in form render, field labels and primary CTA are visible, and no obvious overlap/clipping appears. This visual observation is **not** a mobile QA pass.
- **Still open:** independent reviewer acceptance against the approved product criteria; mobile accessibility/viewport testing; authenticated tenant/role/permission business flows that are not implemented in Phase 0; native Node 24 bridge regression job (previously tested in an isolated JS harness, not native CircleCI).
- This live QA run verifies only implemented Phase 0 guest-auth acceptance. It must not be described as ChurchPro MVP complete or broadly product accepted.

## Follow-up verification — expanded Phase 0 QA and native Node proof

- ChurchPro [CircleCI #5](https://app.circleci.com/pipelines/circleci/B65DMdC1ZhAJQM74t7SrZ1/HQvs3kNUw3sJb4jVVJizHu/5) on `658e2ecf826eda48d917054ac840317f75734e2d` successfully ran 10 standard jobs and the opt-in QA job. The private `artifact_report` verified **5/5 approved guest-only acceptance checks passed** (two QA-Intel Gherkin contracts; three supplemental Playwright checks for 320px/390px responsive layout, native empty-form validation, and uncaught browser exceptions). Both full-page mobile PNGs were privately previewed and visually examined without obvious layout overflow or clipping. This does not certify authenticated or future product workflows.
- ChurchPro [CircleCI #6](https://app.circleci.com/pipelines/circleci/B65DMdC1ZhAJQM74t7SrZ1/HQvs3kNUw3sJb4jVVJizHu/6) at temporary config SHA `28c0921b91ee35f6efc087faf3d8015af561ea7b` ran the **native Node 24.15** command `node --test tests/*.test.mjs` on the pinned bridge repository SHA `cfe60d93a95c2f20b261a210d9275adb297effe3`. CircleCI `job_steps` confirms the test step succeeded (exit 0); all 11 jobs were green. This is a real native Node regression execution, beyond the prior isolated V8 harness.
- The **one-time** cross-repository step was removed from ChurchPro in `749059efaaf1a4c3aa2610da8db5611b69029842`. [CircleCI #7](https://app.circleci.com/pipelines/circleci/B65DMdC1ZhAJQM74t7SrZ1/HQvs3kNUw3sJb4jVVJizHu/7) confirmed the permanent ten-job plus opt-in QA workflow still passes 11/11. A separate native test job remains defined in this bridge repository, but its own CircleCI project has not been confirmed configured.
- A reviewer-facing independent QA evidence pack is now in [ChurchPro's Phase 0 handoff](https://github.com/dev-amaraii/ChurchPro/blob/circleci-project-setup/qa-intel/reviews/phase0-handoff-20261025.md). The implementing agent's own examination of screenshots is **not** independent product sign-off. The machine-readable `productAcceptance` field remains `pending_independent_qa_review`. ChurchPro [draft PR #5](https://github.com/dev-amaraii/ChurchPro/pull/5) and this [bridge PR #7](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/pull/7) are open for review.
- Cloudflare Worker deployment, security bindings, Queue, public URL and schedule settings were **not modified** during these QA evidence runs.

## Outstanding gates

- **Resolved:** ChurchPro QA-Intel pipeline #4 was manually triggered and both workflows passed; handoff JSON and guest screenshot were verified through the private bridge.
- Maintain an independent QA-review verdict separate from CI green. Current handoff explicitly leaves product acceptance pending, and Phase 1+ workflows are deferred, not passed.
- **Native Node 24 test proof completed via pinned source in CircleCI #6**. A dedicated bridge-repository CircleCI project remains unverified; PR #7 is draft and not merged into `main`. Avoid redeploying older main.
- Future independent QA reviews must use approved ChurchPro product requirements, not screenshots alone, and must explicitly distinguish current implemented behavior from deferred functionality.

See [bridge/OPERATIONS.md](OPERATIONS.md) for private on-demand command protocol and [ChurchPro QA agent workflow](https://github.com/dev-amaraii/ChurchPro/blob/circleci-project-setup/docs/quality/qa-intel-agent-workflow.md).
