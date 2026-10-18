import { isCorsOriginAllowed, isSwaggerEnabled, parseAllowedOrigins, validateProductionSecurityConfig } from './security-config';

describe('bootstrap security config', () => {
  const validStorage = {
    ENCRYPTION_KEY: 'ab'.repeat(32),
    HMAC_SALT: 'secure-test-salt-'.repeat(3),
    STORAGE_PROVIDER: 's3',
    STORAGE_S3_BUCKET: 'private-bucket',
    STORAGE_S3_REGION: 'us-east-1',
    STORAGE_S3_ACCESS_KEY_ID: 'access-key',
    STORAGE_S3_SECRET_ACCESS_KEY: 'secret-key',
    STORAGE_SIGNED_URL_TTL_SECONDS: '300',
  };

  it('does not expose Swagger in production', () => {
    expect(isSwaggerEnabled({ NODE_ENV: 'production', SHOW_SWAGGER: 'true' } as any)).toBe(false);
  });

  it('rejects disallowed CORS origins', () => {
    const allowed = parseAllowedOrigins('http://localhost:3000,https://app.integrity.test');

    expect(isCorsOriginAllowed('https://evil.example', allowed, 'production')).toBe(false);
    expect(isCorsOriginAllowed('https://app.integrity.test', allowed, 'production')).toBe(true);
  });

  it('rejects insecure production defaults', () => {
    expect(() => validateProductionSecurityConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@db:5432/app',
      REDIS_URL: 'redis://redis:6379',
      RATE_LIMIT_STORE: 'redis',
      SHOW_SWAGGER: 'false',
      JWT_SECRET: 'change-me-to-a-long-random-secret',
      ENABLE_DEV_AUTH: 'false',
      CORS_ORIGINS: 'https://app.integrity.test',
      API_BODY_LIMIT: '1mb',
      ...validStorage,
    } as any)).toThrow('JWT_SECRET');

    expect(() => validateProductionSecurityConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@db:5432/app',
      REDIS_URL: 'redis://redis:6379',
      RATE_LIMIT_STORE: 'redis',
      SHOW_SWAGGER: 'false',
      JWT_SECRET: 'a'.repeat(40),
      ENABLE_DEV_AUTH: 'true',
      CORS_ORIGINS: 'https://app.integrity.test',
      API_BODY_LIMIT: '1mb',
      ...validStorage,
    } as any)).toThrow('ENABLE_DEV_AUTH');

    expect(() => validateProductionSecurityConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@db:5432/app',
      REDIS_URL: 'redis://redis:6379',
      RATE_LIMIT_STORE: 'redis',
      SHOW_SWAGGER: 'false',
      JWT_SECRET: 'a'.repeat(40),
      ENABLE_DEV_AUTH: 'false',
      CORS_ORIGINS: '*',
      API_BODY_LIMIT: '1mb',
      ...validStorage,
    } as any)).toThrow('CORS_ORIGINS');
  });

  it('rejects production when required infrastructure config is missing or unsafe', () => {
    expect(() => validateProductionSecurityConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(40),
      REDIS_URL: 'redis://redis:6379',
      RATE_LIMIT_STORE: 'redis',
      SHOW_SWAGGER: 'false',
      ENABLE_DEV_AUTH: 'false',
      CORS_ORIGINS: 'https://app.integrity.test',
      API_BODY_LIMIT: '1mb',
      ...validStorage,
    } as any)).toThrow('DATABASE_URL');

    expect(() => validateProductionSecurityConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@db:5432/app',
      JWT_SECRET: 'a'.repeat(40),
      RATE_LIMIT_STORE: 'memory',
      SHOW_SWAGGER: 'false',
      ENABLE_DEV_AUTH: 'false',
      CORS_ORIGINS: 'https://app.integrity.test',
      API_BODY_LIMIT: '1mb',
      ...validStorage,
    } as any)).toThrow('REDIS_URL');

    expect(() => validateProductionSecurityConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@db:5432/app',
      REDIS_URL: 'redis://redis:6379',
      JWT_SECRET: 'a'.repeat(40),
      RATE_LIMIT_STORE: 'memory',
      SHOW_SWAGGER: 'false',
      ENABLE_DEV_AUTH: 'false',
      CORS_ORIGINS: 'https://app.integrity.test',
      API_BODY_LIMIT: '1mb',
      ...validStorage,
    } as any)).toThrow('RATE_LIMIT_STORE');

    expect(() => validateProductionSecurityConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@db:5432/app',
      REDIS_URL: 'redis://redis:6379',
      JWT_SECRET: 'a'.repeat(40),
      RATE_LIMIT_STORE: 'redis',
      SHOW_SWAGGER: 'true',
      ENABLE_DEV_AUTH: 'false',
      CORS_ORIGINS: 'https://app.integrity.test',
      API_BODY_LIMIT: '1mb',
      ...validStorage,
    } as any)).toThrow('Swagger');
  });

  it('rejects unsafe production storage config', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@db:5432/app',
      REDIS_URL: 'redis://redis:6379',
      JWT_SECRET: 'a'.repeat(40),
      RATE_LIMIT_STORE: 'redis',
      SHOW_SWAGGER: 'false',
      ENABLE_DEV_AUTH: 'false',
      CORS_ORIGINS: 'https://app.integrity.test',
      API_BODY_LIMIT: '1mb',
      ENCRYPTION_KEY: 'ab'.repeat(32),
      HMAC_SALT: 'secure-test-salt-'.repeat(3),
    };

    // local-private ahora está permitido en producción con almacenamiento de disco persistente en Render
    expect(() => validateProductionSecurityConfig({
      ...base,
      STORAGE_PROVIDER: 'local-private',
      STORAGE_LOCAL_PERSISTENT: 'true',
      STORAGE_LOCAL_PRIVATE_PATH: '/data/private',
      STORAGE_SIGNED_URL_TTL_SECONDS: '300',
    } as any)).not.toThrow();
    expect(() => validateProductionSecurityConfig({
      ...base,
      STORAGE_PROVIDER: 's3',
      STORAGE_S3_BUCKET: 'bucket',
      STORAGE_SIGNED_URL_TTL_SECONDS: '300',
    } as any)).toThrow('STORAGE_S3_REGION');
    expect(() => validateProductionSecurityConfig({
      ...base,
      ...validStorage,
      STORAGE_SIGNED_URL_TTL_SECONDS: '3600',
    } as any)).toThrow('STORAGE_SIGNED_URL_TTL_SECONDS');
  });
  it('rejects missing production encryption secrets', () => {
    const base = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://db/app', REDIS_URL: 'redis://redis:6379', JWT_SECRET: 'a'.repeat(40), RATE_LIMIT_STORE: 'redis', CORS_ORIGINS: 'https://pilot.example', ...validStorage };
    expect(() => validateProductionSecurityConfig({ ...base, ENCRYPTION_KEY: '' })).toThrow('ENCRYPTION_KEY');
    expect(() => validateProductionSecurityConfig({ ...base, HMAC_SALT: '' })).toThrow('HMAC_SALT');
  });

});
