import { ConflictException } from '@nestjs/common';
import { INTEGRITY_LABORAL_ASSESSMENT_CODE, INTEGRITY_LABORAL_SCORING_REVISION, INTEGRITY_LABORAL_NOTICE, dimensionByKey } from '../integrity-laboral/integrity-laboral.definition';

// Denominators come from the frozen assessment version, never from answered items.
export function summarizeAssessment(links: any[], submissions: any[]) {
  if (!links.length) throw new ConflictException('La evaluación no contiene reactivos.');
  const byId = new Map(submissions.map(s => [s.itemVersionId || s.questionId, s]));
  const dimensions: Record<string, any> = {};
  let total = 0;
  let minimum = 0;
  let maximum = 0;
  let integrity = false;
  for (const link of links) {
    const item = link.itemVersion;
    const stem = item.stemJson || {};
    const content = stem.content || stem;
    const scoring = item.scoringKeyJson || {};
    const isIntegrity = content.assessmentCode === INTEGRITY_LABORAL_ASSESSMENT_CODE || scoring.assessmentCode === INTEGRITY_LABORAL_ASSESSMENT_CODE;
    integrity ||= isIntegrity;
    if (isIntegrity && scoring.scoringRevision !== INTEGRITY_LABORAL_SCORING_REVISION) {
      throw new ConflictException('Versión de integridad retirada por clave de puntuación incorrecta. Crear un intento con la revisión 1.1.0.');
    }
    const sub = byId.get(item.id);
    if (!sub) return null; // Accepted answers may still be in Redis. Never publish a partial score.
    const points = Number(sub.pointsEarned);
    const defaultPoints = Number(stem.defaultPoints ?? 1);
    const weights = Object.values(scoring.weights || {}).map(Number);
    const min = stem.type === 'LIKERT' ? Math.min(...weights) * defaultPoints : 0;
    const max = stem.type === 'LIKERT' ? Math.max(...weights) * defaultPoints : defaultPoints;
    if (![points, min, max].every(Number.isFinite) || max <= min || points < min || points > max) {
      throw new ConflictException('Puntuación fuera de la escala publicada.');
    }
    const key = scoring.dimensionKey || content.dimensionKey || content.dimension || stem.dimension || 'GENERAL';
    const dim = dimensions[key] ||= { name: scoring.dimension || content.dimension || dimensionByKey(key)?.name || key, earned: 0, min: 0, max: 0 };
    dim.earned += points; dim.min += min; dim.max += max;
    total += points; minimum += min; maximum += max;
  }
  const percent = (earned: number, min: number, max: number) => Number(((earned - min) / (max - min) * 100).toFixed(1));
  for (const dim of Object.values(dimensions)) dim.percentage = percent(dim.earned, dim.min, dim.max);
  if (integrity) dimensions.integrityLaboral = {
    assessmentCode: INTEGRITY_LABORAL_ASSESSMENT_CODE,
    scoringRevision: INTEGRITY_LABORAL_SCORING_REVISION,
    validationStatus: 'EXPERIMENTAL',
    notice: INTEGRITY_LABORAL_NOTICE,
    global: { name: 'Resumen descriptivo', earned: total, min: minimum, max: maximum, percentage: percent(total, minimum, maximum) },
  };
  return { total, dimensions };
}
