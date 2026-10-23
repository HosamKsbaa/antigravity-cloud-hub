import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import zlib from 'zlib';
import path from 'path';
import fs from 'fs';
import { createApp } from '../app.js';
import { initDb } from '../db/index.js';
import { seedAdminUser } from '../db/seed.js';
import { seedRegistry } from '../db/seedRegistry.js';
import {
  computeSha256,
  parseSemVer,
  isValidSemVer,
  compareSemVer,
  parseSkillMarkdown,
} from '../services/packageService.js';
import { config } from '../config.js';

describe('Milestone 2: Package Service & Registry API', () => {
  const app = createApp();
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    await initDb();
    await seedAdminUser();
    await seedRegistry();

    // Login as admin
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: config.seedAdminEmail,
        password: config.seedAdminPassword,
      });
    expect(adminRes.status).toBe(200);
    adminToken = adminRes.body.token;

    // Create and login as regular user
    const testUserEmail = `reg_user_${Date.now()}@example.com`;
    const testUserPass = 'Password123!';
    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: testUserEmail,
        password: testUserPass,
        role: 'user',
      });

    const userRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: testUserEmail,
        password: testUserPass,
      });
    expect(userRes.status).toBe(200);
    userToken = userRes.body.token;
  });

  describe('1. Package Service Utilities', () => {
    it('computes correct SHA-256 for strings and buffers', () => {
      const data = 'Antigravity Registry Test';
      const hash = computeSha256(data);
      expect(hash).toHaveLength(64);
      expect(computeSha256(Buffer.from(data))).toBe(hash);
    });

    it('validates and parses Semantic Versioning strings', () => {
      expect(isValidSemVer('1.0.0')).toBe(true);
      expect(isValidSemVer('v2.1.3')).toBe(true);
      expect(isValidSemVer('0.0.1-alpha.1')).toBe(true);
      expect(isValidSemVer('invalid_semver')).toBe(false);
      expect(isValidSemVer('1.0')).toBe(false);

      const parsed = parseSemVer('2.3.4-beta');
      expect(parsed).toEqual({ major: 2, minor: 3, patch: 4, prerelease: 'beta' });
    });

    it('correctly compares SemVer versions', () => {
      expect(compareSemVer('2.0.0', '1.9.9')).toBeGreaterThan(0);
      expect(compareSemVer('1.0.1', '1.0.0')).toBeGreaterThan(0);
      expect(compareSemVer('1.0.0', '1.0.0')).toBe(0);
      expect(compareSemVer('1.0.0', '2.0.0')).toBeLessThan(0);
      expect(() => compareSemVer('invalid', '1.0.0')).toThrow();
    });

    it('parses skill frontmatter markdown properly', () => {
      const doc = `---
name: test-skill
description: |
  A test skill description.
version: v2.0.0
license: MIT
publisher: Antigravity
---

# Test Skill Title
Detailed instructions here.
`;
      const meta = parseSkillMarkdown(doc);
      expect(meta.name).toBe('test-skill');
      expect(meta.displayName).toBe('Test Skill Title');
      expect(meta.version).toBe('2.0.0');
      expect(meta.license).toBe('MIT');
      expect(meta.publisher).toBe('Antigravity');
      expect(meta.description).toContain('A test skill description.');
    });
  });

  describe('2. Registry Catalog (GET /api/registry.json)', () => {
    it('returns catalog adhering to SPEC-REG-001', async () => {
      const res = await request(app).get('/api/registry.json');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');

      const body = res.body;
      expect(body.schemaVersion).toBe(1);
      expect(body.registryName).toBe('Antigravity Cloud Hub');
      expect(Array.isArray(body.plugins)).toBe(true);
      expect(Array.isArray(body.skills)).toBe(true);
      expect(body.pluginCount).toBeGreaterThanOrEqual(10);
      expect(body.skillCount).toBeGreaterThanOrEqual(19);

      // Verify token-tracker plugin
      const tokenTracker = body.plugins.find((p: any) => p.id === 'token-tracker');
      expect(tokenTracker).toBeDefined();
      expect(tokenTracker.version).toBe('2.0.0');
      expect(tokenTracker.downloadUrl).toContain('/api/plugins/token-tracker/download');
      expect(tokenTracker.checksum).toHaveLength(64);

      // Verify accidental-data-loss-prevention skill
      const guardSkill = body.skills.find((s: any) => s.id === 'accidental-data-loss-prevention');
      expect(guardSkill).toBeDefined();
      expect(guardSkill.version).toBe('1.0.0');
      expect(guardSkill.downloadUrl).toContain('/api/skills/accidental-data-loss-prevention/download');
      expect(guardSkill.checksum).toHaveLength(64);
    });
  });

  describe('3. Package Downloads', () => {
    it('streams plugin bundle with valid gzip and checksum headers', async () => {
      const res = await request(app)
        .get('/api/plugins/token-tracker/download')
        .responseType('blob');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/gzip');
      expect(res.headers['x-checksum-sha256']).toBeDefined();
      expect(res.headers['content-disposition']).toContain('attachment; filename="token-tracker-2.0.0.tar.gz"');

      const unzipped = zlib.gunzipSync(res.body);
      expect(unzipped.length).toBeGreaterThan(0);
      const tarHeader = unzipped.subarray(0, 100).toString('utf-8').replace(/\0+$/, '');
      expect(tarHeader.length).toBeGreaterThan(0);
    });

    it('streams skill bundle with valid gzip', async () => {
      const res = await request(app)
        .get('/api/skills/accidental-data-loss-prevention/download')
        .responseType('blob');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/gzip');
      expect(res.headers['x-checksum-sha256']).toBeDefined();

      const unzipped = zlib.gunzipSync(res.body);
      expect(unzipped.length).toBeGreaterThan(0);
    });

    it('returns 404 for non-existent plugin or version', async () => {
      const res1 = await request(app).get('/api/plugins/non-existent-plugin/download');
      expect(res1.status).toBe(404);

      const res2 = await request(app).get('/api/plugins/token-tracker/download?v=999.0.0');
      expect(res2.status).toBe(404);
    });

    it('returns 404 for non-existent skill', async () => {
      const res = await request(app).get('/api/skills/non-existent-skill/download');
      expect(res.status).toBe(404);
    });
  });

  describe('4. Publishing RBAC & Validation', () => {
    function makeTarball(files: Record<string, string>): Buffer {
      const blocks: Buffer[] = [];
      for (const [filename, content] of Object.entries(files)) {
        const fileBuf = Buffer.from(content, 'utf-8');
        const header = Buffer.alloc(512);
        header.write(filename, 0, 100, 'utf-8');
        header.write('0000755\0', 100, 8, 'utf-8');
        const sizeOctal = fileBuf.length.toString(8).padStart(11, '0') + ' ';
        header.write(sizeOctal, 124, 12, 'utf-8');
        header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + ' ', 136, 12, 'utf-8');
        header.write('0', 156, 1, 'utf-8');
        header.write('ustar\0', 257, 6, 'utf-8');
        header.write('00', 263, 2, 'utf-8');
        header.fill(' ', 148, 156);
        let checksum = 0;
        for (let i = 0; i < 512; i++) checksum += header[i];
        header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf-8');
        blocks.push(header);
        blocks.push(fileBuf);
        const rem = fileBuf.length % 512;
        if (rem > 0) blocks.push(Buffer.alloc(512 - rem));
      }
      blocks.push(Buffer.alloc(1024));
      return zlib.gzipSync(Buffer.concat(blocks));
    }

    it('rejects publication by non-admin with 403 Forbidden', async () => {
      const tar = makeTarball({ 'plugin.json': '{"name":"test"}' });
      const res = await request(app)
        .post('/api/plugins/publish')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('file', tar, 'test.tar.gz');

      expect(res.status).toBe(403);
    });

    it('rejects publication with missing manifest with 400 Bad Request', async () => {
      const tar = makeTarball({ 'README.md': '# No plugin manifest' });
      const res = await request(app)
        .post('/api/plugins/publish')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', tar, 'test.tar.gz');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PACKAGE');
    });

    it('rejects publication with invalid SemVer with 400 Bad Request', async () => {
      const tar = makeTarball({
        'plugin.json': JSON.stringify({
          id: 'invalid-semver-plugin',
          name: 'invalid-semver-plugin',
          version: 'invalid-version',
        }),
      });
      const res = await request(app)
        .post('/api/plugins/publish')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', tar, 'test.tar.gz');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_SEMVER');
    });

    it('allows admin to publish and delete new plugin', async () => {
      const testPluginId = `unit-test-plugin-${Date.now()}`;
      const tar = makeTarball({
        'plugin.json': JSON.stringify({
          id: testPluginId,
          name: testPluginId,
          displayName: 'Unit Test Plugin',
          version: '1.0.0',
          description: 'Published via unit test',
        }),
        'scripts/run.sh': '#!/bin/bash\necho "test"',
      });

      const pubRes = await request(app)
        .post('/api/plugins/publish')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', tar, `${testPluginId}.tar.gz`);

      expect(pubRes.status).toBe(201);
      expect(pubRes.body.ok).toBe(true);
      expect(pubRes.body.id).toBe(testPluginId);

      // Verify appears in catalog
      const catRes = await request(app).get('/api/registry.json');
      const found = catRes.body.plugins.find((p: any) => p.id === testPluginId);
      expect(found).toBeDefined();

      // Delete plugin
      const delRes = await request(app)
        .delete(`/api/plugins/${testPluginId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(delRes.status).toBe(200);
      expect(delRes.body.ok).toBe(true);
    });
  });
});
