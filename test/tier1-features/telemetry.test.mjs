// test/tier1-features/telemetry.test.mjs
// Tier 1: Feature Coverage - Telemetry Ingestion and Dashboard Summary API

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../helpers/api-client.mjs';
import { ADMIN_EMAIL, ADMIN_PASSWORD, generateRandomEmail, generateRandomPassword } from '../helpers/test-env.mjs';
import { buildTelemetryPayload } from '../helpers/fixtures.mjs';

describe('Tier 1: Telemetry Ingestion & Summary Analytics', () => {
  const adminClient = createApiClient();
  let userApiKey = null;
  const userClient = createApiClient();
  const testUserEmail = generateRandomEmail('t1_telem');
  const testUserPassword = generateRandomPassword();

  it('T1.17: POST /api/telemetry/sync accepts token-tracker payload via Bearer JWT', async () => {
    await adminClient.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    
    // Create regular user for telemetry testing
    const createRes = await adminClient.post('/api/users', {
      email: testUserEmail,
      password: testUserPassword,
      role: 'user'
    });
    assert.ok(createRes.status === 200 || createRes.status === 201);

    await userClient.login(testUserEmail, testUserPassword);

    const payload = buildTelemetryPayload({
      workspaces: [
        {
          workspaceName: 't1-jwt-workspace',
          workspacePath: '/workspace/t1',
          conversationsCount: 1,
          turnsCount: 3,
          inputTokens: 5000,
          cacheReadTokens: 15000,
          outputTokens: 1000,
          thinkingTokens: 400,
          responseTokens: 600,
          costUsd: 0.025
        }
      ]
    });

    const res = await userClient.post('/api/telemetry/sync', payload);
    assert.equal(res.status, 200, `Expected 200 OK on sync, got ${res.status}: ${res.rawText}`);
    assert.ok(res.data?.success !== false, 'Sync response should indicate success');
  });

  it('T1.18: POST /api/telemetry/sync accepts token-tracker payload via X-API-Key header', async () => {
    // Generate API key for userClient
    const keyRes = await userClient.post('/api/api-keys', { name: 'Telemetry Sync Key' });
    assert.ok(keyRes.status === 200 || keyRes.status === 201);
    const keyData = keyRes.data?.apiKey || keyRes.data?.data?.apiKey || keyRes.data?.data || keyRes.data;
    userApiKey = keyData?.key || keyData?.secretKey;
    assert.ok(userApiKey, 'Must obtain plaintext API key');

    const extensionClient = createApiClient();
    extensionClient.setApiKey(userApiKey);

    const payload = buildTelemetryPayload({
      workspaces: [
        {
          workspaceName: 't1-apikey-workspace',
          workspacePath: '/workspace/apikey',
          conversationsCount: 1,
          turnsCount: 4,
          inputTokens: 8000,
          cacheReadTokens: 24000,
          outputTokens: 1500,
          thinkingTokens: 500,
          responseTokens: 1000,
          costUsd: 0.04
        }
      ]
    });

    const res = await extensionClient.post('/api/telemetry/sync', payload);
    assert.equal(res.status, 200, `Expected 200 OK with API key sync, got ${res.status}: ${res.rawText}`);
    assert.ok(res.data?.success !== false);
  });

  it('T1.19: GET /api/telemetry/summary returns aggregated totals', async () => {
    const res = await userClient.get('/api/telemetry/summary');
    assert.equal(res.status, 200, `Expected 200 OK on summary query, got ${res.status}: ${res.rawText}`);
    
    const summary = res.data?.data || res.data;
    assert.ok(summary, 'Summary payload should be present');
    assert.ok(summary.totals || summary.totalTokens !== undefined, 'Summary must contain totals breakdown');

    const totals = summary.totals || summary;
    assert.ok(totals.totalTokens !== undefined || totals.inputTokens !== undefined, 'Must report token counts');
  });

  it('T1.20: GET /api/telemetry/summary supports ?period=today query parameter', async () => {
    const res = await userClient.get('/api/telemetry/summary?period=today');
    assert.equal(res.status, 200, `Expected 200 OK with period filter, got ${res.status}: ${res.rawText}`);
    
    const summary = res.data?.data || res.data;
    assert.ok(summary, 'Filtered summary must be returned');
  });

  it('T1.21: Telemetry summary includes models breakdown', async () => {
    const res = await userClient.get('/api/telemetry/summary');
    assert.equal(res.status, 200);

    const summary = res.data?.data || res.data;
    const models = summary.modelsBreakdown || summary.models;
    assert.ok(Array.isArray(models), 'Summary should include models breakdown array');
  });

  it('T1.22: Telemetry summary includes top workspaces list', async () => {
    const res = await userClient.get('/api/telemetry/summary');
    assert.equal(res.status, 200);

    const summary = res.data?.data || res.data;
    const workspaces = summary.topWorkspaces || summary.workspaces;
    assert.ok(Array.isArray(workspaces), 'Summary should include workspaces array');
  });
});
