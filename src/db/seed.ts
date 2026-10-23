import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db, initDb } from './index.js';
import { users } from './schema.js';
import { config } from '../config.js';

export async function seedAdminUser() {
  const existingAdmin = await db.query.users.findFirst({
    where: eq(users.email, config.seedAdminEmail),
  });

  if (!existingAdmin) {
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(config.seedAdminPassword, salt);

    const [created] = await db
      .insert(users)
      .values({
        email: config.seedAdminEmail,
        passwordHash,
        name: 'Hosam Admin',
        role: 'admin',
        isActive: true,
      })
      .returning();

    console.log(`[SEED] Initial admin created: ${created.email} (${created.id})`);
    return created;
  } else {
    // Ensure existing user has admin role and isActive = true
    if (existingAdmin.role !== 'admin' || !existingAdmin.isActive) {
      const [updated] = await db
        .update(users)
        .set({
          role: 'admin',
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingAdmin.id))
        .returning();

      console.log(`[SEED] Existing user promoted to active admin: ${updated.email}`);
      return updated;
    }

    console.log(`[SEED] Admin already exists and active: ${existingAdmin.email}`);
    return existingAdmin;
  }
}

import { seedRegistry } from './seedRegistry.js';

export async function seed() {
  await initDb();
  await seedAdminUser();
  await seedRegistry();
}

// Allow direct execution
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  seed()
    .then(() => {
      console.log('[SEED] Seeding completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[SEED] Seeding failed:', err);
      process.exit(1);
    });
}
