import { Injectable, Logger } from '@nestjs/common';
import { AttemptRepository } from '../repositories/attempt.repository';

@Injectable()
export class AttemptService {
  private readonly logger = new Logger(AttemptService.name);

  constructor(private readonly attempts: AttemptRepository) {}

  async listAttempts(organizationId: string) {
    this.logger.log('Listando todos los intentos de evaluación finalizados...');
    const attempts = await this.attempts.listAttemptsForTenant(organizationId);

    const result = [];
    for (const att of attempts) {
      const user = await this.attempts.findUserInTenant(att.userId, organizationId);
      const exam = await this.attempts.findExamInTenant(att.examId, organizationId);
      const expired = att.status === 'EXPIRED' || (att.status === 'IN_PROGRESS' && Date.now() >= att.startedAt.getTime() + (exam?.durationMinutes || 10) * 60_000);
      const statusLabel = att.status === 'COMPLETED' ? 'Completado' : expired ? 'Tiempo terminado · incompleto' : att.status === 'SUBMITTED' ? 'Pendiente de revisión' : 'En curso';

      result.push({
        id: att.id,
        candidateName: user ? `${user.firstName} ${user.lastName}`.trim() : 'Candidato Externo',
        email: user?.email || 'unknown@example.com',
        assessmentTitle: exam?.title || 'Evaluación Psicométrica',
        date: att.submittedAt ? att.submittedAt.toISOString() : att.startedAt.toISOString(),
        overallScore: att.status === 'COMPLETED' && att.score !== null ? `${att.score} puntos` : expired ? 'Sin puntuación · incompleto' : 'Pendiente',
        incidentsCount: 0,
        riskStatus: 'NOT_MONITORED',
        statusLabel,
      });
    }

    return result;
  }
}
