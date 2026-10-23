import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { users, apiKeys } from '../db/schema.js';
import { JwtPayload } from '../types.js';

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const xApiKeyHeader = req.headers['x-api-key'] as string | undefined;
    const cookieToken = req.cookies?.[config.cookieName];

    // 1. Check for API Key in X-API-Key or Authorization header
    let apiKeyRaw: string | undefined = xApiKeyHeader;

    if (!apiKeyRaw && authHeader) {
      if (authHeader.startsWith('ApiKey ')) {
        apiKeyRaw = authHeader.slice(7).trim();
      } else if (authHeader.startsWith('Bearer agy_')) {
        apiKeyRaw = authHeader.slice(7).trim();
      }
    }

    if (apiKeyRaw) {
      const keyHash = crypto.createHash('sha256').update(apiKeyRaw).digest('hex');
      const apiKeyRecord = await db.query.apiKeys.findFirst({
        where: eq(apiKeys.keyHash, keyHash),
      });

      if (!apiKeyRecord) {
        res.status(401).json({ error: 'Invalid API key' });
        return;
      }

      if (apiKeyRecord.expiresAt && new Date(apiKeyRecord.expiresAt) < new Date()) {
        res.status(401).json({ error: 'API key has expired' });
        return;
      }

      const userRecord = await db.query.users.findFirst({
        where: eq(users.id, apiKeyRecord.userId),
      });

      if (!userRecord || !userRecord.isActive) {
        res.status(401).json({ error: 'Associated user is inactive or deleted' });
        return;
      }

      // Update lastUsedAt in background
      db.update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, apiKeyRecord.id))
        .catch((err) => console.error('Failed to update API key lastUsedAt:', err));

      req.user = userRecord;
      req.apiKey = apiKeyRecord;
      req.authMethod = 'apiKey';
      return next();
    }

    // 2. Check for JWT in Authorization: Bearer <token> or Cookie
    let jwtToken: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      jwtToken = authHeader.slice(7).trim();
    } else if (cookieToken) {
      jwtToken = cookieToken;
    }

    if (!jwtToken) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const decoded = jwt.verify(jwtToken, config.jwtSecret) as JwtPayload;

      const userRecord = await db.query.users.findFirst({
        where: eq(users.id, decoded.sub),
      });

      if (!userRecord || !userRecord.isActive) {
        res.status(401).json({ error: 'User is inactive or deleted' });
        return;
      }

      req.user = userRecord;
      req.authMethod = 'jwt';
      return next();
    } catch (jwtErr) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
  } catch (error) {
    console.error('Authentication middleware error:', error);
    res.status(500).json({ error: 'Internal authentication error' });
  }
}

export function optionalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  const xApiKeyHeader = req.headers['x-api-key'];
  const cookieToken = req.cookies?.[config.cookieName];

  if (!authHeader && !xApiKeyHeader && !cookieToken) {
    return next();
  }

  authMiddleware(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}
