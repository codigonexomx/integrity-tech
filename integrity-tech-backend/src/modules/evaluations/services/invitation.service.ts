import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { randomInt } from 'crypto';
import { PrismaService } from '../../../shared/database/prisma.service';
import { AUDIT_ACTIONS, AuditRequestMetadata } from '../../audit/audit-event.types';
import { AuditService } from '../../audit/services/audit.service';
import { IamFacade, SessionUser } from '../../iam';
import { EvaluationGovernanceResolverService } from '../../psychometric-governance/services/evaluation-governance-resolver.service';
import { MetricsService } from '../../../shared/observability/metrics.service';
import { ClaimAccessCodeDto, CreateInvitationDto, VerifyAccessCodeDto } from '../dto/evaluation-flow.dto';
import { AttemptStarted, InvitationCreated } from '../events/evaluation-domain.events';
import { InvitationRepository } from '../repositories/invitation.repository';

@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly iamFacade: IamFacade,
    private readonly invitations: InvitationRepository,
    private readonly auditService: AuditService,
    private readonly governanceResolver: EvaluationGovernanceResolverService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async createInvitation(user: SessionUser, body: CreateInvitationDto, metadata: AuditRequestMetadata = {}) {
    this.logger.log('Generando invitación de candidato.');

    const exam = await this.resolveExamForInvitation(body.examId, user);
    const accessCode = await this.generateUniqueAccessCode();

    const invitation = await this.invitations.createInvitation({
      organizationId: user.organizationId,
      createdByUserId: user.userId,
      examId: exam.id,
      email: body.email.trim().toLowerCase(),
      candidateName: body.candidateName.trim(),
      accessCode,
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    });
    void new InvitationCreated(invitation.id, invitation.organizationId, invitation.examId);
    await this.auditService.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      actorType: 'STAFF',
      action: AUDIT_ACTIONS.INVITATION_CREATED,
      resourceType: 'CandidateInvitation',
      resourceId: invitation.id,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      metadata: {
        examId: exam.id,
        candidateEmail: invitation.email,
      },
    });
    this.metrics?.recordDomainEvent('AssessmentDelivery', 'invitation_created', 'success');

    return {
      status: 'success',
      accessCode: invitation.accessCode,
      directLink: `/exam/login?code=${invitation.accessCode}`,
    };
  }

  async verifyInvitation(body: VerifyAccessCodeDto, metadata: AuditRequestMetadata = {}) {
    const code = this.normalizeAccessCode(body.accessCode);
    let invitation;
    try {
      invitation = await this.getPendingInvitation(code);
    } catch (error) {
      await this.auditInvitationFailure(code, AUDIT_ACTIONS.PUBLIC_INVITATION_VERIFY_FAILED, metadata, error);
      throw error;
    }
    const exam = await this.invitations.findExamForInvitation(invitation.examId, invitation.organizationId);
    await this.auditService.record({
      organizationId: invitation.organizationId,
      actorType: 'CANDIDATE',
      action: AUDIT_ACTIONS.INVITATION_VERIFIED,
      resourceType: 'CandidateInvitation',
      resourceId: invitation.id,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      metadata: { examId: invitation.examId },
    });
    this.metrics?.recordDomainEvent('AssessmentDelivery', 'invitation_verified', 'success');

    return {
      status: 'PENDING',
      candidateName: invitation.candidateName,
      email: invitation.email,
      examId: invitation.examId,
      examTitle: exam?.title || 'Evaluación asignada',
    };
  }

  async claimInvitation(body: ClaimAccessCodeDto, metadata: AuditRequestMetadata = {}) {
    const code = this.normalizeAccessCode(body.accessCode);
    let invitation;
    try {
      invitation = await this.getPendingInvitation(code, {
        notFound: 'Código de acceso no válido.',
        expired: 'El código de acceso ha expirado.',
        used: 'El código ya ha sido reclamado.',
      });
    } catch (error) {
      await this.auditInvitationFailure(code, AUDIT_ACTIONS.PUBLIC_INVITATION_CLAIM_FAILED, metadata, error);
      throw error;
    }

    const exam = await this.invitations.findExamForInvitation(invitation.examId, invitation.organizationId);
    if (!exam) {
      throw new BadRequestException('La evaluación asignada ya no existe.');
    }
    const assessmentVersion = await this.governanceResolver.resolvePublishedAssessmentVersionForExam(
      exam.id,
      exam.organizationId,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const nameParts = (body.candidateName || invitation.candidateName || 'Candidato').trim().split(/\s+/);
      const firstName = nameParts[0] || 'Candidato';
      const lastName = nameParts.slice(1).join(' ') || 'Externo';
      const email = (body.email || invitation.email).trim().toLowerCase();

      let candidate = await tx.user.findFirst({
        where: {
          organizationId: exam.organizationId,
          email,
        },
      });

      if (!candidate) {
        candidate = await tx.user.create({
          data: {
            organizationId: exam.organizationId,
            email,
            passwordHash: 'CANDIDATE_INVITATION_NO_PASSWORD',
            firstName,
            lastName,
          },
        });
      }

      const attempt = await tx.examAttempt.create({
        data: {
          examId: invitation.examId,
          assessmentVersionId: assessmentVersion.id,
          organizationId: exam.organizationId,
          userId: candidate.id,
          status: 'IN_PROGRESS',
        },
      });

      await tx.candidateInvitation.update({
        where: { id: invitation.id },
        data: {
          status: 'USED',
          attemptId: attempt.id,
        },
      });

      return { attempt, candidate, organizationId: exam.organizationId };
    });
    void new AttemptStarted(result.attempt.id, result.organizationId, result.attempt.examId, result.candidate.id);
    await this.auditService.record({
      organizationId: result.organizationId,
      actorUserId: result.candidate.id,
      actorType: 'CANDIDATE',
      action: AUDIT_ACTIONS.INVITATION_CLAIMED,
      resourceType: 'ExamAttempt',
      resourceId: result.attempt.id,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      metadata: {
        invitationId: invitation.id,
        examId: result.attempt.examId,
        assessmentVersionId: result.attempt.assessmentVersionId,
      },
    });
    this.metrics?.recordDomainEvent('AssessmentDelivery', 'invitation_claimed', 'success');

    const token = this.iamFacade.issueSessionToken({
      userId: result.candidate.id,
      organizationId: result.organizationId,
      email: result.candidate.email,
      roles: ['candidate'],
    });

    return {
      status: 'success',
      attemptId: result.attempt.id,
      token,
      message: 'Invitación reclamada con éxito. Sesión de evaluación inicializada.',
    };
  }

  private async getPendingInvitation(
    code: string,
    messages = {
      notFound: 'El código de acceso especificado no es válido o ha expirado.',
      expired: 'El código de acceso especificado no es válido o ha expirado.',
      used: 'Este código de acceso ya ha sido reclamado para una sesión de evaluación.',
    },
  ) {
    const invitation = await this.invitations.findByAccessCode(code);
    if (!invitation) {
      throw new BadRequestException(messages.notFound);
    }

    if (invitation.expiresAt && invitation.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException(messages.expired);
    }

    if (invitation.status !== 'PENDING') {
      throw new BadRequestException(messages.used);
    }

    return invitation;
  }

  private normalizeAccessCode(accessCode: string): string {
    if (!accessCode || typeof accessCode !== 'string') {
      throw new BadRequestException('La clave de acceso es requerida.');
    }
    return accessCode.trim().toUpperCase();
  }

  private async generateUniqueAccessCode(): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const accessCode = `IT-${randomInt(100000, 1000000)}`;
      const existing = await this.invitations.accessCodeExists(accessCode);
      if (!existing) return accessCode;
    }
    throw new BadRequestException('No fue posible generar una clave de acceso única.');
  }

  private async auditInvitationFailure(
    accessCode: string,
    action: string,
    metadata: AuditRequestMetadata,
    error: any,
  ) {
    const invitation = await this.invitations.findByAccessCode(accessCode).catch(() => null);
    await this.auditService.record({
      organizationId: invitation?.organizationId || null,
      actorType: 'CANDIDATE',
      action,
      resourceType: 'CandidateInvitation',
      resourceId: invitation?.id || null,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      metadata: {
        accessCodeFingerprint: this.fingerprintAccessCode(accessCode),
        reason: error?.message || 'invitation_not_available',
      },
    });
  }

  private fingerprintAccessCode(accessCode: string): string {
    return `${accessCode.slice(0, 3)}***${accessCode.slice(-2)}`;
  }

  private isUuid(value?: string): boolean {
    return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private async resolveExamForInvitation(examId: string, user: SessionUser) {
    if (!this.isUuid(examId)) {
      throw new BadRequestException('El identificador de evaluación no es válido.');
    }

    const exam = await this.prisma.exam.findFirst({
      where: {
        id: examId,
        organizationId: user.organizationId,
        isPublished: true,
      },
    });
    if (!exam) {
      throw new NotFoundException('La evaluación solicitada no existe o no está publicada para esta organización.');
    }

    return exam;
  }
}
