import { queueRedisOptions } from './shared/security/redis.config';
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './shared/database/database.module';
import { IamModule } from './modules/iam';
import { ExamsModule } from './modules/exams/exams.module';
import { EvaluationsModule } from './modules/evaluations/evaluations.module';
import { ProctoringModule } from './modules/proctoring/proctoring.module';
import { AuditModule } from './modules/audit/audit.module';
import { DataGovernanceModule } from './modules/data-governance/data-governance.module';
import { PsychometricGovernanceModule } from './modules/psychometric-governance/psychometric-governance.module';
import { ObservabilityModule } from './shared/observability/observability.module';
import { StorageModule } from './modules/storage/storage.module';

@Module({
  imports: [
    // 0. Habilitar tareas programadas (Schedule)
    ScheduleModule.forRoot(),

    // 1. Configuración global de la conexión a Redis para las colas BullMQ
    BullModule.forRoot({
      redis: queueRedisOptions(),
      prefix: process.env.REDIS_KEY_PREFIX || 'integrity',
    }),

    // 2. Módulo de comunicación por eventos desacoplada
    EventEmitterModule.forRoot(),

    // 3. Módulo de base de datos relacional global (Prisma)
    DatabaseModule,
    StorageModule,
    ObservabilityModule,

    // 4. Módulos de Dominios Acotados (Bounded Contexts)
    IamModule,
    ExamsModule,
    EvaluationsModule,
    ProctoringModule,
    AuditModule,
    DataGovernanceModule,
    PsychometricGovernanceModule,
  ],
})
export class AppModule {}
