import { ForbiddenException } from '@nestjs/common';
import { CandidateConsentService, CURRENT_CANDIDATE_CONSENT_VERSION } from './candidate-consent.service';

describe('CandidateConsentService', () => {
  const user = { userId: '00000000-0000-7000-8000-000000000003', organizationId: '00000000-0000-7000-8000-000000000002' };
  const attempt = { id: '00000000-0000-7000-8000-000000000501', organizationId: user.organizationId, userId: user.userId, examId: 'exam', assessmentVersionId: 'version', status: 'AWAITING_CONSENT' };
  let prisma: any, attempts: any, audit: any, service: CandidateConsentService;
  beforeEach(() => {
    prisma = {
      candidateConsent: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(async ({ data }) => ({ id: 'consent-1', ...data })) },
      examAttempt: { findUniqueOrThrow: jest.fn().mockResolvedValue(attempt), update: jest.fn() },
      assessmentVersionItem: { count: jest.fn().mockResolvedValue(3) },
      $queryRaw: jest.fn(),
    };
    prisma.$transaction = jest.fn(callback => callback(prisma));
    attempts = { findAttemptInTenant: jest.fn().mockResolvedValue(attempt), findExamInTenant: jest.fn().mockResolvedValue({ title: 'Práctica', durationMinutes: 15 }) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new CandidateConsentService(prisma, attempts, audit);
  });
  it('returns false before accepting and exposes instructions without starting time', async () => {
    expect(await service.hasConsent(attempt.id, user)).toBe(false);
    const status = await service.getConsentStatus(attempt.id, user);
    expect(status.evaluation).toEqual({ title: 'Práctica', durationMinutes: 15, questionCount: 3 });
    expect(prisma.examAttempt.update).not.toHaveBeenCalled();
  });
  it('starts time exactly at first acceptance under a row lock', async () => {
    const result = await service.acceptConsent(attempt.id, user, {});
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.examAttempt.update).toHaveBeenCalledWith({ where: { id: attempt.id }, data: { startedAt: result.acceptedAt, status: 'IN_PROGRESS' } });
    expect(result.consentVersion).toBe(CURRENT_CANDIDATE_CONSENT_VERSION);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'candidate.consent.accepted' }));
  });
  it('preserves the original start time when acceptance is retried or another tab accepts', async () => {
    const acceptedAt = new Date('2026-07-02T00:00:00Z');
    prisma.candidateConsent.findUnique.mockResolvedValue({ id: 'consent-1', consentVersion: CURRENT_CANDIDATE_CONSENT_VERSION, acceptedAt });
    const result = await service.acceptConsent(attempt.id, user, {});
    expect(result.acceptedAt).toBe(acceptedAt);
    expect(prisma.examAttempt.update).not.toHaveBeenCalled();
    expect(prisma.candidateConsent.create).not.toHaveBeenCalled();
  });
  it('does not restart an already closed attempt without consent', async () => {
    prisma.examAttempt.findUniqueOrThrow.mockResolvedValue({ ...attempt, status: 'EXPIRED' });
    await expect(service.acceptConsent(attempt.id, user, {})).rejects.toThrow('ya está cerrado');
    expect(prisma.examAttempt.update).not.toHaveBeenCalled();
  });
  it('rejects consent for another candidate', async () => {
    attempts.findAttemptInTenant.mockResolvedValue({ ...attempt, userId: 'someone-else' });
    await expect(service.acceptConsent(attempt.id, user, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
