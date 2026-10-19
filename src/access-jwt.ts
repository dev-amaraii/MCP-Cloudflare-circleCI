import { Buffer } from "node:buffer";
import { getAccessOidcIssuer, validateOidcClaims, type AccessOidcConfig, type OidcClaims } from "./oidc-claims.ts";

type ClaimsAndSignature = {
  data: string;
  header: Record<string, unknown>;
  claims: OidcClaims;
  signature: Uint8Array;
};

function parseSignedJwt(token: string): ClaimsAndSignature {
  if (typeof token !== "string" || token.length > 16_384) throw new Error("Invalid ID token");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw new Error("Malformed ID token");
  }
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Record<string, unknown>;
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as OidcClaims;
  if (!header || typeof header !== "object" || Array.isArray(header) ||
      header.alg !== "RS256" || typeof header.kid !== "string" ||
      !header.kid || header.kid.length > 256) {
    throw new Error("Unsupported JWT header");
  }
  return {
    data: parts[0] + "." + parts[1],
    header,
    claims,
    signature: Buffer.from(parts[2], "base64url"),
  };
}

/** Verify Access for SaaS ID tokens with an app-pinned JWKS and exact issuer. */
export async function verifyAccessIdToken(
  env: AccessOidcConfig,
  token: string,
  now = Math.floor(Date.now() / 1000),
  fetcher: typeof fetch = fetch,
): Promise<OidcClaims> {
  // Reject inconsistent upstream configuration before any network call.
  const issuer = getAccessOidcIssuer(env);
  const jwt = parseSignedJwt(token);

  const response = await fetcher(env.ACCESS_JWKS_URL, { redirect: "error" });
  if (!response.ok) throw new Error("Access JWKS unavailable");
  const data = (await response.json()) as { keys?: Array<JsonWebKey & { kid?: string; alg?: string; use?: string }> };
  if (!data || !Array.isArray(data.keys)) throw new Error("Invalid JWKS");
  const matches = data.keys.filter((key) => key?.kid === jwt.header.kid);
  if (matches.length !== 1) throw new Error("Unknown or ambiguous signing key");
  const jwk = matches[0];
  if (jwk.kty !== "RSA" || (jwk.alg && jwk.alg !== "RS256") || (jwk.use && jwk.use !== "sig")) {
    throw new Error("Unsupported signing key");
  }
  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
  );
  const signed = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, jwt.signature, Buffer.from(jwt.data),
  );
  if (!signed) throw new Error("Invalid JWT signature");
  validateOidcClaims(jwt.claims, issuer, env.ACCESS_CLIENT_ID, "devops@amaraii.com", now);
  return jwt.claims;
}
