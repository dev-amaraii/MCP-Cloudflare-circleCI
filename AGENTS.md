# Agent start here — NEN remote CI / CircleCI repository

**Ownership:** NEN International only. Read the [NEN Context OS — Remote CI/CD Standard](https://app.notion.com/p/3fffa5e3c90581ceab86f62e1b1fb5a5) for the latest accepted decisions and verified operational state. See [issue #4](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/issues/4) for capability-gap tracking. Do not sync or copy this context to Personal Context OS.

## Accepted decision: GitHub first (22 October 2026)

- **Default for AmaraiiOS tests:** use native connected GitHub tools and the CircleCI GitHub App's `run-ci` **label-added PR trigger**, then inspect the `ci/circleci: validate` status and CircleCI job URL **for the exact current PR head SHA**.
- Before spending CircleCI credits, verify whether the current SHA already has a relevant completed CI result; do not treat a green check on an earlier SHA as proof. A new `run-ci` label-added event (remove then re-add an existing label) must be intentional, never a timer, push-trigger or automatic retry.
- **Do not implement** a new Cloudflare API, Queue, KV cache, background poller, general-purpose MCP gateway or proxy as a prerequisite. Prove a specific capability missing from GitHub and implement only the smallest approved fix. Full CircleCI step diagnostics are not provided by the GitHub commit-status connector; use the job link first.
- CI validation is not permission to deploy, migrate data, switch billing on, or bypass hosted QA and UAT.
- **Jayson Storefront preview release is separate:** it requires explicit approval, exact `release_sha`, QA-gated promotion and restricted deployment credentials. The AmaraiiOS `run-ci` label is not a release control.

## Repository and deployment identities: do not confuse them

- This repository's **root `src/`, `wrangler.toml`, OAuth/MCP docs** are the earlier experimental `nen-circleci-mcp` design; status/deployment must be independently verified. Do not treat the root scaffold as the active CI execution bridge.
- Private **`nen-ci-bridge`** source, tests and operator runbook are on branch [`feat/nen-ci-kv-bridge`](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/tree/feat/nen-ci-kv-bridge/bridge); matching 5-minute Cron source config and updated docs are in [draft PR #3](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/pull/3) (`codex/reduce-ci-kv-idle-polling-20261021`). Read [bridge/AGENTS.md](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/blob/codex/reduce-ci-kv-idle-polling-20261021/bridge/AGENTS.md) and [bridge/OPERATIONS.md](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/blob/codex/reduce-ci-kv-idle-polling-20261021/bridge/OPERATIONS.md) before touching that Worker.
- **Last verified live on 22 October 2026:** `nen-ci-bridge` version `332c29dd-5363-4626-a18f-fb0575ae32da`, private KV+Cron, scheduled `*/5 * * * *` after a schedule-only change from one-minute polling (theoretical 288 idle KV list calls/day). `CIRCLE_TOKEN` is a `secret_text` binding and `QUEUE` is a `kv_namespace` binding. This is **temporary**; it is not a zero-polling deployment.
- **Do not disable the live Cron, delete KV, redeploy an unverified source mirror or expand authorization** until all consumers — especially the Jayson QA-gated release — have a tested, approved replacement. A GitHub branch/config is not proof of the active Cloudflare version or schedule.

## Working rules for any agent

1. Fetch current NEN Context OS and GitHub branch/PR HEAD. Categorize facts, accepted decisions, proposals and unverified claims separately.
2. Prefer GitHub-native on-demand tests; check commit statuses per SHA. Never trigger paid workflows without an explicit purpose/approval.
3. For missing functions, document concrete blocked agent operation and cheapest solution before writing runtime code.
4. Keep credentials in secret stores. Never read, export, commit, print or rotate the CircleCI token or Cloudflare deploy token; never expose an unauthenticated mutating HTTP endpoint or generic release label.
5. Keep changes reviewable. Run relevant tests before claiming passing code. Do not deploy infrastructure or adjust production/billing from documentation-only tasks.
6. Update NEN Context OS and issue #4 only with verified changes and clearly marked remaining gaps.

**Scope note:** These instructions describe the NEN bridge project as of 22 October 2026. Re-verify live configuration for later operations; historical CI successes are not current-SHA proof.
