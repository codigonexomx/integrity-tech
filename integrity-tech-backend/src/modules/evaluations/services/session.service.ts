import { createHash } from 'crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import { AUDIT_ACTIONS, AuditRequestMetadata } from '../../audit/audit-event.types';
import { AuditService } from '../../audit/services/audit.service';
import { EvaluationGovernanceResolverService } from '../../psychometric-governance/services/evaluation-governance-resolver.service';
import { AttemptRepository } from '../repositories/attempt.repository';
import { CandidateConsentService } from './candidate-consent.service';
import { INTEGRITY_LABORAL_ASSESSMENT_CODE } from '../integrity-laboral/integrity-laboral.definition';

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attempts: AttemptRepository,
    private readonly consentService: CandidateConsentService,
    private readonly auditService: AuditService,
    private readonly governanceResolver: EvaluationGovernanceResolverService,
  ) {}

  async getAttemptSession(
    attemptId: string,
    user: { userId: string; organizationId: string },
    metadata: AuditRequestMetadata = {},
  ) {
    const organizationId = user.organizationId;
    const attempt = await this.attempts.findAttemptInTenant(attemptId, organizationId);
    if (!attempt) {
      throw new NotFoundException('Intento de examen no encontrado.');
    }

    if (!['IN_PROGRESS', 'SUBMITTED', 'COMPLETED', 'EXPIRED'].includes(attempt.status)) {
      throw new BadRequestException('El intento no se encuentra disponible para el candidato.');
    }

    const hasConsent = await this.consentService.hasConsent(attemptId, user);
    if (!hasConsent) {
      throw new ForbiddenException('Debes aceptar el consentimiento informado antes de iniciar la evaluación.');
    }

    const exam = await this.attempts.findExamInTenant(attempt.examId, organizationId);
    if (!exam) {
      throw new NotFoundException('Evaluación no encontrada.');
    }

    if (!attempt.assessmentVersionId) {
      throw new BadRequestException('El intento no tiene una versión psicométrica publicada asociada.');
    }

    const safeQuestions = await this.getGovernedQuestions(attempt.assessmentVersionId, attempt.id);

    await this.auditService.record({
      organizationId,
      actorUserId: user.userId,
      actorType: 'CANDIDATE',
      action: AUDIT_ACTIONS.EXAM_SESSION_ACCESSED,
      resourceType: 'ExamAttempt',
      resourceId: attempt.id,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      metadata: {
        examId: exam.id,
        assessmentVersionId: attempt.assessmentVersionId || null,
        mode: 'VERSIONED',
        questionCount: safeQuestions.length,
      },
    });

    const deadlineAt = new Date(attempt.startedAt.getTime() + (exam.durationMinutes || 10) * 60_000);
    const status = attempt.status === 'IN_PROGRESS' && Date.now() >= deadlineAt.getTime() ? 'EXPIRED' : attempt.status;
    const submissions = await this.prisma.answerSubmission.findMany({ where: { examAttemptId: attempt.id }, select: { questionId: true, response: true } });
    return {
      serverNow: new Date().toISOString(),
      deadlineAt: deadlineAt.toISOString(),
      answers: Object.fromEntries(submissions.map(s => [s.questionId, s.response])),
      attemptId: attempt.id,
      status,
      exam: {
        id: exam.id,
        title: exam.title,
        durationMinutes: exam.durationMinutes,
      },
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      questions: safeQuestions,
    };
  }

  private shuffleForAttempt(items: any[], attemptId: string) {
    return [...items].sort((a, b) => {
      const hashA = createHash('sha256').update(`${attemptId}:${a.itemVersionId}`).digest('hex');
      const hashB = createHash('sha256').update(`${attemptId}:${b.itemVersionId}`).digest('hex');
      return hashA.localeCompare(hashB);
    });
  }

  private stripCorrectConfig(content: any): any {
    if (!content || typeof content !== 'object') return content;
    const { correctConfig, correctAnswer, correctAnswers, ...safeContent } = content;
    return safeContent;
  }

  private async getGovernedQuestions(assessmentVersionId: string, attemptId: string) {
    const governedItems = await this.governanceResolver.findGovernedSessionItems(assessmentVersionId);
    const shouldRandomize = governedItems.some((link) => {
      const stem = link.itemVersion.stemJson as any;
      const content = stem?.content || stem || {};
      return content?.assessmentCode === INTEGRITY_LABORAL_ASSESSMENT_CODE;
    });
    const orderedItems = shouldRandomize ? this.shuffleForAttempt(governedItems, attemptId) : governedItems;
    return orderedItems.map((link) => {
      const stem = link.itemVersion.stemJson as any;
      return {
        id: link.itemVersionId,
        itemVersionId: link.itemVersionId,
        type: stem?.type || 'UNKNOWN',
        defaultPoints: Number(link.weight || stem?.defaultPoints || 1),
        content: this.stripCorrectConfig(stem?.content || stem),
        item: {
          id: link.itemVersion.item?.id,
          code: link.itemVersion.item?.itemCode,
        },
      };
    });
  }
}
