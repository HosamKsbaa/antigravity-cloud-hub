import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import apiKeysRoutes from './routes/apiKeys.js';
import registryRoutes from './routes/registry.js';
import telemetryRoutes from './routes/telemetry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  // Standard middleware
  app.use(
    cors({
      origin: true,
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/api-keys', apiKeysRoutes);
  app.use('/api/telemetry', telemetryRoutes);
  app.use('/api', registryRoutes);

  // Fallback 404 handler for API routes
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  // Static hosting and SPA fallback for Web UI
  const webDist = path.resolve(__dirname, '../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  // Global JSON error handler
  // Intercepts body-parser errors (413 PayloadTooLargeError, 400 SyntaxError) and prevents HTML stack trace leakage
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.type === 'entity.too.large'
      ? 'Payload too large'
      : err.message || 'Internal server error';

    res.status(status).json({
      error: message,
    });
  });

  return app;
}
