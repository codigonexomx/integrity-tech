export function isSwaggerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.SHOW_SWAGGER !== 'false';
}

export function parseAllowedOrigins(corsOrigins?: string): string[] {
  return (corsOrigins || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function isCorsOriginAllowed(origin: string | undefined, allowedOrigins: string[], _nodeEnv?: string): boolean {
  // CORS controls browser cross-origin access, not authentication or server health probes.
  if (!origin) return true;
  return Boolean(origin && allowedOrigins.includes(origin));
}

export function validateProductionSecurityConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  if (!env.DATABASE_URL) {
    throw new Error('Configuración insegura: DATABASE_URL es obligatorio en producción.');
  }

  if (!env.REDIS_URL) {
    throw new Error('Configuración insegura: REDIS_URL es obligatorio en producción.');
  }

  const jwtSecret = env.JWT_SECRET || '';
  if (!jwtSecret || jwtSecret.includes('change-me') || jwtSecret.length < 32) {
    throw new Error('Configuración insegura: JWT_SECRET debe ser un secreto fuerte en producción.');
  }

  if (jwtSecret.includes('replace-with') || jwtSecret.includes('superlocal') || jwtSecret.includes('development')) {
    throw new Error('Configuración insegura: JWT_SECRET no puede usar valores placeholder en producción.');
  }

  if (env.ENABLE_DEV_AUTH === 'true') {
    throw new Error('Configuración insegura: ENABLE_DEV_AUTH no puede estar activo en producción.');
  }

  if (env.RATE_LIMIT_STORE !== 'redis') {
    throw new Error('Configuración insegura: RATE_LIMIT_STORE debe ser redis en producción.');
  }

  if (env.SHOW_SWAGGER === 'true') {
    throw new Error('Configuración insegura: Swagger debe estar cerrado en producción.');
  }

  const allowedOrigins = parseAllowedOrigins(env.CORS_ORIGINS);
  if (!env.CORS_ORIGINS || allowedOrigins.length === 0 || allowedOrigins.includes('*')) {
    throw new Error('Configuración insegura: CORS_ORIGINS debe listar orígenes explícitos en producción.');
  }

  const bodyLimitBytes = parseBodyLimitToBytes(env.API_BODY_LIMIT || '1mb');
  if (bodyLimitBytes > 2 * 1024 * 1024) {
    throw new Error('Configuración insegura: API_BODY_LIMIT no debe exceder 2mb en producción.');
  }

  validateProductionStorageConfig(env);
  if (!/^[a-fA-F0-9]{64}$/.test(env.ENCRYPTION_KEY || '') || /^([a-fA-F0-9])\1+$/.test(env.ENCRYPTION_KEY || '')) {
    throw new Error('Configuración insegura: ENCRYPTION_KEY debe contener 32 bytes hexadecimales aleatorios.');
  }
  if ((env.HMAC_SALT || '').length < 32 || /development|change-me|replace-with/.test(env.HMAC_SALT || '')) {
    throw new Error('Configuración insegura: HMAC_SALT debe ser un secreto de al menos 32 caracteres.');
  }
}

function validateProductionStorageConfig(env: NodeJS.ProcessEnv): void {
  if (!env.STORAGE_PROVIDER) {
    throw new Error('Configuración insegura: STORAGE_PROVIDER es obligatorio en producción.');
  }
  if (env.STORAGE_PROVIDER === 'local-private') {
    if (env.STORAGE_LOCAL_PERSISTENT !== 'true' || !env.STORAGE_LOCAL_PRIVATE_PATH) throw new Error('Almacenamiento local productivo requiere STORAGE_LOCAL_PERSISTENT=true y STORAGE_LOCAL_PRIVATE_PATH.');
    return;
  }
  if (!['s3', 'gcs'].includes(env.STORAGE_PROVIDER)) {
    throw new Error('Configuración insegura: STORAGE_PROVIDER debe ser s3, gcs o local-private en producción.');
  }
  if (env.STORAGE_PROVIDER === 's3') {
    const required = [
      'STORAGE_S3_BUCKET',
      'STORAGE_S3_REGION',
      'STORAGE_S3_ACCESS_KEY_ID',
      'STORAGE_S3_SECRET_ACCESS_KEY',
    ];
    const missing = required.filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(`Configuración insegura: faltan variables S3 (${missing.join(', ')}).`);
    }
  }
  if (env.STORAGE_PROVIDER === 'gcs') {
    const required = ['STORAGE_GCS_BUCKET'];
    const missing = required.filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(`Configuración insegura: faltan variables GCS (${missing.join(', ')}).`);
    }
  }
  if (!env.STORAGE_SIGNED_URL_TTL_SECONDS || Number(env.STORAGE_SIGNED_URL_TTL_SECONDS) > 900) {
    throw new Error('Configuración insegura: STORAGE_SIGNED_URL_TTL_SECONDS debe existir y ser <= 900.');
  }
}

function parseBodyLimitToBytes(limit: string): number {
  const match = limit.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)(b|kb|mb)?$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const value = Number(match[1]);
  const unit = match[2] || 'b';
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
  };
  return value * multipliers[unit];
}
