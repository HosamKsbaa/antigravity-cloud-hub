import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { initDb, pool } from '../db/index.js';
import { seedAdminUser } from '../db/seed.js';

describe('Milestone 1: Backend Foundation, Authentication, RBAC & Last-Admin Protection', () => {
  const app = createApp();

  let adminToken: string;
  let adminId: string;
  let regularUserId: string;
  let regularUserToken: string;
  let generatedApiKey: string;
  let generatedApiKeyId: string;

  beforeAll(async () => {
    // Ensure DB schema and initial admin exist
    await initDb();
    const admin = await seedAdminUser();
    adminId = admin.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  // ---------------------------------------------------------------------------
  // 1. Health check
  // ---------------------------------------------------------------------------
  it('GET /api/health should return ok and timestamp', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // 2. Authentication & Login
  // ---------------------------------------------------------------------------
  it('POST /api/auth/login should reject invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'hosamchakasba@gmail.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('POST /api/auth/login should reject non-existent user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'somepassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('POST /api/auth/login should succeed for seeded admin (hosamchakasba@gmail.com / admin)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'hosamchakasba@gmail.com', password: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe('hosamchakasba@gmail.com');
    expect(res.body.user.role).toBe('admin');

    adminToken = res.body.token;
    adminId = res.body.user.id;
  });

  it('GET /api/auth/me should return admin profile when authenticated with JWT Bearer', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(adminId);
    expect(res.body.user.email).toBe('hosamchakasba@gmail.com');
    expect(res.body.user.role).toBe('admin');
  });

  it('GET /api/auth/me should reject unauthenticated requests', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Authentication required');
  });

  // ---------------------------------------------------------------------------
  // 3. User Creation & Regular User RBAC
  // ---------------------------------------------------------------------------
  it('POST /api/users should allow admin to create a regular user', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'developer.alice@example.com',
        password: 'Password123!',
        name: 'Alice Dev',
        role: 'user',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.email).toBe('developer.alice@example.com');
    expect(res.body.role).toBe('user');
    expect(res.body.isActive).toBe(true);

    regularUserId = res.body.id;
  });

  it('Regular user should be able to log in', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'developer.alice@example.com', password: 'Password123!' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe('user');

    regularUserToken = res.body.token;
  });

  it('GET /api/users should forbid regular user with HTTP 403 Forbidden', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${regularUserToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Admin access required');
  });

  it('POST /api/users should forbid regular user from creating other users with HTTP 403', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${regularUserToken}`)
      .send({
        email: 'forbidden@example.com',
        password: 'Pass',
        role: 'user',
      });

    expect(res.status).toBe(403);
  });

  it('GET /api/users should allow admin to list all users', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);

    const emails = res.body.map((u: any) => u.email);
    expect(emails).toContain('hosamchakasba@gmail.com');
    expect(emails).toContain('developer.alice@example.com');
  });

  // ---------------------------------------------------------------------------
  // 4. Role Promotion & Demotion
  // ---------------------------------------------------------------------------
  it('PATCH /api/users/:id/role should allow admin to promote regular user to admin', async () => {
    const res = await request(app)
      .patch(`/api/users/${regularUserId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(regularUserId);
    expect(res.body.role).toBe('admin');
  });

  it('PATCH /api/users/:id/role should allow demoting second admin back to user (since 1 admin remains)', async () => {
    const res = await request(app)
      .patch(`/api/users/${regularUserId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'user' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(regularUserId);
    expect(res.body.role).toBe('user');
  });

  // ---------------------------------------------------------------------------
  // 5. Strict Last-Admin Protection
  // ---------------------------------------------------------------------------
  it('PATCH /api/users/:id/role on the ONLY remaining admin should be REJECTED with HTTP 409 Conflict', async () => {
    // Attempt to demote hosamchakasba@gmail.com when they are the only active admin
    const res = await request(app)
      .patch(`/api/users/${adminId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'user' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Cannot demote or delete the last remaining active admin');
  });

  it('DELETE /api/users/:id on the ONLY remaining admin should be REJECTED with HTTP 409 Conflict', async () => {
    // Attempt to delete hosamchakasba@gmail.com when they are the only active admin
    const res = await request(app)
      .delete(`/api/users/${adminId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Cannot demote or delete the last remaining active admin');
  });

  it('DELETE /api/users/:id on a non-admin user should succeed with HTTP 200', async () => {
    const res = await request(app)
      .delete(`/api/users/${regularUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 6. API Key Generation & X-API-Key Authentication
  // ---------------------------------------------------------------------------
  it('POST /api/api-keys should generate a new API key returning the plain secret once', async () => {
    const res = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Antigravity IDE Extension' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('Antigravity IDE Extension');
    expect(res.body.keyPrefix).toBeDefined();
    expect(res.body.key).toMatch(/^agy_[0-9a-f]{64}$/);

    generatedApiKey = res.body.key;
    generatedApiKeyId = res.body.id;
  });

  it('GET /api/api-keys should list user API keys without disclosing secret key', async () => {
    const res = await request(app)
      .get('/api/api-keys')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);

    const found = res.body.find((k: any) => k.id === generatedApiKeyId);
    expect(found).toBeDefined();
    expect(found.keyPrefix).toBeDefined();
    expect(found.key).toBeUndefined(); // Secret key must not be exposed
  });

  it('GET /api/auth/me should authenticate successfully via X-API-Key header', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('X-API-Key', generatedApiKey);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(adminId);
    expect(res.body.user.email).toBe('hosamchakasba@gmail.com');
  });

  it('GET /api/auth/me should reject invalid X-API-Key with HTTP 401', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('X-API-Key', 'agy_invalid0000000000000000000000000000000000000000000000000000000000');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid API key');
  });

  it('DELETE /api/api-keys/:id should delete the API key', async () => {
    const res = await request(app)
      .delete(`/api/api-keys/${generatedApiKeyId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('Deleted API key should no longer authenticate', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('X-API-Key', generatedApiKey);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid API key');
  });
});
