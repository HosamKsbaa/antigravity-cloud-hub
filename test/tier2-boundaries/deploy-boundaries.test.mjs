// test/tier2-boundaries/deploy-boundaries.test.mjs
// Tier 2: Boundary & Corner Cases - HTTP Protocol, Non-Existent Routes & Payload Size Limits

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../helpers/api-client.mjs';

describe('Tier 2: Deployment & HTTP Protocol Boundaries', () => {
  const client = createApiClient();

  it('T2.23: Requesting non-existent API route returns 404 Not Found', async () => {
    const res = await client.get('/api/unknown-non-existent-endpoint-404');
    assert.equal(res.status, 404, `Expected 404 for unknown endpoint, got ${res.status}`);
  });

  it('T2.24: Unsupported HTTP method on catalog endpoint returns 404 or 405', async () => {
    const res = await client.request('/api/registry.json', { method: 'DELETE' });
    assert.ok(
      res.status === 404 || res.status === 405,
      `Expected 404 or 405 Method Not Allowed, got ${res.status}`
    );
  });

  it('T2.25: Oversized body to non-upload JSON endpoint returns 413 Payload Too Large', async () => {
    // Generate an oversized string (>2MB) to test JSON body parser limit
    const hugeString = 'a'.repeat(3 * 1024 * 1024); // 3MB
    const res = await client.post('/api/auth/login', {
      email: 'test@example.com',
      password: hugeString
    }, { timeoutMs: 20000 });

    assert.ok(
      res.status === 413 || res.status === 400,
      `Expected 413 Payload Too Large or 400 Bad Request, got ${res.status}`
    );
  });
});
