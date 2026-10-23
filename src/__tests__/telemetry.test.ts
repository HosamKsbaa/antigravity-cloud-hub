import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { initDb, pool } from '../db/index.js';
import { seedAdminUser } from '../db/seed.js';

describe('Milestone 3: Telemetry Ingestion, Aggregation & Web UI Static Hosting', () => {
  const app = createApp();

  let adminToken: string;
  let adminId: string;
  let userToken: string;
  let userId: string;
  let userApiKey: string;

  beforeAll(async () => {
    await initDb();
    const admin = await seedAdminUser();
    adminId = admin.id;

    // Login as admin
    const adminLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'hosamchakasba@gmail.com', password: 'admin' });
    adminToken = adminLoginRes.body.token;

    // Create a regular user
    const testUserEmail = `m3_test_${Date.now()}@example.com`;
    const userRes = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: testUserEmail, password: 'password123', role: 'user' });
    userId = userRes.body.id || userRes.body.user?.id;

    // Login as regular user
    const userLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: testUserEmail, password: 'password123' });
    userToken = userLoginRes.body.token;

    // Generate API key for regular user
    const keyRes = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'M3 Test Key' });
    userApiKey = keyRes.body.key || keyRes.body.apiKey?.key;
  });

  afterAll(async () => {
    // Clean up test user
    if (userId) {
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Authentication & Boundary Checks
  // ---------------------------------------------------------------------------
  it('POST /api/telemetry/sync rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .post('/api/telemetry/sync')
      .send({ clientVersion: '2.0.0' });

    expect(res.status).toBe(401);
  });

  it('POST /api/telemetry/sync handles empty JSON body gracefully (200, count: 0)', async () => {
    const res = await request(app)
      .post('/api/telemetry/sync')
      .set('Authorization', `Bearer ${userToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.syncedCount).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 2. Ingestion via JWT and API Key
  // ---------------------------------------------------------------------------
  it('POST /api/telemetry/sync ingests payload via Bearer JWT', async () => {
    const convId = `conv-jwt-${Date.now()}`;
    const payload = {
      clientVersion: '2.0.0',
      syncedAt: new Date().toISOString(),
      workspaces: [
        {
          workspaceName: 'm3-unit-jwt-ws',
          workspacePath: '/workspace/m3-jwt',
          turnsCount: 4,
          inputTokens: 5000,
          cacheReadTokens: 15000,
          outputTokens: 1200,
          thinkingTokens: 400,
          responseTokens: 800,
          costUsd: 0.025,
        },
      ],
      dailyUsage: [
        {
          date: new Date().toISOString().split('T')[0],
          modelName: 'Gemini 4 Argon (High)',
          workspaceName: 'm3-unit-jwt-ws',
          turns: 4,
          inputTokens: 5000,
          cacheReadTokens: 15000,
          outputTokens: 1200,
          thinkingTokens: 400,
          responseTokens: 800,
          totalTokens: 21200,
          costUsd: 0.025,
        },
      ],
      conversations: [
        {
          conversationId: convId,
          title: 'Unit Test JWT Conversation',
          workspaceName: 'm3-unit-jwt-ws',
          primaryModel: 'Gemini 4 Argon (High)',
          turns: 4,
          inputTokens: 5000,
          cacheReadTokens: 15000,
          outputTokens: 1200,
          thinkingTokens: 400,
          responseTokens: 800,
          totalTokens: 21200,
          costUsd: 0.025,
        },
      ],
    };

    const res = await request(app)
      .post('/api/telemetry/sync')
      .set('Authorization', `Bearer ${userToken}`)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.syncedCount).toBeGreaterThan(0);
  });

  it('POST /api/telemetry/sync ingests payload via X-API-Key header', async () => {
    const payload = {
      clientVersion: '2.0.0',
      syncedAt: new Date().toISOString(),
      workspaces: [
        {
          workspaceName: 'm3-unit-apikey-ws',
          workspacePath: '/workspace/m3-key',
          turnsCount: 2,
          inputTokens: 3000,
          cacheReadTokens: 8000,
          outputTokens: 600,
          costUsd: 0.015,
        },
      ],
    };

    const res = await request(app)
      .post('/api/telemetry/sync')
      .set('X-API-Key', userApiKey)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.syncedCount).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // 3. Telemetry Summary Analytics
  // ---------------------------------------------------------------------------
  it('GET /api/telemetry/summary returns aggregated metrics and breakdowns', async () => {
    const res = await request(app)
      .get('/api/telemetry/summary')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.totalTokens).toBeGreaterThan(0);
    expect(res.body.estimatedCostUsd).toBeGreaterThanOrEqual(0);
    expect(res.body.totals).toBeDefined();
    expect(Array.isArray(res.body.models)).toBe(true);
    expect(Array.isArray(res.body.workspaces)).toBe(true);
    expect(Array.isArray(res.body.daily)).toBe(true);
  });

  it('GET /api/telemetry/summary supports ?period=today and invalid period fallback', async () => {
    const todayRes = await request(app)
      .get('/api/telemetry/summary?period=today')
      .set('Authorization', `Bearer ${userToken}`);
    expect(todayRes.status).toBe(200);
    expect(todayRes.body.ok).toBe(true);

    const fallbackRes = await request(app)
      .get('/api/telemetry/summary?period=non_existent_period_xyz')
      .set('Authorization', `Bearer ${userToken}`);
    expect(fallbackRes.status).toBe(200);
    expect(fallbackRes.body.ok).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 4. Web UI Static Hosting & Security Headers
  // ---------------------------------------------------------------------------
  it('GET /login serves Web UI HTML document', async () => {
    const res = await request(app).get('/login');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('id="root"');
  });

  it('GET /dashboard falls back to index.html for Single Page App routing', async () => {
    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('id="root"');
  });

  it('All responses include X-Content-Type-Options: nosniff security header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
