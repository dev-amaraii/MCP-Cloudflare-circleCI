# Isolated staging readiness — NEN CircleCI MCP

**Status: PREPARED IN GIT; CLOUD RESOURCES NOT CREATED OR DEPLOYED.** This is an approval-gated plan, not permission to deploy. The existing Worker, Access applications, OAuth KV, traffic, secrets, and GitHub main branch must remain unchanged.

## 1. Proven baseline (2026-10-19)

- Source: `dev-amaraii/MCP-Cloudflare-circleCI`, draft PR #2 on `fix/oauth-claims-hardening`.
- Last **code** SHA validated: `fb1b6dc1bdaf70d1a7ae22079b409261fc3b3cb0`. [CircleCI validation #37](https://app.circleci.com/pipelines/circleci/B65DMdC1ZhAJQM74t7SrZ1/4QT9iy1PpGnXx8VQDfdzLm/37/workflows/ce031928-1a35-4709-87b1-42f54fa47cd8/jobs/8) passed locked `npm ci`, full TypeScript, all committed Node tests, and Wrangler `deploy --dry-run` in 31 seconds. GitHub commit status independently reports `ci/circleci: validate = success`. This does **not** mean deployed OAuth is working.
- Cloudflare account read-only inventory: Worker `nen-circleci-mcp` still deployed as `dcaea5a5-c331-4d0b-9ba5-b00b8754d8ff` (2026-10-19 09:20 UTC). There is no Worker with an MCP staging name in the Worker listing.
- Existing live Worker bindings include `CIRCLE_TOKEN`, Access OAuth configuration and `COOKIE_ENCRYPTION_KEY`; **no `OAUTH_KV`, `MCP_OBJECT`, or `OAUTH_REPLAY_GUARD` binding** in the live Worker settings. Binding names/types were inspected; sensitive values were not read.
- Existing OAuth KV namespace: `nen-circleci-mcp-oauth`, ID `b27a78e5d8a8447ea233f0e7c92459d4`. It is **not for staging**. No existing MCP Durable Object namespaces were returned by the read-only Cloudflare namespace listing.
- Existing Access applications: `NEN CircleCI MCP` (self-hosted) and `NEN CircleCI MCP OAuth` (SaaS OIDC). They are for the existing service, **not automatically suitable for staging**. Earlier read-only policy check found only the designated NEN administrator allowed, with no broad Allow/Bypass rule.
- The repository's `wrangler.toml` still targets the **live Worker** `nen-circleci-mcp` and references the existing production OAuth KV. **Never use it as the staging deployment config.**
- Cloudflare's Workers OAuth source uses `/mcp`, `/register`, `/token`, `/authorize`, and `/callback`; four MCP tools are intentionally **read-only**. No pipeline trigger tool exists.

## 2. Staging-only config template

Use [`wrangler.staging.example.toml`](../wrangler.staging.example.toml). It deliberately contains:
- Worker name **`nen-circleci-mcp-staging`** rather than live `nen-circleci-mcp`.
- **`workers_dev = false`**, no routes and no custom domain, so the initial staging config does not publish a reachable endpoint.
- An **invalid placeholder** for a *new* OAuth KV namespace ID, making an accidental unconfigured deployment fail rather than reuse production state.
- Staging-local Durable Object bindings `MCP_OBJECT` / `OAUTH_REPLAY_GUARD`, with **SQLite** migrations v1/v2 for the two classes, matching the tested source configuration.
- Non-secret CircleCI identifiers for **this MCP project**, not the separate Jayson storefront pipeline.

After a separate staging-resource approval, copy the template to `wrangler.staging.toml` and fill with *new* staging IDs. That real file is gitignored and must never be committed. Any deployment command must explicitly include `--config wrangler.staging.toml`; a plain `wrangler deploy` would target the live Worker and is prohibited in this workflow. No automated CircleCI publish workflow should be created.

**Important:** `wrangler.staging.example.toml` is a draft template, **not a proven Wrangler-valid production config**. Only the original default Wrangler config was included in passing CI #37. Review/validate a filled, secret-free staging config before its first approved upload.

## 3. Isolation and secret provisioning requirements

| Scope | Staging requirement | Must not do |
|---|---|---|
| Worker | New script `nen-circleci-mcp-staging` | Overwrite `nen-circleci-mcp` or add staging aliases to it |
| OAuth KV | New `nen-circleci-mcp-staging-oauth` namespace ID | Bind existing `b27a78e5d8a8447ea233f0e7c92459d4` |
| Durable Objects | New, script-local SQLite `CircleMCP` and `OAuthReplayGuard` namespaces, v1/v2 first-deploy migration checked | Reuse/transfer live namespaces or modify live migration history |
| Access to staging Worker | Separate Worker-specific self-hosted Access application, single authorized NEN test identity, deny by default | Open endpoint before Access protection or broadly bypass `/mcp` |
| Access SaaS/OIDC | Separate **staging OIDC application/client** whose redirect URI is exactly the eventual staging `/callback` URL | Reuse a production client/redirect and defeat strict issuer/audience validation |
| Secrets | **Stage-only** `CIRCLE_TOKEN`, `COOKIE_ENCRYPTION_KEY`, `ACCESS_CLIENT_ID`, `ACCESS_CLIENT_SECRET`, `ACCESS_AUTHORIZATION_URL`, `ACCESS_TOKEN_URL`, `ACCESS_JWKS_URL`; values provisioned into the staging Worker through an approved secret path | Read, print, copy or commit values of live Worker secrets |
| Plain settings | Verified stage-specific `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `MCP_PUBLIC_URL` if needed by the provider; correct MCP `CIRCLE_PROJECT_SLUG` / `CIRCLE_DEFINITION_ID` | Mistake the Jayson CI project for this MCP project |
| CircleCI | Exercise **read-only** pipeline, workflow and job metadata for a known NEN MCP run; negative tests for other project IDs | Add pipeline trigger or run chargeable test pipelines through MCP |

The source currently gates identity to the specific approved NEN administrative email. Staging should test that authorized identity and rejection of all others; changing identity or expanding permissions requires a separate review.

**Token scoping caveat:** CircleCI token privileges may exceed the code's four read-only methods. Use a dedicated staging token where feasible and inspect its account permissions; the Worker code must remain read-only independently of API-token permissions. Do not return raw logs or temporary artifact links to untrusted clients.

## 4. Approval-gated activation order

**Gate A — This PR's preparation (permitted, no cloud writes):** Review the staging template, source/binding inventory and this plan. Ensure no secrets, live KV IDs or production deployment commands leak into staging instructions. Do not create cloud resources.

**Gate B — Authorize cloud resource creation:** Create an independent OAuth KV namespace and a distinct staging Worker identity. The first staging deployment, if approved, uses `workers_dev=false` and no routes. Confirm that v1/v2 SQLite classes and their bindings initialize, and that the live Worker deployment ID, settings and traffic remain unchanged. Staging provisioning/deployment can incur Cloudflare usage and must be separately authorized.

**Gate C — Authorize Access/OIDC configuration:** Set up the staging-only Access application for the Worker, its restricted identity policy, and a separate staging SaaS OIDC client with the exact final callback URL. Check that the Access policy really applies to the stage Worker and preview URLs. Provision stage-only secrets and required plain settings without exposing values in GitHub, logs or chat. Only after policy verification may a public `workers.dev` endpoint or protected route be enabled with a separate authorization.

**Gate D — Execute staging integration tests:** Before an OAuth round trip, verify unauthorized requests to `/mcp` fail closed. Verify OAuth discovery routes and dynamic registration (`/.well-known/*`, `/register`) as well as `/authorize`, `/callback`, `/token`; **self-hosted Access must not break protocol discovery/PKCE**. Do not add a blanket Access Bypass to make tests pass. Confirm SaaS ID token full path-scoped issuer, audience, signature, key ID and allowed identity. Test first-time consent, already-approved consent, `__Host-CSRF_TOKEN` expiration, bound `__Host-OAUTH_STATE` cookie, PKCE verifier and missing-cookie rejection. Test simultaneous state claims/replay and Durable Object persistence with actual workerd SQLite. Check transient KV failure / DO failure fail closed and avoid raw token logging.

**Gate E — Verify real MCP client:** Connect authorized ChatGPT MCP client to **staging only**; verify OAuth registration, login/callback, `tools/list`, each of four project-scoped CircleCI reads (pipeline/workflow/jobs/job details), foreign-project rejection, zero mutating tools and zero billable pipeline triggers. Inspect logs only after sensitive data redaction. Keep staging credentials distinct.

**Gate F — Production decision (not authorized):** Review staging results, readiness checklist, compatibility with existing Access routes, rollback and service impacts; obtain explicit approval before any GitHub merge or live deployment. Existing production script must remain intact until then.

## 5. Known integration risks and questions to resolve

1. **Access interception versus OAuth protocol:** Worker-level Access authentication may intercept `/.well-known`, `/register`, and authorization redirects that an unauthenticated MCP client needs. Validate actual behavior; decide any route-specific auth exception only with explicit security review. Hostname-based Access matches only that hostname/path; Worker-target Access can cover an entire Worker. Cloudflare documents both models.
2. **Exact callback and issuer:** A staging SaaS OAuth app is required because strict OIDC issuer/client/audience validation must match the staging client, and callbacks must match the staging Worker URL. Do not point it at the existing Worker.
3. **DO migrations:** First deployment of the new script must create new SQLite-backed `CircleMCP` and `OAuthReplayGuard` namespaces. No live DO namespaces are available to recycle. Use v1/v2 existing migration scheme for the staging experiment; do not silently switch legacy migration semantics.
4. **Exposure gap:** `workers_dev=false` ensures this template creates no public workers.dev endpoint. Activation requires a protected public URL; create/verify Access protection before setting `workers_dev=true` or adding routes, avoiding the interval where the service is public.
5. **No staging runtime proof yet:** CircleCI #37 passed tests and a default-config Wrangler dry-run, not staging Worker deployment, Access protection or actual client connection. A successful CI run must not be treated as authorization for Cloudflare writes.

## References

- [Cloudflare Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/)
- [Cloudflare Wrangler configuration / Durable Object migrations](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [Cloudflare Access application models](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/choose-application-type/)
- [Cloudflare staging source](../wrangler.staging.example.toml)
- [NEN source-level release checklist](SECURITY-RELEASE-GATES.md)
