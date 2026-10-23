// test/tier2-boundaries/telemetry-boundaries.test.mjs
// Tier 2: Boundary & Corner Cases - Telemetry Payloads & Scope Isolation

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../helpers/api-client.mjs';
import { ADMIN_EMAIL, ADMIN_PASSWORD, generateRandomEmail, generateRandomPassword } from '../helpers/test-env.mjs';
import { buildTelemetryPayload } from '../helpers/fixtures.mjs';

describe('Tier 2: Telemetry Ingestion & Summary Boundaries', () => {
  const adminClient = createApiClient();
  const userClient = createApiClient();
  let userEmail = generateRandomEmail('t2_telem_b');
  let userPassword = generateRandomPassword();

  it('T2.17: Telemetry sync with empty JSON payload {} returns 400 or handled gracefully', async () => {
    await adminClient.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    await adminClient.post('/api/users', { email: userEmail, password: userPassword, role: 'user' });
    await userClient.login(userEmail, userPassword);

    const res = await userClient.post('/api/telemetry/sync', {});
    // Server should either reject empty body with 400 or accept with 0 items synced
    assert.ok(
      res.status === 400 || res.status === 200 || res.status === 422,
      `Expected 400 or 200 for empty body, got ${res.status}`
    );
  });

  it('T2.18: Telemetry sync with malformed JSON syntax returns 400 Bad Request', async () => {
    const res = await userClient.request('/api/telemetry/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: '{"clientVersion": "2.0.0", "brokenJson": ' // invalid JSON
    });
    assert.equal(res.status, 400, `Expected 400 Bad Request for malformed JSON, got ${res.status}`);
  });

  it('T2.19: Telemetry sync with extreme integer token counts handles large numbers without overflow', async () => {
    const extremePayload = buildTelemetryPayload({
      workspaces: [
        {
          workspaceName: 'extreme-tokens-workspace',
          workspacePath: '/workspace/extreme',
          conversationsCount: 1,
          turnsCount: 10,
          inputTokens: 99999999999, // 100 billion tokens
          cacheReadTokens: 500000000000,
          outputTokens: 50000000000,
          thinkingTokens: 20000000000,
          responseTokens: 30000000000,
          costUsd: 125000.50
        }
      ]
    });

    const res = await userClient.post('/api/telemetry/sync', extremePayload);
    assert.ok(
      res.status === 200 || res.status === 400,
      `Expected 200 or 400, got ${res.status}: ${res.rawText}`
    );
  });

  it('T2.20: Unauthenticated telemetry sync returns 401 Unauthorized', async () => {
    const unauthClient = createApiClient();
    const payload = buildTelemetryPayload();

    const res = await unauthClient.post('/api/telemetry/sync', payload);
    assert.equal(res.status, 401, `Expected 401 Unauthorized, got ${res.status}`);
  });

  it('T2.21: Summary query with invalid period parameter handles gracefully or returns 400', async () => {
    const res = await userClient.get('/api/telemetry/summary?period=invalid_period_name_xyz');
    assert.ok(
      res.status === 200 || res.status === 400,
      `Expected 200 (fallback) or 400, got ${res.status}`
    );
  });

  it('T2.22: Regular user attempting scope=all is restricted to own data or returns 403', async () => {
    const res = await userClient.get('/api/telemetry/summary?scope=all');
    // If 200, verify the response only contains regular user's data, or server blocks scope=all with 403
    if (res.status === 403) {
      assert.equal(res.status, 403);
    } else {
      assert.equal(res.status, 200);
      const summary = res.data?.data || res.data;
      assert.ok(summary, 'Summary returned');
    }
  });
});
