# Urban Paints Semaphore support (staged)

Project: `dev-amaraii/urban-design-paint`. Provider `semaphore` only. Actions: `health`, `trigger`, `inspect`. Branch `feat/site-foundation-homepage`. Exact lowercase commit SHA mandatory, workflow `.semaphore/semaphore.yml` fixed in adapter, mode `validation` only. Project UUID comes from encrypted Cloudflare Worker binding `SEMAPHORE_PROJECT_ID_URBAN_DESIGN_PAINT`; provider credential remains `SEMAPHORE_TOKEN` secret. No deploy/promotion, arbitrary URL, logs, or artifact operations.

This branch is based on the repository default branch for review. **The deployed `nen-ci-bridge` has newer PR109/NEN/ChurchPro modules not all reflected on main. Reconcile and forward-port these narrowly scoped changes to the deployed source before any activation. Do not upload the repo's stale main bundle over the active Worker.**

Local adapter unit checks: `node --test bridge/tests/urban-paints.test.mjs`; run the full `cd bridge && node --test tests/*.test.mjs` before staging, inspect the staged bindings and queue settings, and only then activate with explicit authorization. No live Semaphore trigger has been verified by this PR.
