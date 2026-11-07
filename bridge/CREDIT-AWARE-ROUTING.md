# NEN CI Bridge — Credit-aware validation routing

Owner: NEN International. Source-only until native CI and Semaphore development-branch acceptance pass.

## Scope
- `provider:"auto"` is an **opt-in**, explicitly approved command for `amaraii-os` on `development`, `mode:"validation"`, with required exact 40-character commit SHA.
- The read-only `action:"route"` reports the chosen provider; `action:"trigger"` makes **one** request to the selected provider. No scheduled polling, no automatic replay, and no release/migration/preview permissions.
- Existing commands without a provider still use CircleCI. Explicit `provider:"circleci"` or `provider:"semaphore"` behavior is preserved.
- `provider:"auto"` selects CircleCI unless a verified, unexpired exhausted-credit marker is present.
- There is no reliable synchronous CircleCI *remaining free credits* balance API in the current bridge. CircleCI's asynchronous usage-export API reports historical consumption, not an authoritative free-plan remaining balance. Do not invent a quota signal based on 403, 429, test failure, timeout, or a queued job.
- Fallback to Semaphore requires both explicit owner-controlled enablement and a finite exhaustion expiry no more than 32 days away. Fallback only covers core + Learn validation after Semaphore QA parity is accepted. Full Gym, Bar, Bookings and database-backed QA-Intel acceptance remain separate and cannot be inferred from this run.

## Cloudflare Worker variables (not yet enabled)
- `CI_AUTO_ROUTING_ENABLED=true`: turns on the read-only route preview and approved auto triggers. Default absent = disabled.
- `CI_CIRCLECI_EXHAUSTED_UNTIL=2026-11-30T23:59:59Z` (example only): operator-set marker only after checking CircleCI Plan → Plan Usage and confirming credits exhausted; expires automatically. Must be UTC and not more than 32 days ahead.
- `CI_SEMAPHORE_FALLBACK_ENABLED=true`: only after verification of PR #96 on the same validation requirements, and after Semaphore's `development` branch is allowed. Default absent = disabled.
- Keep `CIRCLE_TOKEN`, `QUEUE`, `SEMAPHORE_PROJECT_ID` and `SEMAPHORE_TOKEN` existing names/types. Never store credential values in KV or PR comments.

## Safe private Queue command
```json
{
  "v":1,
  "id":"<new UUID>",
  "action":"route",
  "project":"amaraii-os",
  "provider":"auto",
  "branch":"development",
  "mode":"validation",
  "commitSha":"<current approved full 40-character SHA>",
  "requestedAt":"<fresh UTC ISO>",
  "approved":true
}
```
After verifying the read-only result, a new UUID with `action:"trigger"` creates **one** provider pipeline. Do not retry ambiguous 5xx/timeout/4xx or failed tests. Use read-only provider `inspect` and verify exact revision, test scope, required gate results and artifacts before accepting.

When auto chooses CircleCI, its current GitHub App branch trigger is **not SHA pinned**. The returned `requestedRevision` is an intent, not evidence: `revisionVerificationRequired:true` and the actual pipeline's inspected `vcs.revision` must match before any acceptance. When auto chooses Semaphore, its API call pins `commit_sha` in the request.

## Acceptance gates
- [ ] PR #96 Semaphore Learn, Chromium, and ActionEngine validation passes.
- [ ] Native Node 24 bridge regression suite passes with these changes.
- [ ] Code-review approved; no production application deployment or DB mutation.
- [ ] Operator verifies exhaustion status and enables signals only when needed.
- [ ] Stage Cloudflare Worker version with strict binding inheritance, reconcile live source, then approve activation.
- [ ] Private read-only `route` test for normal and exhausted signals.
- [ ] One exact-head pilot trigger and inspection, without duplicate paid runs.
