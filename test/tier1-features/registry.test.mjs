// test/tier1-features/registry.test.mjs
// Tier 1: Feature Coverage - Plugin & Global Skill Registry and Downloads

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createApiClient } from '../helpers/api-client.mjs';
import { EXPECTED_SEEDED_PLUGINS, EXPECTED_SEEDED_SKILLS } from '../helpers/fixtures.mjs';

describe('Tier 1: Plugin & Global Skill Registry', () => {
  const client = createApiClient();
  let registryCatalog = null;

  it('T1.11: GET /api/registry.json returns HTTP 200 with valid schema structure', async () => {
    const res = await client.get('/api/registry.json');
    assert.equal(res.status, 200, `Expected 200 OK, got ${res.status}: ${res.rawText}`);
    assert.ok(res.data, 'Registry must return parsed JSON body');

    registryCatalog = res.data?.data || res.data;
    assert.ok(registryCatalog.plugins, 'Catalog must contain plugins array');
    assert.ok(Array.isArray(registryCatalog.plugins), 'plugins must be an array');
    assert.ok(registryCatalog.skills, 'Catalog must contain skills array');
    assert.ok(Array.isArray(registryCatalog.skills), 'skills must be an array');
  });

  it('T1.12: Registry catalog contains seeded plugins (including token-tracker)', async () => {
    assert.ok(registryCatalog, 'registryCatalog must be loaded');
    const plugins = registryCatalog.plugins;
    assert.ok(plugins.length >= 2, `Expected seeded plugins, found ${plugins.length}`);

    for (const expectedId of EXPECTED_SEEDED_PLUGINS) {
      const plugin = plugins.find(p => p.id === expectedId || p.name === expectedId);
      assert.ok(plugin, `Expected seeded plugin "${expectedId}" to be present in catalog`);
      assert.ok(plugin.version, `Plugin ${expectedId} must have version string`);
      assert.ok(plugin.downloadUrl, `Plugin ${expectedId} must have downloadUrl`);
      assert.ok(plugin.downloadUrl.includes('/download'), `downloadUrl must point to download endpoint`);
    }
  });

  it('T1.13: Registry catalog contains seeded skills (including accidental-data-loss-prevention)', async () => {
    assert.ok(registryCatalog, 'registryCatalog must be loaded');
    const skills = registryCatalog.skills;
    assert.ok(skills.length >= 2, `Expected seeded skills, found ${skills.length}`);

    for (const expectedId of EXPECTED_SEEDED_SKILLS) {
      const skill = skills.find(s => s.id === expectedId || s.name === expectedId);
      assert.ok(skill, `Expected seeded skill "${expectedId}" to be present in catalog`);
      assert.ok(skill.version, `Skill ${expectedId} must have version`);
      assert.ok(skill.downloadUrl, `Skill ${expectedId} must have downloadUrl`);
    }
  });

  it('T1.14: GET /api/plugins/token-tracker/download returns valid gzipped bundle', async () => {
    const res = await client.get('/api/plugins/token-tracker/download', { asBuffer: true });
    assert.equal(res.status, 200, `Expected 200 OK on plugin download, got ${res.status}`);
    
    assert.ok(res.buffer && res.buffer.length > 0, 'Response should contain binary data');
    const contentType = res.headers.get('content-type') || '';
    assert.ok(
      contentType.includes('gzip') || contentType.includes('octet-stream'),
      `Expected gzip/octet-stream content-type, got: ${contentType}`
    );

    // Verify buffer is valid gzip
    assert.doesNotThrow(() => {
      const unzipped = zlib.gunzipSync(res.buffer);
      assert.ok(unzipped.length > 0, 'Unzipped tarball should have content');
    }, 'Downloaded plugin file must be valid gzip');
  });

  it('T1.15: GET /api/skills/accidental-data-loss-prevention/download returns valid gzipped bundle', async () => {
    const res = await client.get('/api/skills/accidental-data-loss-prevention/download', { asBuffer: true });
    assert.equal(res.status, 200, `Expected 200 OK on skill download, got ${res.status}`);
    
    assert.ok(res.buffer && res.buffer.length > 0, 'Response should contain binary data');
    
    // Verify buffer is valid gzip
    assert.doesNotThrow(() => {
      const unzipped = zlib.gunzipSync(res.buffer);
      assert.ok(unzipped.length > 0, 'Unzipped tarball should have content');
    }, 'Downloaded skill file must be valid gzip');
  });

  it('T1.16: Downloaded plugin tarball contains inspectable archive records', async () => {
    const res = await client.get('/api/plugins/token-tracker/download', { asBuffer: true });
    assert.equal(res.status, 200);

    const unzipped = zlib.gunzipSync(res.buffer);
    // USTAR tar header check: inspect first block
    const filename = unzipped.subarray(0, 100).toString('utf-8').replace(/\0+$/, '');
    assert.ok(filename.length > 0, 'Tar archive should have at least one file entry');
  });
});
