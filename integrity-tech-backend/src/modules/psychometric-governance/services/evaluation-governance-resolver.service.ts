import { BadRequestException, Injectable } from '@nestjs/common';
import { INTEGRITY_LABORAL_ASSESSMENT_CODE, INTEGRITY_LABORAL_SCORING_REVISION } from '../../evaluations/integrity-laboral/integrity-laboral.definition';
import { PrismaService } from '../../../shared/database/prisma.service';

@Injectable()
export class EvaluationGovernanceResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolvePublishedAssessmentVersionForExam(examId: string, organizationId: string) {
    const assessment = await (this.prisma as any).assessment.findFirst({
      where: {
        organizationId,
        id: examId,
      },
      include: {
        versions: {
          where: { status: 'PUBLISHED' },
          orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
          take: 1,
        },
      },
    });

    const version = assessment?.versions?.[0];
    if (!version) {
      throw new BadRequestException(
        'La evaluación no tiene una versión psicométrica publicada.',
      );
    }

    const blueprint = version.blueprintJson || {};
    if ((assessment.code === INTEGRITY_LABORAL_ASSESSMENT_CODE || blueprint.assessmentCode === INTEGRITY_LABORAL_ASSESSMENT_CODE) && blueprint.scoringRevision !== INTEGRITY_LABORAL_SCORING_REVISION) {
      throw new BadRequestException('Versión de integridad retirada: publique una revisión corregida antes de crear intentos.');
    }
    return version;
  }

  async resolveItemVersionForAnswer(input: {
    attemptId: string;
    organizationId: string;
    questionId: string;
  }): Promise<{ itemVersionId: string }> {
    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: input.attemptId, organizationId: input.organizationId },
      select: { id: true, assessmentVersionId: true },
    });

    if (!attempt?.assessmentVersionId) {
      throw new BadRequestException('Intento de examen no válido para evaluación versionada.');
    }

    const linkedItem = await (this.prisma as any).assessmentVersionItem.findFirst({
      where: {
        assessmentVersionId: attempt.assessmentVersionId,
        itemVersionId: input.questionId,
        itemVersion: {
          status: { in: ['ACTIVE', 'PUBLISHED'] },
          item: { organizationId: input.organizationId },
        },
      },
      select: { itemVersionId: true },
    });

    if (!linkedItem) {
      throw new BadRequestException('El reactivo no pertenece a la versión publicada del intento.');
    }

    return { itemVersionId: linkedItem.itemVersionId };
  }

  async validateItemVersionBelongsToAttempt(input: {
    attemptId: string;
    questionId: string;
    itemVersionId?: string | null;
  }) {
    const attempt = await this.prisma.examAttempt.findUnique({
      where: { id: input.attemptId },
      select: { assessmentVersionId: true, organizationId: true },
    });

    if (!attempt?.assessmentVersionId) return false;

    const itemVersionId = input.itemVersionId || input.questionId;
    if (itemVersionId !== input.questionId) return false;

    const link = await (this.prisma as any).assessmentVersionItem.findFirst({
      where: {
        assessmentVersionId: attempt.assessmentVersionId,
        itemVersionId,
        itemVersion: {
          status: { in: ['ACTIVE', 'PUBLISHED'] },
          item: { organizationId: attempt.organizationId },
        },
      },
      select: { itemVersionId: true },
    });

    return !!link;
  }

  async findGovernedSessionItems(assessmentVersionId: string) {
    return (this.prisma as any).assessmentVersionItem.findMany({
      where: {
        assessmentVersionId,
        itemVersion: {
          status: { in: ['ACTIVE', 'PUBLISHED'] },
        },
      },
      orderBy: { sortOrder: 'asc' },
      include: {
        itemVersion: {
          include: { item: true },
        },
      },
    });
  }

  async resolvePublishedResultVersions(assessmentVersionId?: string | null) {
    if (!assessmentVersionId) {
      return {
        scoringModelVersionId: null,
        normGroupVersionId: null,
      };
    }

    const [scoringModelVersion, normGroupVersion, reportTemplateVersion] = await Promise.all([
      (this.prisma as any).scoringModelVersion.findFirst({
        where: {
          status: 'PUBLISHED',
          scoringModel: { assessmentVersionId },
        },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      }),
      (this.prisma as any).normGroupVersion.findFirst({
        where: {
          status: 'PUBLISHED',
          normGroup: { assessmentVersionId },
        },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      }),
      (this.prisma as any).reportTemplateVersion.findFirst({
        where: {
          status: 'PUBLISHED',
          reportTemplate: { assessmentVersionId },
        },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

    return {
      scoringModelVersionId: scoringModelVersion?.id || null,
      normGroupVersionId: normGroupVersion?.id || null,
      reportTemplateVersionId: reportTemplateVersion?.id || null,
    };
  }
}
