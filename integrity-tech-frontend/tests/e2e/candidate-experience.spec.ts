import { expect, test, Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { clearE2ERateLimitKeys } from './fixtures/rate-limit-isolation';
import { E2E, authGet, authPost, createInvitation, loginStaff, countQueuedAnswers } from './fixtures/e2e-data';
const requireBackend = createRequire(resolve(process.cwd(), '../integrity-tech-backend/package.json'));

async function editFictitiousAttempt(id: string, data: { startedAt: Date }) {
  const database = process.env.DATABASE_URL || '';
  if (!new URL(database).pathname.endsWith('_e2e')) throw new Error('Only an isolated E2E database is allowed');
  const { PrismaClient } = requireBackend('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const attempt = await prisma.examAttempt.findUniqueOrThrow({ where: { id }, include: { organization: true } });
    expect(attempt.organization.slug).toBe(E2E.orgA);
    await prisma.examAttempt.update({ where: { id }, data });
  } finally { await prisma.$disconnect(); }
}
async function fixture(request: any, suffix: string) {
  const staff = await loginStaff(request, E2E.users.recruiterA);
  const invitation = await createInvitation(request, staff.accessToken, `${Date.now()}-${suffix}`);
  return { staff, invitation };
}
async function openCandidate(page: Page, invitation: any) {
  await page.goto(`/exam/login?code=${invitation.accessCode}`);
  await expect(page.getByText(invitation.candidateEmail, { exact: true })).toBeVisible();
  const claim = page.waitForResponse(r => r.url().endsWith('/invitations/claim'));
  await page.getByRole('button', { name: 'Continuar al aviso' }).click();
  const candidate = await (await claim).json();
  await expect(page.getByRole('heading', { name: 'Antes de comenzar' })).toBeVisible();
  return candidate;
}
async function answerVisible(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /Pregunta/ })).toBeVisible();
  const radios = page.getByRole('radio');
  if (await radios.count()) await radios.first().locator('..').click();
  else await page.getByRole('button', { name: '3', exact: true }).click();
}
async function answerThree(page: Page) {
  for (let index = 0; index < 3; index++) {
    await answerVisible(page);
    if (index < 2) await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  }
}
test.beforeEach(async () => { await clearE2ERateLimitKeys(); });

test('changed invitation and Enter use exactly the displayed candidate; identity substitution is refused', async ({ page, request }) => {
  const { staff, invitation: a } = await fixture(request, 'code-a');
  const b = await createInvitation(request, staff.accessToken, `${Date.now()}-code-b`);
  const forged = await request.post(`${E2E.apiBaseURL}/evaluations/invitations/claim`, { data: { accessCode: a.accessCode, candidateName: b.candidateName, email: b.candidateEmail } });
  expect(forged.status()).toBe(400);
  await page.goto(`/exam/login?code=${a.accessCode}`);
  await expect(page.getByText(a.candidateEmail, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await page.getByRole('textbox', { name: 'Clave de acceso', exact: true }).fill(b.accessCode);
  await page.getByRole('textbox', { name: 'Clave de acceso', exact: true }).press('Enter');
  await expect(page.getByText(b.candidateEmail, { exact: true })).toBeVisible();
  const claim = page.waitForResponse(r => r.url().endsWith('/invitations/claim'));
  await page.getByRole('button', { name: 'Continuar al aviso' }).click();
  const candidate = await (await claim).json();
  const report = await authGet(request, staff.accessToken, `/evaluations/attempts/${candidate.attemptId}`);
  expect((await report.json()).email).toBe(b.candidateEmail);
  const verifyA = await request.post(`${E2E.apiBaseURL}/evaluations/invitations/verify`, { data: { accessCode: a.accessCode } });
  expect(verifyA.ok()).toBeTruthy();
});

test('consent starts the full timer once; omissions, position, review, delivery and resumption work', async ({ page, request }) => {
  const { staff, invitation } = await fixture(request, 'full-ui');
  const candidate = await openCandidate(page, invitation);
  await editFictitiousAttempt(candidate.attemptId, { startedAt: new Date(Date.now() - 60 * 60_000) });
  const list = await authGet(request, staff.accessToken, '/evaluations/attempts');
  expect((await list.json()).find((r: any) => r.id === candidate.attemptId).statusLabel).toBe('Pendiente de inicio');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Antes de comenzar' })).toBeVisible();
  await expect(page.getByLabel('Tiempo restante')).toHaveCount(0);
  await page.getByRole('button', { name: 'Acepto e iniciar evaluación' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Pregunta 1 de 3/ })).toBeVisible();
  const first = await authGet(request, candidate.token, `/evaluations/attempts/${candidate.attemptId}/session`);
  const before = await first.json();
  expect(Date.parse(before.deadlineAt) - Date.parse(before.serverNow)).toBeGreaterThan(19 * 60_000);
  await authPost(request, candidate.token, `/evaluations/attempts/${candidate.attemptId}/consent`, { consentVersion: 'pilot-consent-v1' });
  const again = await authGet(request, candidate.token, `/evaluations/attempts/${candidate.attemptId}/session`);
  expect((await again.json()).deadlineAt).toBe(before.deadlineAt);
  await answerVisible(page);
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: /Pregunta 2 de 3/ })).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await page.getByRole('button', { name: 'Finalizar y Entregar' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /Faltan 2 preguntas/ })).toBeVisible();
  await answerVisible(page);
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await answerVisible(page);
  await page.getByRole('button', { name: 'Finalizar y Entregar' }).click();
  await expect(page.getByRole('heading', { name: 'Revisa antes de entregar' })).toBeVisible();
  await page.getByRole('button', { name: 'Volver a revisar' }).click();
  await expect(page.getByRole('radio').first()).toBeChecked();
  await page.getByRole('button', { name: 'Finalizar y Entregar' }).click();
  await page.getByRole('button', { name: 'Confirmar entrega', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Evaluación entregada', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Omitir encuesta' }).click();
  await page.goto(`/exam/login?code=${invitation.accessCode}`);
  await page.getByRole('button', { name: 'Reanudar o ver entrega' }).click();
  await expect(page.getByRole('heading', { name: 'Evaluación entregada', exact: true })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await page.getByRole('button', { name: 'Salir de la evaluación' }).click();
  await page.goto(`/exam/${candidate.attemptId}`);
  await expect(page.getByRole('alert').filter({ hasText: /sesión/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Volver al acceso' })).toBeVisible();
  await expect(page.getByText('Falta la cabecera de Autorización.')).toHaveCount(0);
});

test('same-browser original link resumes an in-progress attempt without another claim', async ({ page, request, browser }) => {
  const { invitation } = await fixture(request, 'resume');
  const c = await openCandidate(page, invitation);
  await page.getByRole('button', { name: 'Acepto e iniciar evaluación' }).click();
  await page.getByRole('radio').first().locator('..').click();
  await page.goto(`/exam/login?code=${invitation.accessCode}`);
  await page.getByRole('button', { name: 'Reanudar o ver entrega' }).click();
  await expect(page.getByRole('radio').first()).toBeChecked();
  expect(page.url()).toContain(c.attemptId);
  const other = await browser.newContext();
  try {
    const otherPage = await other.newPage();
    await otherPage.goto(`${E2E.frontendURL}/exam/login?code=${invitation.accessCode}`);
    await expect(otherPage.getByRole('alert').filter({ hasText: /otro navegador/ })).toBeVisible();
    await expect(otherPage.getByRole('button', { name: 'Reanudar o ver entrega' })).toHaveCount(0);
  } finally { await other.close(); }
});

test('connection recovery reconciles a stale session response with a queue that drained during loading', async ({ page, request }) => {
  test.setTimeout(60_000);
  const { invitation } = await fixture(request, 'reconnect');
  const candidate = await openCandidate(page, invitation);
  await page.getByRole('button', { name: 'Acepto e iniciar evaluación' }).click();
  let blocked = true;
  await page.route('**/api/evaluations/attempts/*/submit', async route => {
    if (blocked) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Fictitious temporary failure' }) });
    else await route.continue();
  });
  await answerThree(page);
  await expect.poll(() => countQueuedAnswers(page)).toBe(3);
  await page.getByRole('button', { name: 'Finalizar y Entregar' }).click();
  await page.getByRole('button', { name: 'Confirmar entrega', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /pendientes de guardar/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Evaluación entregada', exact: true })).toHaveCount(0);
  await page.route('**/api/evaluations/attempts/*/session?*', async route => {
    const staleResponse = await route.fetch();
    blocked = false;
    await expect.poll(async () => {
      const r = await authGet(request, candidate.token, `/evaluations/attempts/${candidate.attemptId}/session`);
      return Object.keys((await r.json()).answers).length;
    }, { timeout: 20_000 }).toBe(3);
    await expect.poll(() => countQueuedAnswers(page)).toBe(0);
    await route.fulfill({ response: staleResponse });
  }, { times: 1 });
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: /3 de 3 respondidas/ })).toBeVisible();
  await expect(page.getByRole('radio').first()).toBeChecked();
  await page.getByRole('button', { name: 'Finalizar y Entregar' }).click();
  await page.getByRole('button', { name: 'Confirmar entrega', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Evaluación entregada', exact: true })).toBeVisible();
});

test('initial service failure has a retry action that recovers without a page reload', async ({ page, request }) => {
  const { invitation } = await fixture(request, 'retry');
  const c = await openCandidate(page, invitation);
  await page.route('**/api/evaluations/attempts/*/consent?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Technical details should stay hidden' }) }));
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: /Reintentar/ })).toBeVisible();
  await expect(page.getByText('Technical details should stay hidden')).toHaveCount(0);
  await page.unroute('**/api/evaluations/attempts/*/consent?*');
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByRole('heading', { name: 'Antes de comenzar' })).toBeVisible();
  expect(page.url()).toContain(c.attemptId);
});

test('timer expiry during review keeps received answers and never emits an incomplete score', async ({ page, request }) => {
  const { staff, invitation } = await fixture(request, 'timeout');
  const c = await openCandidate(page, invitation);
  await page.getByRole('button', { name: 'Acepto e iniciar evaluación' }).click();
  await page.getByRole('radio').first().locator('..').click();
  await expect.poll(() => countQueuedAnswers(page)).toBe(0);
  await editFictitiousAttempt(c.attemptId, { startedAt: new Date(Date.now() - 20 * 60_000 + 3000) });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tiempo terminado' })).toBeVisible();
  const report = await authGet(request, staff.accessToken, `/evaluations/attempts/${c.attemptId}`);
  expect((await report.json()).overallScore).toContain('Sin puntuación');
  await expect(page.getByRole('radio')).toHaveCount(0);
});

test('mobile candidate can complete, decline or submit optional feedback, and has no horizontal overflow', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { invitation } = await fixture(request, 'mobile-ui');
  await openCandidate(page, invitation);
  await page.getByRole('link', { name: 'No iniciar ahora' }).click();
  await page.goto(`/exam/login?code=${invitation.accessCode}`);
  await page.getByRole('button', { name: 'Reanudar o ver entrega' }).click();
  await expect(page.getByRole('heading', { name: 'Antes de comenzar' })).toBeVisible();
  await page.getByRole('button', { name: 'Acepto e iniciar evaluación' }).click();
  await answerThree(page);
  await page.getByRole('button', { name: 'Finalizar y Entregar' }).click();
  await page.getByRole('button', { name: 'Confirmar entrega', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Evaluación entregada', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '8', exact: true }).click();
  await expect(page.getByRole('button', { name: '8', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel(/Qué podríamos mejorar/).fill('Opinión ficticia de prueba móvil.');
  await page.getByRole('button', { name: 'Enviar Comentarios' }).click();
  await expect(page.getByRole('heading', { name: '¡Gracias por tu opinión!' })).toBeVisible();
});
