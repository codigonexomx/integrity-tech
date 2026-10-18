'use client';

import { useParams } from 'next/navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useExamStore } from '../../../store/exam.store';
import { useSecureTimer } from '../../../hooks/useSecureTimer';
import { syncEngine } from '../../../services/sync-engine';
import { QuestionRenderer } from '../../../components/exam/QuestionRenderer';
import { FeedbackLayer } from '../../../components/exam/FeedbackLayer';
import { apiClient } from '../../../services/api-client';
import type { CandidateConsentResponse, ExamSessionResponse } from '../../../generated/api/types';

export default function ExamTakingPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const answers = useExamStore(s => s.answers);
  const isOffline = useExamStore(s => s.isOffline);
  const [session, setSession] = useState<ExamSessionResponse | null>(null);
  const [consented, setConsented] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState(false);
  const [pending, setPending] = useState(0);
  const closing = useRef(false);

  const load = useCallback(async () => {
    const data = await apiClient.get<ExamSessionResponse>(`/evaluations/attempts/${attemptId}/session`);
    const queued = await syncEngine?.pendingAnswers(attemptId) || [];
    const restored = { ...(data.answers || {}), ...Object.fromEntries(queued.map(a => [a.questionId, a.response])) };
    // Server and durable local queue are authoritative; do not reuse another attempt's store.
    useExamStore.setState({ attemptId, examId: data.exam.id, answers: restored, status: data.status === 'COMPLETED' || data.status === 'SUBMITTED' ? 'SUBMITTED' : data.status === 'EXPIRED' ? 'EXPIRED' : 'IN_PROGRESS' });
    setSession(data);
    setPending(queued.length);
  }, [attemptId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!useExamStore.persist.hasHydrated()) await new Promise<void>(resolve => {
          const off = useExamStore.persist.onFinishHydration(() => { off(); resolve(); });
        });
        const consent = await apiClient.get<CandidateConsentResponse>(`/evaluations/attempts/${attemptId}/consent`);
        if (!active) return;
        setConsented(consent.accepted);
        if (consent.accepted) await load();
      } catch (e: any) { if (active) setError(e.message || 'No se pudo abrir la evaluación.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [attemptId, load]);

  useEffect(() => {
    const interval = setInterval(() => { syncEngine?.pendingAnswers(attemptId).then(q => setPending(q.length)); }, 500);
    return () => clearInterval(interval);
  }, [attemptId]);

  async function accept() {
    setBusy(true); setError('');
    try {
      await apiClient.post(`/evaluations/attempts/${attemptId}/consent`, { consentVersion: 'pilot-consent-v1' });
      setConsented(true); await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  const missing = session?.questions.filter(q => !answers[q.id] || (typeof answers[q.id].text === 'string' && !answers[q.id].text.trim())) || [];
  async function finish(expired = false) {
    if (closing.current) return;
    setError('');
    if (!expired && missing.length) {
      setError(`Faltan ${missing.length} preguntas por responder. Completa todas antes de entregar.`);
      setIndex(session!.questions.findIndex(q => q.id === missing[0].id));
      return;
    }
    closing.current = true; setBusy(true);
    try {
      if (!expired && await syncEngine?.flushAnswers(10000, attemptId) === false) throw new Error('Hay respuestas pendientes de guardar. Revisa tu conexión y vuelve a entregar. Tus respuestas permanecen en este equipo.');
      const result = await apiClient.post<{ status: string }>(`/evaluations/attempts/${attemptId}/finalize`);
      useExamStore.getState().setStatus(result.status === 'COMPLETED' ? 'SUBMITTED' : 'EXPIRED');
      setSession(current => current && ({ ...current, status: result.status }));
      setFeedback(!expired && result.status === 'COMPLETED');
    } catch (e: any) { setError(e.message || 'No se pudo confirmar la entrega. Inténtalo nuevamente.'); }
    finally { setBusy(false); closing.current = false; }
  }

  const timer = useSecureTimer({ initialServerTimeMs: Date.parse(session?.serverNow || '') || 0, endTimeMs: Date.parse(session?.deadlineAt || '') || 0,
    enabled: session?.status === 'IN_PROGRESS', onTimeUp: () => {
      setSession(current => current && ({ ...current, status: 'EXPIRED' }));
      void finish(true);
    } });
  const terminal = session?.status === 'COMPLETED' || session?.status === 'EXPIRED' || session?.status === 'SUBMITTED';

  return <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8">
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div><p className="text-sm text-indigo-300">Integrity Tech · Piloto de práctica</p><h1 className="text-xl font-bold">{session?.exam.title || 'Evaluación asignada'}</h1></div>
        {session && !terminal && <p className="font-mono" aria-label="Tiempo restante">Restan: {timer.formattedTime}</p>}
      </header>
      {loading ? <p>Cargando evaluación…</p> : <>
        {error && <p role="alert" className="rounded-lg border border-amber-600 bg-amber-950 p-4 text-amber-100">{error}</p>}
        {!consented && !error && <section className="rounded-xl bg-slate-900 p-6 space-y-4">
          <h2 className="text-xl font-bold">Consentimiento informado</h2>
          <p>Acepto participar en un piloto para comprobar el funcionamiento de la plataforma. Las prácticas incluidas no miden aptitud laboral.</p>
          <p>Acepto registrar mis respuestas y los datos asociados al intento para generar reportes descriptivos accesibles a la organización que me invitó.</p>
          <p>La cámara y la telemetría de navegación están desactivadas. Se conserva el registro técnico necesario para operar la evaluación.</p>
          <p>Los reportes no determinan honestidad ni aptitud y no deben utilizarse para aceptar o rechazar candidatos.</p>
          <p className="text-sm text-slate-400">Versión: pilot-consent-v1</p>
          <button disabled={busy} onClick={accept} className="rounded-lg bg-indigo-600 px-5 py-3">{busy ? 'Registrando…' : 'Acepto y continuar'}</button>
        </section>}
        {terminal ? <section className="rounded-xl bg-slate-900 p-6 space-y-4">
          <h2 className="text-xl font-bold">{session.status === 'COMPLETED' ? 'Examen Entregado' : session.status === 'EXPIRED' ? 'Tiempo terminado' : 'Entrega pendiente de revisión'}</h2>
          <p>{session.status === 'COMPLETED' ? 'La entrega está confirmada. Tus respuestas y el resultado están guardados y no pueden modificarse.' : 'Se conservaron las respuestas recibidas. No se publica una puntuación incompleta. Contacta a la organización que te invitó si necesitas ayuda.'}</p>
          {pending > 0 && <p role="status">Quedan {pending} respuestas locales sin confirmar; no forman parte de un resultado confirmado.</p>}
          {feedback && <><button onClick={() => setFeedback(false)} className="rounded-lg border border-slate-600 px-4 py-3">Omitir encuesta</button><FeedbackLayer attemptId={attemptId} onFeedbackSubmitted={() => setFeedback(false)} /></>}
          <button onClick={() => { localStorage.removeItem(`candidate-token:${attemptId}`); useExamStore.getState().resetExam(); window.location.replace('/exam/login'); }} className="inline-block rounded-lg border border-slate-600 px-4 py-3">Salir de la evaluación</button>
        </section> : session && <>
          <p role="status" className="text-sm text-slate-300">{isOffline ? 'Modo Offline · las respuestas se guardan en este equipo' : pending ? `${pending} respuestas pendientes de sincronización` : 'Respuestas guardadas'} · Pregunta {index + 1} de {session.questions.length}</p>
          <fieldset disabled={busy}><QuestionRenderer question={session.questions[index]} /></fieldset>
          <div className="flex flex-wrap justify-between gap-3">
            <button disabled={index === 0 || busy} onClick={() => setIndex(n => n - 1)} className="rounded-lg border border-slate-700 px-5 py-3 disabled:opacity-40">Anterior</button>
            {index < session.questions.length - 1 ? <button onClick={() => setIndex(n => n + 1)} className="rounded-lg bg-slate-800 px-5 py-3">Siguiente</button> : <button disabled={busy} onClick={() => void finish()} className="rounded-lg bg-indigo-600 px-5 py-3 disabled:opacity-40">{busy ? 'Confirmando entrega…' : 'Finalizar y Entregar'}</button>}
          </div>
        </>}
      </>}
    </div>
  </main>;
}
