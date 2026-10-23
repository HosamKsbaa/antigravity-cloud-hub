// test/tier1-features/auth-rbac.test.mjs
// Tier 1: Feature Coverage - Authentication, User Management, RBAC & API Keys

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../helpers/api-client.mjs';
import { ADMIN_EMAIL, ADMIN_PASSWORD, generateRandomEmail, generateRandomPassword } from '../helpers/test-env.mjs';

describe('Tier 1: Auth, RBAC & API Key Management', () => {
  const adminClient = createApiClient();
  let createdUserId = null;
  let testUserEmail = generateRandomEmail('t1_user');
  let testUserPassword = generateRandomPassword();
  let createdApiKeyId = null;

  it('T1.1: Admin login with seeded credentials returns JWT and user profile', async () => {
    const res = await adminClient.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    assert.equal(res.status, 200, `Expected 200 OK, got ${res.status}: ${res.rawText}`);
    
    const token = res.data?.token || res.data?.data?.token;
    assert.ok(token, 'Response should contain authentication token');
    assert.ok(typeof token === 'string' && token.length > 20, 'Token should be a valid string');

    const user = res.data?.user || res.data?.data?.user;
    assert.ok(user, 'Response should contain user profile');
    assert.equal(user.email, ADMIN_EMAIL, 'User email should match seeded admin');
    assert.equal(user.role, 'admin', 'User role should be admin');
  });

  it('T1.2: GET /api/auth/me returns profile for authenticated session', async () => {
    const res = await adminClient.get('/api/auth/me');
    assert.equal(res.status, 200, `Expected 200 OK, got ${res.status}`);
    const user = res.data?.user || res.data?.data?.user || res.data;
    assert.ok(user?.email, 'User profile must include email');
    assert.equal(user.email, ADMIN_EMAIL);
    assert.equal(user.role, 'admin');
  });

  it('T1.3: Admin creates a new regular user (role: "user")', async () => {
    const res = await adminClient.post('/api/users', {
      email: testUserEmail,
      password: testUserPassword,
      role: 'user',
      name: 'E2E Test User'
    });
    assert.ok(res.status === 200 || res.status === 201, `Expected 200 or 201, got ${res.status}: ${res.rawText}`);
    
    const user = res.data?.user || res.data?.data?.user || res.data?.data || res.data;
    assert.ok(user?.id, 'Created user should have an id');
    createdUserId = user.id;
    assert.equal(user.email, testUserEmail);
    assert.equal(user.role, 'user');
  });

  it('T1.4: Newly created user can log in with their credentials', async () => {
    const userClient = createApiClient();
    const res = await userClient.login(testUserEmail, testUserPassword);
    assert.equal(res.status, 200, `Expected 200 OK on user login, got ${res.status}: ${res.rawText}`);
    
    const token = res.data?.token || res.data?.data?.token;
    assert.ok(token, 'User should receive valid token upon login');

    const meRes = await userClient.get('/api/auth/me');
    assert.equal(meRes.status, 200);
    const user = meRes.data?.user || meRes.data?.data?.user || meRes.data;
    assert.equal(user.role, 'user');
  });

  it('T1.5: Admin promotes regular user to admin (role: "admin")', async () => {
    assert.ok(createdUserId, 'createdUserId must exist');
    const res = await adminClient.patch(`/api/users/${createdUserId}/role`, {
      role: 'admin'
    });
    assert.equal(res.status, 200, `Expected 200 OK on role promotion, got ${res.status}: ${res.rawText}`);
    
    const user = res.data?.user || res.data?.data?.user || res.data?.data || res.data;
    assert.equal(user?.role, 'admin', 'Target user role should now be admin');
  });

  it('T1.6: Admin demotes user back to regular user (role: "user")', async () => {
    assert.ok(createdUserId, 'createdUserId must exist');
    const res = await adminClient.patch(`/api/users/${createdUserId}/role`, {
      role: 'user'
    });
    assert.equal(res.status, 200, `Expected 200 OK on role demotion, got ${res.status}: ${res.rawText}`);
    
    const user = res.data?.user || res.data?.data?.user || res.data?.data || res.data;
    assert.equal(user?.role, 'user', 'Target user role should be restored to user');
  });

  it('T1.7: User generates an API key and receives plaintext secret key', async () => {
    const userClient = createApiClient();
    await userClient.login(testUserEmail, testUserPassword);

    const res = await userClient.post('/api/api-keys', {
      name: 'IDE Plugin Key 1'
    });
    assert.ok(res.status === 200 || res.status === 201, `Expected 200/201, got ${res.status}: ${res.rawText}`);
    
    const keyData = res.data?.apiKey || res.data?.data?.apiKey || res.data?.data || res.data;
    assert.ok(keyData?.id, 'API Key object must have an id');
    assert.ok(keyData?.key || keyData?.secretKey, 'API Key creation must return secret key once');
    createdApiKeyId = keyData.id;

    const rawKey = keyData.key || keyData.secretKey;
    assert.ok(rawKey.startsWith('agy_'), 'API key must start with agy_ prefix');
  });

  it('T1.8: User lists API keys and views key prefix metadata', async () => {
    const userClient = createApiClient();
    await userClient.login(testUserEmail, testUserPassword);

    const res = await userClient.get('/api/api-keys');
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${res.rawText}`);
    
    const keys = res.data?.apiKeys || res.data?.data?.apiKeys || res.data?.data || res.data;
    assert.ok(Array.isArray(keys), 'Result must be an array of API keys');
    const matching = keys.find(k => k.id === createdApiKeyId);
    assert.ok(matching, 'Created key should be listed');
    assert.equal(matching.name, 'IDE Plugin Key 1');
    assert.ok(matching.keyPrefix || matching.prefix, 'Must include key prefix');
  });

  it('T1.9: User revokes an API key successfully', async () => {
    const userClient = createApiClient();
    await userClient.login(testUserEmail, testUserPassword);
    assert.ok(createdApiKeyId, 'createdApiKeyId must exist');

    const res = await userClient.delete(`/api/api-keys/${createdApiKeyId}`);
    assert.ok(res.status === 200 || res.status === 204, `Expected 200 or 204, got ${res.status}`);

    // Verify key is no longer in list
    const listRes = await userClient.get('/api/api-keys');
    const keys = listRes.data?.apiKeys || listRes.data?.data?.apiKeys || listRes.data?.data || listRes.data || [];
    assert.ok(!keys.some(k => k.id === createdApiKeyId), 'Revoked key must not appear in active list');
  });

  it('T1.10: Admin deletes test user account', async () => {
    assert.ok(createdUserId, 'createdUserId must exist');
    const res = await adminClient.delete(`/api/users/${createdUserId}`);
    assert.ok(res.status === 200 || res.status === 204, `Expected 200/204 on delete, got ${res.status}: ${res.rawText}`);

    // Verify user cannot log in anymore
    const userClient = createApiClient();
    const loginRes = await userClient.login(testUserEmail, testUserPassword);
    assert.ok(loginRes.status === 401 || loginRes.status === 404, `Deleted user login should fail, got ${loginRes.status}`);
  });
});
