import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const liveV150 = Object.freeze({
  'amaraii-pr109-evidence.mjs': ['5854fc3c66c2ea55ab39ff087c1f66eb3f18c719cf67e9cee7768d808072dcc7', 11189],
  'index.mjs': ['b86d6616eb6a4ee2bfc278b83d8eda3158765d56e009b10436d60103bed6f3df', 58111],
  'provider-routing.mjs': ['89d798f3e30359a51e77254f60895c778ef927e7ca66d7d69bfe4c72b6e51ef8', 1497],
  'semaphore-churchpro.mjs': ['1ce8c0927ce67ba7a3cd6ede09dae08f19733684e896099ed58bf44d60f517c8', 37267],
  'semaphore-nen.mjs': ['9510b775703487be16f57cd8078abd72ff791c4862050becfdb6d99b954ca1f8', 19997],
  'semaphore-urban.mjs': ['29c17c06cc49de3f14b5993732e2392e0e693137954b48d499de34a4a12e4ac6', 13247],
  'semaphore.mjs': ['d1b6073340a9f7f912c05089c33f91796d2928642f5bbacadc4f39f33f00b0d2', 20065],
});

test('checked-in bridge modules remain byte-identical to deployed Cloudflare v150', async () => {
  assert.equal(Object.keys(liveV150).length, 7);
  for (const [filename, [digest, bytes]] of Object.entries(liveV150)) {
    const source = await readFile(new URL('../src/' + filename, import.meta.url));
    const actual = createHash('sha256').update(source).digest('hex');
    assert.equal(source.byteLength, bytes, filename + ': byte length drift');
    assert.equal(actual, digest, filename + ': deployed v150 source SHA-256 drift');
  }
});
