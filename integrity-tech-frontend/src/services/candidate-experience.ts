export function candidateErrorMessage(error: unknown) {
  const status = (error as { status?: number })?.status;
  if (status === 401 || status === 403) return 'No pudimos validar tu sesión. Vuelve al acceso o contacta a la organización que te invitó.';
  if (status === 404) return 'Esta evaluación no está disponible. Contacta a la organización que te invitó.';
  if (status === 429) return 'Hay demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
  return 'No pudimos conectar con la evaluación. Comprueba tu conexión y pulsa Reintentar. No borres los datos de este navegador.';
}

// A queue can drain after a session snapshot was taken. Retain the durable
// local answers for THIS attempt, never those of a previous candidate.
export function reconcileCandidateAnswers(
  attemptId: string,
  server: Record<string, any>,
  local: { attemptId: string | null; answers: Record<string, any> },
  queuedBefore: { questionId: string; response: any }[],
  queuedAfter: { questionId: string; response: any }[],
) {
  return {
    ...server,
    ...Object.fromEntries(queuedBefore.map(a => [a.questionId, a.response])),
    ...(local.attemptId === attemptId ? local.answers : {}),
    ...Object.fromEntries(queuedAfter.map(a => [a.questionId, a.response])),
  };
}

export function rememberCandidateInvitation(code: string, attemptId: string) {
  localStorage.setItem(`candidate-invitation:${code.trim().toUpperCase()}`, attemptId);
}

export function resumableCandidateAttempt(code: string) {
  const id = localStorage.getItem(`candidate-invitation:${code.trim().toUpperCase()}`);
  return id && /^[a-f\d-]{36}$/i.test(id) && localStorage.getItem(`candidate-token:${id}`) ? id : null;
}

// Synchronous write-ahead copy: a tab can close before IndexedDB opens or
// commits. Keep it until the attempt is explicitly left, including after a
// 202 acknowledgement whose server-side processing is still in flight.
export function readCandidateAnswers(attemptId: string): Record<string, any> {
  const text = localStorage.getItem(`candidate-answers:${attemptId}`);
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function saveCandidateAnswer(attemptId: string, questionId: string, response: unknown) {
  localStorage.setItem(`candidate-answers:${attemptId}`, JSON.stringify({ ...readCandidateAnswers(attemptId), [questionId]: response }));
}
