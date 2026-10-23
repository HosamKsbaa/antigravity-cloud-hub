// test/tier3-interactions/admin-lifecycle.test.mjs
// Tier 3: Cross-Feature Interactions - Role Transitions, Session Lockouts & Dual-Admin Safety

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../helpers/api-client.mjs';
import { ADMIN_EMAIL, ADMIN_PASSWORD, generateRandomEmail, generateRandomPassword } from '../helpers/test-env.mjs';

describe('Tier 3: Admin Lifecycle, Demotion Lockout & Dual-Admin Safety', () => {
  const adminClient = createApiClient();
  const candidateClient = createApiClient();

  const candidateEmail = generateRandomEmail('t3_candidate');
  const candidatePassword = generateRandomPassword();
  let candidateUserId = null;

  it('T3.3: User promotion enables admin access, and subsequent demotion immediately enforces 403 Forbidden', async () => {
    await adminClient.login(ADMIN_EMAIL, ADMIN_PASSWORD);

    // 1. Create candidate user
    const createRes = await adminClient.post('/api/users', {
      email: candidateEmail,
      password: candidatePassword,
      role: 'user'
    });
    assert.ok(createRes.status === 200 || createRes.status === 201);
    const user = createRes.data?.user || createRes.data?.data?.user || createRes.data?.data || createRes.data;
    candidateUserId = user.id;

    // 2. Candidate logs in and cannot access /api/users
    await candidateClient.login(candidateEmail, candidatePassword);
    const initialForbidden = await candidateClient.get('/api/users');
    assert.equal(initialForbidden.status, 403);

    // 3. Admin promotes candidate to admin
    const promoteRes = await adminClient.patch(`/api/users/${candidateUserId}/role`, { role: 'admin' });
    assert.equal(promoteRes.status, 200);

    // Refresh candidate token/session if needed
    await candidateClient.login(candidateEmail, candidatePassword);

    // 4. Promoted user now successfully accesses /api/users
    const adminAccessRes = await candidateClient.get('/api/users');
    assert.equal(adminAccessRes.status, 200, `Promoted admin should access /api/users, got ${adminAccessRes.status}`);

    // 5. Original admin demotes candidate back to user
    const demoteRes = await adminClient.patch(`/api/users/${candidateUserId}/role`, { role: 'user' });
    assert.equal(demoteRes.status, 200);

    // 6. Demoted user is immediately forbidden from accessing /api/users
    await candidateClient.login(candidateEmail, candidatePassword);
    const postDemoteRes = await candidateClient.get('/api/users');
    assert.equal(postDemoteRes.status, 403, `Demoted user must receive 403 Forbidden on /api/users, got ${postDemoteRes.status}`);
  });

  it('T3.4: Dual admin safety: Having two admins allows demoting one, but demoting the last fails with 409', async () => {
    // Re-promote candidate to admin (now 2 admins exist: primary admin and candidate)
    const promoteRes = await adminClient.patch(`/api/users/${candidateUserId}/role`, { role: 'admin' });
    assert.equal(promoteRes.status, 200);

    // Primary admin can safely demote candidate (since primary admin remains)
    const demoteCandidateRes = await adminClient.patch(`/api/users/${candidateUserId}/role`, { role: 'user' });
    assert.equal(demoteCandidateRes.status, 200, 'Demoting secondary admin when primary admin remains should succeed');

    // Get primary admin ID
    const meRes = await adminClient.get('/api/auth/me');
    const primaryAdmin = meRes.data?.user || meRes.data?.data?.user || meRes.data;
    const primaryAdminId = primaryAdmin.id;

    // Primary admin attempting to demote themselves now fails with 409 Conflict
    const lastAdminDemoteRes = await adminClient.patch(`/api/users/${primaryAdminId}/role`, { role: 'user' });
    assert.equal(
      lastAdminDemoteRes.status,
      409,
      `Expected 409 Conflict when only one admin remains, got ${lastAdminDemoteRes.status}`
    );

    // Cleanup candidate
    if (candidateUserId) {
      await adminClient.delete(`/api/users/${candidateUserId}`);
    }
  });
});
