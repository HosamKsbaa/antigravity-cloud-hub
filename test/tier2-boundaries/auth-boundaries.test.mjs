// test/tier2-boundaries/auth-boundaries.test.mjs
// Tier 2: Boundary & Corner Cases - Auth, RBAC & Last-Admin Protection

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../helpers/api-client.mjs';
import { ADMIN_EMAIL, ADMIN_PASSWORD, generateRandomEmail, generateRandomPassword } from '../helpers/test-env.mjs';

describe('Tier 2: Auth, RBAC & Last-Admin Boundaries', () => {
  const adminClient = createApiClient();
  let adminUserId = null;

  it('T2.1: Login with empty credentials returns 400 or 401', async () => {
    const client = createApiClient();
    const res = await client.post('/api/auth/login', { email: '', password: '' });
    assert.ok(
      res.status === 400 || res.status === 401,
      `Expected 400 Bad Request or 401 Unauthorized, got ${res.status}`
    );
  });

  it('T2.2: Login with incorrect password returns 401 Unauthorized', async () => {
    const client = createApiClient();
    const res = await client.post('/api/auth/login', {
      email: ADMIN_EMAIL,
      password: 'CompletelyWrongPassword123!'
    });
    assert.equal(res.status, 401, `Expected 401 Unauthorized on invalid password, got ${res.status}`);
  });

  it('T2.3: Accessing admin endpoint /api/users without authentication returns 401', async () => {
    const unauthClient = createApiClient();
    const res = await unauthClient.get('/api/users');
    assert.equal(res.status, 401, `Expected 401 Unauthorized for unauthenticated call, got ${res.status}`);
  });

  it('T2.4: Regular user accessing admin endpoint /api/users returns 403 Forbidden', async () => {
    await adminClient.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    
    // Create a regular user
    const userEmail = generateRandomEmail('t2_reg');
    const userPassword = generateRandomPassword();
    const createRes = await adminClient.post('/api/users', {
      email: userEmail,
      password: userPassword,
      role: 'user'
    });
    assert.ok(createRes.status === 200 || createRes.status === 201);
    const userId = (createRes.data?.user || createRes.data?.data?.user || createRes.data?.data || createRes.data)?.id;

    const userClient = createApiClient();
    await userClient.login(userEmail, userPassword);

    const res = await userClient.get('/api/users');
    assert.equal(res.status, 403, `Expected 403 Forbidden for regular user, got ${res.status}`);

    // Cleanup user
    if (userId) await adminClient.delete(`/api/users/${userId}`);
  });

  it('T2.5: STRICT LAST-ADMIN PROTECTION: Demoting the sole active admin returns 409 Conflict', async () => {
    await adminClient.login(ADMIN_EMAIL, ADMIN_PASSWORD);

    // Get admin user ID
    const meRes = await adminClient.get('/api/auth/me');
    const user = meRes.data?.user || meRes.data?.data?.user || meRes.data;
    adminUserId = user?.id;
    assert.ok(adminUserId, 'Admin user ID must exist');

    // Ensure there are no other active admins before testing last-admin lockout
    const listRes = await adminClient.get('/api/users');
    const usersList = listRes.data?.users || listRes.data?.data?.users || listRes.data?.data || listRes.data || [];
    const otherAdmins = usersList.filter(u => u.role === 'admin' && u.id !== adminUserId && u.isActive !== false);

    // Demote any extra admins so only the seeded admin is active
    for (const extraAdmin of otherAdmins) {
      await adminClient.patch(`/api/users/${extraAdmin.id}/role`, { role: 'user' });
    }

    // Now attempt to demote the sole remaining active admin
    const demoteRes = await adminClient.patch(`/api/users/${adminUserId}/role`, {
      role: 'user'
    });

    assert.equal(
      demoteRes.status,
      409,
      `Expected 409 Conflict on demoting last active admin, got ${demoteRes.status}: ${demoteRes.rawText}`
    );
  });

  it('T2.6: STRICT LAST-ADMIN PROTECTION: Deleting the sole active admin returns 409 Conflict', async () => {
    assert.ok(adminUserId, 'adminUserId must exist');

    const deleteRes = await adminClient.delete(`/api/users/${adminUserId}`);
    assert.equal(
      deleteRes.status,
      409,
      `Expected 409 Conflict on deleting last active admin, got ${deleteRes.status}: ${deleteRes.rawText}`
    );
  });

  it('T2.7: Creating user with already-registered email returns 409 Conflict', async () => {
    const res = await adminClient.post('/api/users', {
      email: ADMIN_EMAIL, // Duplicate of existing admin
      password: 'AnotherPassword123!',
      role: 'user'
    });
    assert.equal(res.status, 409, `Expected 409 Conflict on duplicate email, got ${res.status}: ${res.rawText}`);
  });

  it('T2.8: Request with invalid / forged JWT token returns 401 Unauthorized', async () => {
    const forgedClient = createApiClient();
    forgedClient.setToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.fake_signature_xyz123');

    const res = await forgedClient.get('/api/auth/me');
    assert.equal(res.status, 401, `Expected 401 Unauthorized on forged token, got ${res.status}`);
  });

  it('T2.9: Request with fake / malformed API key returns 401 Unauthorized', async () => {
    const fakeKeyClient = createApiClient();
    fakeKeyClient.setApiKey('agy_fake_non_existent_key_00000000000000000000000000000000');

    const res = await fakeKeyClient.get('/api/auth/me');
    assert.equal(res.status, 401, `Expected 401 Unauthorized on fake API key, got ${res.status}`);
  });
});
