// test/tier3-interactions/publish-download.test.mjs
// Tier 3: Cross-Feature Interactions - Publish Package -> Catalog Update -> Download Validation

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createApiClient } from '../helpers/api-client.mjs';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../helpers/test-env.mjs';
import { createSamplePluginPackage, createSampleSkillPackage } from '../helpers/fixtures.mjs';

describe('Tier 3: Publish -> Registry Catalog -> Download Validation', () => {
  const adminClient = createApiClient();
  const publicClient = createApiClient();

  const testPluginId = 'e2e-cross-plugin-' + Math.random().toString(36).substring(2, 7);
  const testSkillId = 'e2e-cross-skill-' + Math.random().toString(36).substring(2, 7);

  it('T3.5: Admin publishes new plugin -> Appears in registry.json -> Successfully downloaded', async () => {
    await adminClient.login(ADMIN_EMAIL, ADMIN_PASSWORD);

    // 1. Create plugin package tarball
    const pluginTar = createSamplePluginPackage(testPluginId, '1.0.0');

    // 2. Upload/publish plugin
    const formData = new FormData();
    formData.append('file', new Blob([pluginTar], { type: 'application/gzip' }), `${testPluginId}-1.0.0.tar.gz`);
    formData.append('pluginId', testPluginId);
    formData.append('version', '1.0.0');

    const publishRes = await adminClient.post('/api/plugins/publish', formData);
    assert.ok(
      publishRes.status === 200 || publishRes.status === 201,
      `Expected 200 or 201 on publish, got ${publishRes.status}: ${publishRes.rawText}`
    );

    // 3. Check public registry catalog
    const catalogRes = await publicClient.get('/api/registry.json');
    assert.equal(catalogRes.status, 200);
    const catalog = catalogRes.data?.data || catalogRes.data;
    const foundPlugin = catalog.plugins?.find(p => p.id === testPluginId);
    assert.ok(foundPlugin, `Published plugin ${testPluginId} should appear in catalog`);
    assert.equal(foundPlugin.version, '1.0.0');

    // 4. Download package bundle via public client
    const downloadRes = await publicClient.get(`/api/plugins/${testPluginId}/download`, { asBuffer: true });
    assert.equal(downloadRes.status, 200, `Expected 200 on downloading published plugin`);
    assert.ok(downloadRes.buffer && downloadRes.buffer.length > 0);

    // 5. Unpack and verify contents
    const unzipped = zlib.gunzipSync(downloadRes.buffer);
    assert.ok(unzipped.length > 0, 'Downloaded archive must be valid tarball');
  });

  it('T3.6: Admin publishes new skill -> Appears in registry.json -> Successfully downloaded', async () => {
    // 1. Create skill package tarball
    const skillTar = createSampleSkillPackage(testSkillId, '1.0.0');

    // 2. Upload/publish skill
    const formData = new FormData();
    formData.append('file', new Blob([skillTar], { type: 'application/gzip' }), `${testSkillId}-1.0.0.tar.gz`);
    formData.append('skillId', testSkillId);
    formData.append('version', '1.0.0');

    const publishRes = await adminClient.post('/api/skills/publish', formData);
    assert.ok(
      publishRes.status === 200 || publishRes.status === 201,
      `Expected 200/210 on skill publish, got ${publishRes.status}: ${publishRes.rawText}`
    );

    // 3. Check public catalog
    const catalogRes = await publicClient.get('/api/registry.json');
    assert.equal(catalogRes.status, 200);
    const catalog = catalogRes.data?.data || catalogRes.data;
    const foundSkill = catalog.skills?.find(s => s.id === testSkillId);
    assert.ok(foundSkill, `Published skill ${testSkillId} should appear in catalog`);

    // 4. Download skill bundle
    const downloadRes = await publicClient.get(`/api/skills/${testSkillId}/download`, { asBuffer: true });
    assert.equal(downloadRes.status, 200);
    assert.ok(downloadRes.buffer && downloadRes.buffer.length > 0);

    const unzipped = zlib.gunzipSync(downloadRes.buffer);
    assert.ok(unzipped.length > 0);
  });
});
