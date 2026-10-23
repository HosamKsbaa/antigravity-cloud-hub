// test/adversarial_challenge_m1.mjs
// Adversarial Empirical Challenge Suite for Milestone 1 (Auth, JWT, Input Validation, Timing & Cookies)

import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const TARGET_URL = (process.env.TARGET_URL || 'http://localhost:4000').replace(/\/+$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'hosamchakasba@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const JWT_SECRET = process.env.JWT_SECRET || 'antigravity_cloud_hub_jwt_super_secret_key_2026';

const results = {
  section1_jwt: [],
  section2_inputs: [],
  section3_timing: {},
  section4_precedence: [],
  summary: { total: 0, passed: 0, vulnerabilities: 0, warnings: 0 }
};

function recordTest(section, name, payload, expected, actual, passed, details = '') {
  results.summary.total++;
  if (passed) {
    results.summary.passed++;
  } else {
    results.summary.vulnerabilities++;
  }
  const item = { name, payload: typeof payload === 'string' && payload.length > 100 ? payload.slice(0, 100) + '...[truncated]' : payload, expected, actual, passed, details };
  if (Array.isArray(results[section])) {
    results[section].push(item);
  }
  const statusMark = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[${statusMark}] ${name} | Expected: ${expected} | Got: ${actual} ${details ? '(' + details + ')' : ''}`);
}

async function request(path, options = {}) {
  const url = `${TARGET_URL}${path}`;
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body !== undefined && body !== null && typeof body === 'object' && !(body instanceof Uint8Array)) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    body = JSON.stringify(body);
  }

  const start = performance.now();
  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body,
    });
    const duration = performance.now() - start;
    const contentType = res.headers.get('content-type') || '';
    let data = null;
    let text = await res.text();
    if (contentType.includes('application/json')) {
      try { data = JSON.parse(text); } catch { data = null; }
    }
    return {
      status: res.status,
      headers: res.headers,
      data,
      text,
      duration
    };
  } catch (err) {
    const duration = performance.now() - start;
    return {
      status: 0,
      headers: new Headers(),
      data: null,
      text: err.message,
      duration,
      error: err
    };
  }
}

async function runAdversarialSuite() {
  console.log('='.repeat(80));
  console.log(' ADVERSARIAL CHALLENGE HARNESS — MILESTONE 1');
  console.log(` Target: ${TARGET_URL}`);
  console.log(` Admin Email: ${ADMIN_EMAIL}`);
  console.log(` Date: ${new Date().toISOString()}`);
  console.log('='.repeat(80) + '\n');

  // Baseline: Login as Admin to get valid token and admin ID
  console.log('--- Establishing Baseline Admin Session ---');
  const baseline = await request('/api/auth/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
  });

  if (baseline.status !== 200 || !baseline.data?.token) {
    console.error(`FATAL: Cannot authenticate baseline admin: ${baseline.status} ${baseline.text}`);
    process.exit(1);
  }

  const validAdminToken = baseline.data.token;
  const adminId = baseline.data.user.id;
  console.log(`Baseline Admin Authenticated. ID: ${adminId}, Token: ${validAdminToken.slice(0, 25)}...\n`);

  // Create a regular user for role precedence and testing
  const regEmail = `adv_user_${Date.now()}@example.com`;
  const regPassword = 'UserAdvPass123!';
  const createReg = await request('/api/users', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${validAdminToken}` },
    body: { email: regEmail, password: regPassword, role: 'user', name: 'Adversarial Test User' }
  });
  const regUserRes = await request('/api/auth/login', {
    method: 'POST',
    body: { email: regEmail, password: regPassword }
  });
  const validRegToken = regUserRes.data?.token;
  const regUserId = regUserRes.data?.user?.id;

  // Generate an API key for the regular user
  const apiKeyRes = await request('/api/api-keys', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${validRegToken}` },
    body: { name: 'Adv Key' }
  });
  const regApiKey = apiKeyRes.data?.key;

  // =========================================================================
  // SECTION 1: MALFORMED & FORGED JWT TOKENS
  // =========================================================================
  console.log('\n--- SECTION 1: MALFORMED & FORGED JWT TOKENS ---');

  // 1.1 Wrong Secret
  const wrongSecretToken = jwt.sign(
    { sub: adminId, email: ADMIN_EMAIL, role: 'admin' },
    'completely_wrong_secret_key_abcdef123456789',
    { expiresIn: '1h' }
  );
  const res1_1 = await request('/api/auth/me', {
    headers: { 'Authorization': `Bearer ${wrongSecretToken}` }
  });
  recordTest('section1_jwt', '1.1 JWT Signed with Wrong Secret', wrongSecretToken, 401, res1_1.status, res1_1.status === 401, res1_1.data?.error);

  // 1.2 Expired Token
  const expiredToken = jwt.sign(
    { sub: adminId, email: ADMIN_EMAIL, role: 'admin' },
    JWT_SECRET,
    { expiresIn: -3600 } // expired 1 hour ago
  );
  const res1_2 = await request('/api/auth/me', {
    headers: { 'Authorization': `Bearer ${expiredToken}` }
  });
  recordTest('section1_jwt', '1.2 Expired JWT Token', expiredToken, 401, res1_2.status, res1_2.status === 401, res1_2.data?.error);

  // 1.3 None Algorithm Attack (Standard 'none' with trailing dot)
  const headerNone = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payloadNone = Buffer.from(JSON.stringify({ sub: adminId, email: ADMIN_EMAIL, role: 'admin', iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  const tokenNoneStandard = `${headerNone}.${payloadNone}.`;
  const res1_3a = await request('/api/auth/me', {
    headers: { 'Authorization': `Bearer ${tokenNoneStandard}` }
  });
  recordTest('section1_jwt', "1.3a None Algorithm Attack ('none' with trailing dot)", tokenNoneStandard, 401, res1_3a.status, res1_3a.status === 401, res1_3a.data?.error);

  // 1.3b None Algorithm without trailing dot
  const tokenNoneNoDot = `${headerNone}.${payloadNone}`;
  const res1_3b = await request('/api/auth/me', {
    headers: { 'Authorization': `Bearer ${tokenNoneNoDot}` }
  });
  recordTest('section1_jwt', "1.3b None Algorithm Attack ('none' without trailing dot)", tokenNoneNoDot, 401, res1_3b.status, res1_3b.status === 401, res1_3b.data?.error);

  // 1.3c Capitalized 'None'
  const headerNoneCap = Buffer.from(JSON.stringify({ alg: 'None', typ: 'JWT' })).toString('base64url');
  const tokenNoneCap = `${headerNoneCap}.${payloadNone}.`;
  const res1_3c = await request('/api/auth/me', {
    headers: { 'Authorization': `Bearer ${tokenNoneCap}` }
  });
  recordTest('section1_jwt', "1.3c None Algorithm Attack (Capitalized 'None')", tokenNoneCap, 401, res1_3c.status, res1_3c.status === 401, res1_3c.data?.error);

  // 1.4 Garbage Signature on Valid Token
  const parts = validAdminToken.split('.');
  const corruptedSigToken = `${parts[0]}.${parts[1]}.GarbageCorruptedSignatureXYZ0123456789`;
  const res1_4 = await request('/api/auth/me', {
    headers: { 'Authorization': `Bearer ${corruptedSigToken}` }
  });
  recordTest('section1_jwt', '1.4 Garbage Signature on Valid Token', corruptedSigToken, 401, res1_4.status, res1_4.status === 401, res1_4.data?.error);

  // 1.5 Truncated & Malformed Tokens
  const res1_5a = await request('/api/auth/me', {
    headers: { 'Authorization': 'Bearer ' }
  });
  recordTest('section1_jwt', '1.5a Empty Bearer Token (Bearer <empty>)', 'Bearer ', 401, res1_5a.status, res1_5a.status === 401, res1_5a.data?.error);

  const res1_5b = await request('/api/auth/me', {
    headers: { 'Authorization': 'Bearer not.a.valid.jwt.at.all' }
  });
  recordTest('section1_jwt', '1.5b Malformed 5-segment Non-JWT', 'Bearer not.a.valid.jwt.at.all', 401, res1_5b.status, res1_5b.status === 401, res1_5b.data?.error);

  const res1_5c = await request('/api/auth/me', {
    headers: { 'Authorization': 'Bearer ' + 'A'.repeat(5000) }
  });
  recordTest('section1_jwt', '1.5c Massive 5KB Random String Bearer', 'Bearer A*5000', 401, res1_5c.status, res1_5c.status === 401, res1_5c.data?.error);

  // 1.6 Malformed Payloads with Valid Signature
  // 1.6a Non-UUID sub (SQLi string in sub)
  const sqliSubToken = jwt.sign(
    { sub: "' OR 1=1 --", email: 'attacker@example.com', role: 'admin' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  const res1_6a = await request('/api/auth/me', {
    headers: { 'Authorization': `Bearer ${sqliSubToken}` }
  });
  recordTest('section1_jwt', "1.6a Valid Signature with SQLi sub (' OR 1=1 --)", sqliSubToken, 401, res1_6a.status, res1_6a.status === 401, res1_6a.data?.error);

  // 1.6b Numeric sub
  const numSubToken = jwt.sign(
    { sub: 9999999, email: 'attacker@example.com', role: 'admin' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  const res1_6b = await request('/api/auth/me', {
    headers: { 'Authorization': `Bearer ${numSubToken}` }
  });
  recordTest('section1_jwt', '1.6b Valid Signature with Numeric sub (9999999)', numSubToken, 401, res1_6b.status, res1_6b.status === 401, res1_6b.data?.error);

  // 1.6c Non-existent UUID sub
  const nonExistentUuidToken = jwt.sign(
    { sub: '00000000-0000-0000-0000-000000000000', email: 'ghost@example.com', role: 'admin' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  const res1_6c = await request('/api/auth/me', {
    headers: { 'Authorization': `Bearer ${nonExistentUuidToken}` }
  });
  recordTest('section1_jwt', '1.6c Valid Signature with Non-Existent UUID sub', nonExistentUuidToken, 401, res1_6c.status, res1_6c.status === 401, res1_6c.data?.error);

  // =========================================================================
  // SECTION 2: EXTREME & MALFORMED INPUTS TO /api/auth/login
  // =========================================================================
  console.log('\n--- SECTION 2: EXTREME & MALFORMED INPUTS TO /api/auth/login ---');

  // 2.1 SQL Injection Payloads
  const sqliPayloads = [
    { name: "2.1a SQLi OR 1=1 in email", body: { email: "' OR '1'='1", password: 'password' } },
    { name: "2.1b SQLi comment in email", body: { email: "admin' --", password: 'password' } },
    { name: "2.1c SQLi stacked query", body: { email: "admin'; DROP TABLE users; --", password: 'password' } },
    { name: "2.1d SQLi UNION SELECT", body: { email: "' UNION SELECT NULL, 'admin', 'hash', 'admin', true, NOW(), NOW() --", password: 'password' } },
    { name: "2.1e SQLi in password", body: { email: ADMIN_EMAIL, password: "' OR '1'='1" } },
  ];

  for (const tc of sqliPayloads) {
    const res = await request('/api/auth/login', { method: 'POST', body: tc.body });
    recordTest('section2_inputs', tc.name, tc.body, 401, res.status, res.status === 401, res.data?.error);
  }

  // 2.2 Null Byte Payloads
  const res2_2a = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'hosamchakasba\u0000@gmail.com', password: 'admin' }
  });
  // Note: If postgres throws error for null byte, does server crash with 500 or return 400/401?
  recordTest('section2_inputs', '2.2a Null Byte in Email (hosamchakasba\\0@gmail.com)', 'email with \\0', '400 or 401', res2_2a.status, res2_2a.status === 400 || res2_2a.status === 401, res2_2a.data?.error || res2_2a.text);

  const res2_2b = await request('/api/auth/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: 'admin\u0000' }
  });
  // Bcrypt test: does 'admin\0' match password 'admin'? In C bcrypt it truncates at \0; in bcryptjs it does not!
  recordTest('section2_inputs', '2.2b Null Byte in Password (admin\\0 vs admin)', 'password with \\0', 401, res2_2b.status, res2_2b.status === 401, `Status: ${res2_2b.status}`);

  // 2.3 Unicode & Encoding Edge Cases
  const res2_3a = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'hosamchakasba@gmaıl.com', password: 'admin' } // Turkish dotless i
  });
  recordTest('section2_inputs', '2.3a Turkish Dotless i in Domain (gmaıl.com)', 'gmaıl.com', 401, res2_3a.status, res2_3a.status === 401, res2_3a.data?.error);

  const res2_3b = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'hosamchakasba@gmail.com\u200B', password: 'admin' } // Zero-width space
  });
  recordTest('section2_inputs', '2.3b Zero-Width Space Trailing Email (\\u200B)', 'email with \\u200B', 401, res2_3b.status, res2_3b.status === 401, res2_3b.data?.error);

  const res2_3c = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin🔥@example.com', password: 'pass🔑' } // Emojis
  });
  recordTest('section2_inputs', '2.3c Emojis in Email & Password', 'admin🔥@example.com', 401, res2_3c.status, res2_3c.status === 401, res2_3c.data?.error);

  // 2.4 Extreme Size Payloads (10KB, 50KB, 95KB, 120KB)
  console.log('\n--- Testing Extreme Password Sizes (Latency & DoS checks) ---');
  const sizes = [
    { label: '10KB Password', len: 10 * 1024 },
    { label: '50KB Password', len: 50 * 1024 },
    { label: '95KB Password', len: 95 * 1024 },
    { label: '120KB Payload (Exceeds Express default 100kb limit)', len: 120 * 1024 },
  ];

  for (const s of sizes) {
    const hugePassword = 'P'.repeat(s.len);
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: hugePassword }
    });
    const expected = s.len > 100 * 1024 ? 413 : 401;
    const passed = s.len > 100 * 1024 ? (res.status === 413 || res.status === 400) : (res.status === 401);
    recordTest('section2_inputs', `2.4 Extreme Size: ${s.label}`, `Length ${s.len} bytes`, expected, res.status, passed, `Latency: ${res.duration.toFixed(1)}ms`);
  }

  // 2.5 Type Confusion & Non-Object Payloads
  const typeConfusionCases = [
    { name: '2.5a Numbers in Email and Password', body: { email: 12345, password: 67890 } },
    { name: '2.5b Arrays in Email and Password', body: { email: [ADMIN_EMAIL], password: [ADMIN_PASSWORD] } },
    { name: '2.5c Objects in Email and Password', body: { email: { user: ADMIN_EMAIL }, password: {} } },
    { name: '2.5d Booleans in Email and Password', body: { email: true, password: false } },
    { name: '2.5e Missing Password Field', body: { email: ADMIN_EMAIL } },
    { name: '2.5f Empty Object Body', body: {} },
  ];

  for (const tc of typeConfusionCases) {
    const res = await request('/api/auth/login', { method: 'POST', body: tc.body });
    const passed = (res.status === 400 || res.status === 401);
    recordTest('section2_inputs', tc.name, tc.body, '400 or 401', res.status, passed, res.data?.error || res.text);
  }

  // =========================================================================
  // SECTION 3: BCRYPT TIMING & PASSWORD BRUTE-FORCE RESISTANCE
  // =========================================================================
  console.log('\n--- SECTION 3: BCRYPT TIMING & BRUTE FORCE RESISTANCE ---');

  // 3.1 Timing Discrepancy (User Enumeration Side-Channel)
  console.log('Benchmarking response timing for non-existent vs existing users (30 samples each)...');
  const nonExistentTimings = [];
  const existingTimings = [];

  for (let i = 0; i < 30; i++) {
    // Non-existent user
    const r1 = await request('/api/auth/login', {
      method: 'POST',
      body: { email: `nonexistent_${Date.now()}_${i}@example.local`, password: 'WrongPassword123!' }
    });
    nonExistentTimings.push(r1.duration);

    // Existing user with wrong password
    const r2 = await request('/api/auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: 'WrongPassword123!' }
    });
    existingTimings.push(r2.duration);
  }

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const median = arr => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  const nonExistAvg = avg(nonExistentTimings);
  const nonExistMed = median(nonExistentTimings);
  const existAvg = avg(existingTimings);
  const existMed = median(existingTimings);
  const timingRatio = existAvg / nonExistAvg;

  results.section3_timing = {
    nonExistent: { avgMs: nonExistAvg.toFixed(2), medianMs: nonExistMed.toFixed(2), minMs: Math.min(...nonExistentTimings).toFixed(2), maxMs: Math.max(...nonExistentTimings).toFixed(2) },
    existing: { avgMs: existAvg.toFixed(2), medianMs: existMed.toFixed(2), minMs: Math.min(...existingTimings).toFixed(2), maxMs: Math.max(...existingTimings).toFixed(2) },
    timingRatio: timingRatio.toFixed(2),
    vulnerability: timingRatio > 5.0
  };

  console.log(`Non-existent user timing: Avg = ${nonExistAvg.toFixed(2)}ms, Median = ${nonExistMed.toFixed(2)}ms`);
  console.log(`Existing user timing:     Avg = ${existAvg.toFixed(2)}ms, Median = ${existMed.toFixed(2)}ms`);
  console.log(`Timing Delta Ratio:       ${timingRatio.toFixed(2)}x`);

  // Side-channel leak evaluation: If ratio is > 5x, email enumeration via timing is trivially possible!
  const hasTimingLeak = timingRatio > 5.0;
  recordTest(
    'section3_timing',
    '3.1 Bcrypt Timing Discrepancy (User Enumeration Side-Channel)',
    `Existing (${existAvg.toFixed(1)}ms) vs Non-Existent (${nonExistAvg.toFixed(1)}ms)`,
    'Timing delta < 5x (constant-time / dummy hash)',
    `${timingRatio.toFixed(1)}x delta`,
    !hasTimingLeak, // Will fail if timing leak exists
    `Avg difference: ${(existAvg - nonExistAvg).toFixed(1)}ms`
  );

  // 3.2 Rapid-fire Brute Force Attack (50 rapid requests)
  console.log('\nExecuting 50 rapid-fire failed login requests to test rate limiting...');
  const burstResults = [];
  for (let i = 0; i < 50; i++) {
    burstResults.push(request('/api/auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: `GuessPassword_${i}` }
    }));
  }
  const burstResponses = await Promise.all(burstResults);
  const statusCounts = {};
  burstResponses.forEach(r => {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
  });
  console.log('Burst response status distribution:', statusCounts);

  const hasRateLimiting = statusCounts[429] > 0;
  recordTest(
    'section3_timing',
    '3.2 Login Rate Limiting / Brute-Force Throttle (HTTP 429)',
    '50 rapid failed login attempts',
    'HTTP 429 Too Many Requests observed',
    `Status counts: ${JSON.stringify(statusCounts)}`,
    hasRateLimiting,
    hasRateLimiting ? 'Rate limiter engaged' : 'NO rate limiter present: vulnerable to brute-force'
  );

  // 3.3 Post-Burst Legit Login Test
  const legitLoginPostBurst = await request('/api/auth/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
  });
  recordTest(
    'section3_timing',
    '3.3 Legitimate Admin Login Post-Burst',
    'Admin login after 50 failed attempts',
    200,
    legitLoginPostBurst.status,
    legitLoginPostBurst.status === 200,
    legitLoginPostBurst.status === 200 ? 'Admin can still log in (No account lockout)' : 'Admin locked out or throttled'
  );

  // =========================================================================
  // SECTION 4: COOKIE VS BEARER PRECEDENCE & SESSION HANDLING
  // =========================================================================
  console.log('\n--- SECTION 4: COOKIE VS BEARER PRECEDENCE & SESSION HANDLING ---');

  // 4.1 Coexistence: Both Bearer (Admin) and Cookie (Regular User)
  const res4_1 = await request('/api/auth/me', {
    headers: {
      'Authorization': `Bearer ${validAdminToken}`,
      'Cookie': `agy_hub_session=${validRegToken}`
    }
  });
  const userRole4_1 = res4_1.data?.user?.role;
  recordTest(
    'section4_precedence',
    '4.1 Bearer(Admin) + Cookie(User) -> Bearer Takes Precedence',
    'Authorization: Bearer <admin>, Cookie: <user>',
    'admin (Bearer precedence)',
    userRole4_1,
    res4_1.status === 200 && userRole4_1 === 'admin',
    `Resolved user email: ${res4_1.data?.user?.email}`
  );

  // 4.2 Reverse: Bearer (User) + Cookie (Admin)
  const res4_2 = await request('/api/auth/me', {
    headers: {
      'Authorization': `Bearer ${validRegToken}`,
      'Cookie': `agy_hub_session=${validAdminToken}`
    }
  });
  const userRole4_2 = res4_2.data?.user?.role;
  recordTest(
    'section4_precedence',
    '4.2 Bearer(User) + Cookie(Admin) -> Bearer Takes Precedence',
    'Authorization: Bearer <user>, Cookie: <admin>',
    'user (Bearer precedence)',
    userRole4_2,
    res4_2.status === 200 && userRole4_2 === 'user',
    `Resolved user email: ${res4_2.data?.user?.email}`
  );

  // 4.3 Bearer Invalid + Cookie Valid
  const res4_3 = await request('/api/auth/me', {
    headers: {
      'Authorization': 'Bearer invalid.corrupted.token',
      'Cookie': `agy_hub_session=${validAdminToken}`
    }
  });
  // Since Bearer is explicitly sent, if it is invalid, does it reject (401) or fall back to cookie?
  recordTest(
    'section4_precedence',
    '4.3 Bearer(Invalid) + Cookie(Valid) Handling',
    'Authorization: Bearer <invalid>, Cookie: <valid_admin>',
    401,
    res4_3.status,
    res4_3.status === 401,
    res4_3.status === 401 ? 'Strict: Rejects invalid explicit Bearer header without silent fallback' : 'Permissive: Fallback to cookie'
  );

  // 4.4 Bearer Valid + Cookie Invalid
  const res4_4 = await request('/api/auth/me', {
    headers: {
      'Authorization': `Bearer ${validAdminToken}`,
      'Cookie': 'agy_hub_session=invalid.corrupted.token'
    }
  });
  recordTest(
    'section4_precedence',
    '4.4 Bearer(Valid) + Cookie(Invalid) Handling',
    'Authorization: Bearer <valid_admin>, Cookie: <invalid>',
    200,
    res4_4.status,
    res4_4.status === 200 && res4_4.data?.user?.role === 'admin',
    'Valid Bearer completely overrides invalid Cookie'
  );

  // 4.5 X-API-Key vs Bearer Token Precedence
  const res4_5 = await request('/api/auth/me', {
    headers: {
      'X-API-Key': regApiKey,
      'Authorization': `Bearer ${validAdminToken}`
    }
  });
  const resolvedRole4_5 = res4_5.data?.user?.role;
  recordTest(
    'section4_precedence',
    '4.5 X-API-Key(User) vs Authorization: Bearer(Admin) Precedence',
    'X-API-Key: <userKey>, Authorization: Bearer <adminToken>',
    'user (X-API-Key checked first in authMiddleware)',
    resolvedRole4_5,
    res4_5.status === 200 && resolvedRole4_5 === 'user',
    `Resolved user role: ${resolvedRole4_5}`
  );

  // 4.6 Cookie Security Flags on /api/auth/login
  const setCookieHeader = baseline.headers.get('set-cookie') || '';
  console.log(`Set-Cookie header on login: "${setCookieHeader}"`);
  const isHttpOnly = /HttpOnly/i.test(setCookieHeader);
  const isSameSiteLax = /SameSite=Lax/i.test(setCookieHeader);
  const hasAgyHubCookie = /agy_hub_session=/i.test(setCookieHeader);

  recordTest(
    'section4_precedence',
    '4.6a Cookie agy_hub_session Set on Login',
    'Set-Cookie header',
    'agy_hub_session=<token>',
    hasAgyHubCookie ? 'Present' : 'Missing',
    hasAgyHubCookie,
    setCookieHeader.slice(0, 50) + '...'
  );

  recordTest(
    'section4_precedence',
    '4.6b Cookie HttpOnly Flag',
    'Set-Cookie header',
    'HttpOnly attribute present',
    isHttpOnly ? 'HttpOnly present' : 'HttpOnly MISSING',
    isHttpOnly,
    'Prevents XSS session hijacking'
  );

  recordTest(
    'section4_precedence',
    '4.6c Cookie SameSite=Lax Flag',
    'Set-Cookie header',
    'SameSite=Lax present',
    isSameSiteLax ? 'SameSite=Lax present' : 'SameSite attribute missing or non-lax',
    isSameSiteLax,
    'Mitigates CSRF'
  );

  // 4.7 Logout Cookie Invalidation
  const logoutRes = await request('/api/auth/logout', { method: 'POST' });
  const logoutSetCookie = logoutRes.headers.get('set-cookie') || '';
  console.log(`Set-Cookie header on logout: "${logoutSetCookie}"`);
  const isCleared = /agy_hub_session=;/i.test(logoutSetCookie) || /Expires=Thu, 01 Jan 1970/i.test(logoutSetCookie) || /Max-Age=0/i.test(logoutSetCookie);
  recordTest(
    'section4_precedence',
    '4.7 Logout Clears Cookie',
    'POST /api/auth/logout',
    'Cookie expired / cleared',
    isCleared ? 'Cleared' : 'Not cleared',
    logoutRes.status === 200 && isCleared,
    logoutSetCookie
  );

  // Clean up the created regular user
  if (regUserId) {
    await request(`/api/users/${regUserId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${validAdminToken}` }
    });
  }

  // =========================================================================
  // FINAL SCORECARD & SUMMARY
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('              ADVERSARIAL CHALLENGE HARNESS SUMMARY');
  console.log('='.repeat(80));
  console.log(` Total Checks:          ${results.summary.total}`);
  console.log(` Passed:                ${results.summary.passed}`);
  console.log(` Failed/Vulnerabilities: ${results.summary.vulnerabilities}`);
  console.log('='.repeat(80));

  return results;
}

runAdversarialSuite().then(res => {
  const exitCode = res.summary.vulnerabilities > 0 ? 1 : 0;
  console.log(`Completed with exit code ${exitCode}`);
  process.exit(exitCode);
}).catch(err => {
  console.error('Test harness crashed:', err);
  process.exit(2);
});
