import { expect, test } from '@playwright/test';
import { clearE2ERateLimitKeys } from './fixtures/rate-limit-isolation';

test.beforeEach(async () => { await clearE2ERateLimitKeys(); });
import {
  E2E,
  acceptConsent,
  answerAllQuestions,
  authGet,
  authPost,
  claimInvitation,
  createInvitation,
  loadSession,
  loginStaff,
  seedAuthenticatedPage,
  tinyPngDataUrl,
  waitForReportReady,
} from './fixtures/e2e-data';

test.describe('Enterprise E2E complete evaluation flow', () => {
  test('staff creates invitation, candidate completes exam, report/audit/governance/storage are available', async ({ page, request }) => {
    const recruiter = await loginStaff(request, E2E.users.recruiterA);
    await seedAuthenticatedPage(page, recruiter.accessToken);

    await page.goto('/recruiter/dashboard');
    await expect(page.getByRole('heading', { name: 'Consola de candidatos' })).toBeVisible();

    const suffix = `${Date.now()}`;
    const invitation = await createInvitation(request, recruiter.accessToken, suffix);
    const candidate = await claimInvitation(request, invitation.accessCode, invitation.candidateEmail, invitation.candidateName);

    const consentBefore = await authGet(request, candidate.token, `/evaluations/attempts/${candidate.attemptId}/consent`);
    expect([200, 404]).toContain(consentBefore.status());

    await acceptConsent(request, candidate);
    const session = await loadSession(request, candidate);
    expect(session.questions[0].itemVersionId).toBeTruthy();
    expect(JSON.stringify(session.questions)).not.toContain('correctConfig');

    const snapshot = await authPost(request, candidate.token, `/evaluations/attempts/${candidate.attemptId}/snapshots`, {
      image: tinyPngDataUrl,
    });
    expect(snapshot.ok(), await snapshot.text()).toBeTruthy();
    const snapshotBody = await snapshot.json();
    expect(snapshotBody.fileId).toBeTruthy();

    const fileUrl = await authGet(request, candidate.token, `/files/${snapshotBody.fileId}/download-url`);
    expect(fileUrl.ok(), await fileUrl.text()).toBeTruthy();
    const fileUrlBody = await fileUrl.json();
    expect(fileUrlBody.file.objectKey).toBeUndefined();
    expect(fileUrlBody.file.classification).toBe('HIGHLY_SENSITIVE');

    await answerAllQuestions(request, candidate, session);

    await expect.poll(async () => {
      const finalize = await authPost(request, candidate.token, `/evaluations/attempts/${candidate.attemptId}/finalize`);
      return finalize.status();
    }, { timeout: 15_000 }).toBe(200);

    const idempotentFinalize = await authPost(request, candidate.token, `/evaluations/attempts/${candidate.attemptId}/finalize`);
    expect(idempotentFinalize.ok(), await idempotentFinalize.text()).toBeTruthy();

    await waitForReportReady(request, recruiter.accessToken, candidate.attemptId);
    const report = await authGet(request, recruiter.accessToken, `/evaluations/attempts/${candidate.attemptId}`);
    expect(report.ok(), await report.text()).toBeTruthy();
    const reportBody = await report.json();
    expect(reportBody.email).toBe(invitation.candidateEmail);
    expect(reportBody.governanceTrace.assessmentVersionId).toBeTruthy();
    expect(reportBody.governanceTrace.itemVersionIds.length).toBeGreaterThan(0);
    expect(['PARTIAL', 'VERSIONED']).toContain(reportBody.governanceTrace.mode);

    const attempts = await authGet(request, recruiter.accessToken, '/evaluations/attempts');
    expect(attempts.ok(), await attempts.text()).toBeTruthy();
    const attemptsBody = await attempts.json();
    expect(attemptsBody.some((attempt: any) => attempt.id === candidate.attemptId)).toBeTruthy();

    const admin = await loginStaff(request, E2E.users.adminA);
    const audit = await authGet(request, admin.accessToken, `/audit/events?resourceId=${candidate.attemptId}`);
    expect(audit.ok(), await audit.text()).toBeTruthy();
    const auditBody = await audit.json();
    const actions = auditBody.map((event: any) => event.action);
    expect(actions).toEqual(expect.arrayContaining([
      'invitation.claimed',
      'exam.session.accessed',
      'attempt.finalized',
      'report.accessed',
    ]));
  });
});
