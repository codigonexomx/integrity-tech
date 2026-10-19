import { FinalizeService } from './finalize.service';

describe('FinalizeService audit events', () => {
  it('records audit event when an attempt is finalized', async () => {
    const attempts = {
      findAttemptInTenant: jest.fn().mockResolvedValue({
        id: '00000000-0000-7000-8000-000000000501',
        examId: '00000000-0000-7000-8000-000000000301',
        organizationId: 'org-1',
        status: 'IN_PROGRESS',
      }),
      markSubmitted: jest.fn().mockResolvedValue(undefined),
    };
    const answersProcessor = {
      closeAttempt: jest.fn().mockResolvedValue('COMPLETED'),
    };
    const auditService = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    const service = new FinalizeService(attempts as any, answersProcessor as any, auditService as any);

    await service.finalizeAttempt(
      '00000000-0000-7000-8000-000000000501',
      {
        userId: 'candidate-1',
        organizationId: 'org-1',
        email: 'candidate@integrity.demo',
        roles: ['candidate'],
      },
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'attempt.finalized',
        organizationId: 'org-1',
        actorUserId: 'candidate-1',
        resourceId: '00000000-0000-7000-8000-000000000501',
      }),
    );
  });
});
