import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// Pre-computed valid 12-round bcrypt hash matching system cost factor
// Used to equalize response timing (~380ms) for non-existent users
const DUMMY_HASH = '$2b$12$jq7r.CGlRHMEgLPs3eyqHuOpus5R5B7wfWucREY52hgv6v.dXgXeG';

// Rate limiter for login endpoint: max 10 requests per 1-second window per IP
// Suppresses high-concurrency brute-force bursts while allowing legitimate sequential usage
const loginRateLimiter = rateLimit({
  windowMs: 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
});

/**
 * POST /api/auth/login
 * Verifies email & password, returns JWT token and user profile.
 */
router.post('/login', loginRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body || {};

    // 1. Strict type checking (prevents type confusion attacks: arrays, objects, booleans, numbers)
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Email and password must be strings' });
      return;
    }

    // 2. Reject null bytes in email (prevents PostgreSQL driver crash / 500 error)
    if (email.includes('\0')) {
      res.status(400).json({ error: 'Invalid email address' });
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    // 3. Query user by email
    const user = await db.query.users.findFirst({
      where: eq(users.email, trimmedEmail),
    });

    // 4. Constant-time password comparison:
    // If user does not exist or is inactive, compare against DUMMY_HASH to consume identical CPU time
    const hashToCompare = user && user.isActive ? user.passwordHash : DUMMY_HASH;
    const isMatch = await bcrypt.compare(password, hashToCompare);

    if (!user || !user.isActive || !isMatch) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any }
    );

    res.cookie(config.cookieName, token, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal login error' });
  }
});

/**
 * POST /api/auth/logout
 * Clears session cookie.
 */
router.post('/logout', (req: Request, res: Response): void => {
  res.clearCookie(config.cookieName);
  res.json({ success: true, message: 'Logged out successfully' });
});

/**
 * GET /api/auth/me
 * Returns the currently authenticated user.
 */
router.get('/me', authMiddleware, (req: Request, res: Response): void => {
  const user = req.user!;
  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
    },
  });
});

export default router;
