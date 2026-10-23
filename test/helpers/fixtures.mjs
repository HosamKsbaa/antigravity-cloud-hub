// test/helpers/fixtures.mjs
// Test fixtures, payload generators, and archive builders for Antigravity Cloud Hub E2E tests.

import zlib from 'node:zlib';

/**
 * Creates a minimal valid USTAR tar archive in memory and compresses it with gzip.
 * @param {Record<string, string | Buffer>} files Map of relative file paths to content.
 * @returns {Buffer} Gzip-compressed tarball buffer.
 */
export function createTarGzBuffer(files) {
  const blocks = [];

  for (const [filename, content] of Object.entries(files)) {
    const fileBuf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
    const header = Buffer.alloc(512);

    // filename (0..99)
    header.write(filename, 0, 100, 'utf-8');
    // mode (100..107) -> 0000755\0
    header.write('0000755\0', 100, 8, 'utf-8');
    // uid (108..115)
    header.write('0001750\0', 108, 8, 'utf-8');
    // gid (116..123)
    header.write('0001750\0', 116, 8, 'utf-8');
    // size in octal (124..135)
    const sizeOctal = fileBuf.length.toString(8).padStart(11, '0') + ' ';
    header.write(sizeOctal, 124, 12, 'utf-8');
    // mtime (136..147)
    const mtimeOctal = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + ' ';
    header.write(mtimeOctal, 136, 12, 'utf-8');
    // typeflag (156) -> '0' for normal file
    header.write('0', 156, 1, 'utf-8');
    // ustar magic (257..262) -> "ustar\0"
    header.write('ustar\0', 257, 6, 'utf-8');
    // ustar version (263..264) -> "00"
    header.write('00', 263, 2, 'utf-8');

    // checksum calculation (256 spaces placed at 148..155 during calculation)
    header.fill(' ', 148, 156);
    let checksum = 0;
    for (let i = 0; i < 512; i++) {
      checksum += header[i];
    }
    const checksumOctal = checksum.toString(8).padStart(6, '0') + '\0 ';
    header.write(checksumOctal, 148, 8, 'utf-8');

    blocks.push(header);
    blocks.push(fileBuf);

    // Padding file data to 512-byte boundary
    const remainder = fileBuf.length % 512;
    if (remainder > 0) {
      blocks.push(Buffer.alloc(512 - remainder));
    }
  }

  // Two 512-byte zero blocks indicating end of archive
  blocks.push(Buffer.alloc(1024));

  const tarBuffer = Buffer.concat(blocks);
  return zlib.gzipSync(tarBuffer);
}

/**
 * Creates a sample plugin package tarball with plugin.json manifest.
 */
export function createSamplePluginPackage(pluginId = 'sample-test-plugin', version = '1.0.0') {
  const manifest = {
    id: pluginId,
    name: pluginId,
    displayName: `Test Plugin ${pluginId}`,
    version: version,
    description: 'E2E Automated Test Plugin Package',
    author: 'Test Suite',
    tags: ['test', 'e2e'],
    skills: [],
    sidecars: []
  };

  return createTarGzBuffer({
    'plugin.json': JSON.stringify(manifest, null, 2),
    'README.md': `# ${manifest.displayName}\nAutomated test plugin bundle.`,
    'scripts/run.sh': '#!/bin/bash\necho "Running test plugin"\n'
  });
}

/**
 * Creates a sample skill package tarball with SKILL.md.
 */
export function createSampleSkillPackage(skillId = 'sample-test-skill', version = '1.0.0') {
  const skillDoc = `---
name: ${skillId}
description: E2E Automated Test Skill for testing Antigravity Cloud Hub
version: ${version}
---

# ${skillId}
This is an automated test skill.
`;

  return createTarGzBuffer({
    'SKILL.md': skillDoc,
    'scripts/test.py': '#!/usr/bin/env python3\nprint("Test skill executed")\n'
  });
}

/**
 * Builds a valid telemetry payload modeled on token-tracker format.
 */
export function buildTelemetryPayload(overrides = {}) {
  const now = new Date().toISOString();
  const convId = 'conv-' + Math.random().toString(36).substring(2, 10);

  return {
    clientVersion: '2.0.0',
    machineId: 'e2e-test-runner-01',
    syncedAt: now,
    workspaces: [
      {
        workspaceName: 'antigravity-e2e',
        workspacePath: '/tmp/antigravity-e2e-workspace',
        conversationsCount: 1,
        turnsCount: 5,
        inputTokens: 10000,
        cacheReadTokens: 40000,
        outputTokens: 2500,
        thinkingTokens: 1000,
        responseTokens: 1500,
        costUsd: 0.05
      }
    ],
    dailyUsage: [
      {
        date: new Date().toISOString().split('T')[0],
        modelName: 'Gemini 4 Argon (High)',
        workspaceName: 'antigravity-e2e',
        turns: 5,
        inputTokens: 10000,
        cacheReadTokens: 40000,
        outputTokens: 2500,
        thinkingTokens: 1000,
        responseTokens: 1500,
        totalTokens: 52500,
        costUsd: 0.05
      }
    ],
    conversations: [
      {
        conversationId: convId,
        title: 'E2E Automated Telemetry Verification Run',
        workspaceName: 'antigravity-e2e',
        workspacePath: '/tmp/antigravity-e2e-workspace',
        isSubagent: false,
        agentName: null,
        parentConversationId: null,
        primaryModel: 'Gemini 4 Argon (High)',
        turns: 5,
        inputTokens: 10000,
        cacheReadTokens: 40000,
        outputTokens: 2500,
        thinkingTokens: 1000,
        responseTokens: 1500,
        totalTokens: 52500,
        costUsd: 0.05,
        firstAt: now,
        lastActiveAt: now
      }
    ],
    records: [
      {
        conversationId: convId,
        stepIndex: 1,
        modelCode: 1417,
        modelName: 'Gemini 4 Argon (High)',
        backendModel: 'gemini-4-argon-b',
        inputTokens: 2000,
        cacheReadTokens: 8000,
        outputTokens: 500,
        thinkingTokens: 200,
        responseTokens: 300,
        latencyMs: 1200,
        ttftMs: 350,
        costUsd: 0.01,
        tools: ['view_file'],
        promptSummary: 'Verify telemetry persistence in database',
        traceId: 'tr-e2e-' + Math.random().toString(36).substring(2, 8),
        createdAt: now
      }
    ],
    ...overrides
  };
}

// Known seeded items that must be present in the registry catalog
export const EXPECTED_SEEDED_PLUGINS = [
  'token-tracker',
  'hdm-plugin-hub'
];

export const EXPECTED_SEEDED_SKILLS = [
  'accidental-data-loss-prevention',
  'fix-emulator',
  'update-antigravity-linux'
];
