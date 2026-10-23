import { createApp } from './app.js';
import { config } from './config.js';
import { initDb } from './db/index.js';
import { seedAdminUser } from './db/seed.js';
import { seedRegistry } from './db/seedRegistry.js';

async function bootstrap() {
  try {
    console.log('[BOOT] Initializing Antigravity Cloud Hub database...');
    await initDb();
    console.log('[BOOT] Ensuring initial admin account is seeded...');
    await seedAdminUser();
    console.log('[BOOT] Ensuring plugin & skill registry is seeded...');
    await seedRegistry();

    const app = createApp();

    const server = app.listen(config.port, '0.0.0.0', () => {
      console.log(`[BOOT] Antigravity Cloud Hub server listening on port ${config.port} (${config.nodeEnv})`);
      console.log(`[BOOT] Health check: http://127.0.0.1:${config.port}/api/health`);
    });

    // Graceful shutdown
    const handleShutdown = () => {
      console.log('\n[SHUTDOWN] Received signal, closing server gracefully...');
      server.close(() => {
        console.log('[SHUTDOWN] HTTP server closed.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', handleShutdown);
    process.on('SIGINT', handleShutdown);
  } catch (error) {
    console.error('[BOOT] Fatal bootstrap error:', error);
    process.exit(1);
  }
}

bootstrap();
