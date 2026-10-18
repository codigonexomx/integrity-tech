import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { queueRedisOptions } from '../security/redis.config';
import { access, mkdir } from 'fs/promises';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaService } from '../database/prisma.service';
import { MetricsService } from './metrics.service';
import { OperationalEventPublisher } from './operational-event.publisher';
import { getLocalPrivateStoragePath, getStorageProviderName } from '../../modules/storage/storage.config';

type DependencyCheck = {
  name: string;
  status: 'up' | 'down' | 'not_configured';
  latencyMs?: number;
  message?: string;
};

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly events: OperationalEventPublisher,
  ) {}

  liveness() {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  async readiness() {
    const dependencies = await this.dependencies();
    const blocking = dependencies.dependencies.filter((dep) => ['postgresql', 'redis', 'queue'].includes(dep.name));
    const ready = blocking.every((dep) => dep.status === 'up');
    return {
      status: ready ? 'ready' : 'not_ready',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      dependencies: dependencies.dependencies,
    };
  }

  async dependencies() {
    const checks = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkQueue(),
      this.checkStorage(),
    ]);
    return {
      status: checks.every((check) => check.status === 'up' || check.status === 'not_configured') ? 'ok' : 'degraded',
      dependencies: checks,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkPostgres(): Promise<DependencyCheck> {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const latencyMs = Date.now() - started;
      this.metrics.setDependencyHealth('postgresql', true);
      return { name: 'postgresql', status: 'up', latencyMs };
    } catch (error) {
      this.metrics.setDependencyHealth('postgresql', false);
      this.events.publish('DB_UNAVAILABLE', { error: error.message });
      return { name: 'postgresql', status: 'down', latencyMs: Date.now() - started, message: 'PostgreSQL unavailable' };
    }
  }

  private async checkRedis(): Promise<DependencyCheck> {
    const started = Date.now();
    const redis = new Redis({
      ...queueRedisOptions(),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
    });
    try {
      await redis.connect();
      await redis.ping();
      const latencyMs = Date.now() - started;
      this.metrics.setDependencyHealth('redis', true);
      return { name: 'redis', status: 'up', latencyMs };
    } catch (error) {
      this.metrics.setDependencyHealth('redis', false);
      this.events.publish('REDIS_UNAVAILABLE', { error: error.message });
      return { name: 'redis', status: 'down', latencyMs: Date.now() - started, message: 'Redis unavailable' };
    } finally {
      redis.disconnect();
    }
  }

  private async checkQueue(): Promise<DependencyCheck> {
    const redis = await this.checkRedis();
    const up = redis.status === 'up';
    this.metrics.setDependencyHealth('queue', up);
    if (!up) this.events.publish('QUEUE_STALLED', { reason: 'redis_unavailable' });
    return {
      name: 'queue',
      status: up ? 'up' : 'down',
      latencyMs: redis.latencyMs,
      message: up ? undefined : 'Queue backend unavailable',
    };
  }

  private async checkStorage(): Promise<DependencyCheck> {
    const provider = getStorageProviderName();
    if (!provider) {
      this.metrics.setDependencyHealth('storage', false);
      return { name: 'storage', status: 'not_configured', message: 'No private storage provider configured yet' };
    }
    try {
      if (provider === 'local-private') {
        const path = getLocalPrivateStoragePath();
        await mkdir(path, { recursive: true, mode: 0o700 });
        await access(path);
      } else if (provider === 's3') {
        const client = new S3Client({
          region: process.env.STORAGE_S3_REGION,
          endpoint: process.env.STORAGE_S3_ENDPOINT || undefined,
          forcePathStyle: Boolean(process.env.STORAGE_S3_ENDPOINT),
          credentials: {
            accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID || '',
            secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY || '',
          },
        });
        await client.send(new HeadBucketCommand({ Bucket: process.env.STORAGE_S3_BUCKET }));
      } else if (provider === 'gcs') {
        const { Storage } = require('@google-cloud/storage');
        const storage = new Storage({
          projectId: process.env.STORAGE_GCS_PROJECT_ID || undefined,
          keyFilename: process.env.STORAGE_GCS_KEY_FILE || undefined,
        });
        const bucket = storage.bucket(process.env.STORAGE_GCS_BUCKET || '');
        const [exists] = await bucket.exists();
        if (!exists) {
          throw new Error(`Bucket ${process.env.STORAGE_GCS_BUCKET} no existe.`);
        }
      }
      this.metrics.setDependencyHealth('storage', true);
      return { name: 'storage', status: 'up' };
    } catch (error) {
      this.metrics.setDependencyHealth('storage', false);
      this.events.publish('STORAGE_UNAVAILABLE', { provider, error: error.message });
      return { name: 'storage', status: 'down', message: 'Private storage unavailable' };
    }
  }
}
