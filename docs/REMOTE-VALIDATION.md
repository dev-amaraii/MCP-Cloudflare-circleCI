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
- **Lockfile regeneration REQUIRED:** The reviewed v3 lockfile from commit `052a61c9` still records MCP SDK `1.32.1` at the root and `1.29.0` nested under `agents`. Pipeline #33 reached `npm run check` and failed with three TypeScript errors, including incompatible MCP SDK private-type declarations. The branch now pins SDK `1.29.0` but its committed lockfile is **stale**. Do not run `run_validation=true` until a new reviewed lockfile artifact has been committed.
- Config YAML was parsed locally and manual-guard defaults were inspected.
  This is **not** a CircleCI config compile, pipeline execution or full test pass.
- The user completed the first bootstrap and manually ran CircleCI **validation #33**, which failed at `npm run check`: missing `node:buffer` typings, WebCrypto `BufferSource` type mismatch, and two separately installed MCP SDK versions. Source fixes and a manual lockfile-refresh job are staged; these fixes remain unverified by full CircleCI.

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

## 2. Generate or refresh the npm lockfile (NEXT — required after SDK pin)

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

**Refresh required:** The old artifact was reviewed and committed, but `package.json` has since pinned `@modelcontextprotocol/sdk` to `1.29.0`. A new manual `bootstrap_lockfile=true` run regenerates the lockfile from scratch in an ephemeral CircleCI container and **rejects duplicate MCP SDK installs**. Upload its updated artifact so it can be reviewed and committed. Do not hand-edit dependency resolution or bypass peer checks.

## 3. Run full validation — AFTER refreshed lockfile is reviewed and committed

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
