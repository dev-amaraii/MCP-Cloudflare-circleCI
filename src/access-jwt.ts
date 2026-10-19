import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AccessEnv {
	ACCESS_TEAM_DOMAIN: string;
	ACCESS_AUD: string;
}

const keySets = new Map<string, JWTVerifyGetKey>();

export async function verifyAccessAssertion(request: Request, env: AccessEnv, testKeys?: JWTVerifyGetKey) {
	const token = request.headers.get("Cf-Access-Jwt-Assertion");
	if (!token || token.length > 32768) throw new Error("Authentication required");
	const team = new URL(env.ACCESS_TEAM_DOMAIN);
	if (team.protocol !== "https:" || !team.hostname.endsWith(".cloudflareaccess.com") || team.pathname !== "/" || team.search || team.hash || team.port || team.username || team.password || !env.ACCESS_AUD) {
		throw new Error("Invalid Access configuration");
	}
	let keys = testKeys ?? keySets.get(team.origin);
	if (!keys) {
		keys = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", team), { timeoutDuration: 8000 });
		keySets.set(team.origin, keys);
	}
	const { payload } = await jwtVerify(token, keys, {
		issuer: team.origin,
		audience: env.ACCESS_AUD,
		algorithms: ["RS256"],
		requiredClaims: ["iss", "aud", "exp", "sub", "email"],
	});
	if (typeof payload.sub !== "string" || !payload.sub.trim() || typeof payload.email !== "string" || payload.email.toLowerCase() !== "devops@amaraii.com") {
		throw new Error("Unauthorized identity");
	}
	return { email: payload.email.toLowerCase(), sub: payload.sub };
}
