import request from 'supertest';
import bcrypt from 'bcryptjs';
import { eq, and, sql } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { initDb, pool, db } from '../src/db/index.js';
import { users } from '../src/db/schema.js';
import { seedAdminUser } from '../src/db/seed.js';

interface TrialResult {
  trial: number;
  type: 'demotion' | 'deletion';
  status1: number;
  status2: number;
  finalActiveAdmins: number;
  invariantViolated: boolean;
}

async function runConcurrencyStressSuite() {
  console.log('================================================================');
  console.log('EMPIRICAL STRESS TEST: LAST-ADMIN LOCKOUT TOCTOU RACE CONDITION');
  console.log('================================================================\n');

  await initDb();
  const app = createApp();

  const results: TrialResult[] = [];

  // 1. Demotion Concurrency Trials
  console.log('--- Phase 1: 5 Trials of Concurrent Admin Demotion ---');
  for (let i = 1; i <= 5; i++) {
    // Setup 2 admins
    await db.delete(users).where(eq(users.email, 'admin_trial_2@example.com'));
    await seedAdminUser();

    const admin1 = await db.query.users.findFirst({
      where: eq(users.email, 'hosamchakasba@gmail.com'),
    });

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('Admin2Pass123!', salt);
    const [admin2] = await db
      .insert(users)
      .values({
        email: 'admin_trial_2@example.com',
        passwordHash,
        name: 'Trial Admin 2',
        role: 'admin',
        isActive: true,
      })
      .returning();

    // Login tokens
    const login1 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'hosamchakasba@gmail.com', password: 'admin' });
    const token1 = login1.body.token;

    const login2 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin_trial_2@example.com', password: 'Admin2Pass123!' });
    const token2 = login2.body.token;

    // Concurrent demotions
    const [res1, res2] = await Promise.all([
      request(app)
        .patch(`/api/users/${admin2.id}/role`)
        .set('Authorization', `Bearer ${token1}`)
        .send({ role: 'user' }),
      request(app)
        .patch(`/api/users/${admin1!.id}/role`)
        .set('Authorization', `Bearer ${token2}`)
        .send({ role: 'user' }),
    ]);

    const [adminCountRes] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.isActive, true)));

    const count = Number(adminCountRes.count);
    const violated = count === 0;

    results.push({
      trial: i,
      type: 'demotion',
      status1: res1.status,
      status2: res2.status,
      finalActiveAdmins: count,
      invariantViolated: violated,
    });

    console.log(
      `Trial ${i} [Demotion]: Statuses = [${res1.status}, ${res2.status}] | Remaining Active Admins = ${count} | ${
        violated ? '🚨 INVARIANT VIOLATED (0 Admins)!' : '✓ Invariant Maintained'
      }`
    );
  }

  // 2. Deletion Concurrency Trials
  console.log('\n--- Phase 2: 5 Trials of Concurrent Admin Deletion ---');
  for (let i = 1; i <= 5; i++) {
    // Setup 2 admins
    await db.delete(users).where(eq(users.email, 'admin_trial_2@example.com'));
    await seedAdminUser();

    const admin1 = await db.query.users.findFirst({
      where: eq(users.email, 'hosamchakasba@gmail.com'),
    });

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('Admin2Pass123!', salt);
    const [admin2] = await db
      .insert(users)
      .values({
        email: 'admin_trial_2@example.com',
        passwordHash,
        name: 'Trial Admin 2',
        role: 'admin',
        isActive: true,
      })
      .returning();

    // Login tokens
    const login1 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'hosamchakasba@gmail.com', password: 'admin' });
    const token1 = login1.body.token;

    const login2 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin_trial_2@example.com', password: 'Admin2Pass123!' });
    const token2 = login2.body.token;

    // Concurrent deletions
    const [res1, res2] = await Promise.all([
      request(app)
        .delete(`/api/users/${admin2.id}`)
        .set('Authorization', `Bearer ${token1}`),
      request(app)
        .delete(`/api/users/${admin1!.id}`)
        .set('Authorization', `Bearer ${token2}`),
    ]);

    const [adminCountRes] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.isActive, true)));

    const count = Number(adminCountRes.count);
    const violated = count === 0;

    results.push({
      trial: i,
      type: 'deletion',
      status1: res1.status,
      status2: res2.status,
      finalActiveAdmins: count,
      invariantViolated: violated,
    });

    console.log(
      `Trial ${i} [Deletion]: Statuses = [${res1.status}, ${res2.status}] | Remaining Active Admins = ${count} | ${
        violated ? '🚨 INVARIANT VIOLATED (0 Admins)!' : '✓ Invariant Maintained'
      }`
    );
  }

  // Restore seed admin
  await db.delete(users).where(eq(users.email, 'admin_trial_2@example.com'));
  await seedAdminUser();

  console.log('\n================================================================');
  console.log('SUMMARY OF CONCURRENCY STRESS RESULTS');
  console.log('================================================================');
  const totalViolations = results.filter((r) => r.invariantViolated).length;
  console.log(`Total Trials: ${results.length}`);
  console.log(`Total Invariant Violations (Zero Admins Left): ${totalViolations} / ${results.length} (${(totalViolations / results.length) * 100}%)`);

  await pool.end();
  process.exit(totalViolations > 0 ? 2 : 0);
}

runConcurrencyStressSuite().catch((err) => {
  console.error('Stress runner error:', err);
  process.exit(1);
});
