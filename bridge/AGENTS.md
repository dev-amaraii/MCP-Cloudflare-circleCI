# Agent instructions — NEN private CircleCI bridge

Follow [root AGENTS.md](../AGENTS.md) and [OPERATIONS.md](OPERATIONS.md).

The owner's 24 October instruction authorizes on-demand bridge test/artifact use and removal of five-minute polling. Cloudflare Queue `nen-ci-bridge-commands` wakes the existing Worker only when an authenticated client submits a command. The existing `QUEUE` binding is still **KV**, not a Queue producer. Results/claims retain their seven-day lifetime. No new CircleCI credential or public endpoint exists.

- Submit a fresh UUID command through the Queue messages API, then read its private KV result with a bounded wait. Do not write KV `requests/` and expect execution. No scheduled polling or automatic retries.
- Account API access is authorization; `approved:true` alone is not authentication. Honor user scope and distinguish on-demand QA from separately approved releases.
- Preserve the pinned project/branch/mode registry. AmaraiiOS is validation-only. Jayson retains explicit exact-SHA, QA-gated preview release.
- Artifact previews accept only owned AmaraiiOS QA PNGs under the documented prefixes, up to 900,000 bytes. Never accept caller URLs, return signed download URLs, or expose credentials. A CI screenshot is not interactive browser QA.
- Queue consumer: batch size 1, concurrency 1, zero retries. Claims are written before external calls. KV is eventually consistent; this is best-effort duplicate suppression, **not exactly-once**. Reconcile uncertain triggers read-only before intentionally issuing a new request.
- Never expose/print/export/replace `CIRCLE_TOKEN`. Verify inherited `secret_text` and `kv_namespace` bindings on the staged version and active deployment.
- Run `node --test tests/*.test.mjs` from this folder before deployment. Preserve a known rollback version. Do not reactivate Cron merely as rollback; restore an approved on-demand version or pause the queue consumer.
- See [DEPLOYMENT-20261024.md](DEPLOYMENT-20261024.md) for actual release evidence and remaining limitations.
