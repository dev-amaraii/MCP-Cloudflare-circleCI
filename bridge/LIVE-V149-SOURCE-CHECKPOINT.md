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
