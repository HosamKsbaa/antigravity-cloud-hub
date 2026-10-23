import { Request, Response, NextFunction } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: Admin access required' });
    return;
  }

  next();
}

/**
 * Checks if the target user is currently an active admin and whether modifying/deleting
 * them would leave the system without any active admins.
 * Accepts an optional transaction client `txClient` (defaults to `db`) to run within
 * locked transaction contexts.
 */
export async function assertNotLastAdmin(
  targetUserId: string,
  txClient: any = db
): Promise<boolean> {
  const targetUser = await txClient.query.users.findFirst({
    where: eq(users.id, targetUserId),
  });

  if (!targetUser || targetUser.role !== 'admin' || !targetUser.isActive) {
    // Not an active admin, modification will not affect active admin count
    return true;
  }

  const [result] = await txClient
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.isActive, true)));

  const activeAdminCount = Number(result?.count || 0);

  if (activeAdminCount <= 1) {
    return false;
  }

  return true;
}

/**
 * Express middleware for protecting last active admin on demote or delete operations.
 */
export async function lastAdminProtection(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const targetUserId = String(req.params.id);

  if (!targetUserId || targetUserId === 'undefined') {
    return next();
  }

  // If this is a role update to 'admin', it doesn't decrease admin count
  if (req.method === 'PATCH' && req.body?.role === 'admin') {
    return next();
  }

  try {
    const isSafe = await assertNotLastAdmin(targetUserId);
    if (!isSafe) {
      res.status(409).json({
        error: 'Cannot demote or delete the last remaining active admin',
      });
      return;
    }

    next();
  } catch (error) {
    console.error('Error verifying last admin protection:', error);
    res.status(500).json({ error: 'Failed to verify admin status' });
  }
}
