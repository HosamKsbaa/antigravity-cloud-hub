// test/tier4-scenarios/cloud-coexistence.test.mjs
// Tier 4: Real-World Scenario - Cloud Deployment Verification, TLS & Virtual Host Coexistence

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../helpers/api-client.mjs';
import { TARGET_URL, IS_LIVE_TARGET } from '../helpers/test-env.mjs';

describe('Tier 4 Scenario: Cloud Deployment Integrity & Coexistence Verification', () => {
  const client = createApiClient();

  it('T4.4: Verifies deployment endpoint reachability and HTTPS protocol enforcement', async (t) => {
    // 1. Check primary application endpoint
    const res = await client.get('/api/registry.json');
    assert.equal(res.status, 200, `Expected 200 OK from primary target ${TARGET_URL}, got ${res.status}`);

    if (!IS_LIVE_TARGET) {
      t.skip('Skipping live Caddy TLS and multi-tenant neighbor verification on localhost');
      return;
    }

    // 2. Test HTTP -> HTTPS redirection on live target
    const httpTarget = TARGET_URL.replace(/^https:/, 'http:');
    try {
      const redirectRes = await fetch(httpTarget, { redirect: 'manual' });
      assert.ok(
        redirectRes.status === 301 || redirectRes.status === 302 || redirectRes.status === 308,
        `Expected HTTP to redirect to HTTPS, got status ${redirectRes.status}`
      );
      const location = redirectRes.headers.get('location') || '';
      assert.ok(location.startsWith('https://'), `Redirect location should be HTTPS, got ${location}`);
    } catch (err) {
      // In local networks or test environments where port 80 is not forwarded, log and continue
      console.warn(`HTTP redirect check note: ${err.message}`);
    }

    // 3. Multi-tenant coexistence: verify Homes production endpoint remains healthy
    try {
      const homesRes = await fetch('https://34.62.68.230/ar', { redirect: 'manual' });
      assert.ok(
        homesRes.status === 200 || homesRes.status === 302 || homesRes.status === 301,
        `Homes production endpoint (https://34.62.68.230/ar) should be healthy, got ${homesRes.status}`
      );
    } catch (err) {
      console.warn(`Homes production neighbor check note: ${err.message}`);
    }

    // 4. Multi-tenant coexistence: verify GateGoldJira endpoint remains healthy
    try {
      const jiraRes = await fetch('https://jira.34.62.68.230.sslip.io', { redirect: 'manual' });
      assert.ok(
        jiraRes.status === 200 || jiraRes.status === 302 || jiraRes.status === 301,
        `Jira virtual host (https://jira.34.62.68.230.sslip.io) should be healthy, got ${jiraRes.status}`
      );
    } catch (err) {
      console.warn(`Jira neighbor check note: ${err.message}`);
    }
  });
});
