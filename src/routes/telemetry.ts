import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { telemetryService } from '../services/telemetryService.js';

const router = Router();

// Enforce authentication for all telemetry endpoints
router.use(authMiddleware);

/**
 * POST /api/telemetry/sync
 * Ingests telemetry metrics from token-tracker plugin or IDE clients.
 * Supports JWT Bearer token or API Key (X-API-Key).
 */
router.post('/sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const payload = req.body;
    if (!payload || (typeof payload === 'object' && Object.keys(payload).length === 0 && !Array.isArray(payload))) {
      // Empty payload handled gracefully with 0 synced items
      res.status(200).json({
        ok: true,
        success: true,
        count: 0,
        syncedCount: 0,
      });
      return;
    }

    const result = await telemetryService.syncTelemetry(req.user.id, payload);

    res.status(200).json({
      ok: true,
      success: true,
      count: result.syncedCount,
      syncedCount: result.syncedCount,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/telemetry/summary
 * Retrieves aggregated telemetry metrics, model usage breakdown, workspace distribution, and daily trends.
 * Supports query parameters: period, startDate, endDate, workspace, model, scope.
 */
router.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const summary = await telemetryService.getSummary(req.user, req.query);
    res.status(200).json(summary);
  } catch (error) {
    next(error);
  }
});

export default router;
