> **Current source parity as of 15 November 2026: live Worker v150.** This document began as a v149 checkpoint; the v149 hashes and rollback facts below are historical, not the current deployment identity. The 15 November v150 supersession note at the end is authoritative for PR #28's current source. The branch/path retain their original v149 names to preserve existing links.

# NEN CI Bridge — live v149 source checkpoint

**Owner:** NEN International / NEN Context OS
**Checkpoint date:** 2026-11-14
**Status:** Source parity verified against deployed Worker; regression **execution and merge review pending**.
**Repository branch:** `codex/bridge-live-v149-source-parity-20261114` (branched directly from `main`; not from older stacked PR #26/#27).
**Deployment status:** The current live Worker was **not changed** by this GitHub source reconciliation.

## Deployment source of truth

- Cloudflare Worker: `nen-ci-bridge`
- Currently deployed: **v149**, version `6a30ebf7-388f-4039-8d34-3d7bc3708459`
- Deployment: `c05579db-44a5-4b68-82f5-1101fc51747f`, 100% traffic
- Rollback: **v148** `d8c38c05-9b75-43de-acaf-d50000b9e262`
- Configuration: compatibility date `2026-10-20`, **seven source modules**, **ten Worker bindings** (same names/types in v148 and v149; secret values not copied into GitHub)
- Queue: `nen-ci-bridge-commands`, one Worker consumer, batch size 1, no retry
- Worker fetch route remains public **404**, never an HTTP CI command endpoint

Each `bridge/src/*.mjs` module below was re-read from the active Cloudflare `content/v2` multipart response and compared **byte-for-byte** with this GitHub branch. All seven matched. The SHA-256 values below come from Cloudflare's live module bytes, not from source-branch guesses.

| Module | Live bytes | Live SHA-256 |
| --- | ---: | --- |
| `amaraii-pr109-evidence.mjs` | 11,189 | `5854fc3c66c2ea55ab39ff087c1f66eb3f18c719cf67e9cee7768d808072dcc7` |
| `index.mjs` | 58,111 | `b86d6616eb6a4ee2bfc278b83d8eda3158765d56e009b10436d60103bed6f3df` |
| `provider-routing.mjs` | 1,497 | `89d798f3e30359a51e77254f60895c778ef927e7ca66d7d69bfe4c72b6e51ef8` |
| `semaphore-churchpro.mjs` | 37,267 | `1ce8c0927ce67ba7a3cd6ede09dae08f19733684e896099ed58bf44d60f517c8` |
| `semaphore-nen.mjs` | 19,997 | `9510b775703487be16f57cd8078abd72ff791c4862050becfdb6d99b954ca1f8` |
| `semaphore-urban.mjs` | 13,247 | `29c17c06cc49de3f14b5993732e2392e0e693137954b48d499de34a4a12e4ac6` |
| `semaphore.mjs` | 19,791 | `39dee9d34f2470a0e6432f06f1bbc6eaa380300c7a7bc489fae1cb39c16fbd84` |

## Why this is a whole-Worker parity checkpoint, not a one-file PR

The repository `main` branch predates several live Worker integrations. At the time of capture, `main` did not have `semaphore-churchpro.mjs`, `semaphore-nen.mjs`, `semaphore-urban.mjs` or `amaraii-pr109-evidence.mjs`. Draft PRs #26 and #27 are stacked on older bridges and do **not** represent the v149 deployment. Copying only the P3.1 pin into those drafts would leave source drift and could overwrite other live integrations on the next deployment.

Therefore this branch captures **all seven modules from the real deployed Worker**. It changes more lines relative to `main` than the one approved P3.1 patch. This is intentional *source parity*, **not retroactive approval** of every older, unmerged bridge change for promotion.

## ChurchPro v149 approved allowlist

The v149 change is restricted to one additional successful-run, branch/source/pipeline-pinned `churchpro_report` pair:

- Branch: `codex/churchpro-p3-p31-manual-sessions-20261114`
- Pipeline: `2a37bec8-689f-474c-85c9-52261d858979`
- Source: `a374d8ec02b7e3a0b73c25a129fae577649a856d`
- Reports: `qa-intel/churchpro/agent-handoff.json` (73 required API checks) and `qa-intel/churchpro/gather-browser-handoff.json` (35 existing Gather browser checks)
- The earlier successful `d806877f` source and `80f5a3cf` pipeline are still pinned separately.
- The reader verifies project, branch, SHA, completed/pass status, trusted named job, exact artifact filename, sanitized JSON schema and fixed expected totals. It does not grant new PNG, raw log, arbitrary artifact, CI trigger, HTTP command or cross-project access.

Owner-approved live read-back of both reports from v149: **73/73 API passed** and **35/35 Gather browser passed**, zero failures, both returning the exact source SHA. [ChurchPro engineering evidence record](https://github.com/dev-amaraii/ChurchPro/issues/32#issuecomment-6884952045).

These are **existing Gather** browser cases, not a P3.1 attendance UI. Human UAT remains 0/12, with privacy/legal/stakeholder release gates unfulfilled.

## Tests and acceptance

- Restored the existing ChurchPro adapter regression corpus from the most recent PR #27 source branch (`bridge/tests/churchpro-semaphore.test.mjs`, 27 named tests).
- Added `bridge/tests/churchpro-v149-pin.test.mjs` (five test groups): exact latest-source reports (73/35), previous-green continuity, wrong project/branch/revision/state, unauthorized artifact/PNG or job selector, mismatched named job/reports.
- Run `cd bridge && node --test tests/*.test.mjs` and review *all* passing/failing cases before marking this PR ready.
- Repeat the exact seven-file SHA-256 parity check **at merge time** and reject unrelated Worker changes.
- Do not claim a passing regression run solely because files were committed or because ChurchPro's separately recorded Semaphore run is green. CI execution is **pending** for this repository checkpoint.

## Non-negotiable merge/deploy controls

1. **Do not blindly merge** this draft into `main` until the entire live-source diff, older stacked PR dependencies, test output and source parity are independently reviewed. Avoid superseding original PRs #26/#27 without resolving their review history.
2. **Do not run generic `wrangler deploy` against live** without first verifying how all ten bindings and protected encrypted secrets are preserved. The checked-in `bridge/wrangler.toml` does not enumerate every current live plain-text binding. Prefer the reviewed surgical Cloudflare version/deployment path with binding inheritance; inspect the prepared candidate's binding names/types before deployment.
3. Keep v148 rollback available. Verify current deployment is still v149 and compatibility date, queue consumer, seven modules and ten bindings are unchanged before any future update.
4. No fresh CI triggers, ChurchPro application deploy/migrations, church real data, new Attendance routes, bridge privilege escalation or release are authorized by this source checkpoint.
5. On any future bridge deploy, guard against accidental removal of ChurchPro's two approved pinned QA readers and unaffected Amaraii/NEN/Urban project integrations.

**Review context:** [ChurchPro issue #32](https://github.com/dev-amaraii/ChurchPro/issues/32) · [older bridge draft PR #27](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/pull/27) · [NEN Context OS ChurchPro](https://app.notion.com/p/40dfa5e3c905811f8876e702464f8394).

## Static/source review continuation — 14 November 2026

**Why the first checkpoint was not enough:** Restoring the ChurchPro test corpus alone left live Urban Paints, NEN CMS and Amaraii bridge modules without their corresponding historical tests in the new source-parity branch. This was identified during PR #28 cross-project review, and the available source-matching test suites have now been copied from their owner branches without modifying deployed code:

| Test file | Source branch | Named test groups |
| --- | --- | ---: |
| `churchpro-semaphore.test.mjs` | `fix/churchpro-p31-api-pinned-ci-inspect-20261114` | 27 |
| `churchpro-v149-pin.test.mjs` | New on PR #28 | 5 |
| `live-v149-source-parity.test.mjs` | New on PR #28 | 1 |
| `urban-paints.test.mjs` | `feat/urban-paints-semaphore-validation-20261114` | 10 |
| `amaraii-pr109-evidence.test.mjs` | `feat/pr109-semaphore-evidence-readonly-20261113` | 14 |
| `semaphore-nen.test.mjs` | `feat/nen-pr42-scoped-visual-qa-20261112` | 28 |
| `semaphore.test.mjs` | Existing from `main`; corrected historical branch-list expectation against v149 | 7 |
| `live-v149-no-http-commands.test.mjs` | New on PR #28 | 1 |
| `live-v149-cross-project-gates.test.mjs` | New on PR #28 | 3 |

These files contain **96 named test groups** in total. The complete `bridge/tests/*.test.mjs` glob may include additional existing files from `main`; 96 is **not** a claim about the full-suite test count or pass total. The legacy tests were imported for review, not asserted to pass merely because they parse.

**Review findings and limited execution evidence:**
- The source snapshot remains byte-identical to live v149 in all seven `bridge/src` modules; all source SHA-256 hash expectations remain unchanged by the test-only additions.
- JavaScript syntax parsing succeeded for each added test file using a V8 parser with Node import statements excluded; this is **not Node.js test execution**, package resolution, a CI run, or full runtime compatibility proof.
- Executed the *actual v149 report reader source* inside an isolated JavaScript harness with synthetic provider responses: **four authorized exact-current/previous API/browser report combinations accepted**, and **ten negative/malformed cases rejected**, including wrong project, branch, SHA, pipeline state, named job, job selector, missing artifact, 72/73 report and mismatched report revision. These were not signed real provider responses and do not replay the real CI.
- Independently exercised the **actual live v149 command validator source** inside the same isolated harness after loading seven modules: exact NEN PR44 policy and Urban bundle paths allowed; wrong SHA, traversal and P3.1 branch CI trigger denied (**5/5** expected decisions).
- In a separate earlier live bridge read, the **real** P3.1 private sanitized reports were independently retrieved and verified **73/73 QA-Intel API**, **35/35 existing Gather browser**, zero failures at exact P3.1 commit `a374d8ec`. That is application engineering evidence, not execution of PR #28 regression tests.

**Identified and corrected test drift:** `bridge/tests/semaphore.test.mjs` previously expected only two Semaphore branches, while live v149 explicitly allows 11 fixed branch-to-YAML mappings. The test was changed to assert the **exact 11-entry approved source allowlist** (not a broader permissive check). No live code or deployment changed.

**Remaining operational blocker:** `git ls-remote` to GitHub from the current Node 22 container fails because `github.com` cannot be resolved. The connected GitHub plugin can read/edit source but cannot execute repository commands. GitHub Actions usage was previously reported exhausted; this repo has no committed Semaphore pipeline. Therefore **`cd bridge && node --test tests/*.test.mjs` still has not run** on the complete PR #28 checkout. Test execution and an independent review of all historical cross-project changes remain mandatory before merge. Do not use the synthetic checks as a substitute.

**Older PR disposition:** Bridge [draft PR #26](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/pull/26) and [draft PR #27](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/pull/27) remain open and stacked; their prior changes are represented in the exact live v149 source snapshot, but their review history should remain discoverable. Once PR #28's full tests and independent review pass and a merge is explicitly approved, close older drafts with a documented *superseded by #28* explanation rather than merging stale branches into `main`. **Neither was closed or merged here.**

**No-live-change assertion:** This continuation only changed draft GitHub test files and this record. Cloudflare Worker v149 and its existing bindings, queue configuration, live credentials, authorized actions and production workloads were not modified.

## 15 November 2026 — First real Node run and an explicit Semaphore CI path

**Owner:** NEN International; **deployment remains unchanged**. This entry supersedes the previous blanket statement that no bridge repository Node tests have run, while preserving the **full-suite pending** gate.

**Actual execution accomplished:** Recovered precisely `bridge/src/semaphore-urban.mjs` and `bridge/tests/urban-paints.test.mjs` from PR #28 source via the connected GitHub service into an isolated local Node.js 22 environment. Verified their checked-in Git blob identities: Urban adapter matches the deployed v149 SHA-256 `29c17c06cc49de3f14b5993732e2392e0e693137954b48d499de34a4a12e4ac6`, and test file Git blob `e97704dd1db6845c3a92f4e756a153f6ba1de5be` matches GitHub. Executed **`node --test tests/urban-paints.test.mjs` → 10/10 PASS, zero failures**, including bounded validation, project ownership, trusted artifacts, safe diagnostics and foreign-job refusal. This is a **real Node test run of one adapter**, not a synthetic V8-only result and not a claim for any other test file.

**Reusable complete-suite gate added to this PR:** `.semaphore/semaphore.yml`, copied in structure from ChurchPro's verified validation-only Semaphore pattern, source-checked with git blob `a29aa69f5ea93c411f7311377f62787d8d55c9d7`. Tested the YAML document locally using PyYAML **PASS**. The pipeline uses Ubuntu 24.04 / `f1-standard-4`, Node 24, verifies `git rev-parse HEAD == $SEMAPHORE_GIT_SHA`, checks JS syntax for all `bridge/src/*.mjs` and `bridge/tests/*.test.mjs`, and finally executes `cd bridge && node --test tests/*.test.mjs`. It has **no environment secret requirements, no artifact access or secret exposure, and no build/deploy trigger**.

**Execution dependency:** No Semaphore project currently connected to `dev-amaraii/MCP-Cloudflare-circleCI` was established. To run the pipeline, register this repository as a Semaphore project (suggested name `nen-ci-bridge`) in the existing organization and use its `.semaphore/semaphore.yml` pipeline. This is a discrete operator/project-registration action, **not a request to change the live Cloudflare CI bridge**. Do not treat the new YAML as a green Semaphore run before an actual pipeline ID and result are verified.

**Runner alternatives attempted without production mutation:** Node.js 22 was available in the isolated local container, but outbound GitHub cloning remained blocked by DNS/egress; a Vercel Sandbox attempt stopped at the required `projectId` preflight without provisioning a sandbox/project. Do not create unrelated infrastructure to bypass this gate.

**Remaining controls:** Complete **all** repository Node test groups via Semaphore or an accessible checkout. Compare the resulting output to PR #28's exact head SHA; if failures occur, correct **test-only** fixtures first, and do not modify any of the seven live-source modules without separately reviewing impact on the immutable v149 hash test. Independent cross-project/security review, PR merge approval and older #26/#27 supersession remain separate.

## 15 November 2026 — Live v150 source supersedes the v149-only snapshot

**Concurrent independently owner-approved NEN deployment identified:** Cloudflare `nen-ci-bridge` now runs **v150**, version `e09c093b-84b9-4e05-9de0-02c5fc010f1b`, deployment `643ef42e-e821-4895-a1c0-c0556b06c963`, effective **100%** at `2026-11-15T05:38:58.73849Z`. Worker deployment annotation: `Approved PR112 exact-SHA validation-only branch allowlist; no deployment actions added`. The change was **not** made by this PR #28 source-reconciliation task. Cloudflare again reported **10 bindings** and compatibility date `2026-10-20`.

**Full seven-module source comparison:** Six modules are byte-for-byte identical to live v149 (their v149 SHA-256 hashes in the table above remain valid). Exactly one module, `semaphore.mjs`, changed with two additive lines:

```diff
+  'codex/historical-minimum-records-review-20261114': '.semaphore/semaphore.yml',
+    if (command.branch === 'codex/historical-minimum-records-review-20261114' && command.commitSha !== 'a47ee0e75279d377888d408f72720eb9ffaf7cb8') throw Error('PR112 revision not permitted');
```

Its current live **SHA-256 is `d1b6073340a9f7f912c05089c33f91796d2928642f5bbacadc4f39f33f00b0d2`**, byte length **20,065**, replacing v149's `39dee9d3...` / 19,791 bytes. All six other live hashes in the table above remain unchanged. The exact `semaphore.mjs` v150 source was independently compared byte-for-byte against the updated GitHub PR #28 module *before committing*. ChurchPro's P3.1 report reader remains unchanged and retains its exact old/current successful pipeline pins.

**Updated regression guard:** The branch-list test now expects the exact **12** entries from live v150 and a new PR112 test asserts: correct `codex/historical-minimum-records-review-20261114` / `a47ee0e75279d377888d408f72720eb9ffaf7cb8` routes once to Semaphore; other revisions fail before network access. Isolated actual-source V8 synthetic checks returned both expected outcomes (1 permitted mocked provider request, 0 for mismatched SHA). The older `live-v149-source-parity.test.mjs` was superseded by **`live-v150-source-parity.test.mjs`**; the new test pins all seven current v150 hashes. The new validation-only `.semaphore/semaphore.yml` now requires this v150 test file.

**Safety and scope:** The source reconciliation made **no** Cloudflare deployment or bindings change. PR #28's original branch name and this document's filename remain historical identifiers; its review base is still `main`. Full Node24 CI run remains blocked until the bridge repository is registered as a Semaphore project (or a separate full checkout can run); actual local Urban Paints adapter **10/10** Node22 remains valid because the Urban module and its test did not change. PR #28 must not be merged/redeployed from the previous v149 checkpoint without this v150 source and SHA guard.
