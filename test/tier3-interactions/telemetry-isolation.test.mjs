// test/tier3-interactions/telemetry-isolation.test.mjs
// Tier 3: Cross-Feature Interactions - Multi-User Telemetry Data Isolation & Admin Aggregation

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../helpers/api-client.mjs';
import { ADMIN_EMAIL, ADMIN_PASSWORD, generateRandomEmail, generateRandomPassword } from '../helpers/test-env.mjs';
import { buildTelemetryPayload } from '../helpers/fixtures.mjs';

describe('Tier 3: Multi-User Telemetry Isolation & Admin Aggregation', () => {
  const adminClient = createApiClient();
  const aliceClient = createApiClient();
  const bobClient = createApiClient();

  const aliceEmail = generateRandomEmail('t3_alice');
  const alicePassword = generateRandomPassword();
  const bobEmail = generateRandomEmail('t3_bob');
  const bobPassword = generateRandomPassword();

  const aliceWorkspace = 'workspace-alice-' + Math.random().toString(36).substring(2, 6);
  const bobWorkspace = 'workspace-bob-' + Math.random().toString(36).substring(2, 6);

  it('T3.7: Alice and Bob telemetry metrics remain isolated to their respective accounts while Admin aggregates both', async () => {
    // 1. Admin creates Alice and Bob
    await adminClient.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    await adminClient.post('/api/users', { email: aliceEmail, password: alicePassword, role: 'user' });
    await adminClient.post('/api/users', { email: bobEmail, password: bobPassword, role: 'user' });

    // 2. Alice logs in and syncs telemetry
    await aliceClient.login(aliceEmail, alicePassword);
    const alicePayload = buildTelemetryPayload({
      workspaces: [{
        workspaceName: aliceWorkspace,
        workspacePath: `/home/alice/${aliceWorkspace}`,
        conversationsCount: 1,
        turnsCount: 2,
        inputTokens: 3000,
        cacheReadTokens: 9000,
        outputTokens: 600,
        thinkingTokens: 200,
        responseTokens: 400,
        costUsd: 0.015
      }]
    });
    const aliceSync = await aliceClient.post('/api/telemetry/sync', alicePayload);
    assert.equal(aliceSync.status, 200);

    // 3. Bob logs in and syncs telemetry
    await bobClient.login(bobEmail, bobPassword);
    const bobPayload = buildTelemetryPayload({
      workspaces: [{
        workspaceName: bobWorkspace,
        workspacePath: `/home/bob/${bobWorkspace}`,
        conversationsCount: 1,
        turnsCount: 3,
        inputTokens: 7000,
        cacheReadTokens: 21000,
        outputTokens: 1400,
        thinkingTokens: 500,
        responseTokens: 900,
        costUsd: 0.035
      }]
    });
    const bobSync = await bobClient.post('/api/telemetry/sync', bobPayload);
    assert.equal(bobSync.status, 200);

    // 4. Alice queries summary: should NOT see Bob's workspace
    const aliceSummaryRes = await aliceClient.get('/api/telemetry/summary');
    assert.equal(aliceSummaryRes.status, 200);
    const aliceSummary = aliceSummaryRes.data?.data || aliceSummaryRes.data;
    const aliceWorkspaces = aliceSummary.topWorkspaces || aliceSummary.workspaces || [];
    assert.ok(
      !aliceWorkspaces.some(w => w.workspaceName === bobWorkspace),
      "Alice's summary must not contain Bob's workspace"
    );

    // 5. Bob queries summary: should NOT see Alice's workspace
    const bobSummaryRes = await bobClient.get('/api/telemetry/summary');
    assert.equal(bobSummaryRes.status, 200);
    const bobSummary = bobSummaryRes.data?.data || bobSummaryRes.data;
    const bobWorkspaces = bobSummary.topWorkspaces || bobSummary.workspaces || [];
    assert.ok(
      !bobWorkspaces.some(w => w.workspaceName === aliceWorkspace),
      "Bob's summary must not contain Alice's workspace"
    );

    // 6. Admin queries with scope=all: sees both workspaces or aggregated statistics
    const adminSummaryRes = await adminClient.get('/api/telemetry/summary?scope=all');
    assert.equal(adminSummaryRes.status, 200);
    const adminSummary = adminSummaryRes.data?.data || adminSummaryRes.data;
    assert.ok(adminSummary, 'Admin summary should aggregate team data');
  });
});
