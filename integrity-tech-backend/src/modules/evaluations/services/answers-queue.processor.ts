import { Process, Processor } from '@nestjs/bull';
import { ConflictException, Logger, Optional } from '@nestjs/common';
import { Job } from 'bull';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../shared/database/prisma.service';
import { deadlineForAttempt, lockAttempt, persistSubmittedAnswer } from './answer-persistence';
import { EvaluationGovernanceResolverService } from '../../psychometric-governance/services/evaluation-governance-resolver.service';
import { MetricsService } from '../../../shared/observability/metrics.service';
import { summarizeAssessment } from './assessment-score';
import { RequestContextService } from '../../../shared/observability/request-context.service';

@Processor('answers-queue')
export class AnswersQueueProcessor {
  private readonly logger = new Logger(AnswersQueueProcessor.name);

  constructor(
    private readonly prisma: PrismaService, // Inyectamos Prisma para la persistencia transaccional
    private readonly eventEmitter: EventEmitter2, // Inyectamos el emisor de eventos para comunicación desacoplada
    private readonly governanceResolver: EvaluationGovernanceResolverService,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly context?: RequestContextService,
  ) {}

  // Drain legacy jobs safely; new pilot submissions are persisted synchronously.
  @Process('save-answer')
  async handleSaveAnswer(job: Job<any>) {
    await this.prisma.$transaction(async tx => {
      const attempt = await lockAttempt(tx, job.data.attemptId);
      if (attempt.status !== 'IN_PROGRESS') return;
      const previous = await tx.answerSubmission.findUnique({ where: {
        unique_response_per_attempt_question: { examAttemptId: attempt.id, questionId: job.data.questionId },
      } });
      const receivedAt = new Date(job.data.submittedAt);
      if (!Number.isFinite(receivedAt.getTime()) || (previous && previous.submittedAt >= receivedAt)) return;
      if (receivedAt >= await deadlineForAttempt(tx, attempt)) return;
      await persistSubmittedAnswer(tx, attempt, job.data, receivedAt);
    });
  }

  async closeAttempt(attemptId: string): Promise<'COMPLETED' | 'EXPIRED'> {
    return this.prisma.$transaction(async tx => {
      const attempt = await lockAttempt(tx, attemptId);
      if (attempt.status === 'COMPLETED' || attempt.status === 'EXPIRED') return attempt.status;
      if (!['IN_PROGRESS', 'SUBMITTED'].includes(attempt.status)) throw new ConflictException('El intento está cerrado.');
      const submissions = await tx.answerSubmission.findMany({ where: { examAttemptId: attemptId } });
      const links = await tx.assessmentVersionItem.findMany({
        where: { assessmentVersionId: attempt.assessmentVersionId, itemVersion: { item: { organizationId: attempt.organizationId } } },
        include: { itemVersion: true },
      });
      const summary = summarizeAssessment(links, submissions);
      if (!summary) {
        if (new Date() < await deadlineForAttempt(tx, attempt)) {
          throw new ConflictException('Faltan respuestas. Completa todas las preguntas antes de entregar.');
        }
        await tx.examAttempt.update({ where: { id: attemptId }, data: { status: 'EXPIRED', submittedAt: attempt.submittedAt || new Date() } });
        return 'EXPIRED';
      }
      await tx.examAttempt.update({ where: { id: attemptId }, data: {
        score: summary.total, scoreDetails: summary.dimensions, status: 'COMPLETED', submittedAt: attempt.submittedAt || new Date(),
      } });
      return 'COMPLETED';
    });
  }
}
