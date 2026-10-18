import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { MetricsService } from '../../../shared/observability/metrics.service';
import { AUDIT_ACTIONS, AuditRequestMetadata } from '../../audit/audit-event.types';
import { AuditService } from '../../audit/services/audit.service';
import { SessionUser } from '../../iam';
import { AttemptRepository } from '../repositories/attempt.repository';
import { AnswersQueueProcessor } from './answers-queue.processor';

@Injectable()
export class FinalizeService {
  constructor(
    private readonly attempts: AttemptRepository,
    private readonly answersProcessor: AnswersQueueProcessor,
    private readonly auditService: AuditService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async finalizeAttempt(attemptId: string, user: SessionUser, metadata: AuditRequestMetadata = {}) {
    const organizationId = user.organizationId;
    const attempt = await this.attempts.findAttemptInTenant(attemptId, organizationId);
    if (!attempt) {
      throw new NotFoundException('Intento de examen no encontrado.');
    }

    const status = await this.answersProcessor.closeAttempt(attemptId);
    await this.recordFinalizeAudit(attempt, user, metadata, status);
    this.metrics?.recordDomainEvent('AssessmentDelivery', 'finalize', 'success');
    return { status, message: status === 'COMPLETED' ? 'Evaluación entregada y resultado confirmado.' : 'Tiempo terminado. Se conservaron las respuestas; no se emite puntuación incompleta.' };
  }

  private recordFinalizeAudit(attempt: any, user: SessionUser, metadata: AuditRequestMetadata, finalStatus: string) {
    return this.auditService.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      actorType: 'CANDIDATE',
      action: AUDIT_ACTIONS.ATTEMPT_FINALIZED,
      resourceType: 'ExamAttempt',
      resourceId: attempt.id,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      metadata: {
        previousStatus: attempt.status,
        finalStatus,
        examId: attempt.examId,
      },
    });
  }
}
