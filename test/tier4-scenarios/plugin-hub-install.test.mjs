// test/tier4-scenarios/plugin-hub-install.test.mjs
// Tier 4: Real-World Scenario - Complete hdm-plugin-hub Catalog Sync & Extension Install Simulation

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApiClient } from '../helpers/api-client.mjs';

describe('Tier 4 Scenario: Complete hdm-plugin-hub Catalog Sync & Install Flow', () => {
  const client = createApiClient();
  const tempInstallDir = path.join('/tmp', 'agy-test-install-' + Date.now());

  it('T4.2: Queries cloud registry, downloads plugin bundle, verifies checksum, and installs package', async () => {
    // 1. Fetch registry catalog from Cloud Hub endpoint
    const catRes = await client.get('/api/registry.json');
    assert.equal(catRes.status, 200, `Expected 200 from registry.json, got ${catRes.status}`);
    const catalog = catRes.data?.data || catRes.data;
    assert.ok(catalog.plugins && catalog.plugins.length > 0, 'Catalog must contain plugins');

    // 2. Select target plugin to install (e.g. token-tracker)
    const targetPlugin = catalog.plugins.find(p => p.id === 'token-tracker') || catalog.plugins[0];
    assert.ok(targetPlugin, 'Target plugin must exist in catalog');
    assert.ok(targetPlugin.downloadUrl, 'Target plugin must have downloadUrl');

    // 3. Download the plugin package bundle (.tar.gz)
    const downloadRes = await client.get(targetPlugin.downloadUrl, { asBuffer: true });
    assert.equal(downloadRes.status, 200, `Expected 200 on download, got ${downloadRes.status}`);
    assert.ok(downloadRes.buffer && downloadRes.buffer.length > 0, 'Downloaded archive must not be empty');

    // 4. Verify SHA-256 checksum if provided by catalog
    if (targetPlugin.checksum) {
      const calculatedHash = crypto.createHash('sha256').update(downloadRes.buffer).digest('hex');
      assert.equal(calculatedHash, targetPlugin.checksum, 'Package SHA-256 checksum must match catalog');
    }

    // 5. Decompress gzip
    const unzippedTar = zlib.gunzipSync(downloadRes.buffer);
    assert.ok(unzippedTar.length > 0, 'Unzipped tarball must have content');

    // 6. Unpack into local sandbox directory (simulating ~/.gemini/config/plugins/<id>)
    fs.mkdirSync(tempInstallDir, { recursive: true });

    // Minimal USTAR tar reader for unpacking
    let offset = 0;
    let extractedFileCount = 0;

    while (offset < unzippedTar.length - 512) {
      const header = unzippedTar.subarray(offset, offset + 512);
      if (header[0] === 0) break; // End of archive

      const filename = header.subarray(0, 100).toString('utf-8').replace(/\0+$/, '').trim();
      const sizeOctal = header.subarray(124, 136).toString('utf-8').replace(/\0+$/, '').trim();
      const size = parseInt(sizeOctal, 8);

      offset += 512;
      if (filename && !isNaN(size)) {
        const fileData = unzippedTar.subarray(offset, offset + size);
        const destPath = path.join(tempInstallDir, filename);

        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        if (size > 0) {
          fs.writeFileSync(destPath, fileData);
          extractedFileCount++;
        }
      }

      offset += Math.ceil(size / 512) * 512;
    }

    assert.ok(extractedFileCount > 0, `Extracted ${extractedFileCount} files from archive`);

    // 7. Inspect installed plugin manifest
    const manifestPath = path.join(tempInstallDir, 'plugin.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      assert.ok(manifest.id || manifest.name, 'Installed plugin.json must have id or name');
    }

    // 8. Clean up sandbox
    fs.rmSync(tempInstallDir, { recursive: true, force: true });
  });
});
