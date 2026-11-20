import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Source hashes and exact UTF-8 byte sizes retrieved read-only from the active
// Cloudflare nen-ci-bridge content/v2 endpoint on 20 November 2026.
// The historical filename remains temporarily for the Semaphore fallback
// workflow's file-existence guard; the assertions target the live v185 Worker.
// All other seven modules are pinned to deployed v185; the index module is a\n// reviewed, exact-job PR118 diagnostic revision. The optional CircleCI trigger\n// prototype is NOT deployed or included.
const liveV185WithPr118Diagnostic = Object.freeze({
  'amaraii-pr109-evidence.mjs': ['5854fc3c66c2ea55ab39ff087c1f66eb3f18c719cf67e9cee7768d808072dcc7', 11189],
  'circleci-nen-evidence.mjs': ['f7e3b0cea85a8a76547a5300fcc27500ae3cd2de5b162507094626e7d681edf4', 15081],
  'index.mjs': ['a58dbcd1a0352f5f802b9048ab7387bdebcada3bce2b91bebde1b7ae06ae5268', 64517],
  'provider-routing.mjs': ['89d798f3e30359a51e77254f60895c778ef927e7ca66d7d69bfe4c72b6e51ef8', 1497],
  'semaphore-churchpro.mjs': ['1ce8c0927ce67ba7a3cd6ede09dae08f19733684e896099ed58bf44d60f517c8', 37267],
  'semaphore-nen.mjs': ['9510b775703487be16f57cd8078abd72ff791c4862050becfdb6d99b954ca1f8', 19997],
  'semaphore-urban.mjs': ['29c17c06cc49de3f14b5993732e2392e0e693137954b48d499de34a4a12e4ac6', 13247],
  'semaphore.mjs': ['bc5fb8ae92cfbd964dead7139ddcbb40de927ac7b8db3604157fd6c74d9cd5de', 32442],
});

test('PR118 diagnostic build preserves seven deployed bridge modules and pins updated index', async () => {
  assert.equal(Object.keys(liveV185WithPr118Diagnostic).length, 8);
  assert.ok(!Object.hasOwn(liveV185WithPr118Diagnostic, 'circleci-nen.mjs'), 'the unused CircleCI trigger prototype must stay undeployed');
  for (const [filename, [digest, bytes]] of Object.entries(liveV185WithPr118Diagnostic)) {
    const source = await readFile(new URL('../src/' + filename, import.meta.url));
    const actual = createHash('sha256').update(source).digest('hex');
    assert.equal(source.byteLength, bytes, filename + ': live v185 byte length drift');
    assert.equal(actual, digest, filename + ': live v185 SHA-256 drift');
  }
});
