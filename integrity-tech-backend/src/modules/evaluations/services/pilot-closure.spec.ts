import { ConflictException } from '@nestjs/common';
import { AnswersQueueProcessor } from './answers-queue.processor';
import { persistSubmittedAnswer } from './answer-persistence';

describe('pilot durable closure', () => {
  const attempt = { id: 'a', status: 'IN_PROGRESS', assessmentVersionId: 'v', organizationId: 'o', examId: 'e', startedAt: new Date(), submittedAt: null };
  let tx: any;
  let processor: AnswersQueueProcessor;
  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ ...attempt }]),
      exam: { findFirst: jest.fn().mockResolvedValue({ durationMinutes: 15 }) },
      examAttempt: { update: jest.fn() },
      answerSubmission: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
      assessmentVersionItem: { findMany: jest.fn().mockResolvedValue([{ itemVersion: { id: 'q', stemJson: { type: 'MULTIPLE_CHOICE', defaultPoints: 1 }, scoringKeyJson: {} } }]) },
    };
    const prisma = { $transaction: (fn: any) => fn(tx) };
    processor = new AnswersQueueProcessor(prisma as any, {} as any, {} as any);
  });
  it('does not close or publish a score when a question is omitted', async () => {
    await expect(processor.closeAttempt('a')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.examAttempt.update).not.toHaveBeenCalled();
  });
  it('expires an incomplete attempt without inventing a score', async () => {
    tx.$queryRaw.mockResolvedValue([{ ...attempt, startedAt: new Date(0) }]);
    await expect(processor.closeAttempt('a')).resolves.toBe('EXPIRED');
    expect(tx.examAttempt.update.mock.calls[0][0].data).toEqual({ status: 'EXPIRED', submittedAt: expect.any(Date) });
  });
  it('returns a completed attempt without recalculating score or changing delivery time', async () => {
    tx.$queryRaw.mockResolvedValue([{ ...attempt, status: 'COMPLETED' }]);
    await expect(processor.closeAttempt('a')).resolves.toBe('COMPLETED');
    expect(tx.answerSubmission.findMany).not.toHaveBeenCalled();
    expect(tx.examAttempt.update).not.toHaveBeenCalled();
  });
  it('rejects a new answer after completion before touching submissions', async () => {
    await expect(persistSubmittedAnswer(tx, { ...attempt, status: 'COMPLETED' }, {}, new Date())).rejects.toBeInstanceOf(ConflictException);
    expect(tx.answerSubmission.upsert).not.toHaveBeenCalled();
  });
  it('rejects a new answer after the server deadline', async () => {
    await expect(persistSubmittedAnswer(tx, { ...attempt, startedAt: new Date(0) }, {}, new Date())).rejects.toBeInstanceOf(ConflictException);
    expect(tx.answerSubmission.upsert).not.toHaveBeenCalled();
  });
  it('ignores a legacy queued answer after completion', async () => {
    tx.$queryRaw.mockResolvedValue([{ ...attempt, status: 'COMPLETED' }]);
    await processor.handleSaveAnswer({ data: { attemptId: 'a' } } as any);
    expect(tx.answerSubmission.upsert).not.toHaveBeenCalled();
  });
});
