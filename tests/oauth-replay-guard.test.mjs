import assert from "node:assert/strict";
import { test } from "node:test";
import { consumeNonceOnce, claimStateOnce, OAuthReplayGuard } from "../src/oauth-replay-guard.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function fakeSql() {
  const entries = new Map();
  return {
    entries,
    exec(statement, ...args) {
      if (statement.startsWith("CREATE TABLE")) return { rowsWritten: 0 };
      if (statement.startsWith("DELETE FROM")) {
        let removed = 0;
        for (const [key, expires] of entries) {
          if (expires <= args[0]) { entries.delete(key); removed++; }
        }
        return { rowsWritten: removed };
      }
      if (statement.startsWith("INSERT OR IGNORE")) {
        if (entries.has(args[0])) return { rowsWritten: 0 };
        entries.set(args[0], args[1]);
        return { rowsWritten: 1 };
      }
      throw new Error("Unknown SQL");
    },
  };
}
test("nonce may be consumed only once inside a retention window", () => {
  const sql = fakeSql();
  assert.equal(consumeNonceOnce(sql, A, 1000), true);
  assert.equal(consumeNonceOnce(sql, A, 1001), false);
  assert.equal(consumeNonceOnce(sql, B, 1001), true);
});
test("expired nonces are pruned but malformed nonces never consume", () => {
  const sql = fakeSql();
  assert.equal(consumeNonceOnce(sql, "not-a-uuid", 1000), false);
  assert.equal(consumeNonceOnce(sql, A, 1000), true);
  assert.equal(consumeNonceOnce(sql, A, 1000 + 16 * 60_000), true);
  assert.equal(sql.entries.size, 1);
});
test("internal Durable Object endpoint returns 204 for first claim and 409 for replay", async () => {
  const sql = fakeSql();
  const guard = new OAuthReplayGuard({ storage: { sql } });
  const call = (nonce, path = "/consume", method = "POST") =>
    guard.fetch(new Request("https://guard.internal" + path, { method, body: method === "POST" ? nonce : undefined }));
  assert.equal((await call(A)).status, 204);
  assert.equal((await call(A)).status, 409);
  assert.equal((await call(A, "/bad")).status, 404);
  assert.equal((await call("forged")).status, 400);
});
test("claimStateOnce fails closed if binding is missing or returns an error", async () => {
  await assert.rejects(claimStateOnce(undefined, A));
  await assert.rejects(claimStateOnce({ get: () => ({ fetch: async () => new Response(null, { status: 500 }) }), idFromName: () => "id" }, A));
});
test("claimStateOnce never exposes the nonce outside the internal guard binding", async () => {
  const sql = fakeSql();
  const guard = new OAuthReplayGuard({ storage: { sql } });
  const ns = { idFromName: n => n, get: () => ({ fetch: r => guard.fetch(r) }) };
  assert.equal(await claimStateOnce(ns, A), true);
  assert.equal(await claimStateOnce(ns, A), false);
});
