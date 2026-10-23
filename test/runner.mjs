#!/usr/bin/env node
// test/runner.mjs
// Master E2E Test Suite Runner for Antigravity Cloud Hub across all 4 Tiers.

import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse CLI flags
const args = process.argv.slice(2);
let selectedTier = 'all';
let selectedMilestone = 'all';
let targetUrlArg = null;

for (const arg of args) {
  if (arg.startsWith('--tier=')) {
    selectedTier = arg.split('=')[1];
  } else if (arg.startsWith('--milestone=') || arg.startsWith('-m=')) {
    selectedMilestone = arg.split('=')[1];
  } else if (arg.startsWith('--target=')) {
    targetUrlArg = arg.split('=')[1];
  }
}

if (targetUrlArg) {
  process.env.TARGET_URL = targetUrlArg;
}

const targetUrl = process.env.TARGET_URL || 'http://localhost:4000';
const isLive = targetUrl.startsWith('https://') || targetUrl.includes('sslip.io');

console.log('='.repeat(78));
console.log('       ANTIGRAVITY CLOUD HUB — COMPREHENSIVE E2E TEST SUITE');
console.log('='.repeat(78));
console.log(` Target Endpoint: ${targetUrl}`);
console.log(` Target Mode:     ${isLive ? 'LIVE CLOUD RUN / CADDY HTTPS' : 'LOCAL DEVELOPMENT'}`);
console.log(` Selected Scope:  ${selectedMilestone !== 'all' ? `Milestone ${selectedMilestone}` : `Tier ${selectedTier.toUpperCase()}`}`);
console.log(` Started At:      ${new Date().toISOString()}`);
console.log('='.repeat(78));

// Map files by tier
const tierDirs = {
  '1': path.join(__dirname, 'tier1-features'),
  '2': path.join(__dirname, 'tier2-boundaries'),
  '3': path.join(__dirname, 'tier3-interactions'),
  '4': path.join(__dirname, 'tier4-scenarios')
};

const milestoneSuites = {
  '1': [
    path.join(__dirname, 'tier1-features', 'auth-rbac.test.mjs'),
    path.join(__dirname, 'tier2-boundaries', 'auth-boundaries.test.mjs'),
    path.join(__dirname, 'tier2-boundaries', 'deploy-boundaries.test.mjs'),
    path.join(__dirname, 'tier3-interactions', 'admin-lifecycle.test.mjs'),
  ],
  '2': [
    path.join(__dirname, 'tier1-features', 'registry.test.mjs'),
    path.join(__dirname, 'tier2-boundaries', 'registry-boundaries.test.mjs'),
    path.join(__dirname, 'tier3-interactions', 'publish-download.test.mjs'),
    path.join(__dirname, 'tier4-scenarios', 'plugin-hub-install.test.mjs'),
  ],
  '3': [
    path.join(__dirname, 'tier1-features', 'telemetry.test.mjs'),
    path.join(__dirname, 'tier1-features', 'deployment.test.mjs'),
    path.join(__dirname, 'tier2-boundaries', 'telemetry-boundaries.test.mjs'),
    path.join(__dirname, 'tier3-interactions', 'user-key-telemetry.test.mjs'),
    path.join(__dirname, 'tier3-interactions', 'telemetry-isolation.test.mjs'),
    path.join(__dirname, 'tier4-scenarios', 'token-tracker-sync.test.mjs'),
  ]
};

let selectedFiles = [];
const tierFileMap = new Map();

for (const [tierNum, dirPath] of Object.entries(tierDirs)) {
  if (selectedTier === 'all' || selectedTier === tierNum) {
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath)
        .filter(f => f.endsWith('.test.mjs'))
        .map(f => path.join(dirPath, f));
      
      for (const file of files) {
        selectedFiles.push(file);
        tierFileMap.set(file, `Tier ${tierNum}`);
      }
    }
  }
}

if (selectedMilestone !== 'all' && milestoneSuites[selectedMilestone]) {
  const allowed = new Set(milestoneSuites[selectedMilestone]);
  selectedFiles = selectedFiles.filter(f => allowed.has(f));
}

if (selectedFiles.length === 0) {
  console.error(`Error: No test files found for tier filter: ${selectedTier}`);
  process.exit(1);
}

console.log(`Discovered ${selectedFiles.length} test suites. Executing...\n`);

const startTime = Date.now();
let exitCode = 0;

// Track counts by tier
const tierStats = {
  'Tier 1': { total: 0, passed: 0, failed: 0, skipped: 0 },
  'Tier 2': { total: 0, passed: 0, failed: 0, skipped: 0 },
  'Tier 3': { total: 0, passed: 0, failed: 0, skipped: 0 },
  'Tier 4': { total: 0, passed: 0, failed: 0, skipped: 0 }
};

// Run tests serially to preserve deterministic state and avoid database concurrency issues
const testStream = run({
  files: selectedFiles,
  concurrency: 1,
  timeout: 45000
});

// Intercept events to collect tier statistics
testStream.on('test:pass', (t) => {
  // Only count leaf tests (not top-level describe blocks)
  if (t.name && (t.name.startsWith('T1.') || t.name.startsWith('T2.') || t.name.startsWith('T3.') || t.name.startsWith('T4.'))) {
    const tier = t.name.startsWith('T1.') ? 'Tier 1' :
                 t.name.startsWith('T2.') ? 'Tier 2' :
                 t.name.startsWith('T3.') ? 'Tier 3' : 'Tier 4';
    if (t.skip) {
      tierStats[tier].skipped++;
    } else {
      tierStats[tier].passed++;
    }
    tierStats[tier].total++;
  }
});

testStream.on('test:fail', (t) => {
  exitCode = 1;
  if (t.name && (t.name.startsWith('T1.') || t.name.startsWith('T2.') || t.name.startsWith('T3.') || t.name.startsWith('T4.'))) {
    const tier = t.name.startsWith('T1.') ? 'Tier 1' :
                 t.name.startsWith('T2.') ? 'Tier 2' :
                 t.name.startsWith('T3.') ? 'Tier 3' : 'Tier 4';
    tierStats[tier].failed++;
    tierStats[tier].total++;
  }
});

// Format with standard spec reporter
const reporter = new spec();
testStream.compose(reporter).pipe(process.stdout);

testStream.on('end', () => {
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  console.log('\n' + '='.repeat(78));
  console.log('                   E2E 4-TIER TEST SCORECARD');
  console.log('='.repeat(78));
  console.log(' Tier                      | Total | Passed | Failed | Skipped | Status');
  console.log('-'.repeat(78));

  let grandTotal = 0;
  let grandPassed = 0;
  let grandFailed = 0;
  let grandSkipped = 0;

  const tierLabels = {
    'Tier 1': 'Tier 1: Feature Coverage   ',
    'Tier 2': 'Tier 2: Boundary Cases     ',
    'Tier 3': 'Tier 3: Cross Interactions ',
    'Tier 4': 'Tier 4: Realistic Scenarios'
  };

  for (const [tierKey, stats] of Object.entries(tierStats)) {
    grandTotal += stats.total;
    grandPassed += stats.passed;
    grandFailed += stats.failed;
    grandSkipped += stats.skipped;

    const status = stats.failed > 0 ? 'FAIL ✗' : (stats.total > 0 ? 'PASS ✓' : 'N/A');
    const label = tierLabels[tierKey] || tierKey;
    const tStr = String(stats.total).padStart(5);
    const pStr = String(stats.passed).padStart(6);
    const fStr = String(stats.failed).padStart(6);
    const sStr = String(stats.skipped).padStart(7);

    console.log(` ${label} | ${tStr} | ${pStr} | ${fStr} | ${sStr} | ${status}`);
  }

  console.log('-'.repeat(78));
  const totStr = String(grandTotal).padStart(5);
  const pasStr = String(grandPassed).padStart(6);
  const faiStr = String(grandFailed).padStart(6);
  const skiStr = String(grandSkipped).padStart(7);
  const overallStatus = grandFailed > 0 ? 'FAILED ✗' : 'PASSED ✓';
  console.log(` TOTAL                     | ${totStr} | ${pasStr} | ${faiStr} | ${skiStr} | ${overallStatus}`);
  console.log('='.repeat(78));
  console.log(` Total Time Elapsed: ${duration}s`);
  console.log('='.repeat(78) + '\n');

  process.exit(exitCode);
});
