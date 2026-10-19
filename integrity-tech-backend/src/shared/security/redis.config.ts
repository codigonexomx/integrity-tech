import type { RedisOptions } from 'ioredis';

export function queueRedisOptions(env: NodeJS.ProcessEnv = process.env): RedisOptions {
  const url = env.REDIS_URL ? new URL(env.REDIS_URL) : null;
  if (url && !['redis:', 'rediss:'].includes(url.protocol)) throw new Error('REDIS_URL inválida.');
  return {
    host: url?.hostname || env.REDIS_HOST || 'localhost',
    port: Number(url?.port || env.REDIS_PORT || 6379),
    username: url?.username ? decodeURIComponent(url.username) : undefined,
    password: url?.password ? decodeURIComponent(url.password) : env.REDIS_PASSWORD || undefined,
    db: url ? Number(url.pathname.slice(1) || 0) : 0,
    ...(url?.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}
