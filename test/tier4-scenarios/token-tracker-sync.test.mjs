// test/tier4-scenarios/token-tracker-sync.test.mjs
// Tier 4: Real-World Scenario - Complete token-tracker Extension Background Sync Simulation

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../helpers/api-client.mjs';
import { ADMIN_EMAIL, ADMIN_PASSWORD, generateRandomEmail, generateRandomPassword } from '../helpers/test-env.mjs';

describe('Tier 4 Scenario: Complete token-tracker Extension Sync Flow', () => {
  const adminClient = createApiClient();
  const developerClient = createApiClient();
  const tokenTrackerClient = createApiClient();

  const devEmail = generateRandomEmail('dev_token_tracker');
  const devPassword = generateRandomPassword();
  let apiKeySecret = null;

  it('T4.1: Executes realistic multi-turn token-tracker telemetry sync from IDE plugin', async () => {
    // 1. Admin provisions developer account
    await adminClient.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    await adminClient.post('/api/users', {
      email: devEmail,
      password: devPassword,
      role: 'user',
      name: 'Mobile Developer'
    });

    // 2. Developer logs into Web UI to generate extension API key
    await developerClient.login(devEmail, devPassword);
    const keyRes = await developerClient.post('/api/api-keys', {
      name: 'VSCode / Antigravity IDE Key'
    });
    assert.ok(keyRes.status === 200 || keyRes.status === 201);
    const keyData = keyRes.data?.apiKey || keyRes.data?.data?.apiKey || keyRes.data?.data || keyRes.data;
    apiKeySecret = keyData.key || keyData.secretKey;
    assert.ok(apiKeySecret, 'API Key secret must be generated');

    // 3. Configure token-tracker client with API key
    tokenTrackerClient.setApiKey(apiKeySecret);

    // 4. Simulate token-tracker sync payload with multiple conversations, models, thinking vs response tokens
    const conversationId1 = 'conv-dev-' + Date.now();
    const conversationId2 = 'conv-subagent-' + Date.now();
    const syncTimestamp = new Date().toISOString();
    const today = syncTimestamp.split('T')[0];

    const telemetryPayload = {
      clientVersion: '2.0.0',
      machineId: 'dev-workstation-x86_64',
      syncedAt: syncTimestamp,
      workspaces: [
        {
          workspaceName: 'homes-mobile-app',
          workspacePath: '/home/mr-h/Documents/Homes-Flutter',
          conversationsCount: 2,
          turnsCount: 14,
          inputTokens: 125000,
          cacheReadTokens: 480000,
          outputTokens: 31000,
          thinkingTokens: 14000,
          responseTokens: 17000,
          costUsd: 0.385
        }
      ],
      dailyUsage: [
        {
          date: today,
          modelName: 'Gemini 4 Argon (High)',
          workspaceName: 'homes-mobile-app',
          turns: 10,
          inputTokens: 95000,
          cacheReadTokens: 380000,
          outputTokens: 25000,
          thinkingTokens: 11000,
          responseTokens: 14000,
          totalTokens: 500000,
          costUsd: 0.315
        },
        {
          date: today,
          modelName: 'Gemini 3.8 Flash (Tiered)',
          workspaceName: 'homes-mobile-app',
          turns: 4,
          inputTokens: 30000,
          cacheReadTokens: 100000,
          outputTokens: 6000,
          thinkingTokens: 3000,
          responseTokens: 3000,
          totalTokens: 136000,
          costUsd: 0.070
        }
      ],
      conversations: [
        {
          conversationId: conversationId1,
          title: 'Implement Clean Architecture Riverpod Provider',
          workspaceName: 'homes-mobile-app',
          workspacePath: '/home/mr-h/Documents/Homes-Flutter',
          isSubagent: false,
          agentName: null,
          parentConversationId: null,
          primaryModel: 'Gemini 4 Argon (High)',
          turns: 10,
          inputTokens: 95000,
          cacheReadTokens: 380000,
          outputTokens: 25000,
          thinkingTokens: 11000,
          responseTokens: 14000,
          totalTokens: 500000,
          costUsd: 0.315,
          firstAt: syncTimestamp,
          lastActiveAt: syncTimestamp
        },
        {
          conversationId: conversationId2,
          title: 'Extract Widget Test Harness',
          workspaceName: 'homes-mobile-app',
          workspacePath: '/home/mr-h/Documents/Homes-Flutter',
          isSubagent: true,
          agentName: 'teamwork_preview_worker_m1_1',
          parentConversationId: conversationId1,
          primaryModel: 'Gemini 3.8 Flash (Tiered)',
          turns: 4,
          inputTokens: 30000,
          cacheReadTokens: 100000,
          outputTokens: 6000,
          thinkingTokens: 3000,
          responseTokens: 3000,
          totalTokens: 136000,
          costUsd: 0.070,
          firstAt: syncTimestamp,
          lastActiveAt: syncTimestamp
        }
      ],
      records: [
        {
          conversationId: conversationId1,
          stepIndex: 1,
          modelCode: 1417,
          modelName: 'Gemini 4 Argon (High)',
          backendModel: 'gemini-4-argon-b',
          inputTokens: 28400,
          cacheReadTokens: 115000,
          outputTokens: 3200,
          thinkingTokens: 1400,
          responseTokens: 1800,
          latencyMs: 2850,
          ttftMs: 420,
          costUsd: 0.075,
          tools: ['grep_search', 'view_file'],
          promptSummary: 'Verify telemetry persistence in database',
          traceId: 'tr-dev-01',
          createdAt: syncTimestamp
        }
      ]
    };

    // 5. Push telemetry sync from IDE
    const syncRes = await tokenTrackerClient.post('/api/telemetry/sync', telemetryPayload);
    assert.equal(syncRes.status, 200, `Expected 200 on telemetry sync, got ${syncRes.status}: ${syncRes.rawText}`);
    assert.ok(syncRes.data?.success !== false);

    // 6. Developer views telemetry dashboard summary in Web UI
    const summaryRes = await developerClient.get('/api/telemetry/summary');
    assert.equal(summaryRes.status, 200);
    const summary = summaryRes.data?.data || summaryRes.data;
    assert.ok(summary, 'Telemetry summary must be returned to developer');

    // 7. Admin views overall telemetry dashboard
    const adminSummaryRes = await adminClient.get('/api/telemetry/summary?scope=all');
    assert.equal(adminSummaryRes.status, 200);
    const adminSummary = adminSummaryRes.data?.data || adminSummaryRes.data;
    assert.ok(adminSummary, 'Admin summary must aggregate developer data');
  });
});
