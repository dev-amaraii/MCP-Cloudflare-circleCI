# Managed OAuth continuation — 2026-10-19

## Changes and authorization

Work continues in `/Users/maac/Mine/development/nen/mcp/MCP-Cloudflare-circleCI` on the existing PR branch. Its untracked `.DS_Store` is preserved. The owner requested clearing blockers for both Codex and ChatGPT, using this repository as the first GitHub Actions replacement.

The owner explicitly approved enabling Managed OAuth on **NEN CircleCI MCP**, localhost/loopback dynamic registration plus the two documented ChatGPT callback patterns, 15-minute tokens and 24-hour sessions. The Cloudflare API write/readback succeeded and confirmed that the existing email-only allow policy and Worker destination were unchanged.

## Verified live

- GET `/.well-known/oauth-authorization-server`: 200 JSON; issuer is the Access team and authorization/token/registration endpoints are Access-managed.
- GET `/.well-known/oauth-protected-resource`: 200 JSON.
- Anonymous GET `/mcp`: 401 with Bearer challenge and Access resource metadata, replacing the former 302 HTML login redirect.
- Dynamic registration for a localhost callback: 201.
- Dynamic registration for the approved stable ChatGPT callback: 201.
- Dynamic registration for an unapproved external callback: 400 `invalid_client_metadata`.

Registration creates client metadata, not an authenticated grant. No owner bearer token was obtained by these checks. No allowlist bypass or service-token identity substitution was used.

## Verified locally

- `npm ci`: passes with zero reported dependency vulnerabilities.
- `npm run check`: passes.
- `npm test`: 35 pass, 0 fail. The new tests verify signed Access assertions, rejection cases and actual Streamable HTTP MCP initialize/list/call requests. CircleCI data is mocked.
- `wrangler deploy --dry-run`: passes; stateless Worker uses no KV or Durable Object bindings. Preview URLs are disabled in source configuration.
- Official CircleCI CLI 1.7.0: `.circleci/config.yml` is valid.
- CI's Node spec/JUnit command: passes; output XML parses.
- `git diff --check`: passes.

The active source uses SDK Web Standard Streamable HTTP directly and verifies RS256 assertions with `jose`. The Agents dependency and its override were removed because no stateful Agent is needed. Historical SaaS OIDC helpers/tests remain, but the active origin routes only `/mcp` and does not execute a second OAuth provider. Existing remote OAuth KV and SaaS resources are retained.

## Pending interactive access and deployment

Local Wrangler authentication was expired. A normal Worker-scoped OAuth refresh was opened for the owner. No deployment may be claimed until authentication and a manual deployment succeed. The first deployment login refresh timed out; a replacement flow was opened for the owner. The old deployed Worker version is `957d1b68-32ee-4757-ba9b-daaf78a94229`.

Codex connection `nen-circleci` was added to the existing global configuration. Its real OAuth authorization-code/PKCE flow completed successfully (`Successfully logged in` from the CLI). This proves client registration and owner OAuth sign-in, not deployed origin initialization: the Worker deployment is still pending. ChatGPT connection, deployed MCP tool calls and live CircleCI API access remain pending.

The configured project uses a `circleci/...` identifier. Its mapping to this GitHub repo is not yet verified. CircleCI's browser view requires login. The current v1.1 log implementation accepts only gh/bb projects; this limitation remains a release acceptance item, rather than being hidden behind a passing mock test.

## CircleCI replacement

Added one small Docker verification job for this repo, using Node 24, npm download caching keyed to the lockfile, clean install, type check, Node tests/JUnit and Worker dry run. No CircleCI deployment secret or pipeline mutation tool was added. GitHub Actions were not added.

A successful local command or CLI config validation is not a hosted build. Confirm repository/project mapping, pipeline definition/config path and GitHub trigger, then record the hosted pipeline/workflow/job URL and commit. Production deployment remains manual.

NEN Context OS was used in the preceding continuation. No Context OS write is claimed by this continuation.
