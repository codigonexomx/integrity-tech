import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { MetricsService } from '../observability/metrics.service';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private metrics?: MetricsService;

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    });

    (this as any).$on('query', (e: any) => {
      this.metrics?.recordDbQuery(e.query || 'UNKNOWN', e.duration || 0);
    });
  }

  setMetrics(metrics: MetricsService) {
    this.metrics = metrics;
  }

  async onModuleInit() {
    this.logger.log('Iniciando conexión a base de datos PostgreSQL mediante Prisma...');
    await this.$connect();
    this.logger.log('Conexión a PostgreSQL establecida con éxito.');

  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
