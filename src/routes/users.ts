import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { eq, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireAdmin, lastAdminProtection, assertNotLastAdmin } from '../middleware/rbac.js';

const router = Router();

// All user management routes require admin role
router.use(authMiddleware);
router.use(requireAdmin);

/**
 * GET /api/users
 * Lists all registered users (excluding password hashes).
 */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const allUsers = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));

    res.json(allUsers);
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

/**
 * POST /api/users
 * Creates a new user with email, password, and role ('user' | 'admin').
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name, role } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const trimmedEmail = String(email).trim().toLowerCase();
    const assignedRole = role === 'admin' ? 'admin' : 'user';

    const existing = await db.query.users.findFirst({
      where: eq(users.email, trimmedEmail),
    });

    if (existing) {
      res.status(409).json({ error: 'User with this email already exists' });
      return;
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(String(password), salt);

    const [created] = await db
      .insert(users)
      .values({
        email: trimmedEmail,
        passwordHash,
        name: name ? String(name).trim() : null,
        role: assignedRole,
        isActive: true,
      })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      });

    res.status(201).json(created);
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * PATCH /api/users/:id/role
 * Updates role to 'admin' or 'user' (enforcing last-admin protection).
 * Uses PostgreSQL transaction and pg_advisory_xact_lock to prevent TOCTOU race conditions.
 */
router.patch('/:id/role', lastAdminProtection, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { role } = req.body;

    if (!role || (role !== 'admin' && role !== 'user')) {
      res.status(400).json({ error: 'Role must be either "admin" or "user"' });
      return;
    }

    let status = 200;
    let responseBody: any = null;

    await db.transaction(async (tx) => {
      // Serialize admin role mutations to prevent concurrent TOCTOU lockout
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('antigravity_admin_lockout_mutex')::bigint)`
      );

      const targetUser = await tx.query.users.findFirst({
        where: eq(users.id, id),
      });

      if (!targetUser) {
        status = 404;
        responseBody = { error: 'User not found' };
        return;
      }

      // Check last admin protection inside the transaction lock
      if (targetUser.role === 'admin' && role === 'user') {
        const isSafe = await assertNotLastAdmin(id, tx);
        if (!isSafe) {
          status = 409;
          responseBody = {
            error: 'Cannot demote or delete the last remaining active admin',
          };
          return;
        }
      }

      const [updated] = await tx
        .update(users)
        .set({
          role,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          isActive: users.isActive,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        });

      status = 200;
      responseBody = updated;
    });

    res.status(status).json(responseBody);
  } catch (error) {
    console.error('Update user role error:', error);
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

/**
 * DELETE /api/users/:id
 * Deletes a user (enforcing last-admin protection).
 * Uses PostgreSQL transaction and pg_advisory_xact_lock to prevent TOCTOU race conditions.
 */
router.delete('/:id', lastAdminProtection, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    let status = 200;
    let responseBody: any = null;

    await db.transaction(async (tx) => {
      // Serialize admin deletions to prevent concurrent TOCTOU lockout
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('antigravity_admin_lockout_mutex')::bigint)`
      );

      const targetUser = await tx.query.users.findFirst({
        where: eq(users.id, id),
      });

      if (!targetUser) {
        status = 404;
        responseBody = { error: 'User not found' };
        return;
      }

      if (targetUser.role === 'admin') {
        const isSafe = await assertNotLastAdmin(id, tx);
        if (!isSafe) {
          status = 409;
          responseBody = {
            error: 'Cannot demote or delete the last remaining active admin',
          };
          return;
        }
      }

      await tx.delete(users).where(eq(users.id, id));

      status = 200;
      responseBody = { success: true, message: 'User deleted successfully' };
    });

    res.status(status).json(responseBody);
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
