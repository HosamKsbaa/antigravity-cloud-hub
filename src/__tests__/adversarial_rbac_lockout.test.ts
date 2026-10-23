import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { eq, and, sql } from 'drizzle-orm';
import { createApp } from '../app.js';
import { initDb, pool, db } from '../db/index.js';
import { users, apiKeys } from '../db/schema.js';
import { seedAdminUser } from '../db/seed.js';

describe('Adversarial Stress Test: RBAC, API Key Auth & Last-Admin Lockout Guard', () => {
  const app = createApp();

  let adminUser: any;
  let adminToken: string;
  let regularUser: any;
  let regularToken: string;
  let secondUser: any;
  let secondToken: string;

  beforeAll(async () => {
    await initDb();
    adminUser = await seedAdminUser();

    // Login as admin
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'hosamchakasba@gmail.com', password: 'admin' });
    adminToken = loginRes.body.token;
  });

  afterAll(async () => {
    await seedAdminUser();
    await pool.end();
  });

  beforeEach(async () => {
    // Reset secondary test users
    await db.delete(users).where(eq(users.email, 'adversary.bob@example.com'));
    await db.delete(users).where(eq(users.email, 'adversary.charlie@example.com'));
    await db.delete(users).where(eq(users.email, 'admin2@example.com'));

    // Create fresh regular test users
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('TestPass123!', salt);

    const [bob] = await db
      .insert(users)
      .values({
        email: 'adversary.bob@example.com',
        passwordHash,
        name: 'Adversary Bob',
        role: 'user',
        isActive: true,
      })
      .returning();
    regularUser = bob;

    const [charlie] = await db
      .insert(users)
      .values({
        email: 'adversary.charlie@example.com',
        passwordHash,
        name: 'Adversary Charlie',
        role: 'user',
        isActive: true,
      })
      .returning();
    secondUser = charlie;

    // Login tokens
    const bobLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'adversary.bob@example.com', password: 'TestPass123!' });
    regularToken = bobLogin.body.token;

    const charlieLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'adversary.charlie@example.com', password: 'TestPass123!' });
    secondToken = charlieLogin.body.token;
  });

  // ===========================================================================
  // SECTION 1: PRIVILEGE ESCALATION & RBAC BYPASS
  // ===========================================================================
  describe('1. Privilege Escalation & RBAC Bypass', () => {
    it('1.1 Regular user MUST NOT be able to self-promote to admin via PATCH /api/users/:id/role', async () => {
      const res = await request(app)
        .patch(`/api/users/${regularUser.id}/role`)
        .set('Authorization', `Bearer ${regularToken}`)
        .send({ role: 'admin' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Admin access required');

      // Verify in database that role was NOT altered
      const userInDb = await db.query.users.findFirst({
        where: eq(users.id, regularUser.id),
      });
      expect(userInDb?.role).toBe('user');
    });

    it('1.2 Regular user MUST NOT be able to promote peer to admin via PATCH /api/users/:id/role', async () => {
      const res = await request(app)
        .patch(`/api/users/${secondUser.id}/role`)
        .set('Authorization', `Bearer ${regularToken}`)
        .send({ role: 'admin' });

      expect(res.status).toBe(403);

      const userInDb = await db.query.users.findFirst({
        where: eq(users.id, secondUser.id),
      });
      expect(userInDb?.role).toBe('user');
    });

    it('1.3 Regular user MUST NOT be able to access GET /api/users (user enumeration)', async () => {
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${regularToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Admin access required');
    });

    it('1.4 Regular user MUST NOT be able to create new users via POST /api/users', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${regularToken}`)
        .send({
          email: 'attacker.imposter@example.com',
          password: 'Password123!',
          role: 'admin',
        });

      expect(res.status).toBe(403);

      const check = await db.query.users.findFirst({
        where: eq(users.email, 'attacker.imposter@example.com'),
      });
      expect(check).toBeUndefined();
    });

    it('1.5 Regular user MUST NOT be able to delete admin or any user via DELETE /api/users/:id', async () => {
      // Bob attempts to delete admin
      const resAdmin = await request(app)
        .delete(`/api/users/${adminUser.id}`)
        .set('Authorization', `Bearer ${regularToken}`);

      expect(resAdmin.status).toBe(403);

      // Bob attempts to delete Charlie
      const resCharlie = await request(app)
        .delete(`/api/users/${secondUser.id}`)
        .set('Authorization', `Bearer ${regularToken}`);

      expect(resCharlie.status).toBe(403);

      // Bob attempts to delete himself via admin endpoint
      const resSelf = await request(app)
        .delete(`/api/users/${regularUser.id}`)
        .set('Authorization', `Bearer ${regularToken}`);

      expect(resSelf.status).toBe(403);
    });

    it('1.6 Regular user API key MUST NOT bypass requireAdmin middleware', async () => {
      // Bob creates an API key
      const keyRes = await request(app)
        .post('/api/api-keys')
        .set('Authorization', `Bearer ${regularToken}`)
        .send({ name: "Bob's Dev Key" });

      expect(keyRes.status).toBe(201);
      const bobKey = keyRes.body.key;

      // Bob uses his API key against admin endpoints
      const getRes = await request(app)
        .get('/api/users')
        .set('X-API-Key', bobKey);

      expect(getRes.status).toBe(403);
      expect(getRes.body.error).toContain('Admin access required');

      const patchRes = await request(app)
        .patch(`/api/users/${regularUser.id}/role`)
        .set('X-API-Key', bobKey)
        .send({ role: 'admin' });

      expect(patchRes.status).toBe(403);
    });

    it('1.7 Role modification with invalid/tampered role values MUST be rejected with HTTP 400', async () => {
      const invalidRoles = [
        'superadmin',
        'root',
        'ADMIN',
        'User',
        '',
        null,
        12345,
        ['admin'],
        { role: 'admin' },
      ];

      for (const badRole of invalidRoles) {
        const res = await request(app)
          .patch(`/api/users/${regularUser.id}/role`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ role: badRole });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Role must be either "admin" or "user"');
      }

      // Verify Bob is still 'user'
      const bobCheck = await db.query.users.findFirst({
        where: eq(users.id, regularUser.id),
      });
      expect(bobCheck?.role).toBe('user');
    });

    it('1.8 Regular user MUST NOT be able to delete another user\'s API key', async () => {
      // Charlie creates an API key
      const charlieKeyRes = await request(app)
        .post('/api/api-keys')
        .set('Authorization', `Bearer ${secondToken}`)
        .send({ name: "Charlie's Secret Key" });

      expect(charlieKeyRes.status).toBe(201);
      const charlieKeyId = charlieKeyRes.body.id;

      // Bob attempts to delete Charlie's key
      const bobDeleteRes = await request(app)
        .delete(`/api/api-keys/${charlieKeyId}`)
        .set('Authorization', `Bearer ${regularToken}`);

      // Bob must receive 404 (or 403) and deletion must not happen
      expect(bobDeleteRes.status).toBe(404);

      // Verify Charlie's key still exists in database
      const keyInDb = await db.query.apiKeys.findFirst({
        where: eq(apiKeys.id, charlieKeyId),
      });
      expect(keyInDb).toBeDefined();
    });
  });

  // ===========================================================================
  // SECTION 2: FORGED API KEYS & KEY AUTHENTICATION
  // ===========================================================================
  describe('2. Forged API Keys & Key Authentication', () => {
    let validApiKey: string;
    let validKeyId: string;
    let validKeyPrefix: string;
    let validKeyHash: string;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/api-keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Admin Challenger Key' });

      validApiKey = res.body.key;
      validKeyId = res.body.id;
      validKeyPrefix = res.body.keyPrefix;
      validKeyHash = crypto.createHash('sha256').update(validApiKey).digest('hex');
    });

    it('2.1 Presenting only the keyPrefix MUST return HTTP 401', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('X-API-Key', validKeyPrefix);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid API key');
    });

    it('2.2 Presenting the raw SHA-256 hash instead of plaintext secret MUST return HTTP 401', async () => {
      // Attacker extracted or guessed hash from database
      const resRaw = await request(app)
        .get('/api/auth/me')
        .set('X-API-Key', validKeyHash);

      expect(resRaw.status).toBe(401);
      expect(resRaw.body.error).toBe('Invalid API key');

      // Attacker prefixed with agy_
      const resPrefixed = await request(app)
        .get('/api/auth/me')
        .set('X-API-Key', `agy_${validKeyHash}`);

      expect(resPrefixed.status).toBe(401);
      expect(resPrefixed.body.error).toBe('Invalid API key');
    });

    it('2.3 Off-by-one length and corrupted characters MUST return HTTP 401', async () => {
      const corruptedKeys = [
        validApiKey.slice(0, -1), // 1 char short
        `${validApiKey}a`,        // 1 char long
        validApiKey.replace(/[0-9a-f]$/, 'Z'), // non-hex character
        'agy_' + '0'.repeat(63),   // 63 hex digits
        'agy_' + '0'.repeat(65),   // 65 hex digits
        'agy_',                    // empty payload
        '',                        // blank
        ' '.repeat(32),            // whitespace
      ];

      for (const badKey of corruptedKeys) {
        const res = await request(app)
          .get('/api/auth/me')
          .set('X-API-Key', badKey);

        expect(res.status).toBe(401);
      }
    });

    it('2.4 Supported vs unsupported authorization header formats', async () => {
      // Format 1: X-API-Key header -> 200
      const r1 = await request(app)
        .get('/api/auth/me')
        .set('X-API-Key', validApiKey);
      expect(r1.status).toBe(200);

      // Format 2: Authorization: ApiKey <key> -> 200
      const r2 = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `ApiKey ${validApiKey}`);
      expect(r2.status).toBe(200);

      // Format 3: Authorization: Bearer agy_<key> -> 200
      const r3 = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${validApiKey}`);
      expect(r3.status).toBe(200);

      // Unsupported scheme: Authorization: Token <key> -> 401
      const r4 = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Token ${validApiKey}`);
      expect(r4.status).toBe(401);

      // Malformed: Authorization: ApiKey without key -> 401
      const r5 = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'ApiKey');
      expect(r5.status).toBe(401);
    });

    it('2.5 Expired API key MUST be rejected with HTTP 401 and specific error message', async () => {
      // Create key that expired 1 hour ago
      const expiredRaw = crypto.randomBytes(32).toString('hex');
      const expiredPlain = `agy_${expiredRaw}`;
      const expiredHash = crypto.createHash('sha256').update(expiredPlain).digest('hex');

      await db.insert(apiKeys).values({
        userId: adminUser.id,
        name: 'Expired Test Key',
        keyPrefix: expiredPlain.slice(0, 12),
        keyHash: expiredHash,
        expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
      });

      const res = await request(app)
        .get('/api/auth/me')
        .set('X-API-Key', expiredPlain);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('API key has expired');
    });

    it('2.6 API key of deactivated user MUST be rejected with HTTP 401', async () => {
      // Create key for Charlie
      const charlieKeyRes = await request(app)
        .post('/api/api-keys')
        .set('Authorization', `Bearer ${secondToken}`)
        .send({ name: 'Charlie Temp Key' });
      const charlieApiKey = charlieKeyRes.body.key;

      // Deactivate Charlie
      await db
        .update(users)
        .set({ isActive: false })
        .where(eq(users.id, secondUser.id));

      const res = await request(app)
        .get('/api/auth/me')
        .set('X-API-Key', charlieApiKey);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Associated user is inactive or deleted');
    });
  });

  // ===========================================================================
  // SECTION 3: LAST-ADMIN LOCKOUT INVARIANT & CONCURRENCY
  // ===========================================================================
  describe('3. Last-Admin Lockout Guard & Concurrency Stress Testing', () => {
    beforeEach(async () => {
      // Clean up any extra admins so exactly 1 active admin remains before each test
      await db.delete(users).where(eq(users.email, 'admin2@example.com'));
      await db.delete(users).where(eq(users.email, 'admin3@example.com'));
      await db
        .update(users)
        .set({ role: 'user' })
        .where(eq(users.email, 'adversary.bob@example.com'));
    });

    it('3.1 The ONLY active admin CANNOT demote themselves (MUST return HTTP 409 Conflict)', async () => {
      // Check that only 1 admin exists
      const [adminCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
      expect(Number(adminCount.count)).toBe(1);

      const res = await request(app)
        .patch(`/api/users/${adminUser.id}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'user' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Cannot demote or delete the last remaining active admin');

      // Verify DB persistence: adminUser role must still be 'admin'
      const check = await db.query.users.findFirst({
        where: eq(users.id, adminUser.id),
      });
      expect(check?.role).toBe('admin');
    });

    it('3.2 The ONLY active admin CANNOT delete themselves (MUST return HTTP 409 Conflict)', async () => {
      const res = await request(app)
        .delete(`/api/users/${adminUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Cannot demote or delete the last remaining active admin');

      // Verify DB persistence: adminUser still exists and is active
      const check = await db.query.users.findFirst({
        where: eq(users.id, adminUser.id),
      });
      expect(check).toBeDefined();
      expect(check?.isActive).toBe(true);
      expect(check?.role).toBe('admin');
    });

    it('3.3 Sequential Demotion: When 2 admins exist, demote one (200), then immediately demote second (MUST return 409)', async () => {
      // 1. Promote Bob to admin -> Now 2 admins
      const promoteRes = await request(app)
        .patch(`/api/users/${regularUser.id}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'admin' });
      expect(promoteRes.status).toBe(200);

      // Verify 2 admins in DB
      const [c1] = await db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
      expect(Number(c1.count)).toBe(2);

      // 2. Demote Bob back to user -> Should succeed (200) since adminUser remains
      const demoteBobRes = await request(app)
        .patch(`/api/users/${regularUser.id}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'user' });
      expect(demoteBobRes.status).toBe(200);

      // Verify 1 admin remains in DB
      const [c2] = await db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
      expect(Number(c2.count)).toBe(1);

      // 3. Immediately attempt to demote the 2nd (last) admin -> MUST return 409
      const demoteLastAdminRes = await request(app)
        .patch(`/api/users/${adminUser.id}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'user' });

      expect(demoteLastAdminRes.status).toBe(409);
      expect(demoteLastAdminRes.body.error).toBe('Cannot demote or delete the last remaining active admin');

      // Verify adminUser is STILL admin in DB
      const finalCheck = await db.query.users.findFirst({
        where: eq(users.id, adminUser.id),
      });
      expect(finalCheck?.role).toBe('admin');
    });

    it('3.4 Sequential Deletion: When 2 admins exist, delete one (200), then immediately delete second (MUST return 409)', async () => {
      // 1. Promote Bob to admin -> Now 2 admins
      await request(app)
        .patch(`/api/users/${regularUser.id}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'admin' });

      // 2. Delete Bob -> Should succeed (200) since adminUser remains
      const deleteBobRes = await request(app)
        .delete(`/api/users/${regularUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(deleteBobRes.status).toBe(200);

      // 3. Attempt to delete last admin -> MUST return 409
      const deleteLastAdminRes = await request(app)
        .delete(`/api/users/${adminUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteLastAdminRes.status).toBe(409);
      expect(deleteLastAdminRes.body.error).toBe('Cannot demote or delete the last remaining active admin');
    });

    it('3.5 Stress Test: Concurrent demotion requests under race conditions', async () => {
      // Create a dedicated Admin 2 for concurrency testing
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash('Admin2Pass123!', salt);

      const [admin2] = await db
        .insert(users)
        .values({
          email: 'admin2@example.com',
          passwordHash,
          name: 'Admin Two',
          role: 'admin',
          isActive: true,
        })
        .returning();

      // Log in as Admin 2
      const admin2Login = await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin2@example.com', password: 'Admin2Pass123!' });
      const admin2Token = admin2Login.body.token;

      // Verify exactly 2 admins exist
      const [initialCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
      expect(Number(initialCount.count)).toBe(2);

      // Send concurrent requests:
      // Request A: Admin 1 demotes Admin 2
      // Request B: Admin 2 demotes Admin 1
      // Both executed simultaneously via Promise.all
      const [resA, resB] = await Promise.all([
        request(app)
          .patch(`/api/users/${admin2.id}/role`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ role: 'user' }),
        request(app)
          .patch(`/api/users/${adminUser.id}/role`)
          .set('Authorization', `Bearer ${admin2Token}`)
          .send({ role: 'user' }),
      ]);

      const statuses = [resA.status, resB.status];

      // Count active admins in database AFTER concurrent execution
      const [afterCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
      const finalAdminCount = Number(afterCount.count);

      console.log(`[CONCURRENCY EMPIRICAL RESULT] Statuses: ${statuses.join(', ')} | Final Active Admins: ${finalAdminCount}`);

      // INVARIANT CHECK:
      // System MUST NEVER reach 0 active admins.
      // If finalAdminCount === 0, both requests succeeded (200, 200) due to TOCTOU race condition!
      expect(finalAdminCount).toBeGreaterThanOrEqual(1);

      // At least one request must be rejected (409) or only one succeeded (200)
      expect(statuses).toContain(409);
    });

    it('3.6 Stress Test: Concurrent deletion requests under race conditions', async () => {
      // Create a dedicated Admin 2 for concurrency deletion testing
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash('Admin2Pass123!', salt);

      const [admin2] = await db
        .insert(users)
        .values({
          email: 'admin2@example.com',
          passwordHash,
          name: 'Admin Two',
          role: 'admin',
          isActive: true,
        })
        .returning();

      // Log in as Admin 2
      const admin2Login = await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin2@example.com', password: 'Admin2Pass123!' });
      const admin2Token = admin2Login.body.token;

      // Verify exactly 2 admins exist
      const [initialCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
      expect(Number(initialCount.count)).toBe(2);

      // Concurrent deletion requests:
      // Req A: Admin 1 deletes Admin 2
      // Req B: Admin 2 deletes Admin 1
      const [resA, resB] = await Promise.all([
        request(app)
          .delete(`/api/users/${admin2.id}`)
          .set('Authorization', `Bearer ${adminToken}`),
        request(app)
          .delete(`/api/users/${adminUser.id}`)
          .set('Authorization', `Bearer ${admin2Token}`),
      ]);

      const statuses = [resA.status, resB.status];

      const [afterCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
      const finalAdminCount = Number(afterCount.count);

      console.log(`[CONCURRENCY DELETION RESULT] Statuses: ${statuses.join(', ')} | Final Active Admins: ${finalAdminCount}`);

      // Invariant: System must never delete both admins down to 0
      expect(finalAdminCount).toBeGreaterThanOrEqual(1);
      expect(statuses).toContain(409);
    });

    afterEach(async () => {
      // Guarantee seed admin is restored after concurrency tests
      await seedAdminUser();
    });
  });
});

