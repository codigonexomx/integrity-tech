import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { queueRedisOptions } from './redis.config';

export interface RateLimitHit {
  count: number;
  resetAt: number;
  source: 'redis' | 'memory';
}

interface MemoryBucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class RedisRateLimitStore implements OnModuleDestroy {
  private readonly logger = new Logger(RedisRateLimitStore.name);
  private readonly memoryBuckets = new Map<string, MemoryBucket>();
  private redis: Redis | null = null;
  private redisConnection: Promise<Redis> | null = null;
  private redisUnavailableLogged = false;

  async increment(key: string, windowMs: number): Promise<RateLimitHit> {
    if (this.shouldUseMemoryFallback()) {
      return this.incrementMemory(key, windowMs);
    }

    try {
      const redis = await this.getConnectedRedis();
      const namespacedKey = `integrity:rate-limit:${key}`;
      const count = await redis.incr(namespacedKey);
      if (count === 1) {
        await redis.pexpire(namespacedKey, windowMs);
      }
      const ttl = await redis.pttl(namespacedKey);
      return {
        count,
        resetAt: Date.now() + Math.max(ttl, windowMs),
        source: 'redis',
      };
    } catch (error) {
      if (process.env.NODE_ENV === 'production' || process.env.RATE_LIMIT_REDIS_REQUIRED === 'true') {
        throw error;
      }

      if (!this.redisUnavailableLogged) {
        this.logger.warn(`Redis no disponible para rate limiting; usando fallback local solo en ${process.env.NODE_ENV || 'development'}.`);
        this.redisUnavailableLogged = true;
      }
      return this.incrementMemory(key, windowMs);
    }
  }

  async onModuleDestroy() {
    if (this.redis) {
      this.redis.disconnect();
    }
    this.redisConnection = null;
  }

  resetForTests() {
    this.memoryBuckets.clear();
  }

  private async getConnectedRedis(): Promise<Redis> {
    const redis = this.getRedis();
    if (redis.status === 'ready') return redis;

    if (!this.redisConnection) {
      this.redisConnection = redis.connect()
        .then(() => redis)
        .catch((error) => {
          this.redisConnection = null;
          throw error;
        });
    }

    return this.redisConnection;
  }

  private getRedis(): Redis {
    if (!this.redis) {
      this.redis = new Redis({
        ...queueRedisOptions(),
        keyPrefix: process.env.REDIS_KEY_PREFIX || '',
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 750,
      });
      this.redis.on('error', (error) => {
        if (!this.redisUnavailableLogged && process.env.NODE_ENV !== 'test') {
          this.logger.warn(`Redis rate limit error: ${error.message}`);
          this.redisUnavailableLogged = true;
        }
      });
    }
    return this.redis;
  }

  private shouldUseMemoryFallback(): boolean {
    return process.env.RATE_LIMIT_STORE === 'memory' && process.env.NODE_ENV !== 'production';
  }

  private incrementMemory(key: string, windowMs: number): RateLimitHit {
    const now = Date.now();
    const bucket = this.memoryBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      const resetAt = now + windowMs;
      this.memoryBuckets.set(key, { count: 1, resetAt });
      return { count: 1, resetAt, source: 'memory' };
    }

    bucket.count += 1;
    return { count: bucket.count, resetAt: bucket.resetAt, source: 'memory' };
  }
}
