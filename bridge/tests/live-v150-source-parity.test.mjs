import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Source hashes and exact UTF-8 byte sizes retrieved read-only from the active
// Cloudflare nen-ci-bridge content/v2 endpoint on 20 November 2026.
// The historical filename remains temporarily for the Semaphore fallback
// workflow's file-existence guard; the assertions target the live v185 Worker.
// The optional circleci-nen.mjs trigger prototype is NOT deployed or included.
const liveV185 = Object.freeze({
  'amaraii-pr109-evidence.mjs': ['5854fc3c66c2ea55ab39ff087c1f66eb3f18c719cf67e9cee7768d808072dcc7', 11189],
  'circleci-nen-evidence.mjs': ['f7e3b0cea85a8a76547a5300fcc27500ae3cd2de5b162507094626e7d681edf4', 15081],
  'provider-routing.mjs': ['89d798f3e30359a51e77254f60895c778ef927e7ca66d7d69bfe4c72b6e51ef8', 1497],
  'semaphore-churchpro.mjs': ['1ce8c0927ce67ba7a3cd6ede09dae08f19733684e896099ed58bf44d60f517c8', 37267],
  'semaphore-nen.mjs': ['9510b775703487be16f57cd8078abd72ff791c4862050becfdb6d99b954ca1f8', 19997],
  'semaphore-urban.mjs': ['29c17c06cc49de3f14b5993732e2392e0e693137954b48d499de34a4a12e4ac6', 13247],
  'semaphore.mjs': ['bc5fb8ae92cfbd964dead7139ddcbb40de927ac7b8db3604157fd6c74d9cd5de', 32442],
});

test('seven unchanged historical bridge modules retain their v185 verified source', async () => {
  assert.equal(Object.keys(liveV185).length, 7);
  assert.ok(!Object.hasOwn(liveV185, 'circleci-nen.mjs'), 'the unused CircleCI trigger prototype must stay undeployed');
  for (const [filename, [digest, bytes]] of Object.entries(liveV185)) {
    const source = await readFile(new URL('../src/' + filename, import.meta.url));
    const actual = createHash('sha256').update(source).digest('hex');
    assert.equal(source.byteLength, bytes, filename + ': live v185 byte length drift');
    assert.equal(actual, digest, filename + ': live v185 SHA-256 drift');
  }
});

test('updated bridge entrypoint preserves live Gym/Bookings code and exact Phase 3 read gate', async () => {
  const source=await readFile(new URL('../src/index.mjs',import.meta.url),'utf8');
  assert.ok(source.includes('PINNED_GYM_QA_JOB'));
  assert.ok(source.includes('summarizePr118WorkspaceVitest'));
  assert.ok(source.includes("command.action==='churchpro_phase3_artifact'"));
  assert.ok(source.includes('CHURCHPRO_PHASE3_PATHS.includes(command.artifactPath)'));
  assert.ok(source.includes('readCircleCiChurchProPhase3(env, {'));
  assert.ok(source.includes("fetch() {\n    return new Response('Not found'"));
});
