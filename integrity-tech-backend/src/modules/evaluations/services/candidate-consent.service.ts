import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import { AUDIT_ACTIONS, AuditRequestMetadata } from '../../audit/audit-event.types';
import { AuditService } from '../../audit/services/audit.service';
import { AcceptCandidateConsentDto } from '../dto/candidate-consent.dto';
import { AttemptRepository } from '../repositories/attempt.repository';

export const CURRENT_CANDIDATE_CONSENT_VERSION = 'pilot-consent-v1';

@Injectable()
export class CandidateConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attempts: AttemptRepository,
    private readonly auditService: AuditService,
  ) {}

  async getConsentStatus(
    attemptId: string,
    user: { userId: string; organizationId: string },
    metadata?: AuditRequestMetadata,
  ) {
    const attempt = await this.assertCandidateAttempt(attemptId, user);
    const consent = await (this.prisma as any).candidateConsent.findUnique({
      where: { attemptId },
    });

    await this.auditService.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      actorType: 'CANDIDATE',
      action: AUDIT_ACTIONS.CONSENT_VIEWED,
      resourceType: 'CandidateConsent',
      resourceId: consent?.id || null,
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent,
      metadata: { attemptId: attempt.id, accepted: Boolean(consent) },
    });

    return {
      accepted: Boolean(consent),
      consentVersion: consent?.consentVersion || CURRENT_CANDIDATE_CONSENT_VERSION,
      acceptedAt: consent?.acceptedAt || null,
    };
  }

  async acceptConsent(
    attemptId: string,
    user: { userId: string; organizationId: string },
    body: AcceptCandidateConsentDto,
    metadata: AuditRequestMetadata = {},
  ) {
    const attempt = await this.assertCandidateAttempt(attemptId, user);
    const consentVersion = body.consentVersion || CURRENT_CANDIDATE_CONSENT_VERSION;
    const consent = await (this.prisma as any).candidateConsent.upsert({
      where: { attemptId },
      update: {},
      create: {
        organizationId: user.organizationId,
        userId: user.userId,
        attemptId: attempt.id,
        consentVersion,
        ipAddress: metadata.ipAddress || null,
        userAgent: metadata.userAgent || null,
      },
    });

    await this.auditService.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      actorType: 'CANDIDATE',
      action: AUDIT_ACTIONS.CONSENT_ACCEPTED,
      resourceType: 'CandidateConsent',
      resourceId: consent.id,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      metadata: { attemptId: attempt.id, consentVersion: consent.consentVersion },
    });

    return {
      accepted: true,
      consentVersion: consent.consentVersion,
      acceptedAt: consent.acceptedAt,
    };
  }

  async hasConsent(attemptId: string, user: { userId: string; organizationId: string }): Promise<boolean> {
    await this.assertCandidateAttempt(attemptId, user);
    const consent = await (this.prisma as any).candidateConsent.findUnique({
      where: { attemptId },
      select: { id: true },
    });
    return Boolean(consent);
  }

  private async assertCandidateAttempt(attemptId: string, user: { userId: string; organizationId: string }) {
    const attempt = await this.attempts.findAttemptInTenant(attemptId, user.organizationId);
    if (!attempt) {
      throw new NotFoundException('Intento de examen no encontrado.');
    }

    if (attempt.userId !== user.userId) {
      throw new ForbiddenException('El intento pertenece a otro candidato.');
    }

    return attempt;
  }
}
