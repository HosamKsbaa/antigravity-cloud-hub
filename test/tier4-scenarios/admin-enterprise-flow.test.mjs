// test/tier4-scenarios/admin-enterprise-flow.test.mjs
// Tier 4: Real-World Scenario - Multi-User Enterprise Admin & Team Member Lifecycle

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../helpers/api-client.mjs';
import { ADMIN_EMAIL, ADMIN_PASSWORD, generateRandomEmail, generateRandomPassword } from '../helpers/test-env.mjs';
import { buildTelemetryPayload } from '../helpers/fixtures.mjs';

describe('Tier 4 Scenario: Enterprise Multi-User Administration Lifecycle', () => {
  const ownerClient = createApiClient();
  const aliceClient = createApiClient();
  const bobClient = createApiClient();

  const aliceEmail = generateRandomEmail('alice_team');
  const alicePassword = generateRandomPassword();
  let aliceId = null;

  const bobEmail = generateRandomEmail('bob_team');
  const bobPassword = generateRandomPassword();
  let bobId = null;

  it('T4.3: Executes complete multi-user onboarding, telemetry, co-admin promotion, and self-demotion flow', async () => {
    // 1. Owner logs in
    await ownerClient.login(ADMIN_EMAIL, ADMIN_PASSWORD);

    // 2. Owner creates Alice and Bob accounts
    const aliceCreateRes = await ownerClient.post('/api/users', {
      email: aliceEmail,
      password: alicePassword,
      role: 'user',
      name: 'Alice Cooper'
    });
    assert.ok(aliceCreateRes.status === 200 || aliceCreateRes.status === 201);
    aliceId = (aliceCreateRes.data?.user || aliceCreateRes.data?.data?.user || aliceCreateRes.data?.data || aliceCreateRes.data)?.id;

    const bobCreateRes = await ownerClient.post('/api/users', {
      email: bobEmail,
      password: bobPassword,
      role: 'user',
      name: 'Bob Marley'
    });
    assert.ok(bobCreateRes.status === 200 || bobCreateRes.status === 201);
    bobId = (bobCreateRes.data?.user || bobCreateRes.data?.data?.user || bobCreateRes.data?.data || bobCreateRes.data)?.id;

    // 3. Alice and Bob log in and push telemetry
    await aliceClient.login(aliceEmail, alicePassword);
    const aliceSync = await aliceClient.post('/api/telemetry/sync', buildTelemetryPayload({
      workspaces: [{
        workspaceName: 'frontend-portal',
        workspacePath: '/src/frontend-portal',
        conversationsCount: 1,
        turnsCount: 4,
        inputTokens: 8000,
        cacheReadTokens: 32000,
        outputTokens: 2000,
        thinkingTokens: 800,
        responseTokens: 1200,
        costUsd: 0.03
      }]
    }));
    assert.equal(aliceSync.status, 200);

    await bobClient.login(bobEmail, bobPassword);
    const bobSync = await bobClient.post('/api/telemetry/sync', buildTelemetryPayload({
      workspaces: [{
        workspaceName: 'backend-microservice',
        workspacePath: '/src/backend-microservice',
        conversationsCount: 1,
        turnsCount: 5,
        inputTokens: 15000,
        cacheReadTokens: 60000,
        outputTokens: 3000,
        thinkingTokens: 1200,
        responseTokens: 1800,
        costUsd: 0.05
      }]
    }));
    assert.equal(bobSync.status, 200);

    // 4. Owner verifies aggregated telemetry in dashboard summary
    const ownerSummary = await ownerClient.get('/api/telemetry/summary?scope=all');
    assert.equal(ownerSummary.status, 200);

    // 5. Owner promotes Bob to co-administrator
    const promoteBobRes = await ownerClient.patch(`/api/users/${bobId}/role`, { role: 'admin' });
    assert.equal(promoteBobRes.status, 200);

    // 6. Bob logs in as admin and lists users
    await bobClient.login(bobEmail, bobPassword);
    const usersListRes = await bobClient.get('/api/users');
    assert.equal(usersListRes.status, 200, 'Co-admin Bob should have access to /api/users');

    // 7. Bob demotes himself back to regular user
    const bobSelfDemote = await bobClient.patch(`/api/users/${bobId}/role`, { role: 'user' });
    assert.equal(bobSelfDemote.status, 200, 'Bob demoting himself when Owner remains should succeed');

    // 8. Bob confirms he no longer has admin access
    await bobClient.login(bobEmail, bobPassword);
    const postDemoteCheck = await bobClient.get('/api/users');
    assert.equal(postDemoteCheck.status, 403, 'Bob should now receive 403 Forbidden on /api/users');

    // 9. Cleanup test users
    if (aliceId) await ownerClient.delete(`/api/users/${aliceId}`);
    if (bobId) await ownerClient.delete(`/api/users/${bobId}`);
  });
});
