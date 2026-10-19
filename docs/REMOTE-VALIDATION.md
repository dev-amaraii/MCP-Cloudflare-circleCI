# Remote, on-demand validation — without ChatGPT Work or a Mac

**Scope:** NEN CircleCI MCP, draft PR #2 on `fix/oauth-claims-hardening`.
This is a validation-only workflow. It must not deploy Cloudflare Workers,
change Cloudflare Access settings, or trigger CircleCI automatically.

## Current state

- `.circleci/config.yml` is committed to the security branch.
- Two explicit boolean pipeline parameters default to **false**:
  `bootstrap_lockfile` and `run_validation`.
- Both workflow jobs use the Node 24.13 CircleCI image, with no CircleCI
  contexts, Cloudflare credentials, GitHub write token, or CircleCI token.
- **Lockfile regeneration COMPLETED:** CircleCI bootstrap pipeline **#34** succeeded on `fix/oauth-claims-hardening`, checking the aligned SDK version and uploading an artifact. The user supplied this lockfile, which passed manifest, single-SDK and registry/integrity metadata checks; the new `package-lock.json` was committed at `fe9cbb97ade30c42025b57b26999dbf3a7d1dfeb` (blob `483b7c0f8a0f4f14ffc212c3935741210fc83224`). Next run is manual full validation, **not** another bootstrap.
- The committed config has now been executed repeatedly in CircleCI, including the **fully passing manual validation #37** on commit `fb1b6dc1`. The Boolean guards still default false and the GitHub event trigger remains disabled.
- **VALIDATION PASSED:** [CircleCI #37](https://app.circleci.com/pipelines/circleci/B65DMdC1ZhAJQM74t7SrZ1/4QT9iy1PpGnXx8VQDfdzLm/37/workflows/ce031928-1a35-4709-87b1-42f54fa47cd8/jobs/8), `fix/oauth-claims-hardening` at commit `fb1b6dc1`, took 31 seconds. The checkout, lockfile check, `npm ci`, full `npm run check`, all tests and Wrangler `deploy --dry-run` were all green. GitHub commit status independently reports `ci/circleci: validate` **success** for the same commit. No production deploy.

## 1. One-time CircleCI project setup (requires CircleCI web UI)

Open [CircleCI Projects](https://app.circleci.com/projects) in the NEN
GitHub App-backed organization (the one already running the Jayson storefront).

1. Find **dev-amaraii/MCP-Cloudflare-circleCI**. If it is not a project yet,
   create the project using the **existing** repository file
   `.circleci/config.yml`. Set both config source and checkout source to
   `dev-amaraii/MCP-Cloudflare-circleCI` on branch
   `fix/oauth-claims-hardening`. Choose **Finish setup**, not a
   "commit config and run" action.
2. **Important:** GitHub App project creation can create an **all-push
   trigger by default**. In Project Settings → Project Setup, remove or
   disable any GitHub push, PR, schedule or custom-webhook triggers. No
   automatic triggers should be attached. The parameter defaults also
   prevent jobs if a pipeline is accidentally instantiated without
   explicit values, but they do not prevent such a pipeline event.
3. Confirm that CircleCI shows the project/pipeline definition.
   Record the actual project slug and definition ID in NEN Context OS;
   **never copy the Jayson storefront's CircleCI project IDs**.
4. Do not configure Cloudflare tokens or production secrets in this project.

Official references:
- https://circleci.com/docs/guides/getting-started/create-project/
- https://circleci.com/docs/guides/orchestrate/set-up-triggers/
- https://circleci.com/docs/guides/orchestrate/triggers-overview/

## 2. Generate or refresh the npm lockfile (COMPLETED in pipeline #34)

**Requires a separately approved CircleCI execution.** In the CircleCI web
app select the MCP project → **Trigger Pipeline** and use:

- Config source branch: `fix/oauth-claims-hardening`
- Checkout source branch: `fix/oauth-claims-hardening`
- Parameter `bootstrap_lockfile` (boolean): `true`
- Parameter `run_validation` (boolean): `false`

The `export_lockfile` job executes only
`npm install --package-lock-only --ignore-scripts --no-audit --no-fund`
in an ephemeral CircleCI container and exports **package-lock.json**
as a CircleCI artifact. No dependency scripts and no deploy are run.

**Refresh completed:** The artifact produced by CircleCI pipeline #34 was reviewed and committed. The new npm lockfile v3 contains 290 package records, a single root MCP SDK `1.29.0`, and 289 resolved registry packages with SHA-512 integrity metadata. GitHub readback confirms blob SHA `483b7c0f8a0f4f14ffc212c3935741210fc83224`. Do not rerun bootstrap unless dependencies change.

## 3. Run full validation on demand (COMPLETED in pipeline #37)

Again, **requires a separately approved CircleCI execution**.
Trigger Pipeline with the same two branches and:

- `bootstrap_lockfile = false`
- `run_validation = true`

The `validate` job runs, in order:

```sh
npm ci --no-audit --no-fund
npm run check
npm test
npx --no-install wrangler deploy --dry-run
```

This checks locked dependency installation, full TypeScript compilation,
all five committed test suites and Wrangler bundling **without deployment**.
Keep `run_validation` false except for a manually requested job.
Pass results and redacted logs back through CircleCI UI (or an approved,
read-only connector) to fix errors via the GitHub direct connector.

CircleCI’s manual trigger uses the existing API endpoint
`POST /api/v2/project/{circleci-project-slug}/pipeline/run` with
the project-specific `definition_id`, config/checkout branch references
and explicit parameters, after the MCP project has been set up.
The existing Jayson definition ID is **not** valid for this repository.

## Security gates after passing CircleCI

**Full repository CI passed at `fb1b6dc1`. Documentation-only follow-ups may add later commits without another CI run, since automatic triggers are intentionally disabled. Do not conflate a green historic code commit with a newer untested code change.**

Running the above proves only the repository's build and unit-test health.
It does **not** verify production OAuth, Cloudflare Access routing,
Durable Object migrations under workerd or ChatGPT MCP connectivity.
Stage these separately, obtain deployment authorization and verify that
read-only tools work before adding any mutating CircleCI trigger.
Keep production Worker `nen-circleci-mcp` unchanged in the meantime.

## Work/Codex usage-limit fallback

When Work quota is exhausted, the NEN GitHub connector can still commit
configuration/test fixes from normal ChatGPT conversations. CircleCI does
the npm/network work; CircleCI's own web UI supplies the initial one-time
project connection and explicit on-demand execution. This deliberately
avoids a dependency on the Mac or a Work-mode cloud computer.
