/** Configuration for the Cloudflare Access for SaaS OIDC client. */
export interface AccessOidcConfig {
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_CLIENT_ID: string;
  ACCESS_AUTHORIZATION_URL: string;
  ACCESS_TOKEN_URL: string;
  ACCESS_JWKS_URL: string;
}
export interface OidcClaims {
  iss?: unknown;
  aud?: unknown;
  azp?: unknown;
  exp?: unknown;
  iat?: unknown;
  nbf?: unknown;
  sub?: unknown;
  email?: unknown;
  [key: string]: unknown;
}

/** Cloudflare Access for SaaS uses a *path-scoped* issuer, not the team origin. */
export function getAccessOidcIssuer(env: AccessOidcConfig): string {
  const authorization = new URL(env.ACCESS_AUTHORIZATION_URL);
  const team = new URL(env.ACCESS_TEAM_DOMAIN);
  const app = authorization.pathname.match(/^\/cdn-cgi\/access\/sso\/oidc\/([A-Za-z0-9_-]+)\/authorization$/);
  if (
    authorization.protocol !== "https:" ||
    team.protocol !== "https:" ||
    !authorization.hostname.endsWith(".cloudflareaccess.com") ||
    authorization.origin !== team.origin ||
    authorization.search || authorization.hash ||
    team.pathname !== "/" || team.search || team.hash ||
    !app || !env.ACCESS_CLIENT_ID || app[1] !== env.ACCESS_CLIENT_ID
  ) {
    throw new Error("Invalid Access for SaaS OIDC configuration");
  }
  const issuer = authorization.origin + authorization.pathname.slice(0, -"/authorization".length);
  if (env.ACCESS_TOKEN_URL !== issuer + "/token" || env.ACCESS_JWKS_URL !== issuer + "/jwks") {
    throw new Error("Inconsistent Access for SaaS endpoints");
  }
  return issuer;
}

/** Only return after a cryptographically verified ID token's claims are acceptable. */
export function validateOidcClaims(
  claims: OidcClaims,
  issuer: string,
  clientId: string,
  email: string,
  now = Math.floor(Date.now() / 1000),
): void {
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) throw new Error("Invalid claims");
  if (claims.iss !== issuer) throw new Error("Invalid issuer");
  const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
  if (
    !Array.isArray(audiences) ||
    audiences.length === 0 ||
    !audiences.every((aud) => typeof aud === "string" && aud.length > 0) ||
    !audiences.includes(clientId)
  ) throw new Error("Invalid audience");
  if ((audiences.length > 1 || claims.azp !== undefined) && claims.azp !== clientId) {
    throw new Error("Invalid authorized party");
  }
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= now) {
    throw new Error("Expired token");
  }
  if (typeof claims.iat !== "number" || !Number.isFinite(claims.iat) || claims.iat > now + 60) {
    throw new Error("Invalid issued-at");
  }
  if (claims.nbf !== undefined &&
      (typeof claims.nbf !== "number" || !Number.isFinite(claims.nbf) || claims.nbf > now)) {
    throw new Error("Premature token");
  }
  if (typeof claims.sub !== "string" || !claims.sub.trim()) throw new Error("Invalid subject");
  if (typeof claims.email !== "string" || claims.email.toLowerCase() !== email.toLowerCase()) {
    throw new Error("Unauthorized identity");
  }
}
