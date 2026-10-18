import { expect, test } from '@playwright/test';
import { clearE2ERateLimitKeys } from './fixtures/rate-limit-isolation';
import { E2E, acceptConsent, answerAllQuestions, authGet, authPost, claimInvitation, createInvitation, loadSession, loginStaff } from './fixtures/e2e-data';

test.beforeEach(async () => { await clearE2ERateLimitKeys(); });

test('pilot does not expose calibration, CAT, LTI or automatic hiring recommendations', async ({ request }) => {
  const admin = await loginStaff(request, E2E.users.adminA);
  for (const path of ['/v1/psicometria/calibrar', '/lti/launch']) {
    const response = await authPost(request, admin.accessToken, path, {});
    expect(response.status()).toBe(404);
  }
  const invitation = await createInvitation(request, admin.accessToken, `${Date.now()}-disabled-science`);
  const candidate = await claimInvitation(request, invitation.accessCode, invitation.candidateEmail, invitation.candidateName);
  const iga = await authGet(request, admin.accessToken, `/evaluations/attempts/${candidate.attemptId}/resultados`);
  expect(iga.status()).toBe(503);
});

test('ten simultaneous candidate flows produce complete descriptive reports', async ({ request }) => {
  test.setTimeout(60_000);
  const staff = await loginStaff(request, E2E.users.adminA);
  await Promise.all(Array.from({ length: 10 }, async (_, index) => {
    const invitation = await createInvitation(request, staff.accessToken, `${Date.now()}-batch-${index}`);
    const candidate = await claimInvitation(request, invitation.accessCode, invitation.candidateEmail, invitation.candidateName);
    await acceptConsent(request, candidate);
    const session = await loadSession(request, candidate);
    await answerAllQuestions(request, candidate, session);
    const finalize = await authPost(request, candidate.token, `/evaluations/attempts/${candidate.attemptId}/finalize`);
    expect(finalize.ok(), await finalize.text()).toBeTruthy();
    await expect.poll(async () => {
      const response = await authGet(request, staff.accessToken, `/evaluations/attempts/${candidate.attemptId}`);
      if (!response.ok()) return false;
      const report = await response.json();
      return typeof report.overallScore === 'string' && report.overallScore.includes('puntos');
    }, { timeout: 20_000 }).toBe(true);
  }));
});
