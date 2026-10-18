import { defineConfig, devices } from '@playwright/test';

const backendURL = process.env.E2E_BACKEND_URL || 'http://127.0.0.1:3001';
const frontendURL = process.env.E2E_FRONTEND_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: frontendURL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: {
      'x-e2e-test': 'integrity-enterprise-flow',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run start:e2e',
      cwd: '../integrity-tech-backend',
      url: `${backendURL}/health/live`,
      reuseExistingServer: process.env.E2E_REUSE_SERVERS === 'true',
      timeout: 120_000,
      env: {
        PORT: new URL(backendURL).port || '3001',
        NODE_ENV: 'test',
        DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:localpassword123@127.0.0.1:5432/integrity_tech_e2e?schema=public',
        REDIS_HOST: process.env.REDIS_HOST || '127.0.0.1',
        REDIS_PORT: process.env.REDIS_PORT || '6379',
        REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
        REDIS_KEY_PREFIX: process.env.REDIS_KEY_PREFIX || 'integrity:e2e:',
        RATE_LIMIT_STORE: 'redis',
        RATE_LIMIT_REDIS_REQUIRED: 'true',
        JWT_SECRET: process.env.JWT_SECRET || 'e2e-jwt-secret-with-at-least-thirty-two-characters',
        ACCESS_TOKEN_TTL_SECONDS: process.env.ACCESS_TOKEN_TTL_SECONDS || '900',
        REFRESH_TOKEN_TTL_DAYS: '1',
        CORS_ORIGINS: frontendURL,
        SHOW_SWAGGER: 'false',
        ENABLE_DEV_AUTH: 'false',
        API_BODY_LIMIT: '1mb',
        STORAGE_PROVIDER: 'local-private',
        STORAGE_LOCAL_PRIVATE_PATH: process.env.STORAGE_LOCAL_PRIVATE_PATH || '.private-storage/e2e',
        STORAGE_SIGNED_URL_TTL_SECONDS: '120',
        STORAGE_MAX_FILE_BYTES: '2097152',
        OTEL_ENABLED: 'false',
        LOG_LEVEL: 'warn',
        LATE_ANSWER_WINDOW_MS: '300000',
      },
    },
    {
      command: `npm run dev -- --hostname 127.0.0.1 --port ${new URL(frontendURL).port || '3000'}`,
      url: frontendURL,
      reuseExistingServer: process.env.E2E_REUSE_SERVERS === 'true',
      timeout: 120_000,
      env: {
        BACKEND_URL: backendURL,
        NEXT_PUBLIC_API_BASE_URL: `${backendURL}/api`,
        NEXT_PUBLIC_APP_ENV: 'e2e',
        NEXT_PUBLIC_BUILD_DATE: 'e2e',
      },
    },
  ],
});
