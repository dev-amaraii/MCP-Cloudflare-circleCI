# OAuth implementation and verification

## Architecture

The MCP server uses the Cloudflare Workers OAuth Provider for MCP authorization code flow, PKCE, dynamic client registration, consent, and token issuance. Cloudflare Access for SaaS is the upstream OIDC identity provider. The self-hosted Access application remains an outer access layer and retains its allow policy for `devops@amaraii.com`.

The callback accepts the ID token only after:

1. Fetching the Access application's OIDC discovery document at `https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client-id>/.well-known/openid-configuration`.
2. Confirming that discovery's issuer, authorization endpoint, token endpoint, and JWKS URI match the configured SaaS application and Worker variables.
3. Requiring the `RS256` algorithm and a matching RSA signing key from the configured JWKS endpoint.
4. Verifying the JWT signature and checking exact issuer, SaaS client ID audience, expiration, not-before, non-empty subject, and `devops@amaraii.com` email.
5. Consuming the saved, HMAC-protected OAuth state once and using the PKCE verifier for the upstream code exchange.

`ACCESS_AUD` is the self-hosted Access application's audience tag. It is not the expected OIDC audience for the SaaS application; the ID token audience is `ACCESS_CLIENT_ID`. The signed ID token's email is checked only after cryptographic verification.

The callback URI is built from `MCP_PUBLIC_URL`, not the request Host header. Keep it equal to the hostname registered in the SaaS app's redirect URI. Local HTTP is accepted only for `localhost` development.

The upstream Access bearer token is checked as part of the token response but is not retained in MCP authorization props because CircleCI calls use the separate `CIRCLE_TOKEN` binding.

## Current implementation versus verification

- **Implemented in the local working copy:** discovery and endpoint matching, RS256/JWKS token verification, claim validation, allowlisted identity check, fixed callback base URL, PKCE/state path, and read-only MCP tools.
- **Unit tested:** signed and invalid ID tokens, claim mismatches, CircleCI project ownership, job association, and log URL validation.
- **Not verified:** live OIDC discovery/JWKS response, full Access login and callback, OAuth metadata through the self-hosted Access layer, token exchange, MCP client initialization, or ChatGPT connection.
- **Not deployed:** the production Worker has not been changed.

## Cloudflare configuration to verify before deployment

1. Confirm `NEN CircleCI MCP OAuth` is the OIDC SaaS app and its exact client ID and OAuth endpoints match Worker bindings.
2. Confirm its registered callback is `https://nen-circleci-mcp.devops-948.workers.dev/callback` (or the value selected in `MCP_PUBLIC_URL`).
3. Confirm the SaaS app's Access policy allows only `devops@amaraii.com` and its intended identity provider is enabled.
4. Confirm the self-hosted Access app still has the same allowlist. Do not remove or broaden that policy.
5. Test whether the self-hosted application intercepts OAuth discovery, `/register`, `/authorize`, `/callback`, `/token`, and `/mcp`. The OAuth browser callback and MCP client discovery must complete without weakening the Access boundary.
6. Verify the `OAUTH_KV` binding and `MCP_OBJECT` Durable Object binding/migration on the selected Worker environment.

The current source uses the existing single-Worker `OAuthProvider` integration. Cloudflare's October 2026 Workers OAuth Provider 1.0 split API is a separate major-version migration and has not been performed in this change. Before upgrading, compare its migration guidance with the existing Cloudflare Access example and test it independently.

## Troubleshooting

- **Discovery mismatch:** compare the OIDC discovery document's issuer and endpoint URLs to the values from the SaaS app. Do not substitute `ACCESS_AUD` for `ACCESS_CLIENT_ID`.
- **401 from callback:** verify OAuth state, PKCE exchange, discovery/JWKS reachability, key rotation, and ID token claims. The callback intentionally returns a generic authentication failure and does not expose token details.
- **Access login loops or callback blocked:** check both Access applications' host/path coverage and policies. Do not bypass Access to make the loop disappear.
- **MCP tools missing:** only the allowlisted subject can receive the CircleCI tools. Check the signed ID token identity and tool initialization, not the CircleCI token.

## Credential handling and rotation

Store all credentials as encrypted Worker secrets. Never print, commit, or log OAuth tokens, `CIRCLE_TOKEN`, authorization headers, or `COOKIE_ENCRYPTION_KEY`. Rotate credentials in the Cloudflare dashboard and update the corresponding Worker secret; do not regenerate unrelated credentials. Test OAuth and CircleCI access in a non-production environment after each rotation.
