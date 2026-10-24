# NEN remote CI bridge — agents start here

Owner: **NEN International only**. Read [NEN Context OS](https://app.notion.com/p/3fffa5e3c90581ceab86f62e1b1fb5a5) and [bridge/OPERATIONS.md](bridge/OPERATIONS.md). Do not copy this context to Personal Context OS.

## Accepted direction — 24 October 2026

The owner requested that the existing bridge let agents retrieve QA artifacts and run tests on demand, and explicitly removed five-minute polling. This supersedes the 22 October restriction against a Queue for this bridge. Commands now arrive through the authenticated Cloudflare Queues API; results remain in the existing private KV. There is no public Worker command/download endpoint or scheduled consumer.

- Use [bridge/OPERATIONS.md](bridge/OPERATIONS.md) for the exact request protocol and deployed evidence. Writing a KV `requests/` key alone no longer invokes the Worker.
- Agents may request on-demand QA within the user's requested work. Verify the current branch/HEAD and existing CI evidence first; avoid duplicate paid runs. No automatic push/PR/timer triggers or unattended status polling.
- Native GitHub `run-ci` label-added validation remains available for AmaraiiOS feature PRs. The bridge's trigger branches are separately allowlisted; do not broaden them or infer that the feature PR is covered by an older green SHA.
- Jayson preview release still needs separate explicit approval, its exact 40-character SHA, QA gates and restricted deployment credentials. Ordinary validation cannot deploy. AmaraiiOS release remains denied.
- Credentials stay in encrypted Worker/CircleCI secrets. Never print, export, replace or put them in code, chat, KV or Context OS. Preserve secret/KV bindings during version upload.
- The root OAuth/MCP scaffold (`nen-circleci-mcp`) is a separate historical experiment. Modify only `bridge/` for the active `nen-ci-bridge`.
- For bridge changes run `cd bridge && node --test tests/*.test.mjs`. Inspect active Worker/version, bindings, queue consumer, schedules and private URL settings after deployment. Source commits and uploaded inactive versions are not live proof.
- Record verified outcomes in NEN Context OS and [issue #4](https://github.com/dev-amaraii/MCP-Cloudflare-circleCI/issues/4). Validation, UI screenshots and source checks do not establish hosted UAT, migrations, payment readiness or deployment acceptance.
