'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useExamStore } from '../../../store/exam.store';
import { useSecureTimer } from '../../../hooks/useSecureTimer';
import { syncEngine } from '../../../services/sync-engine';
import { QuestionRenderer } from '../../../components/exam/QuestionRenderer';
import { FeedbackLayer } from '../../../components/exam/FeedbackLayer';
import { apiClient } from '../../../services/api-client';
import { candidateErrorMessage, readCandidateAnswers, reconcileCandidateAnswers } from '../../../services/candidate-experience';
import type { CandidateConsentResponse, ExamSessionResponse } from '../../../generated/api/types';

export default function ExamTakingPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const answers = useExamStore(s => s.answers);
  const isOffline = useExamStore(s => s.isOffline);
  const [session, setSession] = useState<ExamSessionResponse | null>(null);
  const [preview, setPreview] = useState<CandidateConsentResponse['evaluation']>();
  const [consented, setConsented] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState(false);
  const [pending, setPending] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const closing = useRef(false);
  const requestVersion = useRef(0);
  const initializationVersion = useRef(0);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const questionHeading = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    const before = await syncEngine?.pendingAnswers(attemptId) || [];
    const data = await apiClient.get<ExamSessionResponse>(`/evaluations/attempts/${attemptId}/session`);
    if (version !== requestVersion.current) return;
    const cached = readCandidateAnswers(attemptId);
    const pendingNow = await syncEngine?.pendingAnswers(attemptId) || [];
    if (data.status === 'IN_PROGRESS') {
      for (const question of data.questions) {
        if (cached[question.id] && !pendingNow.some(a => a.questionId === question.id)
          && JSON.stringify(cached[question.id]) !== JSON.stringify(data.answers?.[question.id])) {
          await syncEngine?.queueAnswer(attemptId, question.id, cached[question.id], undefined, question.itemVersionId);
        }
      }
    }
    const after = await syncEngine?.pendingAnswers(attemptId) || [];
    if (version !== requestVersion.current) return;
    useExamStore.setState(local => ({ attemptId, examId: data.exam.id,
      answers: reconcileCandidateAnswers(attemptId, data.answers || {}, { attemptId, answers: { ...cached, ...(local.attemptId === attemptId ? local.answers : {}) } }, before, after),
      status: data.status === 'COMPLETED' || data.status === 'SUBMITTED' ? 'SUBMITTED' : data.status === 'EXPIRED' ? 'EXPIRED' : 'IN_PROGRESS',
    }));
    setSession(data); setPending(after.length);
    const position = Number(localStorage.getItem(`candidate-position:${attemptId}`) || 0);
    setIndex(Number.isInteger(position) ? Math.max(0, Math.min(position, data.questions.length - 1)) : 0);
  }, [attemptId]);

  const initialize = useCallback(async () => {
    const version = ++initializationVersion.current;
    setLoading(true); setError('');
    try {
      if (!useExamStore.persist.hasHydrated()) await new Promise<void>(resolve => {
        const off = useExamStore.persist.onFinishHydration(() => { off(); resolve(); });
      });
      const consent = await apiClient.get<CandidateConsentResponse>(`/evaluations/attempts/${attemptId}/consent`);
      if (version !== initializationVersion.current) return;
      setPreview(consent.evaluation); setConsented(consent.accepted);
      if (consent.accepted) await load();
    } catch (e) { if (version === initializationVersion.current) setError(candidateErrorMessage(e)); }
    finally { if (version === initializationVersion.current) setLoading(false); }
  }, [attemptId, load]);

  useEffect(() => {
    setSession(null); setConfirming(false);
    void initialize();
    const invalidateRequests = () => { requestVersion.current++; initializationVersion.current++; };
    return invalidateRequests;
  }, [initialize]);

  useEffect(() => {
    let active = true;
    const interval = setInterval(() => {
      syncEngine?.pendingAnswers(attemptId).then(q => { if (active) setPending(q.length); }).catch(() => {
        if (active) setError('No pudimos comprobar el guardado en este navegador. No cierres la página y contacta a la organización que te invitó.');
      });
    }, 500);
    return () => { active = false; clearInterval(interval); };
  }, [attemptId]);

  useEffect(() => { if (confirming) reviewHeading.current?.focus(); }, [confirming]);

  function navigate(position: number) {
    setIndex(position); localStorage.setItem(`candidate-position:${attemptId}`, String(position));
    setError(''); questionHeading.current?.focus();
  }

  async function accept() {
    setBusy(true); setError('');
    try {
      await apiClient.post(`/evaluations/attempts/${attemptId}/consent`, { consentVersion: 'pilot-consent-v1' });
      setConsented(true); await load();
    } catch (e) { setError(candidateErrorMessage(e)); } finally { setBusy(false); }
  }

  const missing = session?.questions.filter(q => !answers[q.id] || (typeof answers[q.id].text === 'string' && !answers[q.id].text.trim())) || [];
  function review() {
    setError('');
    if (missing.length) {
      navigate(session!.questions.findIndex(q => q.id === missing[0].id));
      setError(missing.length === 1 ? 'Falta 1 pregunta por responder. Complétala antes de entregar.' : `Faltan ${missing.length} preguntas por responder. Completa todas antes de entregar.`);
      return;
    }
    setConfirming(true);
  }
  async function finish(expired = false) {
    if (closing.current) return;
    closing.current = true; setBusy(true); setError('');
    try {
      if (!expired && await syncEngine?.flushAnswers(10000, attemptId) === false) {
        setError('Hay respuestas pendientes de guardar. Revisa tu conexión y vuelve a entregar. Tus respuestas permanecen en este equipo.');
        return;
      }
      const result = await apiClient.post<{ status: string }>(`/evaluations/attempts/${attemptId}/finalize`);
      useExamStore.getState().setStatus(result.status === 'COMPLETED' ? 'SUBMITTED' : 'EXPIRED');
      setSession(current => current && ({ ...current, status: result.status }));
      setFeedback(!expired && result.status === 'COMPLETED'); setConfirming(false);
    } catch (e) { setError(candidateErrorMessage(e)); }
    finally { setBusy(false); closing.current = false; }
  }

  const timer = useSecureTimer({ initialServerTimeMs: Date.parse(session?.serverNow || '') || 0, endTimeMs: Date.parse(session?.deadlineAt || '') || 0,
    enabled: session?.status === 'IN_PROGRESS', onTimeUp: () => {
      setSession(current => current && ({ ...current, status: 'EXPIRED' })); setConfirming(false);
      void finish(true);
    } });
  const terminal = session?.status === 'COMPLETED' || session?.status === 'EXPIRED' || session?.status === 'SUBMITTED';
  const answeredCount = (session?.questions.length || 0) - missing.length;

  return <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 [&_button:focus-visible]:outline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-4 [&_button:focus-visible]:outline-indigo-300">
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div><p className="text-sm text-indigo-300">Código Nexo · Integrity Tech</p><h1 className="text-xl font-bold">{session?.exam.title || preview?.title || 'Evaluación asignada'}</h1></div>
        {session && !terminal && <p className="font-mono" aria-label="Tiempo restante">Restan: {timer.formattedTime}</p>}
      </header>
      {loading ? <p role="status">Cargando evaluación…</p> : <>
        {error && <div role="alert" className="space-y-3 rounded-lg border border-amber-600 bg-amber-950 p-4 text-amber-100"><p>{error}</p>
          {!session && <div className="flex flex-wrap gap-3"><button disabled={busy} onClick={() => void initialize()} className="min-h-11 rounded-lg border border-amber-300 px-4 py-3">Reintentar</button><Link href="/exam/login" className="inline-block min-h-11 rounded-lg border border-amber-300 px-4 py-3">Volver al acceso</Link></div>}
          {terminal && session?.status === 'EXPIRED' && <button disabled={busy} onClick={() => void finish(true)} className="min-h-11 rounded-lg border border-amber-300 px-4 py-3">Reintentar cierre</button>}
        </div>}
        {!consented && !error && <section className="rounded-xl bg-slate-900 p-6 space-y-4">
          <h2 className="text-xl font-bold">Antes de comenzar</h2>
          <p>{preview?.questionCount ? `${preview.questionCount} preguntas` : 'Cuestionario asignado'} · {preview?.durationMinutes || 10} minutos para responder. El tiempo empieza al pulsar «Acepto e iniciar evaluación».</p>
          <ul className="list-disc space-y-2 pl-5 text-slate-300"><li>Puedes volver a las preguntas y corregir tus respuestas antes de entregar.</li><li>Debes responder todas las preguntas para confirmar una entrega completa. No podrás modificarla después.</li><li>Si la conexión falla, conserva esta página y este navegador. La entrega requiere confirmación del servidor; el tiempo continúa corriendo.</li><li>No se solicita cámara ni micrófono.</li></ul>
          <h3 className="text-lg font-semibold">Consentimiento informado</h3>
          <p>Acepto participar en una demostración con prácticas ficticias para comprobar el funcionamiento de la plataforma. No miden aptitud laboral.</p>
          <p>Acepto registrar mis respuestas y los datos asociados al intento para generar reportes descriptivos accesibles a la organización que me invitó.</p>
          <p>La cámara y la telemetría de navegación están desactivadas. Se conserva el registro técnico necesario para operar la evaluación.</p>
          <p>Los reportes no determinan honestidad ni aptitud y no deben utilizarse para aceptar o rechazar candidatos.</p>
          <p className="text-sm text-slate-300">Aviso de demostración: pilot-consent-v1. Para un proceso real deben acordarse previamente el responsable y las condiciones de datos.</p>
          <div className="flex flex-wrap gap-3"><button disabled={busy} onClick={() => void accept()} className="min-h-11 rounded-lg bg-indigo-600 px-5 py-3 disabled:opacity-50">{busy ? 'Iniciando…' : 'Acepto e iniciar evaluación'}</button><Link href="/exam/login" className="inline-block min-h-11 rounded-lg border border-slate-600 px-4 py-3">No iniciar ahora</Link></div>
        </section>}
        {terminal ? <section className="rounded-xl bg-slate-900 p-6 space-y-4">
          <h2 className="text-xl font-bold">{session.status === 'COMPLETED' ? 'Evaluación entregada' : session.status === 'EXPIRED' ? 'Tiempo terminado' : 'Entrega pendiente de revisión'}</h2>
          <p>{session.status === 'COMPLETED' ? 'La entrega está confirmada. Tus respuestas y el resultado están guardados y no pueden modificarse. Ya puedes cerrar esta página.' : 'Se conservaron las respuestas recibidas. No se publica una puntuación incompleta. Contacta a la organización que te invitó si necesitas ayuda.'}</p>
          {pending > 0 && <p role="status">Quedan {pending} respuestas locales sin confirmar; no forman parte de un resultado confirmado. No borres los datos de este navegador y contacta a la organización.</p>}
          {feedback && <><button onClick={() => setFeedback(false)} className="min-h-11 rounded-lg border border-slate-600 px-4 py-3">Omitir encuesta</button><FeedbackLayer attemptId={attemptId} onFeedbackSubmitted={() => setFeedback(false)} /></>}
          <button onClick={() => { localStorage.removeItem(`candidate-token:${attemptId}`); if (!pending) localStorage.removeItem(`candidate-answers:${attemptId}`); useExamStore.getState().resetExam(); window.location.replace('/exam/login'); }} className="min-h-11 inline-block rounded-lg border border-slate-600 px-4 py-3">Salir de la evaluación</button>
        </section> : session && <>
          <p role="status" className="text-sm text-slate-300">{isOffline ? 'Sin conexión · respuestas guardadas en este equipo' : pending ? `${pending} ${pending === 1 ? 'respuesta pendiente' : 'respuestas pendientes'} de sincronización` : 'Sin respuestas pendientes de sincronización'} · {answeredCount} de {session.questions.length} respondidas · Pregunta {index + 1} de {session.questions.length}</p>
          {confirming ? <section role="region" aria-labelledby="review-heading" className="rounded-xl border border-indigo-400 bg-slate-900 p-6 space-y-4">
            <h2 id="review-heading" ref={reviewHeading} tabIndex={-1} className="text-xl font-bold">Revisa antes de entregar</h2>
            <p>Has respondido {answeredCount} de {session.questions.length} preguntas. Al confirmar no podrás cambiar las respuestas. El tiempo continúa corriendo.</p>
            {pending > 0 && <p>Esperaremos la confirmación de tus respuestas antes de completar la entrega.</p>}
            <div className="flex flex-wrap gap-3"><button disabled={busy} onClick={() => { setConfirming(false); setError(''); }} className="min-h-11 rounded-lg border border-slate-600 px-5 py-3">Volver a revisar</button><button disabled={busy} onClick={() => void finish()} className="min-h-11 rounded-lg bg-indigo-600 px-5 py-3 disabled:opacity-50">{busy ? 'Confirmando entrega…' : 'Confirmar entrega'}</button></div>
          </section> : <>
            <h2 ref={questionHeading} tabIndex={-1} className="sr-only">Pregunta {index + 1} de {session.questions.length}</h2>
            <fieldset disabled={busy}><QuestionRenderer question={session.questions[index]} /></fieldset>
            <div className="flex flex-wrap justify-between gap-3"><button disabled={index === 0 || busy} onClick={() => navigate(index - 1)} className="min-h-11 rounded-lg border border-slate-700 px-5 py-3 disabled:opacity-40">Anterior</button>
              {index < session.questions.length - 1 ? <button disabled={busy} onClick={() => navigate(index + 1)} className="min-h-11 rounded-lg bg-slate-800 px-5 py-3">Siguiente</button> : <button disabled={busy} onClick={review} className="min-h-11 rounded-lg bg-indigo-600 px-5 py-3 disabled:opacity-40">Finalizar y Entregar</button>}
            </div>
          </>}
        </>}
      </>}
      <aside className="border-t border-slate-800 pt-4 text-sm text-slate-300"><p>¿Necesitas ayuda? Contacta a la organización por el mismo medio en que recibiste la invitación.</p><p className="mt-2">Para volver a este intento, abre el enlace original en este mismo navegador. No borres sus datos mientras haya respuestas pendientes.</p></aside>
    </div>
  </main>;
}
