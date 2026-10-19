import { INTEGRITY_LABORAL_ITEMS, INTEGRITY_LABORAL_SCORING_REVISION, INTEGRITY_LABORAL_ASSESSMENT_CODE, likertWeights } from '../integrity-laboral/integrity-laboral.definition';
import { LikertStrategy } from './grading-strategy';
import { summarizeAssessment } from './assessment-score';

describe('Integrity scoring reference cases', () => {
  const links = INTEGRITY_LABORAL_ITEMS.map(item => ({ itemVersion: {
    id: String(item.order),
    stemJson: { type: 'LIKERT', defaultPoints: 1, content: { assessmentCode: INTEGRITY_LABORAL_ASSESSMENT_CODE } },
    scoringKeyJson: { assessmentCode: INTEGRITY_LABORAL_ASSESSMENT_CODE, scoringRevision: INTEGRITY_LABORAL_SCORING_REVISION, dimensionKey: item.dimensionKey, weights: likertWeights(item.reverseScored) },
  } }));
  it('rejects theft endorsement and rewards expense-fraud rejection', () => {
    const theft = links[5].itemVersion.scoringKeyJson;
    const expense = links[9].itemVersion.scoringKeyJson;
    const grade = new LikertStrategy();
    expect(grade.grade({ value: 5 }, theft, 1).pointsEarned).toBe(1);
    expect(grade.grade({ value: 1 }, theft, 1).pointsEarned).toBe(5);
    expect(grade.grade({ value: 5 }, expense, 1).pointsEarned).toBe(5);
  });
  it('normalizes both ends to 0/100 and supports a shorter frozen version', () => {
    for (const subset of [links, links.slice(0, 7)]) {
      const answers = (pointsEarned: number) => subset.map(l => ({ itemVersionId: l.itemVersion.id, pointsEarned }));
      expect(summarizeAssessment(subset, answers(1))?.dimensions.integrityLaboral.global.percentage).toBe(0);
      expect(summarizeAssessment(subset, answers(5))?.dimensions.integrityLaboral.global.percentage).toBe(100);
      expect(summarizeAssessment(subset, answers(5))?.dimensions.integrityLaboral.global.max).toBe(subset.length * 5);
    }
  });
  it('does not report completion while an accepted answer is still queued', () => {
    const missingLast = links.slice(0, -1).map(l => ({ itemVersionId: l.itemVersion.id, pointsEarned: 5 }));
    expect(summarizeAssessment(links, missingLast)).toBeNull();
  });
  it('refuses legacy integrity scoring instead of rewriting history', () => {
    const legacy = structuredClone(links);
    delete (legacy[0].itemVersion.scoringKeyJson as any).scoringRevision;
    expect(() => summarizeAssessment(legacy, [])).toThrow('retirada');
  });
  it.each([0, 6, 'invalid', null, undefined])('rejects invalid Likert response %p', value => {
    expect(() => new LikertStrategy().grade({ value }, links[0].itemVersion.scoringKeyJson, 1)).toThrow();
  });
});
