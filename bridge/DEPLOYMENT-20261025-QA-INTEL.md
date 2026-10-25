# ChurchPro QA-Intel bridge extension — 25 October 2026

Status: private Worker deployed, baseline CI green, QA-specific execution and independent acceptance pending.

## Scope

ChurchPro `circleci-project-setup` now has an opt-in CircleCI `run_qa_intel` parameter and `qa_intel_phase0` job. It uses the existing published `@qutecoder/qa-intel@0.2.0` deterministic runner against current Phase 0 guest sign-in contracts. The report marks product acceptance as pending independent QA review, and future member/attendance/education features as deferred.

The NEN bridge supports an explicit `qa_intel` mode and an exact path-only `artifact_report` read action for `qa-intel/churchpro/agent-handoff.json`. It verifies CircleCI pipeline/job/project ownership, safe artifact hosts and redirects, file size and schema, and returns only the validated evidence status and contract identifiers. It never returns raw report keys, signed URLs or CircleCI credentials.

## Verified evidence

- Previous ChurchPro [pipeline #3](https://app.circleci.com/pipelines/circleci/B65DMdC1ZhAJQM74t7SrZ1/HQvs3kNUw3sJb4jVVJizHu/3): 10/10 baseline jobs passed after adding the optional workflow.
- Bridge contract suite: 49/49 cases passed in the isolated V8 harness, not the native Node 24 test runner. A `.circleci/config.yml` job now exists to execute the native suite once the bridge project is enabled in CircleCI.
- Worker active version: `a6eb1159-2374-4a08-9bf1-42f421b83346`. Deployment: `33d1086f-8ce3-48c3-a799-33de07f3e3de`. Runtime source commit: `3b23e7e2d5e8c3e703224136f138ca7401fd4b9e`.
- Read-only Cloudflare verification confirmed 100% new version, existing `CIRCLE_TOKEN:secret_text` and `QUEUE:kv_namespace` bindings, single command consumer (retries 0), empty schedules and disabled public and preview URLs.

## Outstanding gates

- An authorized live `qa_intel` trigger could not be completed through the connected execution tool. No QA-specific green result, handoff artifact or screenshot is claimed.
- After the next permitted run, verify QA-Intel runner/browser installation and Gherkin compilation; inspect the exact `qa_intel_phase0` job, `artifact_report` handoff and optional unauthenticated screenshot. Fix any real failures and rerun rather than changing acceptance criteria.
- Run the native Node 24 bridge CircleCI job. PR #7 is draft and its source has not been merged into `main`. Avoid redeploying older main.
- Future independent QA reviews must use approved ChurchPro product requirements, not screenshots alone, and must explicitly distinguish current implemented behavior from deferred functionality.

See [bridge/OPERATIONS.md](OPERATIONS.md) for private on-demand command protocol and [ChurchPro QA agent workflow](https://github.com/dev-amaraii/ChurchPro/blob/circleci-project-setup/docs/quality/qa-intel-agent-workflow.md).
