interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_REPLAY_GUARD: DurableObjectNamespace;
  MCP_OBJECT: DurableObjectNamespace;
  CIRCLE_TOKEN: string;
  CIRCLE_PROJECT_SLUG: string;
  CIRCLE_DEFINITION_ID: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ACCESS_CLIENT_ID: string;
  ACCESS_CLIENT_SECRET: string;
  ACCESS_TOKEN_URL: string;
  ACCESS_AUTHORIZATION_URL: string;
  ACCESS_JWKS_URL: string;
  COOKIE_ENCRYPTION_KEY: string;
}
