import { ForbiddenException } from '@nestjs/common';
import { SessionService } from './session.service';

describe('Evaluation SessionService consent gate', () => {
  const user = {
    userId: '00000000-0000-7000-8000-000000000003',
    organizationId: '00000000-0000-7000-8000-000000000002',
  };
  const attempt = {
    id: '00000000-0000-7000-8000-000000000501',
    examId: '00000000-0000-7000-8000-000000000301',
    organizationId: user.organizationId,
    userId: user.userId,
    status: 'IN_PROGRESS',
    assessmentVersionId: '00000000-0000-7000-8000-000000000901',
    startedAt: new Date('2026-07-02T00:00:00.000Z'),
    submittedAt: null,
  };

  let prisma: any;
  let attempts: any;
  let consentService: any;
  let auditService: any;
  let governanceResolver: any;
  let service: SessionService;

  beforeEach(() => {
    prisma = { answerSubmission: { findMany: jest.fn().mockResolvedValue([]) } };
    attempts = {
      findAttemptInTenant: jest.fn().mockResolvedValue(attempt),
      findExamInTenant: jest.fn().mockResolvedValue({
        id: attempt.examId,
        title: 'Evaluación demo',
        durationMinutes: 30,
      }),
    };
    consentService = {
      hasConsent: jest.fn(),
    };
    auditService = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    governanceResolver = {
      findGovernedSessionItems: jest.fn().mockResolvedValue([
        {
          itemVersionId: '00000000-0000-7000-8000-000000000902',
          weight: 2,
          itemVersion: {
            stemJson: {
              type: 'MULTIPLE_CHOICE',
              defaultPoints: 2,
              content: {
                text: 'Pregunta gobernada',
                correctConfig: { optionId: 'a' },
              },
            },
            item: { id: '00000000-0000-7000-8000-000000000802', itemCode: 'ITEM-1' },
          },
        },
      ]),
    };
    service = new SessionService(prisma, attempts, consentService, auditService, governanceResolver);
  });

  it('rejects session loading when candidate consent is missing', async () => {
    consentService.hasConsent.mockResolvedValue(false);

    await expect(service.getAttemptSession(attempt.id, user)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('loads versioned item questions without correct answers after consent', async () => {
    consentService.hasConsent.mockResolvedValue(true);

    const result = await service.getAttemptSession(attempt.id, user);

    expect(result.questions).toHaveLength(1);
    expect((result.questions[0] as any).content.correctConfig).toBeUndefined();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'exam.session.accessed',
        organizationId: user.organizationId,
        actorUserId: user.userId,
      }),
    );
  });


  it('randomizes Integrity Laboral questions deterministically per attempt', async () => {
    consentService.hasConsent.mockResolvedValue(true);
    governanceResolver.findGovernedSessionItems.mockResolvedValue([
      {
        itemVersionId: '00000000-0000-7000-8000-000000000901',
        weight: 1,
        itemVersion: {
          stemJson: { type: 'LIKERT', content: { assessmentCode: 'EVALUACION_INTEGRIDAD_LABORAL', text: 'A', dimension: 'Sinceridad' } },
          item: { id: 'item-1', itemCode: 'EIL-1' },
        },
      },
      {
        itemVersionId: '00000000-0000-7000-8000-000000000902',
        weight: 1,
        itemVersion: {
          stemJson: { type: 'LIKERT', content: { assessmentCode: 'EVALUACION_INTEGRIDAD_LABORAL', text: 'B', dimension: 'Justicia' } },
          item: { id: 'item-2', itemCode: 'EIL-2' },
        },
      },
      {
        itemVersionId: '00000000-0000-7000-8000-000000000903',
        weight: 1,
        itemVersion: {
          stemJson: { type: 'LIKERT', content: { assessmentCode: 'EVALUACION_INTEGRIDAD_LABORAL', text: 'C', dimension: 'Modestia' } },
          item: { id: 'item-3', itemCode: 'EIL-3' },
        },
      },
    ]);

    const first = await service.getAttemptSession(attempt.id, user);
    const second = await service.getAttemptSession(attempt.id, user);

    expect(first.questions.map((question: any) => question.id)).toEqual(second.questions.map((question: any) => question.id));
    expect(first.questions.map((question: any) => question.id)).not.toEqual([
      '00000000-0000-7000-8000-000000000901',
      '00000000-0000-7000-8000-000000000902',
      '00000000-0000-7000-8000-000000000903',
    ]);
  });

  it('loads questions from AssessmentVersionItem when attempt is governed', async () => {
    consentService.hasConsent.mockResolvedValue(true);
    attempts.findAttemptInTenant.mockResolvedValue({
      ...attempt,
      assessmentVersionId: '00000000-0000-7000-8000-000000000901',
    });
    governanceResolver.findGovernedSessionItems.mockResolvedValue([
      {
        itemVersionId: '00000000-0000-7000-8000-000000000902',
        weight: 2,
        itemVersion: {
          stemJson: {
            type: 'MULTIPLE_CHOICE',
            defaultPoints: 2,
            content: {
              text: 'Pregunta gobernada',
              correctConfig: { optionId: 'a' },
            },
          },
          item: { id: '00000000-0000-7000-8000-000000000802', itemCode: 'ITEM-1' },
        },
      },
    ]);

    const result = await service.getAttemptSession(attempt.id, user);

    expect(result.questions[0]).toEqual(
      expect.objectContaining({
        id: '00000000-0000-7000-8000-000000000902',
        itemVersionId: '00000000-0000-7000-8000-000000000902',
        type: 'MULTIPLE_CHOICE',
      }),
    );
    expect((result.questions[0] as any).content.correctConfig).toBeUndefined();
    expect(governanceResolver.findGovernedSessionItems).toHaveBeenCalledWith('00000000-0000-7000-8000-000000000901');
  });
});
