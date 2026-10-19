import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';

@Injectable()
export class InvitationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByAccessCode(accessCode: string) {
    return this.prisma.candidateInvitation.findUnique({
      where: { accessCode },
    });
  }

  findExamForInvitation(examId: string, organizationId: string) {
    return this.prisma.exam.findFirst({
      where: { id: examId, organizationId },
      select: { id: true, title: true, organizationId: true, durationMinutes: true },
    });
  }

  createInvitation(data: {
    organizationId: string;
    createdByUserId: string;
    examId: string;
    email: string;
    candidateName: string;
    accessCode: string;
    expiresAt: Date;
  }) {
    return this.prisma.candidateInvitation.create({
      data: {
        organizationId: data.organizationId,
        createdByUserId: data.createdByUserId,
        examId: data.examId,
        email: data.email,
        candidateName: data.candidateName,
        accessCode: data.accessCode,
        status: 'PENDING',
        expiresAt: data.expiresAt,
      },
    });
  }

  accessCodeExists(accessCode: string): Promise<boolean> {
    return this.prisma.candidateInvitation
      .findUnique({
        where: { accessCode },
        select: { id: true },
      })
      .then(Boolean);
  }
}
