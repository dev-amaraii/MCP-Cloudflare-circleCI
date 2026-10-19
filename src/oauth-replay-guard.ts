/**
 * Atomic, single-use OAuth nonce consumption.
 *
 * KV get/delete is not atomic, so competing OAuth callbacks could otherwise both
 * complete authorization with the same state. This Durable Object is deliberately
 * internal-only and keyed by a fixed name so all callbacks serialize through one
 * SQLite namespace. The primary-key insert is atomic.
 */
const NONCE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const RETAIN_MS = 15 * 60 * 1000;

export function consumeNonceOnce(
  sql: Pick<SqlStorage, "exec">,
  nonce: string,
  now: number = Date.now(),
): boolean {
  if (!NONCE.test(nonce)) return false;
  // The state expires in KV after 10 minutes. Keep consumed nonces longer.
  sql.exec("DELETE FROM oauth_consumed_nonces WHERE expires_at <= ?", now);
  const inserted = sql.exec(
    "INSERT OR IGNORE INTO oauth_consumed_nonces (nonce, expires_at) VALUES (?, ?)",
    nonce, now + RETAIN_MS,
  );
  return inserted.rowsWritten === 1;
}

export class OAuthReplayGuard {
  constructor(private readonly state: DurableObjectState) {
    state.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS oauth_consumed_nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)",
    );
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/consume") {
      return new Response("Not Found", { status: 404 });
    }
    const nonce = await request.text();
    if (nonce.length > 36 || !NONCE.test(nonce)) {
      return new Response("Invalid nonce", { status: 400 });
    }
    const accepted = consumeNonceOnce(this.state.storage.sql, nonce);
    return new Response(null, { status: accepted ? 204 : 409 });
  }
}

/** Bind every state validation to the same internal singleton Durable Object. */
export async function claimStateOnce(
  binding: DurableObjectNamespace,
  nonce: string,
): Promise<boolean> {
  if (!binding || !NONCE.test(nonce)) throw new Error("OAuth replay protection unavailable");
  const stub = binding.get(binding.idFromName("nen-oauth-state-v1"));
  const response = await stub.fetch(
    new Request("https://oauth-guard.internal/consume", { method: "POST", body: nonce }),
  );
  if (response.status === 204) return true;
  if (response.status === 409) return false;
  throw new Error("OAuth replay protection unavailable");
}
