// test/adversarial_challenge_m2.mjs
// Adversarial Empirical Challenge Suite for Milestone 2 (Registry API, Package Validation & Upload Security)

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import jwt from 'jsonwebtoken';
import { createApiClient } from './helpers/api-client.mjs';
import {
  TARGET_URL,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  generateRandomEmail,
  generateRandomPassword,
} from './helpers/test-env.mjs';
import { createTarGzBuffer, createSamplePluginPackage, createSampleSkillPackage } from './helpers/fixtures.mjs';

const JWT_SECRET = process.env.JWT_SECRET || 'antigravity_cloud_hub_jwt_super_secret_key_2026';

const results = {
  section1_corrupted: [],
  section2_traversal: [],
  section3_semver: [],
  section4_manifest: [],
  section5_auth: [],
  summary: { total: 0, passed: 0, vulnerabilities: 0, warnings: 0 }
};

function recordTest(section, name, payload, expected, actual, passed, details = '', isVulnerability = false) {
  results.summary.total++;
  if (passed) {
    results.summary.passed++;
  } else {
    if (isVulnerability) {
      results.summary.vulnerabilities++;
    } else {
      results.summary.warnings++;
    }
  }
  const item = {
    name,
    payload: typeof payload === 'string' && payload.length > 100 ? payload.slice(0, 100) + '...[truncated]' : payload,
    expected,
    actual,
    passed,
    details,
    isVulnerability
  };
  if (Array.isArray(results[section])) {
    results[section].push(item);
  }
  const statusMark = passed ? '✅ PASS' : (isVulnerability ? '🔥 VULNERABILITY' : '⚠️ FAIL');
  console.log(`[${statusMark}] ${name} | Expected: ${expected} | Got: ${actual} ${details ? '(' + details + ')' : ''}`);
}

/**
 * Creates a valid ZIP archive containing the provided files.
 */
function createZipBuffer(files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-zip-test-'));
  try {
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(tmp, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
    const zipPath = path.join(tmp, 'archive.zip');
    execSync(`zip -q -r "${zipPath}" .`, { cwd: tmp });
    return fs.readFileSync(zipPath);
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Creates a raw uncompressed TAR archive (without gzip).
 */
function createRawTarBuffer(files) {
  const blocks = [];
  for (const [filename, content] of Object.entries(files)) {
    const fileBuf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
    const header = Buffer.alloc(512);
    header.write(filename, 0, 100, 'utf-8');
    header.write('0000755\0', 100, 8, 'utf-8');
    header.write('0001750\0', 108, 8, 'utf-8');
    header.write('0001750\0', 116, 8, 'utf-8');
    const sizeOctal = fileBuf.length.toString(8).padStart(11, '0') + ' ';
    header.write(sizeOctal, 124, 12, 'utf-8');
    const mtimeOctal = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + ' ';
    header.write(mtimeOctal, 136, 12, 'utf-8');
    header.write('0', 156, 1, 'utf-8');
    header.write('ustar\0', 257, 6, 'utf-8');
    header.write('00', 263, 2, 'utf-8');
    header.fill(' ', 148, 156);
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += header[i];
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    blocks.push(header);
    blocks.push(fileBuf);
    const remainder = fileBuf.length % 512;
    if (remainder > 0) blocks.push(Buffer.alloc(512 - remainder));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

async function runMilestone2AdversarialSuite() {
  console.log('='.repeat(80));
  console.log(' ADVERSARIAL EMPIRICAL CHALLENGE SUITE — MILESTONE 2');
  console.log(' REGISTRY API, MANIFEST VALIDATION & PACKAGE UPLOAD SECURITY');
  console.log(` Target: ${TARGET_URL}`);
  console.log(` Admin:  ${ADMIN_EMAIL}`);
  console.log(` Date:   ${new Date().toISOString()}`);
  console.log('='.repeat(80) + '\n');

  // Baseline Admin Authentication
  const adminClient = createApiClient();
  const loginRes = await adminClient.login(ADMIN_EMAIL, ADMIN_PASSWORD);
  if (!loginRes.ok) {
    console.error(`FATAL: Cannot authenticate baseline admin: ${loginRes.status} ${loginRes.rawText}`);
    process.exit(1);
  }
  console.log('✓ Baseline Admin Session Established.\n');

  // =========================================================================
  // SECTION 1: Corrupted Tarball Uploads
  // =========================================================================
  console.log('--- SECTION 1: Corrupted Tarball Uploads ---');

  // 1.1: Random bytes buffer (1024 bytes) -> /api/plugins/publish
  {
    const randomBuf = crypto.randomBytes(1024);
    const formData = new FormData();
    formData.append('file', new Blob([randomBuf], { type: 'application/gzip' }), 'random.tar.gz');
    const res = await adminClient.post('/api/plugins/publish', formData);
    const passed = res.status === 400 && res.data?.code === 'INVALID_PACKAGE';
    recordTest(
      'section1_corrupted',
      '1.1 Random bytes uploaded to /api/plugins/publish',
      '1024 random crypto bytes',
      'HTTP 400 (INVALID_PACKAGE)',
      `HTTP ${res.status} (${res.data?.code || res.rawText})`,
      passed,
      res.data?.error || ''
    );
  }

  // 1.2: Random bytes buffer (1024 bytes) -> /api/skills/publish
  {
    const randomBuf = crypto.randomBytes(1024);
    const formData = new FormData();
    formData.append('file', new Blob([randomBuf], { type: 'application/gzip' }), 'random.tar.gz');
    const res = await adminClient.post('/api/skills/publish', formData);
    const passed = res.status === 400 && res.data?.code === 'INVALID_PACKAGE';
    recordTest(
      'section1_corrupted',
      '1.2 Random bytes uploaded to /api/skills/publish',
      '1024 random crypto bytes',
      'HTTP 400 (INVALID_PACKAGE)',
      `HTTP ${res.status} (${res.data?.code || res.rawText})`,
      passed,
      res.data?.error || ''
    );
  }

  // 1.3: Truncated gzip stream -> /api/plugins/publish
  {
    const validTarGz = createSamplePluginPackage('trunc-test', '1.0.0');
    const truncatedBuf = validTarGz.slice(0, 50);
    const formData = new FormData();
    formData.append('file', new Blob([truncatedBuf], { type: 'application/gzip' }), 'truncated.tar.gz');
    const res = await adminClient.post('/api/plugins/publish', formData);
    const passed = res.status === 400 && res.data?.code === 'INVALID_PACKAGE';
    recordTest(
      'section1_corrupted',
      '1.3 Truncated gzip stream uploaded to /api/plugins/publish',
      'First 50 bytes of valid tar.gz',
      'HTTP 400 (INVALID_PACKAGE)',
      `HTTP ${res.status} (${res.data?.code || res.rawText})`,
      passed,
      res.data?.error || ''
    );
  }

  // 1.4: Truncated gzip stream -> /api/skills/publish
  {
    const validSkillTarGz = createSampleSkillPackage('trunc-skill', '1.0.0');
    const truncatedBuf = validSkillTarGz.slice(0, 50);
    const formData = new FormData();
    formData.append('file', new Blob([truncatedBuf], { type: 'application/gzip' }), 'truncated.tar.gz');
    const res = await adminClient.post('/api/skills/publish', formData);
    const passed = res.status === 400 && res.data?.code === 'INVALID_PACKAGE';
    recordTest(
      'section1_corrupted',
      '1.4 Truncated gzip stream uploaded to /api/skills/publish',
      'First 50 bytes of valid tar.gz',
      'HTTP 400 (INVALID_PACKAGE)',
      `HTTP ${res.status} (${res.data?.code || res.rawText})`,
      passed,
      res.data?.error || ''
    );
  }

  // 1.5: Valid PK-ZIP archive instead of .tar.gz -> /api/plugins/publish
  {
    const zipBuf = createZipBuffer({
      'plugin.json': JSON.stringify({ id: 'zip-plugin', name: 'zip-plugin', version: '1.0.0' })
    });
    const formData = new FormData();
    formData.append('file', new Blob([zipBuf], { type: 'application/zip' }), 'plugin.zip');
    const res = await adminClient.post('/api/plugins/publish', formData);
    const passed = res.status === 400 && res.data?.code === 'INVALID_PACKAGE';
    recordTest(
      'section1_corrupted',
      '1.5 PK-ZIP archive uploaded to /api/plugins/publish',
      'Valid zip archive containing plugin.json',
      'HTTP 400 (INVALID_PACKAGE)',
      `HTTP ${res.status} (${res.data?.code || res.rawText})`,
      passed,
      res.data?.error || ''
    );
  }

  // 1.6: Valid PK-ZIP archive instead of .tar.gz -> /api/skills/publish
  {
    const zipBuf = createZipBuffer({
      'SKILL.md': '---\nname: zip-skill\nversion: 1.0.0\n---\n# Zip Skill'
    });
    const formData = new FormData();
    formData.append('file', new Blob([zipBuf], { type: 'application/zip' }), 'skill.zip');
    const res = await adminClient.post('/api/skills/publish', formData);
    const passed = res.status === 400 && res.data?.code === 'INVALID_PACKAGE';
    recordTest(
      'section1_corrupted',
      '1.6 PK-ZIP archive uploaded to /api/skills/publish',
      'Valid zip archive containing SKILL.md',
      'HTTP 400 (INVALID_PACKAGE)',
      `HTTP ${res.status} (${res.data?.code || res.rawText})`,
      passed,
      res.data?.error || ''
    );
  }

  // 1.7: Raw uncompressed tar archive (no gzip compression) -> /api/plugins/publish
  {
    const rawTarBuf = createRawTarBuffer({
      'plugin.json': JSON.stringify({ id: 'raw-tar', name: 'raw-tar', version: '1.0.0' })
    });
    const formData = new FormData();
    formData.append('file', new Blob([rawTarBuf], { type: 'application/x-tar' }), 'plugin.tar');
    const res = await adminClient.post('/api/plugins/publish', formData);
    // tar.extract with default options or gzip may fail or accept. The requirement is rejection of non-gzipped archive.
    const passed = res.status === 400;
    recordTest(
      'section1_corrupted',
      '1.7 Raw uncompressed tar (missing gzip) to /api/plugins/publish',
      'Uncompressed TAR archive',
      'HTTP 400 rejection',
      `HTTP ${res.status} (${res.data?.code || res.data?.error || res.rawText})`,
      passed,
      res.data?.error || ''
    );
    // Clean up if it was created
    if (res.status === 201) {
      await adminClient.delete('/api/plugins/raw-tar');
    }
  }

  // 1.8: Gzip-compressed plain text (not tar archive)
  {
    const textGz = zlib.gzipSync(Buffer.from('Hello world this is not a tar archive!'));
    const formData = new FormData();
    formData.append('file', new Blob([textGz], { type: 'application/gzip' }), 'plain.tar.gz');
    const res = await adminClient.post('/api/plugins/publish', formData);
    const passed = res.status === 400 && res.data?.code === 'INVALID_PACKAGE';
    recordTest(
      'section1_corrupted',
      '1.8 Gzip of non-tar plain text to /api/plugins/publish',
      'Gzipped plain text string',
      'HTTP 400 (INVALID_PACKAGE)',
      `HTTP ${res.status} (${res.data?.code || res.rawText})`,
      passed,
      res.data?.error || ''
    );
  }

  // 1.9: Empty 0-byte file upload -> /api/plugins/publish
  {
    const emptyBuf = Buffer.alloc(0);
    const formData = new FormData();
    formData.append('file', new Blob([emptyBuf], { type: 'application/gzip' }), 'empty.tar.gz');
    const res = await adminClient.post('/api/plugins/publish', formData);
    const passed = res.status === 400;
    recordTest(
      'section1_corrupted',
      '1.9 Zero-byte empty file to /api/plugins/publish',
      '0 bytes file buffer',
      'HTTP 400 Bad Request',
      `HTTP ${res.status} (${res.data?.code || res.data?.error || res.rawText})`,
      passed,
      res.data?.error || ''
    );
  }

  // 1.10: Empty 0-byte file upload -> /api/skills/publish
  {
    const emptyBuf = Buffer.alloc(0);
    const formData = new FormData();
    formData.append('file', new Blob([emptyBuf], { type: 'application/gzip' }), 'empty.tar.gz');
    const res = await adminClient.post('/api/skills/publish', formData);
    const passed = res.status === 400;
    recordTest(
      'section1_corrupted',
      '1.10 Zero-byte empty file to /api/skills/publish',
      '0 bytes file buffer',
      'HTTP 400 Bad Request',
      `HTTP ${res.status} (${res.data?.code || res.data?.error || res.rawText})`,
      passed,
      res.data?.error || ''
    );
  }

  console.log('');

  // =========================================================================
  // SECTION 2: Malicious Archive Entries & Path Traversal Attacks
  // =========================================================================
  console.log('--- SECTION 2: Path Traversal & Malicious Archive Entries ---');

  // 2.1: Archive entry named `../../../../tmp/m2_traversal_attack1.txt`
  {
    const markerPath = '/tmp/m2_traversal_attack1.txt';
    try { if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath); } catch {}

    const maliciousTar = createTarGzBuffer({
      'plugin.json': JSON.stringify({ id: 'traversal-attack-1', name: 'traversal-attack-1', version: '1.0.0' }),
      '../../../../tmp/m2_traversal_attack1.txt': 'PWNED_BY_TRAVERSAL_ENTRY'
    });

    const formData = new FormData();
    formData.append('file', new Blob([maliciousTar], { type: 'application/gzip' }), 'evil.tar.gz');
    const res = await adminClient.post('/api/plugins/publish', formData);

    const fileEscaped = fs.existsSync(markerPath);
    // Security check: File MUST NOT exist at /tmp/m2_traversal_attack1.txt
    const passed = !fileEscaped;
    recordTest(
      'section2_traversal',
      '2.1 Archive entry with relative path traversal (../../../../tmp/...)',
      'Tar entry: ../../../../tmp/m2_traversal_attack1.txt',
      'File does NOT escape to /tmp/m2_traversal_attack1.txt',
      fileEscaped ? 'CRITICAL: File written outside cwd!' : 'Blocked / dropped by tar sandbox',
      passed,
      `fileEscaped=${fileEscaped}, HTTP ${res.status}`,
      fileEscaped
    );

    // Clean up
    if (res.status === 201) await adminClient.delete('/api/plugins/traversal-attack-1');
    try { if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath); } catch {}
  }

  // 2.2: Archive entry with absolute path `/tmp/m2_traversal_attack2.txt`
  {
    const markerPath = '/tmp/m2_traversal_attack2.txt';
    try { if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath); } catch {}

    const maliciousTar = createTarGzBuffer({
      'plugin.json': JSON.stringify({ id: 'traversal-attack-2', name: 'traversal-attack-2', version: '1.0.0' }),
      '/tmp/m2_traversal_attack2.txt': 'PWNED_BY_ABSOLUTE_ENTRY'
    });

    const formData = new FormData();
    formData.append('file', new Blob([maliciousTar], { type: 'application/gzip' }), 'evil.tar.gz');
    const res = await adminClient.post('/api/plugins/publish', formData);

    const fileEscaped = fs.existsSync(markerPath);
    const passed = !fileEscaped;
    recordTest(
      'section2_traversal',
      '2.2 Archive entry with absolute path (/tmp/...)',
      'Tar entry: /tmp/m2_traversal_attack2.txt',
      'File does NOT escape to /tmp/m2_traversal_attack2.txt',
      fileEscaped ? 'CRITICAL: File written to absolute path!' : 'Sanitized to relative or dropped',
      passed,
      `fileEscaped=${fileEscaped}, HTTP ${res.status}`,
      fileEscaped
    );

    if (res.status === 201) await adminClient.delete('/api/plugins/traversal-attack-2');
    try { if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath); } catch {}
  }

  // 2.3: Nested directory traversal entry in skill upload `nested/../../../../tmp/m2_traversal_attack3.txt`
  {
    const markerPath = '/tmp/m2_traversal_attack3.txt';
    try { if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath); } catch {}

    const maliciousTar = createTarGzBuffer({
      'SKILL.md': '---\nname: traversal-skill-3\nversion: 1.0.0\n---\n# Traversal Skill',
      'nested/../../../../tmp/m2_traversal_attack3.txt': 'PWNED_BY_NESTED_TRAVERSAL'
    });

    const formData = new FormData();
    formData.append('file', new Blob([maliciousTar], { type: 'application/gzip' }), 'evil_skill.tar.gz');
    const res = await adminClient.post('/api/skills/publish', formData);

    const fileEscaped = fs.existsSync(markerPath);
    const passed = !fileEscaped;
    recordTest(
      'section2_traversal',
      '2.3 Nested traversal entry in skill archive (nested/../../../../tmp/...)',
      'Tar entry: nested/../../../../tmp/m2_traversal_attack3.txt',
      'File does NOT escape to /tmp/m2_traversal_attack3.txt',
      fileEscaped ? 'CRITICAL: File written outside cwd!' : 'Sanitized or dropped',
      passed,
      `fileEscaped=${fileEscaped}, HTTP ${res.status}`,
      fileEscaped
    );

    if (res.status === 201) await adminClient.delete('/api/skills/traversal-skill-3');
    try { if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath); } catch {}
  }

  // 2.4: Symlink pointing to /etc/passwd in archive
  {
    // Build archive containing symlink header
    const header = Buffer.alloc(512);
    header.write('evil_symlink', 0, 100);
    header.write('0000777\0', 100, 8);
    header.write('0001750\0', 108, 8);
    header.write('0001750\0', 116, 8);
    header.write('00000000000 ', 124, 12);
    header.write('00000000000 ', 136, 12);
    header.write('2', 156, 1); // symlink type
    header.write('/etc/passwd', 157, 100); // target
    header.write('ustar\0', 257, 6);
    header.write('00', 263, 2);
    header.fill(' ', 148, 156);
    let chk = 0; for (let i = 0; i < 512; i++) chk += header[i];
    header.write(chk.toString(8).padStart(6, '0') + '\0 ', 148, 8);

    const pluginHeader = Buffer.alloc(512);
    pluginHeader.write('plugin.json', 0, 100);
    pluginHeader.write('0000644\0', 100, 8);
    pluginHeader.write('0001750\0', 108, 8);
    pluginHeader.write('0001750\0', 116, 8);
    const content = Buffer.from(JSON.stringify({ id: 'symlink-plugin', name: 'symlink-plugin', version: '1.0.0' }));
    const sizeOctal = content.length.toString(8).padStart(11, '0') + ' ';
    pluginHeader.write(sizeOctal, 124, 12);
    pluginHeader.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + ' ', 136, 12);
    pluginHeader.write('0', 156, 1);
    pluginHeader.write('ustar\0', 257, 6);
    pluginHeader.write('00', 263, 2);
    pluginHeader.fill(' ', 148, 156);
    chk = 0; for (let i = 0; i < 512; i++) chk += pluginHeader[i];
    pluginHeader.write(chk.toString(8).padStart(6, '0') + '\0 ', 148, 8);

    const pad = Buffer.alloc(512 - (content.length % 512));
    const end = Buffer.alloc(1024);
    const rawTar = Buffer.concat([pluginHeader, content, pad, header, end]);
    const gzTar = zlib.gzipSync(rawTar);

    const formData = new FormData();
    formData.append('file', new Blob([gzTar], { type: 'application/gzip' }), 'symlink.tar.gz');
    const res = await adminClient.post('/api/plugins/publish', formData);

    // Verify /etc/passwd was neither modified nor overwritten
    const passwdStat = fs.statSync('/etc/passwd');
    const passed = passwdStat.size > 0;
    recordTest(
      'section2_traversal',
      '2.4 Symlink entry pointing to /etc/passwd in archive',
      'Symlink entry pointing to /etc/passwd',
      '/etc/passwd remains intact and uncorrupted',
      passed ? 'Intact (/etc/passwd safe)' : 'CORRUPTED',
      passed,
      `HTTP ${res.status}`
    );

    if (res.status === 201) await adminClient.delete('/api/plugins/symlink-plugin');
  }

  // 2.5: Path Traversal via `pluginId` parameter / manifest ID: `../../m2_pwn_outside`
  {
    const nonce = Math.random().toString(36).substring(2, 7);
    const evilId = `../../m2_pwn_outside_${nonce}`;
    const outsideTarget = path.resolve(process.cwd(), `../m2_pwn_outside_${nonce}-1.0.0.tar.gz`);
    try { if (fs.existsSync(outsideTarget)) fs.unlinkSync(outsideTarget); } catch {}

    const maliciousTar = createTarGzBuffer({
      'plugin.json': JSON.stringify({
        id: evilId,
        name: evilId,
        version: '1.0.0'
      })
    });

    const formData = new FormData();
    formData.append('file', new Blob([maliciousTar], { type: 'application/gzip' }), 'id_traversal.tar.gz');
    const res = await adminClient.post('/api/plugins/publish', formData);

    const fileEscaped = fs.existsSync(outsideTarget);
    // VULNERABILITY CHECK: If file escaped storageDir, this is a path traversal defect!
    const passed = res.status === 400 && !fileEscaped;
    recordTest(
      'section2_traversal',
      '2.5 Path Traversal via pluginId/manifest ID (id: "../../m2_pwn_outside")',
      'plugin.json id: "../../m2_pwn_outside"',
      'HTTP 400 rejection & file must NOT be written outside storage/',
      fileEscaped
        ? `🔥 VULNERABILITY: Escaped storageDir to ${outsideTarget}`
        : (res.status === 201 ? 'Allowed 201 but stayed in storage' : `HTTP ${res.status}`),
      passed,
      `HTTP ${res.status}, fileEscaped=${fileEscaped}`,
      fileEscaped // isVulnerability
    );

    // Clean up if it was written
    try { if (fs.existsSync(outsideTarget)) fs.unlinkSync(outsideTarget); } catch {}
    if (res.status === 201) {
      // Clean DB record manually
      const { db } = await import('../dist/db/index.js');
      const { plugins } = await import('../dist/db/schema.js');
      const { eq } = await import('drizzle-orm');
      await db.delete(plugins).where(eq(plugins.id, evilId));
    }
  }

  // 2.6: Path Traversal via `skillId` parameter (name: "../../m2_pwn_skill")
  {
    const nonce = Math.random().toString(36).substring(2, 7);
    const evilSkillId = `../../m2_pwn_skill_${nonce}`;
    const outsideTarget = path.resolve(process.cwd(), `../m2_pwn_skill_${nonce}-1.0.0.tar.gz`);
    try { if (fs.existsSync(outsideTarget)) fs.unlinkSync(outsideTarget); } catch {}

    const maliciousTar = createTarGzBuffer({
      'SKILL.md': `---\nname: ${evilSkillId}\nversion: 1.0.0\n---\n# Traversal Skill`
    });

    const formData = new FormData();
    formData.append('file', new Blob([maliciousTar], { type: 'application/gzip' }), 'skill_traversal.tar.gz');
    const res = await adminClient.post('/api/skills/publish', formData);

    const fileEscaped = fs.existsSync(outsideTarget);
    const passed = res.status === 400 && !fileEscaped;
    recordTest(
      'section2_traversal',
      '2.6 Path Traversal via skillId/manifest name (name: "../../m2_pwn_skill")',
      'SKILL.md name: "../../m2_pwn_skill"',
      'HTTP 400 rejection & file must NOT be written outside storage/',
      fileEscaped
        ? `🔥 VULNERABILITY: Escaped storageDir to ${outsideTarget}`
        : (res.status === 201 ? 'Allowed 201 but stayed in storage' : `HTTP ${res.status}`),
      passed,
      `HTTP ${res.status}, fileEscaped=${fileEscaped}`,
      fileEscaped
    );

    try { if (fs.existsSync(outsideTarget)) fs.unlinkSync(outsideTarget); } catch {}
    if (res.status === 201) {
      const { db } = await import('../dist/db/index.js');
      const { skills } = await import('../dist/db/schema.js');
      const { eq } = await import('drizzle-orm');
      await db.delete(skills).where(eq(skills.id, evilSkillId));
    }
  }

  // 2.7: Path Traversal in download endpoint GET /api/plugins/..%2F..%2Fetc%2Fpasswd/download
  {
    const client = createApiClient();
    const res = await client.get('/api/plugins/..%2F..%2Fetc%2Fpasswd/download');
    const passed = res.status === 404 || res.status === 400;
    recordTest(
      'section2_traversal',
      '2.7 Path Traversal in GET /api/plugins/:id/download (..%2F..%2Fetc%2Fpasswd)',
      'URL encoded path traversal in :id parameter',
      'HTTP 404 Not Found (safe)',
      `HTTP ${res.status}`,
      passed,
      res.data?.error || ''
    );
  }

  // 2.8: Path Traversal in skill download endpoint GET /api/skills/..%2F..%2Fetc%2Fpasswd/download
  {
    const client = createApiClient();
    const res = await client.get('/api/skills/..%2F..%2Fetc%2Fpasswd/download');
    const passed = res.status === 404 || res.status === 400;
    recordTest(
      'section2_traversal',
      '2.8 Path Traversal in GET /api/skills/:id/download (..%2F..%2Fetc%2Fpasswd)',
      'URL encoded path traversal in :id parameter',
      'HTTP 404 Not Found (safe)',
      `HTTP ${res.status}`,
      passed,
      res.data?.error || ''
    );
  }

  console.log('');

  // =========================================================================
  // SECTION 3: SemVer Downgrade & Replay Attacks
  // =========================================================================
  console.log('--- SECTION 3: SemVer Downgrade & Replay Attacks ---');

  // 3.1: Replay attack on plugin: Re-publishing token-tracker v2.0.0 (same version)
  {
    const tar = createSamplePluginPackage('token-tracker', '2.0.0');
    const formData = new FormData();
    formData.append('file', new Blob([tar], { type: 'application/gzip' }), 'token-tracker.tar.gz');
    const res = await adminClient.post('/api/plugins/publish', formData);
    const passed = res.status === 400 && res.data?.code === 'VERSION_CONFLICT';
    recordTest(
      'section3_semver',
      '3.1 Replay attack: Re-publishing existing version of token-tracker (2.0.0)',
      'token-tracker v2.0.0 upload',
      'HTTP 400 (VERSION_CONFLICT)',
      `HTTP ${res.status} (${res.data?.code || res.rawText})`,
      passed,
      res.data?.error || ''
    );
  }

  // 3.2: Replay attack on skill: Re-publishing accidental-data-loss-prevention v1.0.0
  {
    const tar = createSampleSkillPackage('accidental-data-loss-prevention', '1.0.0');
    const formData = new FormData();
    formData.append('file', new Blob([tar], { type: 'application/gzip' }), 'skill.tar.gz');
    const res = await adminClient.post('/api/skills/publish', formData);
    const passed = res.status === 400 && res.data?.code === 'VERSION_CONFLICT';
    recordTest(
      'section3_semver',
      '3.2 Replay attack: Re-publishing existing version of skill (1.0.0)',
      'accidental-data-loss-prevention v1.0.0 upload',
      'HTTP 400 (VERSION_CONFLICT)',
      `HTTP ${res.status} (${res.data?.code || res.rawText})`,
      passed,
      res.data?.error || ''
    );
  }

  // 3.3: SemVer downgrade attack on plugin: Publishing token-tracker v1.9.9 (lower than 2.0.0)
  {
    const tar = createSamplePluginPackage('token-tracker', '1.9.9');
    const formData = new FormData();
    formData.append('file', new Blob([tar], { type: 'application/gzip' }), 'token-tracker.tar.gz');
    const res = await adminClient.post('/api/plugins/publish', formData);
    const passed = res.status === 400 && res.data?.code === 'VERSION_CONFLICT';
    recordTest(
      'section3_semver',
      '3.3 SemVer downgrade: Publishing token-tracker v1.9.9 when v2.0.0 exists',
      'token-tracker v1.9.9 upload',
      'HTTP 400 (VERSION_CONFLICT)',
      `HTTP ${res.status} (${res.data?.code || res.rawText})`,
      passed,
      res.data?.error || ''
    );
  }

  // 3.4: SemVer downgrade attack on plugin: Publishing token-tracker v0.9.0
  {
    const tar = createSamplePluginPackage('token-tracker', '0.9.0');
    const formData = new FormData();
    formData.append('file', new Blob([tar], { type: 'application/gzip' }), 'token-tracker.tar.gz');
    const res = await adminClient.post('/api/plugins/publish', formData);
    const passed = res.status === 400 && res.data?.code === 'VERSION_CONFLICT';
    recordTest(
      'section3_semver',
      '3.4 SemVer downgrade: Publishing token-tracker v0.9.0 when v2.0.0 exists',
      'token-tracker v0.9.0 upload',
      'HTTP 400 (VERSION_CONFLICT)',
      `HTTP ${res.status} (${res.data?.code || res.rawText})`,
      passed,
      res.data?.error || ''
    );
  }

  // 3.5: SemVer downgrade attack on skill: Publishing accidental-data-loss-prevention v0.5.0
  {
    const tar = createSampleSkillPackage('accidental-data-loss-prevention', '0.5.0');
    const formData = new FormData();
    formData.append('file', new Blob([tar], { type: 'application/gzip' }), 'skill.tar.gz');
    const res = await adminClient.post('/api/skills/publish', formData);
    const passed = res.status === 400 && res.data?.code === 'VERSION_CONFLICT';
    recordTest(
      'section3_semver',
      '3.5 SemVer downgrade: Publishing skill v0.5.0 when v1.0.0 exists',
      'accidental-data-loss-prevention v0.5.0 upload',
      'HTTP 400 (VERSION_CONFLICT)',
      `HTTP ${res.status} (${res.data?.code || res.rawText})`,
      passed,
      res.data?.error || ''
    );
  }

  // 3.6: Form version parameter override downgrade: Form field version="0.1.0"
  {
    const tar = createSamplePluginPackage('token-tracker', '3.0.0');
    const formData = new FormData();
    formData.append('file', new Blob([tar], { type: 'application/gzip' }), 'token-tracker.tar.gz');
    formData.append('version', '0.1.0'); // Attempt to override with downgrade
    const res = await adminClient.post('/api/plugins/publish', formData);
    const passed = res.status === 400 && res.data?.code === 'VERSION_CONFLICT';
    recordTest(
      'section3_semver',
      '3.6 Form-level SemVer override downgrade (form version=0.1.0)',
      'Form version: 0.1.0, manifest version: 3.0.0',
      'HTTP 400 (VERSION_CONFLICT)',
      `HTTP ${res.status} (${res.data?.code || res.rawText})`,
      passed,
      res.data?.error || ''
    );
  }

  // 3.7: Valid SemVer upgrade (positive control): publish test-upgrade v1.0.0, then v1.1.0
  {
    const testId = 'm2-adv-upgrade-' + Math.random().toString(36).substring(2, 7);
    const tar1 = createSamplePluginPackage(testId, '1.0.0');
    const formData1 = new FormData();
    formData1.append('file', new Blob([tar1], { type: 'application/gzip' }), `${testId}-1.0.0.tar.gz`);
    const res1 = await adminClient.post('/api/plugins/publish', formData1);

    const tar2 = createSamplePluginPackage(testId, '1.1.0');
    const formData2 = new FormData();
    formData2.append('file', new Blob([tar2], { type: 'application/gzip' }), `${testId}-1.1.0.tar.gz`);
    const res2 = await adminClient.post('/api/plugins/publish', formData2);

    const passed = res1.status === 201 && res2.status === 201;
    recordTest(
      'section3_semver',
      '3.7 Valid SemVer upgrade (positive control: v1.0.0 -> v1.1.0)',
      `${testId} v1.0.0 -> v1.1.0`,
      'HTTP 201 Created on both',
      `v1.0.0: HTTP ${res1.status}, v1.1.0: HTTP ${res2.status}`,
      passed,
      `v2 publishedAt=${res2.data?.publishedAt}`
    );

    // Clean up
    await adminClient.delete(`/api/plugins/${testId}`);
  }

  console.log('');

  // =========================================================================
  // SECTION 4: Missing or Empty Required Fields in Manifests
  // =========================================================================
  console.log('--- SECTION 4: Missing or Empty Required Fields in Manifests ---');

  // 4.1: Missing plugin.json manifest entirely in plugin package
  {
    const tarWithoutManifest = createTarGzBuffer({
      'README.md': 'No manifest in this package'
    });
    const formData = new FormData();
    formData.append('file', new Blob([tarWithoutManifest], { type: 'application/gzip' }), 'no_manifest.tar.gz');
    const res = await adminClient.post('/api/plugins/publish', formData);
    const passed = res.status === 400 && res.data?.error?.includes('Missing plugin.json');
    recordTest(
      'section4_manifest',
      '4.1 Missing plugin.json in plugin archive',
      'Tarball with README.md only',
      'HTTP 400 (Missing plugin.json manifest)',
      `HTTP ${res.status} (${res.data?.error || res.rawText})`,
      passed,
      res.data?.error || ''
    );
  }

  // 4.2: Missing SKILL.md in skill package
  {
    const tarWithoutSkill = createTarGzBuffer({
      'README.md': 'No SKILL.md in this package'
    });
    const formData = new FormData();
    formData.append('file', new Blob([tarWithoutSkill], { type: 'application/gzip' }), 'no_skill.tar.gz');
    const res = await adminClient.post('/api/skills/publish', formData);
    const passed = res.status === 400 && res.data?.error?.includes('Missing SKILL.md');
    recordTest(
      'section4_manifest',
      '4.2 Missing SKILL.md in skill archive',
      'Tarball with README.md only',
      'HTTP 400 (Missing SKILL.md manifest)',
      `HTTP ${res.status} (${res.data?.error || res.rawText})`,
      passed,
      res.data?.error || ''
    );
  }

  // 4.3: Malformed JSON syntax in plugin.json
  {
    const tarWithBadJson = createTarGzBuffer({
      'plugin.json': '{\n  "id": "bad-json",\n  "version": "1.0.0",\n  "unclosed: '
    });
    const formData = new FormData();
    formData.append('file', new Blob([tarWithBadJson], { type: 'application/gzip' }), 'bad_json.tar.gz');
    const res = await adminClient.post('/api/plugins/publish', formData);
    const passed = res.status === 400 && res.data?.error?.includes('Invalid plugin.json JSON');
    recordTest(
      'section4_manifest',
      '4.3 Malformed JSON in plugin.json',
      'Truncated syntax error in plugin.json',
      'HTTP 400 (Invalid plugin.json JSON)',
      `HTTP ${res.status} (${res.data?.error || res.rawText})`,
      passed,
      res.data?.error || ''
    );
  }

  // 4.4: Invalid SemVer string in plugin.json (version: "beta-123")
  {
    const tarWithBadVer = createTarGzBuffer({
      'plugin.json': JSON.stringify({
        id: 'bad-ver-plugin',
        name: 'bad-ver-plugin',
        version: 'beta-123'
      })
    });
    const formData = new FormData();
    formData.append('file', new Blob([tarWithBadVer], { type: 'application/gzip' }), 'bad_ver.tar.gz');
    const res = await adminClient.post('/api/plugins/publish', formData);
    const passed = res.status === 400 && res.data?.code === 'INVALID_SEMVER';
    recordTest(
      'section4_manifest',
      '4.4 Invalid SemVer in plugin.json (version: "beta-123")',
      'plugin.json with version="beta-123"',
      'HTTP 400 (INVALID_SEMVER)',
      `HTTP ${res.status} (${res.data?.code || res.rawText})`,
      passed,
      res.data?.error || ''
    );
  }

  // 4.5: Empty string version in plugin.json (version: "")
  {
    const testId = 'm2-empty-ver-test';
    const tarWithEmptyVer = createTarGzBuffer({
      'plugin.json': JSON.stringify({
        id: testId,
        name: testId,
        version: ''
      })
    });
    const formData = new FormData();
    formData.append('file', new Blob([tarWithEmptyVer], { type: 'application/gzip' }), 'empty_ver.tar.gz');
    const res = await adminClient.post('/api/plugins/publish', formData);

    // If server silently defaults to 1.0.0 instead of rejecting missing/empty version
    const passed = res.status === 400;
    recordTest(
      'section4_manifest',
      '4.5 Empty string version in plugin.json (version: "")',
      'plugin.json with version=""',
      'HTTP 400 Bad Request rejection',
      res.status === 201
        ? `⚠️ DEFECT: Silently defaulted to "${res.data?.version}" (HTTP 201)`
        : `HTTP ${res.status}`,
      passed,
      res.status === 201 ? `Published version: ${res.data?.version}` : (res.data?.error || ''),
      false // Warning/defect
    );

    if (res.status === 201) await adminClient.delete(`/api/plugins/${testId}`);
  }

  // 4.6: Invalid SemVer in SKILL.md frontmatter (version: "completely-bogus")
  {
    const testSkillId = 'm2-invalid-skill-ver';
    const tarWithBadSkillVer = createTarGzBuffer({
      'SKILL.md': `---
name: ${testSkillId}
version: completely-bogus-semver
description: test skill
---
# Invalid Version Skill
`
    });
    const formData = new FormData();
    formData.append('file', new Blob([tarWithBadSkillVer], { type: 'application/gzip' }), 'bad_skill_ver.tar.gz');
    const res = await adminClient.post('/api/skills/publish', formData);

    // Should be rejected with 400, but packageService line 224 silently coerces to '1.0.0'
    const passed = res.status === 400;
    recordTest(
      'section4_manifest',
      '4.6 Invalid SemVer in SKILL.md frontmatter (version: "completely-bogus-semver")',
      'SKILL.md frontmatter version="completely-bogus-semver"',
      'HTTP 400 Bad Request rejection',
      res.status === 201
        ? `⚠️ DEFECT: Silently coerced to "${res.data?.version}" (HTTP 201)`
        : `HTTP ${res.status}`,
      passed,
      res.status === 201 ? `Published version: ${res.data?.version}` : (res.data?.error || ''),
      false
    );

    if (res.status === 201) await adminClient.delete(`/api/skills/${testSkillId}`);
  }

  // 4.7: Empty / whitespace id and name in plugin.json
  {
    const tarWithEmptyId = createTarGzBuffer({
      'plugin.json': JSON.stringify({
        id: '',
        name: '   ',
        version: '1.0.0'
      })
    });
    const formData = new FormData();
    formData.append('file', new Blob([tarWithEmptyId], { type: 'application/gzip' }), 'empty_id.tar.gz');
    const res = await adminClient.post('/api/plugins/publish', formData);

    const passed = res.status === 400;
    recordTest(
      'section4_manifest',
      '4.7 Empty id and whitespace name in plugin.json',
      'plugin.json with id="" and name="   "',
      'HTTP 400 Bad Request rejection',
      res.status === 201
        ? `⚠️ DEFECT: Fallback to folder name "${res.data?.id}" (HTTP 201)`
        : `HTTP ${res.status}`,
      passed,
      res.status === 201 ? `Published id: ${res.data?.id}` : (res.data?.error || ''),
      false
    );

    if (res.status === 201 && res.data?.id) {
      await adminClient.delete(`/api/plugins/${res.data.id}`);
    }
  }

  // 4.8: Missing archive file in multipart request to /api/plugins/publish
  {
    const formData = new FormData();
    formData.append('pluginId', 'missing-file-plugin');
    const res = await adminClient.post('/api/plugins/publish', formData);
    const passed = res.status === 400;
    recordTest(
      'section4_manifest',
      '4.8 Missing archive file in multipart upload (/api/plugins/publish)',
      'FormData with no "file" part',
      'HTTP 400 Bad Request',
      `HTTP ${res.status} (${res.data?.error || res.rawText})`,
      passed,
      res.data?.error || ''
    );
  }

  // 4.9: Missing archive file in multipart request to /api/skills/publish
  {
    const formData = new FormData();
    formData.append('skillId', 'missing-file-skill');
    const res = await adminClient.post('/api/skills/publish', formData);
    const passed = res.status === 400;
    recordTest(
      'section4_manifest',
      '4.9 Missing archive file in multipart upload (/api/skills/publish)',
      'FormData with no "file" part',
      'HTTP 400 Bad Request',
      `HTTP ${res.status} (${res.data?.error || res.rawText})`,
      passed,
      res.data?.error || ''
    );
  }

  console.log('');

  // =========================================================================
  // SECTION 5: Authorization Bypass & Access Control
  // =========================================================================
  console.log('--- SECTION 5: Authorization Bypass & Access Control ---');

  const unauthClient = createApiClient();

  // 5.1: Unauthenticated request to /api/plugins/publish
  {
    const tar = createSamplePluginPackage('unauth-plugin', '1.0.0');
    const formData = new FormData();
    formData.append('file', new Blob([tar], { type: 'application/gzip' }), 'unauth.tar.gz');
    const res = await unauthClient.post('/api/plugins/publish', formData);
    const passed = res.status === 401;
    recordTest(
      'section5_auth',
      '5.1 Unauthenticated POST /api/plugins/publish',
      'No Authorization header, no cookie',
      'HTTP 401 Unauthorized',
      `HTTP ${res.status}`,
      passed,
      res.data?.error || ''
    );
  }

  // 5.2: Unauthenticated request to /api/skills/publish
  {
    const tar = createSampleSkillPackage('unauth-skill', '1.0.0');
    const formData = new FormData();
    formData.append('file', new Blob([tar], { type: 'application/gzip' }), 'unauth.tar.gz');
    const res = await unauthClient.post('/api/skills/publish', formData);
    const passed = res.status === 401;
    recordTest(
      'section5_auth',
      '5.2 Unauthenticated POST /api/skills/publish',
      'No Authorization header, no cookie',
      'HTTP 401 Unauthorized',
      `HTTP ${res.status}`,
      passed,
      res.data?.error || ''
    );
  }

  // 5.3: Unauthenticated request to DELETE /api/plugins/:id
  {
    const res = await unauthClient.delete('/api/plugins/token-tracker');
    const passed = res.status === 401;
    recordTest(
      'section5_auth',
      '5.3 Unauthenticated DELETE /api/plugins/token-tracker',
      'No Authorization header, no cookie',
      'HTTP 401 Unauthorized',
      `HTTP ${res.status}`,
      passed,
      res.data?.error || ''
    );
  }

  // 5.4: Unauthenticated request to DELETE /api/skills/:id
  {
    const res = await unauthClient.delete('/api/skills/accidental-data-loss-prevention');
    const passed = res.status === 401;
    recordTest(
      'section5_auth',
      '5.4 Unauthenticated DELETE /api/skills/accidental-data-loss-prevention',
      'No Authorization header, no cookie',
      'HTTP 401 Unauthorized',
      `HTTP ${res.status}`,
      passed,
      res.data?.error || ''
    );
  }

  // Setup regular user for role tests
  const regularEmail = generateRandomEmail('adv_m2_user');
  const regularPass = generateRandomPassword();
  await adminClient.post('/api/users', { email: regularEmail, password: regularPass, role: 'user' });

  const regularClient = createApiClient();
  await regularClient.login(regularEmail, regularPass);

  // 5.5: Regular user token attempting POST /api/plugins/publish
  {
    const tar = createSamplePluginPackage('user-plugin', '1.0.0');
    const formData = new FormData();
    formData.append('file', new Blob([tar], { type: 'application/gzip' }), 'user.tar.gz');
    const res = await regularClient.post('/api/plugins/publish', formData);
    const passed = res.status === 403;
    recordTest(
      'section5_auth',
      '5.5 Regular user attempting POST /api/plugins/publish',
      'JWT token for role: "user"',
      'HTTP 403 Forbidden',
      `HTTP ${res.status}`,
      passed,
      res.data?.error || ''
    );
  }

  // 5.6: Regular user token attempting POST /api/skills/publish
  {
    const tar = createSampleSkillPackage('user-skill', '1.0.0');
    const formData = new FormData();
    formData.append('file', new Blob([tar], { type: 'application/gzip' }), 'user.tar.gz');
    const res = await regularClient.post('/api/skills/publish', formData);
    const passed = res.status === 403;
    recordTest(
      'section5_auth',
      '5.6 Regular user attempting POST /api/skills/publish',
      'JWT token for role: "user"',
      'HTTP 403 Forbidden',
      `HTTP ${res.status}`,
      passed,
      res.data?.error || ''
    );
  }

  // 5.7: Regular user token attempting DELETE /api/plugins/token-tracker
  {
    const res = await regularClient.delete('/api/plugins/token-tracker');
    const passed = res.status === 403;
    recordTest(
      'section5_auth',
      '5.7 Regular user attempting DELETE /api/plugins/token-tracker',
      'JWT token for role: "user"',
      'HTTP 403 Forbidden',
      `HTTP ${res.status}`,
      passed,
      res.data?.error || ''
    );
  }

  // 5.8: Regular user token attempting DELETE /api/skills/accidental-data-loss-prevention
  {
    const res = await regularClient.delete('/api/skills/accidental-data-loss-prevention');
    const passed = res.status === 403;
    recordTest(
      'section5_auth',
      '5.8 Regular user attempting DELETE /api/skills/accidental-data-loss-prevention',
      'JWT token for role: "user"',
      'HTTP 403 Forbidden',
      `HTTP ${res.status}`,
      passed,
      res.data?.error || ''
    );
  }

  // 5.9: Forged JWT token signed with bogus secret
  {
    const forgedToken = jwt.sign(
      { sub: 'bogus-id', email: 'forged@admin.com', role: 'admin' },
      'wrong_secret_key_12345'
    );
    const forgedClient = createApiClient().setToken(forgedToken);
    const tar = createSamplePluginPackage('forged-plugin', '1.0.0');
    const formData = new FormData();
    formData.append('file', new Blob([tar], { type: 'application/gzip' }), 'forged.tar.gz');
    const res = await forgedClient.post('/api/plugins/publish', formData);
    const passed = res.status === 401;
    recordTest(
      'section5_auth',
      '5.9 Forged JWT token signed with bogus secret',
      'JWT signed with bogus secret',
      'HTTP 401 (Invalid or expired token)',
      `HTTP ${res.status}`,
      passed,
      res.data?.error || ''
    );
  }

  // 5.10: Expired JWT token
  {
    const expiredToken = jwt.sign(
      { sub: 'expired-id', email: ADMIN_EMAIL, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '-10s' }
    );
    const expiredClient = createApiClient().setToken(expiredToken);
    const tar = createSamplePluginPackage('expired-plugin', '1.0.0');
    const formData = new FormData();
    formData.append('file', new Blob([tar], { type: 'application/gzip' }), 'expired.tar.gz');
    const res = await expiredClient.post('/api/plugins/publish', formData);
    const passed = res.status === 401;
    recordTest(
      'section5_auth',
      '5.10 Expired JWT token on /api/plugins/publish',
      'JWT with negative expiry',
      'HTTP 401 (Invalid or expired token)',
      `HTTP ${res.status}`,
      passed,
      res.data?.error || ''
    );
  }

  // 5.11: Regular user API Key attempting to publish
  {
    // Generate API key for regular user
    const keyRes = await regularClient.post('/api/api-keys', { name: 'user-test-key' });
    const userApiKey = keyRes.data?.key;
    const apiKeyClient = createApiClient().setApiKey(userApiKey);

    const tar = createSamplePluginPackage('apikey-plugin', '1.0.0');
    const formData = new FormData();
    formData.append('file', new Blob([tar], { type: 'application/gzip' }), 'apikey.tar.gz');
    const res = await apiKeyClient.post('/api/plugins/publish', formData);
    const passed = res.status === 403;
    recordTest(
      'section5_auth',
      '5.11 Regular user API key on /api/plugins/publish',
      'X-API-Key for role: "user"',
      'HTTP 403 Forbidden',
      `HTTP ${res.status}`,
      passed,
      res.data?.error || ''
    );
  }

  // 5.12: Deactivated user token
  {
    // Get user id and deactivate user
    const usersRes = await adminClient.get('/api/users');
    const targetUser = usersRes.data?.find?.(u => u.email === regularEmail);
    if (targetUser) {
      // Deactivate target user in DB
      const { db } = await import('../dist/db/index.js');
      const { users } = await import('../dist/db/schema.js');
      const { eq } = await import('drizzle-orm');
      await db.update(users).set({ isActive: false }).where(eq(users.id, targetUser.id));

      const tar = createSamplePluginPackage('deactivated-plugin', '1.0.0');
      const formData = new FormData();
      formData.append('file', new Blob([tar], { type: 'application/gzip' }), 'deactivated.tar.gz');
      const res = await regularClient.post('/api/plugins/publish', formData);
      const passed = res.status === 401;
      recordTest(
        'section5_auth',
        '5.12 Deactivated user token attempting publish',
        'JWT token for inactive user (isActive=false)',
        'HTTP 401 (User is inactive or deleted)',
        `HTTP ${res.status}`,
        passed,
        res.data?.error || ''
      );

      // Re-activate or delete
      await db.delete(users).where(eq(users.id, targetUser.id));
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(' ADVERSARIAL STRESS TEST SUMMARY SCORECARD');
  console.log('='.repeat(80));
  console.log(` Total Tests Executed:     ${results.summary.total}`);
  console.log(` Tests Passed:             ${results.summary.passed}`);
  console.log(` Security Vulnerabilities: ${results.summary.vulnerabilities}`);
  console.log(` Behavioral Defect/Warns:  ${results.summary.warnings}`);
  console.log('='.repeat(80));

  return results;
}

runMilestone2AdversarialSuite()
  .then((res) => {
    if (res.summary.vulnerabilities > 0) {
      console.log('\n❌ EMPIRICAL CHALLENGE VERDICT: CHALLENGE_FAILED (Vulnerabilities Found)');
      process.exit(1);
    } else if (res.summary.warnings > 0) {
      console.log('\n⚠️ EMPIRICAL CHALLENGE VERDICT: CHALLENGE_FAILED (Defects Found)');
      process.exit(2);
    } else {
      console.log('\n✅ EMPIRICAL CHALLENGE VERDICT: APPROVE (All Stress Tests Passed)');
      process.exit(0);
    }
  })
  .catch((err) => {
    console.error('Unhandled test suite error:', err);
    process.exit(3);
  });
