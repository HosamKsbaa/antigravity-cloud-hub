// test/empirical-challenger-m2-verification.mjs
// Empirical verification of package integrity, streaming downloads, SHA-256 checksums,
// and executable script permissions across all seeded plugins and skills.

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import * as tar from 'tar';

const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';

const EXPECTED_PLUGINS = [
  'token-tracker',
  'hdm-system-doctor',
  'hdm-second-brain',
  'hdm-release-center',
  'hdm-plugin-hub',
  'hdm-flutter-studio',
  'googlecloudtools.datacloud_telemetry',
  'github-pr-reviewer',
  'gategoldjira-board',
  'gategoldjira',
];

const EXPECTED_SKILLS = [
  'accidental-data-loss-prevention',
  'antigravity-fix',
  'export_firebase_credentials',
  'fix-emulator',
  'hdm-chat-to-vault',
  'hdm-daily-planner',
  'hdm-explain-diff-html',
  'hdm-project-analysis',
  'hdm-rigorous_math_solver',
  'hdm-setup-devops-mobile',
  'hdm-vault-curator',
  'hdm-vault-ingest',
  'hdm-vault-search',
  'homes-cloud-deploy',
  'laravel-openapi',
  'notebook-guidance',
  'publish',
  'skill-repair',
  'update-antigravity-linux',
];

function computeSha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function findScripts(dir, base = '') {
  let scripts = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = path.join(base, entry.name);
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scripts = scripts.concat(findScripts(fullPath, relPath));
    } else if (entry.isFile()) {
      if (
        entry.name.endsWith('.sh') ||
        entry.name.endsWith('.py') ||
        entry.name.endsWith('.mjs') ||
        entry.name.endsWith('.bash')
      ) {
        scripts.push({
          relPath,
          fullPath,
          name: entry.name,
        });
      }
    }
  }
  return scripts;
}

async function verifyItem(type, item, registryEntry) {
  const itemUrl = `${BASE_URL}/api/${type}s/${encodeURIComponent(item.id)}/download`;
  const res = await fetch(itemUrl);

  const status = res.status;
  const contentType = res.headers.get('content-type');
  const contentDisp = res.headers.get('content-disposition');
  const headerSha = res.headers.get('x-checksum-sha256');

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const actualSha = computeSha256(buffer);
  const sizeBytes = buffer.length;

  const errors = [];

  if (status !== 200) {
    errors.push(`Status is ${status}, expected 200`);
  }
  if (!contentType || !contentType.includes('application/gzip')) {
    errors.push(`Content-Type is "${contentType}", expected application/gzip`);
  }
  if (!contentDisp || !contentDisp.includes('attachment; filename=')) {
    errors.push(`Content-Disposition is "${contentDisp}", expected attachment; filename=...`);
  }
  if (headerSha !== actualSha) {
    errors.push(`X-Checksum-Sha256 header (${headerSha}) does not match body SHA256 (${actualSha})`);
  }
  if (registryEntry && registryEntry.checksum && registryEntry.checksum !== actualSha) {
    errors.push(`Registry checksum (${registryEntry.checksum}) does not match body SHA256 (${actualSha})`);
  }

  // Extract tarball to temporary directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `empirical-${type}-${item.id}-`));
  const tarFile = path.join(tmpDir, 'bundle.tar.gz');
  fs.writeFileSync(tarFile, buffer);

  const extractDir = path.join(tmpDir, 'extracted');
  fs.mkdirSync(extractDir);

  let tarEntries = [];
  try {
    tar.extract({
      file: tarFile,
      cwd: extractDir,
      sync: true,
      onentry: (entry) => {
        tarEntries.push({
          path: entry.path,
          mode: entry.mode,
          modeOctal: (entry.mode & 0o777).toString(8),
        });
      },
    });
  } catch (err) {
    errors.push(`Failed to extract tarball: ${err.message}`);
  }

  // Find all script files
  const scripts = findScripts(extractDir);
  const nonExecScripts = [];

  for (const s of scripts) {
    const stat = fs.statSync(s.fullPath);
    const mode = stat.mode;
    const modeOctal = (mode & 0o777).toString(8);
    const isExec = (mode & 0o111) !== 0;

    if (!isExec) {
      nonExecScripts.push({
        script: s.relPath,
        mode: modeOctal,
      });
      errors.push(`Script "${s.relPath}" is NOT executable (mode: 0${modeOctal})`);
    }
  }

  // Cleanup
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}

  return {
    id: item.id,
    type,
    version: item.version,
    status,
    contentType,
    contentDisp,
    sizeBytes,
    actualSha,
    headerSha,
    registrySha: registryEntry?.checksum,
    shaMatch: actualSha === headerSha && (!registryEntry?.checksum || actualSha === registryEntry.checksum),
    tarEntriesCount: tarEntries.length,
    scriptCount: scripts.length,
    scripts: scripts.map((s) => s.relPath),
    nonExecScripts,
    passed: errors.length === 0,
    errors,
  };
}

async function run() {
  console.log('='.repeat(80));
  console.log('ANTIGRAVITY CLOUD HUB — EMPIRICAL PACKAGE VERIFICATION SUITE');
  console.log(`Server Endpoint: ${BASE_URL}`);
  console.log(`Started At:      ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  // 1. Fetch /api/registry.json
  console.log('\n[1/3] Fetching /api/registry.json...');
  const regRes = await fetch(`${BASE_URL}/api/registry.json`);
  if (!regRes.ok) {
    console.error(`FATAL: /api/registry.json returned status ${regRes.status}`);
    process.exit(1);
  }
  const registry = await regRes.json();
  console.log(`✓ Fetched registry.json: schemaVersion=${registry.schemaVersion}, registryName="${registry.registryName}"`);
  console.log(`  Found ${registry.plugins.length} plugins and ${registry.skills.length} skills in catalog.`);

  const pluginMap = new Map(registry.plugins.map((p) => [p.id, p]));
  const skillMap = new Map(registry.skills.map((s) => [s.id, s]));

  // Verify all expected plugins and skills are in registry
  const missingPlugins = EXPECTED_PLUGINS.filter((id) => !pluginMap.has(id));
  const missingSkills = EXPECTED_SKILLS.filter((id) => !skillMap.has(id));

  if (missingPlugins.length > 0) {
    console.error(`ERROR: Missing expected plugins in registry: ${missingPlugins.join(', ')}`);
  } else {
    console.log(`✓ All 10 expected plugins are present in registry.json.`);
  }

  if (missingSkills.length > 0) {
    console.error(`ERROR: Missing expected skills in registry: ${missingSkills.join(', ')}`);
  } else {
    console.log(`✓ All 19 expected skills are present in registry.json.`);
  }

  // 2. Download and verify every plugin and skill
  console.log('\n[2/3] Verifying bundle integrity, SHA-256, and executable scripts...');
  const pluginResults = [];
  for (const id of EXPECTED_PLUGINS) {
    const entry = pluginMap.get(id);
    const result = await verifyItem('plugin', { id, version: entry?.version || '1.0.0' }, entry);
    pluginResults.push(result);
    const statusMark = result.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`  [Plugin] ${result.id.padEnd(36)} v${result.version.padEnd(6)} ${statusMark} (${result.sizeBytes} B, ${result.scriptCount} scripts)`);
    if (!result.passed) {
      result.errors.forEach((e) => console.log(`      -> Error: ${e}`));
    }
  }

  const skillResults = [];
  for (const id of EXPECTED_SKILLS) {
    const entry = skillMap.get(id);
    const result = await verifyItem('skill', { id, version: entry?.version || '1.0.0' }, entry);
    skillResults.push(result);
    const statusMark = result.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`  [Skill]  ${result.id.padEnd(36)} v${result.version.padEnd(6)} ${statusMark} (${result.sizeBytes} B, ${result.scriptCount} scripts)`);
    if (!result.passed) {
      result.errors.forEach((e) => console.log(`      -> Error: ${e}`));
    }
  }

  // 3. Test version query parameter variations
  console.log('\n[3/3] Testing version query parameter behaviors...');
  const versionTests = [
    {
      name: 'Plugin token-tracker ?version=2.0.0 (exact version)',
      url: `${BASE_URL}/api/plugins/token-tracker/download?version=2.0.0`,
      expectedStatus: 200,
    },
    {
      name: 'Plugin token-tracker ?version=99.99.99 (non-existent version)',
      url: `${BASE_URL}/api/plugins/token-tracker/download?version=99.99.99`,
      expectedStatus: 404,
    },
    {
      name: 'Plugin token-tracker ?v=2.0.0 (shorthand version)',
      url: `${BASE_URL}/api/plugins/token-tracker/download?v=2.0.0`,
      expectedStatus: 200,
    },
    {
      name: 'Plugin token-tracker ?v=99.99.99 (shorthand non-existent version)',
      url: `${BASE_URL}/api/plugins/token-tracker/download?v=99.99.99`,
      expectedStatus: 404,
    },
    {
      name: 'Skill accidental-data-loss-prevention ?version=1.0.0',
      url: `${BASE_URL}/api/skills/accidental-data-loss-prevention/download?version=1.0.0`,
      expectedStatus: 200,
    },
    {
      name: 'Skill accidental-data-loss-prevention ?version=99.99.99',
      url: `${BASE_URL}/api/skills/accidental-data-loss-prevention/download?version=99.99.99`,
      expectedStatus: 404,
    },
    {
      name: 'Skill accidental-data-loss-prevention ?v=1.0.0',
      url: `${BASE_URL}/api/skills/accidental-data-loss-prevention/download?v=1.0.0`,
      expectedStatus: 200,
    },
    {
      name: 'Skill accidental-data-loss-prevention ?v=99.99.99',
      url: `${BASE_URL}/api/skills/accidental-data-loss-prevention/download?v=99.99.99`,
      expectedStatus: 404,
    },
  ];

  const versionTestResults = [];
  for (const vt of versionTests) {
    const res = await fetch(vt.url);
    const passed = res.status === vt.expectedStatus;
    const bodyText = !passed ? (await res.text()).slice(0, 100) : '';
    versionTestResults.push({
      name: vt.name,
      url: vt.url,
      expectedStatus: vt.expectedStatus,
      actualStatus: res.status,
      passed,
      bodyPreview: bodyText,
    });
    console.log(`  ${passed ? '✓ PASS' : '✗ FAIL'}: ${vt.name} (Got ${res.status}, Expected ${vt.expectedStatus})`);
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('VERIFICATION SCORECARD');
  console.log('='.repeat(80));

  const totalPackages = pluginResults.length + skillResults.length;
  const passedPackages = pluginResults.filter((p) => p.passed).length + skillResults.filter((s) => s.passed).length;
  const totalVersionTests = versionTestResults.length;
  const passedVersionTests = versionTestResults.filter((v) => v.passed).length;

  console.log(`Packages Tested: ${totalPackages} (${pluginResults.length} plugins, ${skillResults.length} skills)`);
  console.log(`Packages Passed: ${passedPackages} / ${totalPackages}`);
  console.log(`Version Tests:   ${passedVersionTests} / ${totalVersionTests} passed`);

  const allPassed = passedPackages === totalPackages && passedVersionTests === totalVersionTests;
  console.log(`\nOVERALL VERDICT: ${allPassed ? 'APPROVE' : 'CHALLENGE_FAILED'}`);
  console.log('='.repeat(80));

  // Write full JSON results to file for evidence inspection
  const reportPath = path.join(process.cwd(), 'test', 'empirical-verification-report.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        overallVerdict: allPassed ? 'APPROVE' : 'CHALLENGE_FAILED',
        summary: {
          totalPackages,
          passedPackages,
          totalVersionTests,
          passedVersionTests,
        },
        plugins: pluginResults,
        skills: skillResults,
        versionTests: versionTestResults,
      },
      null,
      2
    )
  );
  console.log(`Full report saved to: ${reportPath}`);

  return {
    allPassed,
    pluginResults,
    skillResults,
    versionTestResults,
  };
}

run().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
