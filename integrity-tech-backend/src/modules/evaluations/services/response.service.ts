import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import { AUDIT_ACTIONS, AuditRequestMetadata } from '../../audit/audit-event.types';
import { AuditService } from '../../audit/services/audit.service';
import { SessionUser } from '../../iam';
import { SubmitAnswerBodyDto } from '../dto/submit-answer.dto';
import { SubmitFeedbackDto } from '../dto/submit-feedback.dto';
import { SubmitSnapshotDto } from '../dto/evaluation-flow.dto';
import { EvaluationQueueProducer } from './evaluation-queue.producer';
import { AttemptRepository } from '../repositories/attempt.repository';
import { EvaluationGovernanceResolverService } from '../../psychometric-governance/services/evaluation-governance-resolver.service';
import { StorageService } from '../../storage/storage.service';

@Injectable()
export class ResponseService {
  private readonly logger = new Logger(ResponseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueProducer: EvaluationQueueProducer,
    private readonly attempts: AttemptRepository,
    private readonly auditService: AuditService,
    private readonly governanceResolver: EvaluationGovernanceResolverService,
    private readonly storage: StorageService,
  ) {}

  async submitAnswer(
    attemptId: string,
    body: SubmitAnswerBodyDto,
    user: SessionUser,
    metadata: AuditRequestMetadata = {},
  ) {
    this.logger.log(`Petición de envío de respuesta recibida para intento: ${attemptId}, Pregunta: ${body.questionId}`);

    const resolvedItem = await this.governanceResolver.resolveItemVersionForAnswer({
      attemptId,
      organizationId: user.organizationId,
      questionId: body.questionId,
    });

    if (body.itemVersionId && resolvedItem.itemVersionId && body.itemVersionId !== resolvedItem.itemVersionId) {
      throw new BadRequestException('La versión del reactivo no corresponde al intento.');
    }

    const result = await this.queueProducer.enqueueAnswer({
      attemptId,
      questionId: body.questionId,
      itemVersionId: resolvedItem.itemVersionId,
      response: body.response,
      tiempoMs: body.tiempoMs,
    });
    await this.auditService.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      actorType: 'CANDIDATE',
      action: AUDIT_ACTIONS.ANSWER_SUBMITTED,
      resourceType: 'AnswerSubmission',
      resourceId: body.questionId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      metadata: {
        attemptId,
        questionId: body.questionId,
        itemVersionId: resolvedItem.itemVersionId,
        governanceMode: 'VERSIONED',
        jobId: result.jobId,
      },
    });

    return {
      status: 'accepted',
      message: 'La respuesta ha sido guardada y puntuada.',
      jobId: result.jobId,
    };
  }

  async submitFeedback(attemptId: string, body: SubmitFeedbackDto, _user?: SessionUser) {
    this.logger.log(`Registrando feedback NPS para intento: ${attemptId} | Score: ${body.npsScore}`);

    await this.attempts.updateFeedback(attemptId, body.npsScore, body.feedbackText);

    return {
      status: 'success',
      message: 'Retroalimentación técnica guardada de forma exitosa.',
    };
  }

  async uploadSnapshot(attemptId: string, body: SubmitSnapshotDto, user: SessionUser) {
    this.logger.log(`Recibiendo foto de supervisión para el intento: ${attemptId}`);

    if (!body.image || !body.image.includes('base64,')) {
      throw new BadRequestException('El formato de la imagen Base64 no es válido.');
    }

    try {
      const privateFile = await this.storage.storeSnapshot({
        organizationId: user.organizationId,
        ownerUserId: user.userId,
        attemptId,
        dataUrl: body.image,
      });

      const lastLog = await this.prisma.attemptLog.findFirst({
        where: { examAttemptId: attemptId },
        orderBy: { timestamp: 'desc' },
      });
      const sequence = lastLog && lastLog.metadata ? ((lastLog.metadata as any).sequence || 0) + 1 : 1;

      await this.prisma.attemptLog.create({
        data: {
          examAttemptId: attemptId,
          eventType: 'identity_snapshot',
          riskLevel: 'INFO',
          metadata: {
            sequence,
            snapshotStored: true,
            privateFileId: privateFile.id,
            mimeType: privateFile.mimeType,
            sizeBytes: privateFile.sizeBytes,
            checksumSha256: privateFile.checksumSha256,
            classification: privateFile.classification,
          },
        },
      });

      return {
        status: 'success',
        message: 'Captura registrada en almacenamiento privado.',
        imageStored: true,
        fileId: privateFile.id,
      };
    } catch (err) {
      this.logger.error(`Error al registrar metadata de supervisión: ${err.message}`, err.stack);
      throw new BadRequestException(`Fallo al registrar metadata de supervisión: ${err.message}`);
    }
  }
}
