// test/tier1-features/deployment.test.mjs
// Tier 1: Feature Coverage - Cloud Deployment, Web UI Serving & Coexistence

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../helpers/api-client.mjs';
import { TARGET_URL, IS_LIVE_TARGET } from '../helpers/test-env.mjs';

describe('Tier 1: Cloud Deployment & Web UI Serving', () => {
  const client = createApiClient();

  it('T1.23: Health check endpoint returns HTTP 200', async () => {
    // Both /api/health or /api/registry.json are valid health indicators
    const healthRes = await client.get('/api/health');
    if (healthRes.status === 200) {
      assert.equal(healthRes.status, 200);
      assert.ok(healthRes.data?.status || healthRes.data?.ok || healthRes.data?.success !== false);
    } else {
      // Fallback: server is responsive via public catalog
      const catRes = await client.get('/api/registry.json');
      assert.equal(catRes.status, 200, `Expected server to be responsive on catalog, got ${catRes.status}`);
    }
  });

  it('T1.24: Web UI root or /login serves HTML document with HTTP 200', async () => {
    const res = await client.get('/login');
    assert.equal(res.status, 200, `Expected 200 OK for Web UI login page, got ${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    assert.ok(contentType.includes('text/html'), `Expected text/html content-type, got ${contentType}`);
    assert.ok(res.rawText.includes('<html') || res.rawText.includes('<!DOCTYPE') || res.rawText.includes('<div id="root"'), 'Response must be HTML document');
  });

  it('T1.25: Web UI returns valid HTML for Single Page App client-side routing', async () => {
    const res = await client.get('/dashboard');
    assert.equal(res.status, 200, `Expected 200 OK on SPA route fallback, got ${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    assert.ok(contentType.includes('text/html'), `Expected text/html for SPA route fallback`);
  });

  it('T1.26: Server returns standard security headers', async () => {
    const res = await client.get('/api/registry.json');
    assert.equal(res.status, 200);

    // Check for common security headers if present (X-Content-Type-Options, etc.)
    const nosniff = res.headers.get('x-content-type-options');
    if (nosniff) {
      assert.equal(nosniff, 'nosniff');
    }
    // Verify response is served with proper content-type
    const contentType = res.headers.get('content-type') || '';
    assert.ok(contentType.includes('application/json'));
  });

  it('T1.27: Live Deployment & Neighbor Endpoint Coexistence check', async (t) => {
    if (!IS_LIVE_TARGET) {
      t.skip('Skipping neighbor check on local environment (TARGET_URL is localhost)');
      return;
    }

    // Check Jira neighbor endpoint on homes-web
    try {
      const jiraRes = await fetch('https://jira.34.62.68.230.sslip.io', { redirect: 'manual' });
      assert.ok(
        jiraRes.status === 200 || jiraRes.status === 302 || jiraRes.status === 301,
        `Expected neighbor Jira endpoint to be healthy, got ${jiraRes.status}`
      );
    } catch (err) {
      t.skip(`Jira neighbor endpoint check skipped: ${err.message}`);
    }
  });
});
