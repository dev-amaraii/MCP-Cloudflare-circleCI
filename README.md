# NEN CircleCI MCP (Cloudflare Workers)

> **Current CI direction — 24 October 2026:** the owner requested the existing private bridge be operational for on-demand tests and QA screenshot inspection, with five-minute polling removed. Use [bridge/OPERATIONS.md](bridge/OPERATIONS.md), [bridge/AGENTS.md](bridge/AGENTS.md), and [release evidence](bridge/DEPLOYMENT-20261024.md). Commands arrive through authenticated Cloudflare Queues, results stay in existing private KV, and no public command/download endpoint is exposed. Native GitHub `run-ci` validation remains available. Jayson release retains separate exact-SHA approval and QA gates.

> **Repo layout:** the active execution Worker is `bridge/` (`nen-ci-bridge`). The root OAuth/MCP scaffold described below is a separate historical experiment.

---

Reusable, private NEN CircleCI integration. **Scaffold only: not deployed or connected to ChatGPT yet.**

## Historical experimental OAuth/MCP scaffold: security-first deployment notes (not the active CI path)

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
