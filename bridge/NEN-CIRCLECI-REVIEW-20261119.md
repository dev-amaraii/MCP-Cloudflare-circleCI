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
