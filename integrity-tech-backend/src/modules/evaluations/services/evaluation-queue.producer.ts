import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { SubmitAnswerDto, SubmitProctoringLogDto } from '../dto/submit-answer.dto';
import { PrismaService } from '../../../shared/database/prisma.service';
import { MetricsService } from '../../../shared/observability/metrics.service';
import { lockAttempt, persistSubmittedAnswer } from './answer-persistence';
import { RequestContextService } from '../../../shared/observability/request-context.service';

@Injectable()
export class EvaluationQueueProducer {
  private readonly logger = new Logger(EvaluationQueueProducer.name);

  constructor(
    @InjectQueue('answers-queue') private readonly answersQueue: Queue,
    @InjectQueue('proctoring-queue') private readonly proctoringQueue: Queue,
    private readonly prisma: PrismaService,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly context?: RequestContextService,
  ) {}

  /**
   * Encola la respuesta de una pregunta de forma asíncrona tras validar el estado del intento.
   */
  async enqueueAnswer(dto: SubmitAnswerDto): Promise<{ jobId: string }> {
    // Small-pilot mode: an HTTP acknowledgement means the graded answer is durable.
    // The browser's IndexedDB queue still retries interrupted requests.
    await this.prisma.$transaction(async tx => {
      const attempt = await lockAttempt(tx, dto.attemptId);
      await persistSubmittedAnswer(tx, attempt, dto, new Date());
    });
    return { jobId: `saved:${dto.attemptId}:${dto.questionId}` };
  }

  /**
   * Encola los logs de proctoring (telemetría de seguridad).
   */
  async enqueueProctoringLog(dto: SubmitProctoringLogDto): Promise<{ jobId: string }> {
    // Para los logs de proctoring no somos tan restrictivos con el estado del examen, 
    // pero sí validamos la existencia del intento.
    
    const job = await this.proctoringQueue.add(
      'save-log',
      {
        attemptId: dto.attemptId,
        eventType: dto.eventType,
        metadata: dto.metadata,
        timestamp: new Date().toISOString(),
        traceId: this.context?.getTraceId() || null,
        requestId: this.context?.getRequestId() || null,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.metrics?.recordQueueJob('proctoring-queue', 'save-log', 'queued');
    return { jobId: job.id as string };
  }

}
