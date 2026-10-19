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
- **Lockfile now committed and source-verified:** `package-lock.json` was supplied after remote CircleCI bootstrap, validated against the current manifest, and committed at `052a61c9`. It has npm lockfile v3 format, 292 package records (including the root), and all 291 resolved packages have SHA-512 integrity metadata from `registry.npmjs.org`. The chat container still cannot install npm dependencies.
- Config YAML was parsed locally and manual-guard defaults were inspected.
  This is **not** a CircleCI config compile, pipeline execution or full test pass.
- The user initiated CircleCI bootstrap jobs; an earlier job failed npm resolution (ERESOLVE), and the dependency manifest was corrected before the supplied lockfile was produced. **The complete validation job has not yet run.**

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

## 2. Generate the npm lockfile on demand (completed for current manifest)

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

**Completed:** The user supplied the generated JSON as a Markdown-fenced attachment; the exact JSON was validated, unwrapped, given a canonical final newline and committed as `package-lock.json`. GitHub blob SHA `c0936d721bc011a0f18923a50af07c1b7fb69596` matches the independently computed local Git blob. Use bootstrap again only for an intentionally revised dependency set.

## 3. Run full validation — NEXT, after committed lockfile

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
