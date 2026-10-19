import { expect, test } from '@playwright/test';
import { clearE2ERateLimitKeys } from './fixtures/rate-limit-isolation';

test.beforeEach(async () => { await clearE2ERateLimitKeys(); });
import {
  E2E,
  acceptConsent,
  claimInvitation,
  countQueuedAnswers,
  createInvitation,
  loadSession,
  loginStaff,
  seedAuthenticatedPage,
} from './fixtures/e2e-data';

test.describe('Enterprise E2E candidate resilience', () => {
  async function createCandidateAttempt(request: any, suffix: string) {
    const recruiter = await loginStaff(request, E2E.users.recruiterA);
    const invitation = await createInvitation(request, recruiter.accessToken, suffix);
    const candidate = await claimInvitation(request, invitation.accessCode, invitation.candidateEmail, invitation.candidateName);
    await acceptConsent(request, candidate);
    await loadSession(request, candidate);
    return candidate;
  }

  test('network failure keeps answers queued locally', async ({ page, request }) => {
    const candidate = await createCandidateAttempt(request, `${Date.now()}-network`);
    await seedAuthenticatedPage(page, candidate.token);
    await page.route('**/api/evaluations/attempts/*/submit', (route) => route.abort('failed'));

    await page.goto(`/exam/${candidate.attemptId}`);
    await expect(page.getByRole('status').filter({ hasText: /Pregunta/ })).toBeVisible();
    await page.locator('label').first().click();

    await expect.poll(() => countQueuedAnswers(page), { timeout: 10_000 }).toBeGreaterThan(0);
    await page.reload();
    await expect.poll(() => countQueuedAnswers(page), { timeout: 10_000 }).toBeGreaterThan(0);
  });

  test('429 keeps answers queued locally', async ({ page, request }) => {
    const candidate = await createCandidateAttempt(request, `${Date.now()}-429`);
    await seedAuthenticatedPage(page, candidate.token);
    await page.route('**/api/evaluations/attempts/*/submit', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 429, message: 'Demasiadas solicitudes.' }),
      }),
    );

    await page.goto(`/exam/${candidate.attemptId}`);
    await expect(page.getByRole('status').filter({ hasText: /Pregunta/ })).toBeVisible();
    await page.locator('label').first().click();

    await expect.poll(() => countQueuedAnswers(page), { timeout: 10_000 }).toBeGreaterThan(0);
  });

  test('refresh token returns a new access token', async ({ request }) => {
    const recruiter = await loginStaff(request, E2E.users.recruiterA);
    const refresh = await request.post(`${E2E.apiBaseURL}/auth/refresh`, {
      data: { refreshToken: recruiter.refreshToken },
    });
    expect(refresh.ok(), await refresh.text()).toBeTruthy();
    const body = await refresh.json();
    expect(body.accessToken).toBeTruthy();
  });
});
