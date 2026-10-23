import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://homes_user:homes_pass@127.0.0.1:5432/antigravity_hub_dev',
  dbCa: process.env.DB_CA || undefined,
  jwtSecret: process.env.JWT_SECRET || 'antigravity_cloud_hub_jwt_super_secret_key_2026',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  seedAdminEmail: process.env.SEED_ADMIN_EMAIL || 'hosamchakasba@gmail.com',
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD || 'admin',
  storageDir: process.env.STORAGE_DIR || path.resolve(process.cwd(), 'storage'),
  cookieName: 'agy_hub_session',
};
