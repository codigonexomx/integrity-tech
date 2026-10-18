import { BadRequestException, ConflictException } from '@nestjs/common';
import { GradingStrategyFactory } from './grading-strategy';

// All answer writes and finalization serialize on the same PostgreSQL row.
export async function lockAttempt(tx: any, attemptId: string) {
  const rows = await tx.$queryRaw`
    SELECT id, status, exam_id AS "examId", started_at AS "startedAt",
      submitted_at AS "submittedAt", assessment_version_id AS "assessmentVersionId",
      organization_id AS "organizationId"
    FROM exam_attempts WHERE id = ${attemptId}::uuid FOR UPDATE;
  `;
  if (!rows[0]) throw new ConflictException('El intento no está disponible.');
  return rows[0];
}

export async function deadlineForAttempt(tx: any, attempt: any) {
  const exam = await tx.exam.findFirst({ where: { id: attempt.examId, organizationId: attempt.organizationId }, select: { durationMinutes: true } });
  if (!exam) throw new ConflictException('La evaluación no está disponible.');
  return new Date(new Date(attempt.startedAt).getTime() + (exam.durationMinutes || 10) * 60_000);
}

export async function persistSubmittedAnswer(tx: any, attempt: any, dto: any, receivedAt: Date) {
  if (attempt.status !== 'IN_PROGRESS' || receivedAt >= await deadlineForAttempt(tx, attempt)) {
    throw new ConflictException('La evaluación está cerrada o su tiempo terminó. No se admiten modificaciones.');
  }
  const itemVersionId = dto.itemVersionId || dto.questionId;
  const link = await tx.assessmentVersionItem.findFirst({
    where: { assessmentVersionId: attempt.assessmentVersionId, itemVersionId,
      itemVersion: { item: { organizationId: attempt.organizationId } } },
    include: { itemVersion: true },
  });
  if (!link || dto.questionId !== itemVersionId) throw new ConflictException('El reactivo no corresponde a esta evaluación.');
  const stem = link.itemVersion.stemJson as any;
  const content = stem?.content || stem || {};
  const response = dto.response;
  const scoring = link.itemVersion.scoringKeyJson || content.correctConfig || {};
  if (!response || (stem.type === 'MULTIPLE_CHOICE' && !content.options?.some((option: any) => option.id === response.selectedOptionId)) ||
    (['SHORT_ANSWER', 'TEXT_RESPONSE'].includes(stem.type) && (typeof response.text !== 'string' || !response.text.trim())) ||
    (stem.type === 'LIKERT' && !Object.prototype.hasOwnProperty.call(scoring.weights || {}, String(response.value)))) {
    throw new BadRequestException('Selecciona o escribe una respuesta válida antes de guardarla.');
  }
  const { isCorrect, pointsEarned } = GradingStrategyFactory.getStrategy(stem?.type || 'UNKNOWN')
    .grade(dto.response, link.itemVersion.scoringKeyJson || content.correctConfig || {}, Number(stem?.defaultPoints || 1));
  const data = { response: dto.response, itemVersionId, isCorrect, pointsEarned, tiempoMs: dto.tiempoMs, submittedAt: receivedAt };
  await tx.answerSubmission.upsert({
    where: { unique_response_per_attempt_question: { examAttemptId: attempt.id, questionId: dto.questionId } },
    update: data, create: { ...data, examAttemptId: attempt.id, questionId: dto.questionId },
  });
}
