# Agent instructions — NEN private CircleCI bridge

**Owner:** NEN International. **Source of truth:** [NEN Remote CI/CD Standard (Context OS)](https://app.notion.com/p/3fffa5e3c90581ceab86f62e1b1fb5a5). See [issue #4](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/issues/4) for the accepted GitHub-first policy and remaining gaps, and [OPERATIONS.md](OPERATIONS.md) for legacy bridge operation. Do not cross into Personal Context OS.

## Accepted decision (22 October 2026): native GitHub first

- For agent-driven **AmaraiiOS development validation**, use the existing GitHub integration and CircleCI GitHub App `run-ci` label-added trigger. This was verified end-to-end on [Games PR #8](https://github.com/dev-amaraii/amaraii-os/pull/8), exact commit `adf2480ee9867acbc1f903a42a7c395cc872715f`, with `ci/circleci: validate` success. The successful SHA is historical evidence, not a guarantee for a new revision.
- Before acting, read the PR's **current head SHA** and check its exact GitHub commit CI status. If a new run is genuinely needed, request the `run-ci` **label-added event** once through the connected GitHub tools (if already present, remove and re-add it only for a separately requested run). Verify the status on the *same head SHA*. Open the CircleCI workflow/job link for details. Do not create an automatic push trigger or a repeated status poller.
- The GitHub status provides CircleCI result and link, not complete CircleCI-native step logs through currently connected GitHub tools. Use the linked job page first. Add a narrowly scoped read-only diagnostic connector only for a demonstrated blocker.
- **Do not build** a replacement gateway, Worker HTTP API, KV cache, Cloudflare Queue, cron scheduler or generalized MCP server by default. Identify missing native capabilities and build only the minimum safe piece if needed. Cloudflare Queues and a new API are previously considered **superseded proposals**, not approved implementations.
- Never infer that code validation proves hosted integration tests, migrations, QA/UAT, payment readiness, or deployment.

## The separate private bridge still exists (legacy fallback)

- `nen-ci-bridge` is a private KV + Cron Worker **distinct from** the experimental `nen-circleci-mcp` OAuth server on the repository root. Its `fetch()` returns HTTP 404; there is no public `/trigger`.
- **Verified live on 22 Oct 2026:** active Worker version `332c29dd-5363-4626-a18f-fb0575ae32da`; binding names/types `CIRCLE_TOKEN: secret_text` and `QUEUE: kv_namespace`; Cron `*/5 * * * *`, changed from `* * * * *` by an authenticated Cloudflare schedule-only API update. This is a **temporary** 80%-lower idle polling mitigation, roughly 288 KV list calls/day when idle, not zero usage. Verify live schedules/version anew before operational actions.
- [Draft PR #3](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/pull/3) contains the matching `bridge/wrangler.toml` and these documentation changes. Source/config on this branch is **not** proof of deployment, and this PR is not merged. Never redeploy a stale source mirror just to reconcile Cron.
- The legacy bridge still carries **Jayson Storefront's** explicitly approved, exact-SHA, QA-gated preview release path. Native AmaraiiOS `run-ci` **does not replace release authorization**. Do **not disable Cron or delete KV** until every remaining legacy consumer (including Jayson) has a tested, approved on-demand alternative.
- In the deployed bridge source, `amaraii-os` is allowed only for validation on its hardcoded pilot/development/staging branches; release is **denied**. `jayson-storefront` has its own restricted `feat/storefront-demo` QA/release path. The feature branch used for native GitHub CI may have more permissive branch rules; **do not assume the old bridge allowlist matches it**.

## Security and execution

- Never expose, print, replace or copy `CIRCLE_TOKEN` or any deployment credential. Do not write secrets to GitHub, Notion, chat, CircleCI output, KV values or logs. If handling Worker versions, preserve and verify `secret_text` and `kv_namespace` bindings before any expressly approved deploy.
- Do not add a public HTTP command endpoint, arbitrary URLs, command execution, unrestricted parameters, unreviewed release labels, or automatic CircleCI triggers.
- For *explicitly authorized legacy KV operations only*, follow [OPERATIONS.md](OPERATIONS.md). A command's `approved:true` field **is not authorization**; Cloudflare identity/permissions are. KV claim markers are best-effort, not atomic exactly-once. Reconcile ambiguous paid triggers read-only; never retry blindly.
- Keep production release/billing settings unchanged. Do not trigger paid CI or deploy anything merely to test documentation.
- For code/config changes run the bridge's committed `node --test tests/*.test.mjs` checks in a suitable environment and verify the exact source/commit. Never claim tests passed without actual evidence.
- Record accepted decisions separately from proposals and live verification in NEN Context OS; report remaining blockers. This document is instructions for agents on the working branch, **not proof** the default `main` branch or Cloudflare deployment has been updated.
