import { expect, test } from '@playwright/test';
import { clearE2ERateLimitKeys } from './fixtures/rate-limit-isolation';

test.beforeEach(async () => { await clearE2ERateLimitKeys(); });
import {
  E2E,
  acceptConsent,
  authGet,
  authPost,
  claimInvitation,
  createInvitation,
  loadSession,
  loginStaff,
  seedAuthenticatedPage,
} from './fixtures/e2e-data';

test.describe('Enterprise E2E security controls', () => {
  test('RBAC blocks recruiter from psychometric governance console/API', async ({ page, request }) => {
    const recruiter = await loginStaff(request, E2E.users.recruiterA);

    const apiResponse = await authGet(request, recruiter.accessToken, '/psychometric-governance/assessments');
    expect(apiResponse.status()).toBe(403);

    await seedAuthenticatedPage(page, recruiter.accessToken);
    await page.goto('/staff/psychometrics');
    await expect(page.getByText('No tienes permisos para acceder a este recurso.', { exact: true })).toBeVisible();
  });

  test('candidate cannot access staff dashboard data', async ({ page, request }) => {
    const recruiter = await loginStaff(request, E2E.users.recruiterA);
    const invitation = await createInvitation(request, recruiter.accessToken, `${Date.now()}-candidate-dashboard`);
    const candidate = await claimInvitation(request, invitation.accessCode, invitation.candidateEmail, invitation.candidateName);

    const apiResponse = await authGet(request, candidate.token, '/evaluations/attempts');
    expect(apiResponse.status()).toBe(403);

    await seedAuthenticatedPage(page, candidate.token);
    await page.goto('/recruiter/dashboard');
    await expect(page.getByText('No tienes permisos para acceder a este recurso.', { exact: true })).toBeVisible();
  });

  test('known UUID from another tenant does not expose reports or attempts', async ({ request }) => {
    const recruiterA = await loginStaff(request, E2E.users.recruiterA, E2E.orgA);
    const recruiterB = await loginStaff(request, E2E.users.recruiterB, E2E.orgB);
    const invitation = await createInvitation(request, recruiterA.accessToken, `${Date.now()}-cross-tenant`);
    const candidate = await claimInvitation(request, invitation.accessCode, invitation.candidateEmail, invitation.candidateName);
    await acceptConsent(request, candidate);
    await loadSession(request, candidate);

    const reportAsB = await authGet(request, recruiterB.accessToken, `/evaluations/attempts/${candidate.attemptId}`);
    expect([400, 403, 404]).toContain(reportAsB.status());

    const attemptsAsB = await authGet(request, recruiterB.accessToken, '/evaluations/attempts');
    expect(attemptsAsB.ok(), await attemptsAsB.text()).toBeTruthy();
    const attemptsBody = await attemptsAsB.json();
    expect(attemptsBody.some((attempt: any) => attempt.id === candidate.attemptId)).toBeFalsy();
  });

  test('revoked session is rejected after logout', async ({ request }) => {
    const admin = await loginStaff(request, E2E.users.adminA);
    const logout = await authPost(request, admin.accessToken, '/auth/logout');
    expect(logout.ok(), await logout.text()).toBeTruthy();

    const rejected = await authGet(request, admin.accessToken, '/audit/events');
    expect(rejected.status()).toBe(401);
  });

  test('rate limit responds with 429 on repeated failed login', async ({ request }) => {
    const email = 'rate-limit-isolation@e2e.integrity.test';
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const response = await request.post(`${E2E.apiBaseURL}/auth/login`, {
        data: { email, password: 'wrong-password', organizationSlug: E2E.orgA },
      });
      statuses.push(response.status());
    }
    expect(statuses).toContain(429);
  });

  test('rate limit counters are isolated between E2E tests', async ({ request }) => {
    const response = await request.post(`${E2E.apiBaseURL}/auth/login`, {
      data: { email: 'rate-limit-isolation@e2e.integrity.test', password: 'wrong-password', organizationSlug: E2E.orgA },
    });

    expect(response.status()).not.toBe(429);
  });
});
