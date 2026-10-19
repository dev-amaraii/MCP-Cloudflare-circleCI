import { verifyAccessIdToken } from "./access-jwt";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import {
	addApprovedClient,
	createOAuthState,
	fetchUpstreamAuthToken,
	generateCSRFProtection,
	getUpstreamAuthorizeUrl,
	isClientApproved,
	OAuthError,
	type Props,
	renderApprovalDialog,
	validateCSRFToken,
	validateOAuthState,
} from "./workers-oauth-utils";

type EnvWithOauth = Env & { OAUTH_PROVIDER: OAuthHelpers };

export async function handleAccessRequest(
	request: Request,
	env: EnvWithOauth,
	_ctx: ExecutionContext,
) {
	const { pathname, searchParams } = new URL(request.url);

	if (request.method === "GET" && pathname === "/authorize") {
		const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
		const { clientId } = oauthReqInfo;
		if (!clientId) {
			return new Response("Invalid request", { status: 400 });
		}

		// Check if client is already approved — no approval form so no CSRF cookie to clear
		if (await isClientApproved(request, clientId, env.COOKIE_ENCRYPTION_KEY)) {
			const { stateToken, codeChallenge } = await createOAuthState(
				oauthReqInfo,
				env.OAUTH_KV,
				env.COOKIE_ENCRYPTION_KEY,
			);
			return redirectToAccess(request, env, stateToken, codeChallenge);
		}

		// Generate CSRF protection for the approval form
		const { token: csrfToken, setCookie } = generateCSRFProtection();

		return renderApprovalDialog(request, {
			client: await env.OAUTH_PROVIDER.lookupClient(clientId),
			csrfToken,
			server: {
				description: "This is a demo MCP Remote Server using Access for authentication.",
				logo: "https://avatars.githubusercontent.com/u/314135?s=200&v=4",
				name: "Cloudflare Access MCP Server",
			},
			setCookie,
			state: { oauthReqInfo },
		});
	}

	if (request.method === "POST" && pathname === "/authorize") {
		try {
			// Read form data once at top
			const formData = await request.formData();

			// Validate CSRF token and capture clearCookie to expire the one-time-use token
			const csrfResult = validateCSRFToken(formData, request);

			// Extract state from form data
			const encodedState = formData.get("state");
			if (!encodedState || typeof encodedState !== "string") {
				return new Response("Missing state in form data", { status: 400 });
			}

			let state: { oauthReqInfo?: AuthRequest };
			try {
				state = JSON.parse(atob(encodedState));
			} catch (_e) {
				return new Response("Invalid state data", { status: 400 });
			}

			if (!state.oauthReqInfo || !state.oauthReqInfo.clientId) {
				return new Response("Invalid request", { status: 400 });
			}

			// Add client to approved list
			const approvedClientCookie = await addApprovedClient(
				request,
				state.oauthReqInfo.clientId,
				env.COOKIE_ENCRYPTION_KEY,
			);

			// Create OAuth state
			const { stateToken, codeChallenge } = await createOAuthState(
				state.oauthReqInfo,
				env.OAUTH_KV,
				env.COOKIE_ENCRYPTION_KEY,
			);

			// Build redirect headers — use Headers to support multiple Set-Cookie values
			const redirectHeaders = new Headers();
			redirectHeaders.append("Set-Cookie", approvedClientCookie);
			redirectHeaders.append("Set-Cookie", csrfResult.clearCookie);

			return redirectToAccess(request, env, stateToken, codeChallenge, redirectHeaders);
		} catch (error: any) {
			console.error("POST /authorize error:", error);
			if (error instanceof OAuthError) {
				return error.toResponse();
			}
			// Unexpected non-OAuth error
			return new Response("Internal server error", { status: 500 });
		}
	}

	if (request.method === "GET" && pathname === "/callback") {
		// Validate OAuth state (retrieves stored data from KV)
		let oauthReqInfo: AuthRequest;
		let codeVerifier: string;

		try {
			const result = await validateOAuthState(
				request,
				env.OAUTH_KV,
				env.COOKIE_ENCRYPTION_KEY,
			);
			oauthReqInfo = result.oauthReqInfo;
			codeVerifier = result.codeVerifier;
		} catch (error: any) {
			if (error instanceof OAuthError) {
				return error.toResponse();
			}
			// Unexpected non-OAuth error
			return new Response("Internal server error", { status: 500 });
		}

		if (!oauthReqInfo.clientId) {
			return new Response("Invalid OAuth request data", { status: 400 });
		}

		// Exchange the code for an access token, including the PKCE verifier
		const [accessToken, idToken, errResponse] = await fetchUpstreamAuthToken({
			client_id: env.ACCESS_CLIENT_ID,
			client_secret: env.ACCESS_CLIENT_SECRET,
			code: searchParams.get("code") ?? undefined,
			redirect_uri: new URL("/callback", request.url).href,
			upstream_url: env.ACCESS_TOKEN_URL,
			code_verifier: codeVerifier,
		});
		if (errResponse) {
			return errResponse;
		}

		let idTokenClaims: Awaited<ReturnType<typeof verifyAccessIdToken>>;
		try {
			idTokenClaims = await verifyAccessIdToken(env, idToken);
		} catch {
			return new Response("Forbidden", { status: 403 });
		}
		const user = {
			email: idTokenClaims.email,
			name: idTokenClaims.name,
			sub: idTokenClaims.sub,
		};

		// Return back to the MCP client a new token
		const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
			metadata: {
				label: user.name,
			},
			// This will be available on this.props inside MyMCP
			props: {
				accessToken,
				email: user.email,
				login: user.sub,
				name: user.name,
			} as Props,
			request: oauthReqInfo,
			scope: oauthReqInfo.scope,
			userId: user.sub,
		});

		return Response.redirect(redirectTo, 302);
	}

	return new Response("Not Found", { status: 404 });
}

async function redirectToAccess(
	request: Request,
	env: Env,
	stateToken: string,
	codeChallenge: string,
	extraHeaders: Headers = new Headers(),
) {
	const headers = new Headers(extraHeaders);
	headers.set(
		"location",
		getUpstreamAuthorizeUrl({
			client_id: env.ACCESS_CLIENT_ID,
			code_challenge: codeChallenge,
			redirect_uri: new URL("/callback", request.url).href,
			scope: "openid email profile",
			state: stateToken,
			upstream_url: env.ACCESS_AUTHORIZATION_URL,
		}),
	);
	return new Response(null, { headers, status: 302 });
}
