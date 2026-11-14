import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';

test('live v149 never exposes HTTP CI commands even for approved-looking requests', async () => {
  for (const candidate of [
    { method: 'GET', url: 'https://example.invalid/' },
    { method: 'GET', url: 'https://example.invalid/health' },
    { method: 'POST', url: 'https://example.invalid/mcp', body: 'approved=true' },
    { method: 'POST', url: 'https://example.invalid/trigger', body: 'approved=true' },
    { method: 'POST', url: 'https://example.invalid/churchpro_report', body: '{}' },
  ]) {
    const result = await worker.fetch(candidate);
    assert.equal(result.status, 404, candidate.url);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(await result.text(), 'Not found');
  }
});
