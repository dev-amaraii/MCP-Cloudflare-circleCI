# NEN private on-demand CircleCI bridge

The existing `nen-ci-bridge` accepts authenticated Cloudflare Queue messages, invokes allowlisted CircleCI operations, and stores results in private KV. It has no scheduled polling or public command/download endpoint.

```text
Agent → authenticated Cloudflare Queue messages API
      → existing private Worker → CircleCI
      → private KV result → agent reads diagnostics or QA screenshot
```

The owner approved on-demand test/artifact use and removal of the five-minute timer on 24 October 2026. The Queue replaces scheduled KV mailbox pickup; `QUEUE` remains the name of the existing KV binding. Ordinary validation cannot deploy. Jayson preview release keeps its separate explicit approval, exact commit, QA and restricted-secret gates.

Read [OPERATIONS.md](OPERATIONS.md) for the agent protocol, [AGENTS.md](AGENTS.md) for safeguards, and [DEPLOYMENT-20261024.md](DEPLOYMENT-20261024.md) for verified release evidence. Root OAuth/MCP code is a separate historical experiment.

Run the mocked local contract suite with `node --test tests/*.test.mjs`. It never starts paid CircleCI jobs. Deployment uses the authenticated Cloudflare version/deployment API, preserving existing encrypted bindings. Inspect active version, schedules, consumer and binding metadata after any change.
