import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';

@Injectable()
export class ReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  findReportAttempt(attemptId: string, organizationId: string) {
    return this.prisma.examAttempt.findFirst({
      where: { id: attemptId, organizationId },
      include: {
        logs: {
          orderBy: { timestamp: 'asc' },
        },
        ltiMapping: true,
      },
    });
  }

  findResultsAttempt(attemptId: string, organizationId: string) {
    return this.prisma.examAttempt.findFirst({
      where: { id: attemptId, organizationId },
      include: {
        resultadosTest: true,
        resultadoGlobal: {
          include: {
            perfil: true,
          },
        },
      },
    });
  }

  findUserInTenant(userId: string, organizationId: string) {
    return this.prisma.user.findFirst({
      where: { id: userId, organizationId },
      select: { firstName: true, lastName: true, email: true },
    });
  }

  findExamInTenant(examId: string, organizationId: string) {
    return this.prisma.exam.findFirst({
      where: { id: examId, organizationId },
      select: { title: true, durationMinutes: true },
    });
  }

  findPublishedReportTemplateVersion(organizationId: string, assessmentVersionId?: string | null) {
    if (!assessmentVersionId) return null;
    return (this.prisma as any).reportTemplateVersion.findFirst({
      where: {
        status: 'PUBLISHED',
        reportTemplate: {
          organizationId,
          assessmentVersionId,
        },
      },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
  }

  findCutScore(organizationId: string, testId: string, theta: number) {
    return this.prisma.cutScore.findFirst({
      where: {
        organizationId,
        testId,
        thetaMin: { lte: theta },
        OR: [{ thetaMax: null }, { thetaMax: { gt: theta } }],
      },
    });
  }

  findPerfiles(organizationId: string) {
    return this.prisma.perfilPuesto.findMany({
      where: { organizationId },
      orderBy: { nombre: 'asc' },
    });
  }
}
