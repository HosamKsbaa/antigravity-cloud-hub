// test/helpers/test-env.mjs
// Environment and target configuration for Antigravity Cloud Hub E2E test suite.

export const TARGET_URL = (process.env.TARGET_URL || 'http://localhost:4000').replace(/\/+$/, '');
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'hosamchakasba@gmail.com';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
export const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || '15000', 10);

export const IS_LIVE_TARGET = TARGET_URL.startsWith('https://') || TARGET_URL.includes('sslip.io');

export function generateRandomEmail(prefix = 'testuser') {
  const nonce = Math.random().toString(36).substring(2, 10);
  const timestamp = Date.now().toString(36);
  return `${prefix}_${nonce}_${timestamp}@agy-test.local`;
}

export function generateRandomPassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = 'Aa1!';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
