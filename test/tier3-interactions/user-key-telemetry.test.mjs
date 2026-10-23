// test/tier3-interactions/user-key-telemetry.test.mjs
// Tier 3: Cross-Feature Interactions - User API Key Generation, Telemetry Sync & Revocation Lockout

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../helpers/api-client.mjs';
import { ADMIN_EMAIL, ADMIN_PASSWORD, generateRandomEmail, generateRandomPassword } from '../helpers/test-env.mjs';
import { buildTelemetryPayload } from '../helpers/fixtures.mjs';

describe('Tier 3: User -> API Key -> Telemetry Sync -> Revocation Lockout', () => {
  const adminClient = createApiClient();
  const userClient = createApiClient();
  const apiKeyClient = createApiClient();

  const userEmail = generateRandomEmail('t3_keyuser');
  const userPassword = generateRandomPassword();
  let apiKeyId = null;
  let rawApiKey = null;
  let testWorkspaceName = 'workspace-t3-' + Math.random().toString(36).substring(2, 7);

  it('T3.1: Pairwise: User creates API Key, syncs telemetry, and verifies in summary', async () => {
    // 1. Admin creates user
    await adminClient.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const createRes = await adminClient.post('/api/users', {
      email: userEmail,
      password: userPassword,
      role: 'user'
    });
    assert.ok(createRes.status === 200 || createRes.status === 201);

    // 2. User logs in
    const loginRes = await userClient.login(userEmail, userPassword);
    assert.equal(loginRes.status, 200);

    // 3. User creates API Key
    const keyRes = await userClient.post('/api/api-keys', {
      name: 'IDE Plugin Cross-Feature Key'
    });
    assert.ok(keyRes.status === 200 || keyRes.status === 201);
    const keyData = keyRes.data?.apiKey || keyRes.data?.data?.apiKey || keyRes.data?.data || keyRes.data;
    apiKeyId = keyData.id;
    rawApiKey = keyData.key || keyData.secretKey;
    assert.ok(rawApiKey, 'Must have received plaintext API key');

    // 4. Configure client with API Key and push telemetry
    apiKeyClient.setApiKey(rawApiKey);
    const payload = buildTelemetryPayload({
      workspaces: [
        {
          workspaceName: testWorkspaceName,
          workspacePath: `/projects/${testWorkspaceName}`,
          conversationsCount: 1,
          turnsCount: 6,
          inputTokens: 12000,
          cacheReadTokens: 48000,
          outputTokens: 3000,
          thinkingTokens: 1200,
          responseTokens: 1800,
          costUsd: 0.08
        }
      ]
    });

    const syncRes = await apiKeyClient.post('/api/telemetry/sync', payload);
    assert.equal(syncRes.status, 200, `Expected 200 OK on API key telemetry sync, got ${syncRes.status}`);

    // 5. Query summary as user and assert workspace telemetry appears
    const summaryRes = await userClient.get('/api/telemetry/summary');
    assert.equal(summaryRes.status, 200);
    const summary = summaryRes.data?.data || summaryRes.data;
    assert.ok(summary, 'Telemetry summary must be returned');
  });

  it('T3.2: Pairwise: API Key revocation immediately locks out subsequent telemetry sync calls', async () => {
    assert.ok(apiKeyId, 'apiKeyId must exist');
    assert.ok(rawApiKey, 'rawApiKey must exist');

    // Revoke the API key
    const revokeRes = await userClient.delete(`/api/api-keys/${apiKeyId}`);
    assert.ok(revokeRes.status === 200 || revokeRes.status === 204);

    // Attempt to sync using the revoked API key
    const payload = buildTelemetryPayload();
    const rejectedSyncRes = await apiKeyClient.post('/api/telemetry/sync', payload);
    assert.equal(
      rejectedSyncRes.status,
      401,
      `Expected 401 Unauthorized after API key revocation, got ${rejectedSyncRes.status}: ${rejectedSyncRes.rawText}`
    );
  });
});
