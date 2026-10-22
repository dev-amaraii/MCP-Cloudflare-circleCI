# NEN CircleCI MCP (Cloudflare Workers)

> **NEN CI operating decision — 22 October 2026 (approved):** For agent-driven AmaraiiOS tests, use the **native connected GitHub integration**: an explicitly requested `run-ci` PR-label-added event invokes CircleCI, then read the `ci/circleci: validate` check for the **exact current head SHA** and follow its CircleCI job URL only when needed. **No new API, Queue, background polling, or KV cache by default.** Build only proven missing capabilities. Details: [root AGENTS.md](AGENTS.md), [NEN Context OS](https://app.notion.com/p/3fffa5e3c90581ceab86f62e1b1fb5a5), [gap-tracking issue #4](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/issues/4).

> **Repo layout:** This README describes the **experimental root OAuth/MCP scaffold**, not the active execution Worker. The deployed private `nen-ci-bridge` source/runbooks live on the [feature branch](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/tree/feat/nen-ci-kv-bridge/bridge) and updated [draft PR #3](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/pull/3). On 22 October, its live Cron was updated to `*/5 * * * *` without a Worker code deployment; this is a **temporary** mitigation. Existing Jayson preview releases still require the legacy bridge and their distinct exact-SHA/QA/restricted-credential safeguards. Do not disable that Cron until a safe replacement is proven.

---

Reusable, private NEN CircleCI integration. **Scaffold only: not deployed or connected to ChatGPT yet.**

## Security-first deployment

1. Create a Cloudflare Access **self-hosted application** protecting the Worker `/mcp` route; only allow trusted NEN identities. Never expose MCP tools without Access.
2. Deploy only after Access is configured. Run `pnpm install`, `pnpm check`, `pnpm test`, `pnpm deploy`.
3. In Worker Settings → Variables and Secrets, add **encrypted secrets**: `CIRCLE_TOKEN`, `CIRCLE_PROJECT_SLUG`, `CIRCLE_DEFINITION_ID`, `ACCESS_TEAM_DOMAIN` (e.g. https://team.cloudflareaccess.com), `ACCESS_AUD` (Access application audience tag). Add `CIRCLE_ALLOWED_BRANCHES` optionally.
4. Configure ChatGPT remote MCP OAuth authentication separately. **Cloudflare Access JWT verification alone does not implement MCP OAuth discovery or authorization.** Use Cloudflare's official [remote MCP + Access OAuth example](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/) to implement the OAuth client/provider handshake before attempting ChatGPT integration.
5. Test unauthorized `POST /mcp` returns 401 and authorized MCP initialize/tools/list calls work. Then test read-only tools; only trigger a pipeline after explicit approval.

## Scope
Tools: `circleci_pipeline_status`, `circleci_pipeline_workflows`, `circleci_trigger`. The trigger has branch allowlist and `confirm=true` gate. Future: job logs, project registry, audit trail, per-project authorization and rate limiting.

## Important
- The repo is public: never commit tokens, OAuth credentials or secret values.
- No GitHub Actions required. Deploy manually with Wrangler or Cloudflare Workers API.
- Current implementation is **single-project**, not multi-tenant.
- CI API endpoint is GitHub App-compatible pipeline/run with definition ID.
- Cloudflare Access app must be created before any public Worker deployment.
