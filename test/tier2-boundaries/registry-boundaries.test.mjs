// test/tier2-boundaries/registry-boundaries.test.mjs
// Tier 2: Boundary & Corner Cases - Registry Downloads & Publishing Validation

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../helpers/api-client.mjs';
import { ADMIN_EMAIL, ADMIN_PASSWORD, generateRandomEmail, generateRandomPassword } from '../helpers/test-env.mjs';
import { createTarGzBuffer } from '../helpers/fixtures.mjs';

describe('Tier 2: Registry & Package Boundaries', () => {
  const client = createApiClient();
  const adminClient = createApiClient();

  it('T2.10: Download non-existent plugin returns 404 Not Found', async () => {
    const res = await client.get('/api/plugins/non-existent-plugin-99999-xyz/download');
    assert.equal(res.status, 404, `Expected 404 for missing plugin, got ${res.status}`);
  });

  it('T2.11: Download non-existent skill returns 404 Not Found', async () => {
    const res = await client.get('/api/skills/non-existent-skill-99999-xyz/download');
    assert.equal(res.status, 404, `Expected 404 for missing skill, got ${res.status}`);
  });

  it('T2.12: Download non-existent version of existing plugin returns 404', async () => {
    const res = await client.get('/api/plugins/token-tracker/download?v=999.888.777');
    assert.equal(res.status, 404, `Expected 404 for missing version, got ${res.status}`);
  });

  it('T2.13: Publishing plugin with invalid SemVer is rejected with 400 Bad Request', async () => {
    await adminClient.login(ADMIN_EMAIL, ADMIN_PASSWORD);

    // Create tarball with invalid SemVer
    const invalidTar = createTarGzBuffer({
      'plugin.json': JSON.stringify({
        id: 'bad-semver-plugin',
        name: 'bad-semver-plugin',
        version: 'not-a-valid-semver-string'
      })
    });

    const formData = new FormData();
    formData.append('file', new Blob([invalidTar], { type: 'application/gzip' }), 'plugin.tar.gz');
    formData.append('version', 'invalid_version');

    const res = await adminClient.post('/api/plugins/publish', formData);
    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 or 422 for invalid SemVer, got ${res.status}: ${res.rawText}`
    );
  });

  it('T2.14: Publishing plugin with missing plugin.json manifest returns 400', async () => {
    await adminClient.login(ADMIN_EMAIL, ADMIN_PASSWORD);

    // Create tarball without plugin.json
    const tarWithoutManifest = createTarGzBuffer({
      'README.md': 'Empty package without plugin.json'
    });

    const formData = new FormData();
    formData.append('file', new Blob([tarWithoutManifest], { type: 'application/gzip' }), 'plugin.tar.gz');

    const res = await adminClient.post('/api/plugins/publish', formData);
    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 for missing plugin.json, got ${res.status}: ${res.rawText}`
    );
  });

  it('T2.15: Publishing skill without SKILL.md returns 400 Bad Request', async () => {
    await adminClient.login(ADMIN_EMAIL, ADMIN_PASSWORD);

    // Create tarball without SKILL.md
    const tarWithoutSkill = createTarGzBuffer({
      'README.md': 'Empty skill without SKILL.md'
    });

    const formData = new FormData();
    formData.append('file', new Blob([tarWithoutSkill], { type: 'application/gzip' }), 'skill.tar.gz');

    const res = await adminClient.post('/api/skills/publish', formData);
    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 for missing SKILL.md, got ${res.status}: ${res.rawText}`
    );
  });

  it('T2.16: Regular user attempting to publish plugin returns 403 Forbidden', async () => {
    // Create regular user
    const userEmail = generateRandomEmail('t2_publisher');
    const userPassword = generateRandomPassword();
    await adminClient.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    await adminClient.post('/api/users', { email: userEmail, password: userPassword, role: 'user' });

    const userClient = createApiClient();
    await userClient.login(userEmail, userPassword);

    const formData = new FormData();
    formData.append('file', new Blob(['test'], { type: 'application/gzip' }), 'test.tar.gz');

    const res = await userClient.post('/api/plugins/publish', formData);
    assert.equal(res.status, 403, `Expected 403 Forbidden for regular user publishing, got ${res.status}`);
  });
});
