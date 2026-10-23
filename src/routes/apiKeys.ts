import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { apiKeys } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);

/**
 * POST /api/api-keys
 * Generates a new secure random API key.
 * Plaintext key is returned strictly once upon creation.
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { name, expiresAt } = req.body;

    const rawRandom = crypto.randomBytes(32).toString('hex');
    const plainKey = `agy_${rawRandom}`;
    const keyPrefix = plainKey.slice(0, 12);
    const keyHash = crypto.createHash('sha256').update(plainKey).digest('hex');

    const keyName = name && String(name).trim() ? String(name).trim() : `Key ${new Date().toISOString().slice(0, 10)}`;
    const parsedExpiresAt = expiresAt ? new Date(expiresAt) : null;

    const [created] = await db
      .insert(apiKeys)
      .values({
        userId: user.id,
        name: keyName,
        keyPrefix,
        keyHash,
        expiresAt: parsedExpiresAt,
      })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        createdAt: apiKeys.createdAt,
      });

    res.status(201).json({
      ...created,
      key: plainKey, // Returned once
    });
  } catch (error) {
    console.error('Create API key error:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

/**
 * GET /api/api-keys
 * Lists user's API keys (without plain secret).
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;

    const userKeys = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, user.id))
      .orderBy(desc(apiKeys.createdAt));

    res.json(userKeys);
  } catch (error) {
    console.error('List API keys error:', error);
    res.status(500).json({ error: 'Failed to retrieve API keys' });
  }
});

/**
 * DELETE /api/api-keys/:id
 * Deletes an API key.
 */
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const id = String(req.params.id);

    // Users can only delete their own keys; admins can delete any key
    const condition =
      user.role === 'admin'
        ? eq(apiKeys.id, id)
        : and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id));

    const existing = await db.query.apiKeys.findFirst({
      where: condition,
    });

    if (!existing) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }

    await db.delete(apiKeys).where(eq(apiKeys.id, id));

    res.json({ success: true, message: 'API key deleted successfully' });
  } catch (error) {
    console.error('Delete API key error:', error);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

export default router;
