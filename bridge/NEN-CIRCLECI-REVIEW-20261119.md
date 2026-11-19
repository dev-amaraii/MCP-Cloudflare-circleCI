# NEN CircleCI bridge adapter — isolated review checkpoint

**Owner:** NEN International / NEN Context OS.
**Date:** 19 November 2026.
**Status:** REVIEW-ONLY, **NOT DEPLOYABLE**. No live Worker code or binding changed.
**Source base:** `codex/bridge-live-v149-source-parity-20261114` at `fd72c2bb8bdaf54c5b164c868f7230d1b5986b4d`. That branch's PR #28 is independently **BLOCKED** for out-of-date live source and unexecuted Node 24 suite. The deployed `nen-ci-bridge` advanced again on 16 November. **Do not merge this branch to main or deploy its Worker.**

## What is implemented

- `bridge/src/circleci-nen.mjs` is a standalone, **unwired** candidate for an explicit NEN CircleCI provider; not imported or called by `bridge/src/index.mjs`.
- Defaults: `health` is local-only; `verify_project` reads CircleCI project and GitHub App definition identity; `inspect` checks the exact originating NEN project, branch and SHA; `trigger` requires an explicitly enabled binding, an approved validation-only branch+SHA, and an independently verified GitHub App definition.
- The only allowed branch and source are `codex/nen-approved-overview-hero-20261118` at `8c818968da6be860ba0e6c4012895b7e2d5331f5` (current approved review checkpoint; will become stale if PR #56 moves). **No user-selected branch, repo, pipeline-definition ID, API host, URL, pipeline parameter, release or auto-fallback.**
- Explicitly prohibits release. The GitHub App API's `checkout.branch` call is **not pinned to commit SHA**. The adapter returns `revisionVerificationRequired=true` on any future POST and the caller must verify the actual returned pipeline's revision before reporting acceptance. No automatic retries or switching providers after an ambiguous POST.
- `bridge/tests/circleci-nen-review.test.mjs`: seven mocked non-network test cases covering health, default trigger denial, wrong branch/SHA/provider/action/mode, strict NEN GitHub App identity, cross-project and stale-SHA rejection, trigger payload, and no retry.

## Actual live verification available

- On 19 November, Cloudflare Worker `nen-ci-bridge` accepted private Queue command `health` for `nen-website-cms`, `provider=semaphore`, and its private KV result returned `status=success`, `projectConfigured=true`, `tokenConfigured=true`, `releasePermitted=false`. Request UUID `f21c943a-a8ef-4f7f-8172-62468cc52875`. This check **did not trigger a CI build**.
- Live Worker has a bound `CIRCLE_TOKEN`, but its NEN adapter still rejects `provider=circleci` and its auto provider routing applies only to AmaraiiOS development. A bound token does not establish a usable **NEN** CircleCI project.
- The NEN website repo's [draft PR #56](https://github.com/dev-amaraii/nen-website-cms/pull/56) contains isolated `nen-security-preview-acceptance` CircleCI config. Its required restricted contexts `nen-staging-cms-readonly` and `nen-protected-preview-readonly` and the project connection **have not been independently verified**.
- This adapter's test file **has not run on Node** in this session: the isolated execution container cannot reach GitHub (DNS blocked); mocked test design and GitHub source write/readback are not proof of a successful test run.

## Activation gates (strict sequence)

1. Confirm **NEN website repo's actual CircleCI project slug**, GitHub App pipeline definition, and project connection via an authorized CircleCI read. Never reuse the historical root `nen-circleci-mcp` Worker project slug without checking `repo.full_name === dev-amaraii/nen-website-cms`.
2. Confirm the two named CircleCI contexts exist and are restricted to NEN; use only the appropriate staging read token and Vercel preview credential. First run NEN PR #56 directly in CircleCI. Inspect job/log/screenshot evidence and verify the exact Git SHA at the Vercel preview. Do not conclude an account's 30,000 refreshed credits imply project readiness.
3. Obtain stable source freeze for the **entire** live shared Worker, reconcile all currently deployed module bytes/allowlists into a reviewed source branch (PR #28 is stale), and preserve current ten binding names/types, Queue/KV, compatibility date, public 404 and all other project adapters.
4. Run Node 24 full bridge tests (`cd bridge && node --test tests/*.test.mjs`), including the new adapter tests, on the exact review HEAD. Review security and provider identity negative cases. Do not mark tests passing without execution evidence.
5. Only after reviewed project identity and source parity, **wire** the new adapter to a narrowly scoped command registry with a dedicated verified NEN project slug binding `NEN_CIRCLECI_PROJECT_SLUG` and disabled-by-default `NEN_CIRCLECI_TRIGGER_ENABLED`. Restrict to explicit health/verify_project/inspect/validation-trigger, separately gate reports/screenshots with whitelisted paths. Do not enable `provider=auto` for NEN. Keep Semaphore read-only diagnostics and older exact-SHA authorizations intact.
6. Stage an inactive Cloudflare Worker version with inherited, encrypted secrets; review binding names/types and rollback to previous live version. Deploy only with explicit owner approval and a non-destructive read-only health check first, then one intentionally authorized validation trigger.
7. Confirm actual CircleCI pipeline revision, job result and NEN browser evidence. Never replay an uncertain paid trigger or treat a branch-intended SHA as deployed proof.

## Non-goals

No production deployment, CMS seeds/content, Contact writes, broader Amaraii/ChurchPro/Urban Paints CI changes, public HTTP commands, exposing CircleCI tokens, arbitrary pipeline execution, automatic credit-based switching or unattended retries.

**References:** [NEN PR #56](https://github.com/dev-amaraii/nen-website-cms/pull/56) · [bridge source parity PR #28](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/pull/28) · [NEN Context OS](https://app.notion.com/p/3e1fa5e3c9058159a372c72f4d346867).


## 19 November 2026 — CircleCI v3 NEN diagnostic + artifact reader prepared (NOT LIVE)

The founder correctly asked that `nen-ci-bridge` retrieve failed job diagnostics and screenshots without repeatedly asking for browser screenshots. The first real NEN CircleCI PR #56 run had **95/96 web tests passing**; the failed test retained obsolete `security_irqhzc.webp` instead of the approved 19 November CCTV hero. That stale assertion was fixed on NEN PR #56 at `7b9f3ff8d9cf906d4a9df6578d54ddfe44c29d9f`. A second CircleCI run was triggered once by removing/re-adding the existing `run-ci` label after the new commit, but its `nen-security-preview-source-qa` also reports **FAILED**. Its new failure cause is **unknown** until its job step is inspected. The latest failure job UUID is `f5db7ff8-0004-4761-aeb4-9ceadca52682`; previous failure was `6afeb08e-2af5-4546-9159-74d755cb8815`.

**Review-only source added**: `bridge/src/circleci-nen-evidence.mjs` and seven mocked regression cases in `bridge/tests/circleci-nen-evidence.test.mjs`. `executeCircleCiNen` can call the reader for `job_diagnostics`, `artifact_list`, `artifact_report` and `artifact_png`, but **the parent NEN CircleCI adapter is still not imported by the live Queue handler**. No deployment/remote CircleCI API reads were performed; the tests were authored and statically reviewed, not yet executed.

Current CircleCI API v3 supports `GET /api/v3/jobs/{jobId}`, `/stdout/condensed?filter[execution]=...&filter[step_num]=...` and `/artifacts`; v2 is used for the authoritative NEN GitHub App project identity and pipeline branch/revision. Documentation: https://circleci.com/docs/api/v3 and https://circleci.com/docs/guides/toolkit/api-v3-developers-guide/.

**Safety invariants:** require exact NEN project slug, a unique GitHub App pipeline definition for `dev-amaraii/nen-website-cms` and `.circleci/config.yml`, job project ID/name, pipeline project ID/branch, and a specifically reviewed SHA (the two current NEN PR #56 failed run revisions only). No cross-project reads, arbitrary domains, caller-controlled URLs, release or CI writes. Error output is limited to failed steps using CircleCI's condensed endpoint and a bounded redacted summary; signed artifact URLs and bearer tokens are never returned. Artifact listing permits only `nen-security-preview-qa` JSON and approved PNG names. Report JSON is narrowed to IDs/failure messages; PNG previews require the PNG signature and an 850 KB limit. All external artifact fetches use an HTTPS host allowlist, manual redirects and bounded streaming. If CircleCI's real response shapes differ, abort rather than relaxing ownership checks. **No real-provider acceptance claimed.**

**Pending before any deployment:** run new reader/adapter tests on Node24 and test real CircleCI v3 response shapes with an authorized NEN project in an isolated read-only environment; reconcile the entire latest live shared Worker v154+ source and ten binding names/types (PR #28 remains stale); review error sanitization and artifact URL host allowlist; confirm an explicit NEN CircleCI project slug in a separately scoped binding; wire only these fixed read-only actions to the authenticated Queue handler. Deploy only after a new, independently approved release with rollback ready. The latest source PR is [bridge PR #29](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/pull/29). Until then, CircleCI's signed-in job UI is the only verified NEN CircleCI diagnostics surface.

