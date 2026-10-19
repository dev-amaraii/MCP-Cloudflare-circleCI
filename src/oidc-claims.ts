export interface OidcClaims {
	iss?: unknown;
	aud?: unknown;
	azp?: unknown;
	exp?: unknown;
	nbf?: unknown;
	sub?: unknown;
	email?: unknown;
	[key: string]: unknown;
}

export interface VerifiedOidcClaims extends OidcClaims {
	iss: string;
	aud: string | string[];
	exp: number;
	sub: string;
	email: string;
}

export interface VerifyOidcIdTokenOptions {
	token: string;
	teamDomain: string;
	clientId: string;
	authorizationUrl: string;
	tokenUrl: string;
	jwksUrl: string;
	expectedEmail: string;
	fetcher?: typeof fetch;
	now?: number;
}

export type OidcProviderOptions = Pick<VerifyOidcIdTokenOptions,
	"teamDomain" | "clientId" | "authorizationUrl" | "tokenUrl" | "jwksUrl" | "fetcher"
>;

interface OidcDiscovery {
	issuer?: unknown;
	authorization_endpoint?: unknown;
	token_endpoint?: unknown;
	jwks_uri?: unknown;
}

async function getValidatedDiscovery(options: OidcProviderOptions): Promise<OidcDiscovery> {
	const fetcher = options.fetcher ?? fetch;
	const team = asHttpsUrl(options.teamDomain, "Access team domain");
	if (team.pathname !== "/" || team.search || team.port) throw new Error("Invalid Access team domain");
	if (!team.hostname.endsWith(".cloudflareaccess.com")) throw new Error("Invalid Access team domain");
	if (!options.clientId || options.clientId.length > 512) throw new Error("Invalid OIDC client ID");

	const oidcBase = `${team.origin}/cdn-cgi/access/sso/oidc/${encodeURIComponent(options.clientId)}`;
	const expectedIssuer = oidcBase;
	const discoveryUrl = `${oidcBase}/.well-known/openid-configuration`;
	const configuredAuthorizationUrl = asHttpsUrl(options.authorizationUrl, "authorization endpoint").href;
	const configuredTokenUrl = asHttpsUrl(options.tokenUrl, "token endpoint").href;
	const configuredJwksUrl = asHttpsUrl(options.jwksUrl, "JWKS endpoint").href;

	const discoveryResponse = await fetcher(discoveryUrl, { signal: AbortSignal.timeout(8_000), redirect: "error" });
	if (!discoveryResponse.ok) throw new Error("OIDC discovery request failed");
	const discoveryLength = Number(discoveryResponse.headers.get("Content-Length"));
	if (Number.isFinite(discoveryLength) && discoveryLength > 32_768) throw new Error("OIDC discovery response is too large");
	const discovery = await discoveryResponse.json() as OidcDiscovery;
	if (
		discovery.issuer !== expectedIssuer ||
		discovery.authorization_endpoint !== configuredAuthorizationUrl ||
		discovery.token_endpoint !== configuredTokenUrl ||
		discovery.jwks_uri !== configuredJwksUrl
	) {
		throw new Error("OIDC discovery configuration mismatch");
	}
	return discovery;
}

/** Confirm configured upstream URLs before redirecting a user or sending a code/client secret. */
export async function validateOidcConfiguration(options: OidcProviderOptions): Promise<void> {
	await getValidatedDiscovery(options);
}

interface JwksResponse {
	keys?: Array<JsonWebKey & { kid?: string; alg?: string; use?: string }>;
}

function asHttpsUrl(value: string, label: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`Invalid ${label}`);
	}
	if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port) {
		throw new Error(`Invalid ${label}`);
	}
	return url;
}

function parseJsonObject(segment: string): Record<string, unknown> {
	const bytes = Uint8Array.from(atob(segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=")), (char) => char.charCodeAt(0));
	const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid token");
	return value as Record<string, unknown>;
}

function parseJwt(token: string) {
	if (token.length > 32_768) throw new Error("Invalid token");
	const parts = token.split(".");
	if (parts.length !== 3 || parts.some((part) => !part)) throw new Error("Invalid token");
	return {
		data: `${parts[0]}.${parts[1]}`,
		header: parseJsonObject(parts[0]!),
		claims: parseJsonObject(parts[1]!),
		signature: Uint8Array.from(atob(parts[2]!.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parts[2]!.length / 4) * 4, "=")), (char) => char.charCodeAt(0)),
	};
}

/** Validate identity claims after verifying the OIDC signature against the app's JWKS. */
export function validateOidcClaims(
	claims: OidcClaims,
	expectedIssuer: string,
	expectedAudience: string,
	expectedEmail: string,
	now = Math.floor(Date.now() / 1000),
): void {
	if (claims.iss !== expectedIssuer) throw new Error("Invalid issuer");
	const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
	if (!Array.isArray(audiences) || !audiences.every((aud) => typeof aud === "string") || !audiences.includes(expectedAudience)) {
		throw new Error("Invalid audience");
	}
	if (audiences.length > 1 && claims.azp !== expectedAudience) throw new Error("Invalid authorized party");
	if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= now) throw new Error("Expired token");
	if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || !Number.isFinite(claims.nbf) || claims.nbf > now)) {
		throw new Error("Premature token");
	}
	if (typeof claims.sub !== "string" || claims.sub.trim().length === 0) throw new Error("Invalid subject");
	if (typeof claims.email !== "string" || claims.email.trim().toLowerCase() !== expectedEmail.toLowerCase()) {
		throw new Error("Unauthorized identity");
	}
}

/** Verify Cloudflare Access OIDC discovery, RS256 signature, and the complete identity claim set. */
export async function verifyOidcIdToken(options: VerifyOidcIdTokenOptions): Promise<VerifiedOidcClaims> {
	const fetcher = options.fetcher ?? fetch;
	const discovery = await getValidatedDiscovery(options);

	const jwt = parseJwt(options.token);
	if (jwt.header.alg !== "RS256" || typeof jwt.header.kid !== "string" || !jwt.header.kid || jwt.header.crit !== undefined || jwt.header.b64 === false) {
		throw new Error("Unsupported token signing algorithm");
	}
	const jwksResponse = await fetcher(discovery.jwks_uri as string, { signal: AbortSignal.timeout(8_000), redirect: "error" });
	if (!jwksResponse.ok) throw new Error("OIDC signing keys request failed");
	const jwksLength = Number(jwksResponse.headers.get("Content-Length"));
	if (Number.isFinite(jwksLength) && jwksLength > 65_536) throw new Error("OIDC signing keys response is too large");
	const jwks = await jwksResponse.json() as JwksResponse;
	const key = jwks.keys?.find((candidate) =>
		candidate.kid === jwt.header.kid &&
		candidate.kty === "RSA" &&
		(candidate.use === undefined || candidate.use === "sig") &&
		(candidate.alg === undefined || candidate.alg === "RS256"),
	);
	if (!key) throw new Error("Unknown OIDC signing key");
	const cryptoKey = await crypto.subtle.importKey(
		"jwk",
		key,
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["verify"],
	);
	const verified = await crypto.subtle.verify(
		"RSASSA-PKCS1-v1_5",
		cryptoKey,
		jwt.signature,
		new TextEncoder().encode(jwt.data),
	);
	if (!verified) throw new Error("Invalid token signature");

	const claims = jwt.claims as OidcClaims;
	validateOidcClaims(claims, discovery.issuer as string, options.clientId, options.expectedEmail, options.now);
	return claims as VerifiedOidcClaims;
}
