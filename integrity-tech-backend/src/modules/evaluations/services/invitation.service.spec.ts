import { InvitationService } from './invitation.service';

describe('InvitationService audit events', () => {
  const staffUser = {
    userId: '00000000-0000-7000-8000-000000000001',
    organizationId: '00000000-0000-7000-8000-000000000002',
    email: 'admin@integrity.demo',
    roles: ['admin'],
  };
  const exam = {
    id: '00000000-0000-7000-8000-000000000301',
    organizationId: staffUser.organizationId,
    title: 'Evaluación demo',
  };
  const invitation = {
    id: '00000000-0000-7000-8000-000000000401',
    organizationId: staffUser.organizationId,
    examId: exam.id,
    accessCode: 'IT-123456',
    candidateName: 'Candidato Demo',
    email: 'candidate@integrity.demo',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 86400000),
  };

  let prisma: any;
  let iamFacade: any;
  let invitations: any;
  let auditService: any;
  let governanceResolver: any;
  let service: InvitationService;

  beforeEach(() => {
    prisma = {
      exam: {
        findFirst: jest.fn().mockResolvedValue(exam),
      },
      $transaction: jest.fn(async (callback) =>
        callback({
          user: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({
              id: '00000000-0000-7000-8000-000000000003',
              email: invitation.email,
            }),
          },
          examAttempt: {
            create: jest.fn().mockResolvedValue({
              id: '00000000-0000-7000-8000-000000000501',
              examId: exam.id,
              assessmentVersionId: '00000000-0000-7000-8000-000000000901',
            }),
          },
          candidateInvitation: {
            update: jest.fn().mockResolvedValue(undefined),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        }),
      ),
    };
    iamFacade = {
      issueSessionToken: jest.fn().mockReturnValue('candidate-jwt'),
    };
    invitations = {
      createInvitation: jest.fn().mockResolvedValue(invitation),
      accessCodeExists: jest.fn().mockResolvedValue(false),
      findByAccessCode: jest.fn().mockResolvedValue(invitation),
      findExamForInvitation: jest.fn().mockResolvedValue(exam),
    };
    auditService = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    governanceResolver = {
      resolvePublishedAssessmentVersionForExam: jest.fn().mockResolvedValue({
        id: '00000000-0000-7000-8000-000000000901',
      }),
    };
    service = new InvitationService(prisma, iamFacade, invitations, auditService, governanceResolver);
  });

  it('records audit event when a staff user creates an invitation', async () => {
    await service.createInvitation(
      staffUser,
      {
        candidateName: 'Candidato Demo',
        email: 'candidate@integrity.demo',
        examId: exam.id,
      },
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'invitation.created',
        organizationId: staffUser.organizationId,
        actorUserId: staffUser.userId,
        resourceId: invitation.id,
      }),
    );
  });

  it('records audit event when a candidate claims an invitation', async () => {
    const result = await service.claimInvitation(
      {
        accessCode: invitation.accessCode,
        candidateName: invitation.candidateName,
        email: invitation.email,
      },
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );

    expect(result.token).toBe('candidate-jwt');
    expect(governanceResolver.resolvePublishedAssessmentVersionForExam).toHaveBeenCalledWith(
      exam.id,
      exam.organizationId,
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'invitation.claimed',
        organizationId: staffUser.organizationId,
        actorType: 'CANDIDATE',
        resourceId: '00000000-0000-7000-8000-000000000501',
      }),
    );
  });

  it('audits failed invitation verification without organization', async () => {
    invitations.findByAccessCode.mockResolvedValue(null);

    await expect(
      service.verifyInvitation(
        { accessCode: 'IT-999999' },
        { ipAddress: '127.0.0.1', userAgent: 'jest' },
      ),
    ).rejects.toThrow('El código de acceso especificado no es válido o ha expirado.');

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: null,
        action: 'public.invitation.verify.failed',
        resourceId: null,
      }),
    );
  });

  it('audits failed invitation claim without organization', async () => {
    invitations.findByAccessCode.mockResolvedValue(null);

    await expect(
      service.claimInvitation(
        {
          accessCode: 'IT-999999',
          candidateName: 'Candidato Demo',
          email: 'candidate@integrity.demo',
        },
        { ipAddress: '127.0.0.1', userAgent: 'jest' },
      ),
    ).rejects.toThrow('Código de acceso no válido.');

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: null,
        action: 'public.invitation.claim.failed',
        resourceId: null,
      }),
    );
  });
  it('rejects identity substitution before reserving an invitation', async () => {
    for (const changes of [{ email: 'other@example.test' }, { candidateName: 'Another person' }]) {
      await expect(service.claimInvitation({ accessCode: invitation.accessCode, candidateName: invitation.candidateName, email: invitation.email, ...changes })).rejects.toThrow('no coinciden');
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a concurrent claim instead of creating a second attempt', async () => {
    prisma.$transaction.mockImplementationOnce(callback => callback({ candidateInvitation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } }));
    await expect(service.claimInvitation({ accessCode: invitation.accessCode, candidateName: invitation.candidateName, email: invitation.email })).rejects.toThrow('ya no está disponible');
  });

});
