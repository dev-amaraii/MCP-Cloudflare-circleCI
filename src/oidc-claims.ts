export interface OidcClaims {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  sub?: unknown;
  email?: unknown;
}
export function validateOidcClaims(claims: OidcClaims, issuer: string, clientId: string, email: string, now = Math.floor(Date.now() / 1000)): void {
  const origin = new URL(issuer).origin;
  if (claims.iss !== origin && claims.iss !== origin + "/") throw new Error("Invalid issuer");
  if (claims.aud !== clientId && !(Array.isArray(claims.aud) && claims.aud.includes(clientId))) throw new Error("Invalid audience");
  if (typeof claims.exp !== "number" || claims.exp <= now) throw new Error("Expired token");
  if (typeof claims.nbf === "number" && claims.nbf > now) throw new Error("Premature token");
  if (typeof claims.sub !== "string" || !claims.sub) throw new Error("Invalid subject");
  if (typeof claims.email !== "string" || claims.email.toLowerCase() !== email.toLowerCase()) throw new Error("Unauthorized identity");
}
