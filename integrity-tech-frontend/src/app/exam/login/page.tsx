'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TopNavigation } from '../../../components/navigation/TopNavigation';
import { apiClient, ApiClientError } from '../../../services/api-client';
import { candidateErrorMessage, rememberCandidateInvitation, resumableCandidateAttempt } from '../../../services/candidate-experience';
import type { ClaimInvitationResponse, VerifyInvitationResponse, CandidateConsentResponse } from '../../../generated/api/types';

export default function CandidateLoginPage() {
  return <Suspense fallback={<main className="min-h-screen bg-slate-950 p-8 text-slate-100"><p role="status">Cargando acceso…</p></main>}><CandidateLoginForm /></Suspense>;
}

function CandidateLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [accessCode, setAccessCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [details, setDetails] = useState<(VerifyInvitationResponse & { verifiedCode: string }) | null>(null);
  const [resume, setResume] = useState<{ attemptId: string; title: string } | null>(null);

  async function verify(value: string) {
    const code = value.trim().toUpperCase();
    setDetails(null); setResume(null); setError('');
    if (!/^IT-\d{6}$/.test(code)) { setError('Introduce la clave completa, por ejemplo IT-123456.'); return; }
    setBusy(true);
    try {
      const attemptId = resumableCandidateAttempt(code);
      if (attemptId) {
        const consent = await apiClient.get<CandidateConsentResponse>(`/evaluations/attempts/${attemptId}/consent`);
        setResume({ attemptId, title: consent.evaluation?.title || 'Evaluación asignada' });
      } else {
        const data = await apiClient.post<VerifyInvitationResponse>('/evaluations/invitations/verify', { accessCode: code }, { auth: false });
        setDetails({ ...data, verifiedCode: code });
      }
    } catch (e) {
      setError(e instanceof ApiClientError && [400, 409].includes(e.status)
        ? 'La clave no está disponible. Revisa que sea correcta. Si ya comenzaste en otro navegador, contacta a la organización que te invitó para recuperar el acceso.'
        : candidateErrorMessage(e));
    } finally { setBusy(false); }
  }

  useEffect(() => {
    const code = searchParams.get('code');
    if (code) { setAccessCode(code); void verify(code); }
  }, [searchParams]);

  async function claim() {
    if (!details) return;
    setBusy(true); setError('');
    try {
      const data = await apiClient.post<ClaimInvitationResponse>('/evaluations/invitations/claim', {
        accessCode: details.verifiedCode, candidateName: details.candidateName, email: details.email,
      }, { auth: false });
      localStorage.setItem(`candidate-token:${data.attemptId}`, data.token);
      rememberCandidateInvitation(details.verifiedCode, data.attemptId);
      router.push(`/exam/${data.attemptId}`);
    } catch (e) {
      setError(e instanceof ApiClientError && [400, 409].includes(e.status)
        ? 'No pudimos iniciar con esta clave. Vuelve a verificarla o contacta a la organización que te invitó.' : candidateErrorMessage(e));
    } finally { setBusy(false); }
  }

  return <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-5 pt-20 font-sans [&_button:focus-visible]:outline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-4 [&_button:focus-visible]:outline-indigo-300">
    <TopNavigation />
    <section className="w-full max-w-lg space-y-6 rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8">
      <header><p className="text-sm text-indigo-300">Código Nexo · Integrity Tech</p><h1 className="mt-2 text-2xl font-bold">Acceso a tu evaluación</h1><p className="mt-2 text-sm text-slate-300">Demostración con prácticas ficticias. No determina aptitud laboral.</p></header>
      {error && <p role="alert" className="rounded-lg border border-amber-600 bg-amber-950 p-4 text-amber-100">{error}</p>}
      {resume ? <div className="space-y-4">
        <h2 className="text-lg font-semibold">Puedes continuar en este navegador</h2><p>{resume.title}</p>
        <p className="text-sm text-slate-300">Recupera el intento que ya abriste. Si ya entregaste, verás su confirmación; no se iniciará otro intento.</p>
        <button onClick={() => router.push(`/exam/${resume.attemptId}`)} className="min-h-11 rounded-lg bg-indigo-600 px-5 py-3">Reanudar o ver entrega</button>
        <button onClick={() => { setResume(null); setError(''); }} className="ml-2 min-h-11 rounded-lg border border-slate-600 px-4 py-3">Usar otra clave</button>
      </div> : details ? <div className="space-y-4">
        <h2 className="text-lg font-semibold">Confirma tu invitación</h2>
        <div className="rounded-lg bg-slate-950 p-4"><p className="font-semibold">{details.candidateName}</p><p className="text-sm text-slate-300">{details.email}</p><p className="mt-3">{details.examTitle}</p></div>
        <p className="text-sm text-slate-300">Dispondrás de {details.durationMinutes || 10} minutos para responder. Primero podrás leer el aviso: el tiempo empieza al aceptar e iniciar, no al abrir este enlace.</p>
        <p className="text-sm text-slate-300">Si estos datos no son tuyos, vuelve y revisa la clave antes de continuar.</p>
        <div className="flex flex-wrap gap-3"><button disabled={busy} onClick={() => { setDetails(null); setError(''); }} className="min-h-11 rounded-lg border border-slate-600 px-5 py-3">Volver</button><button disabled={busy} onClick={() => void claim()} className="min-h-11 rounded-lg bg-indigo-600 px-5 py-3 disabled:opacity-50">{busy ? 'Abriendo…' : 'Continuar al aviso'}</button></div>
      </div> : <form onSubmit={event => { event.preventDefault(); void verify(accessCode); }} className="space-y-4">
        <label htmlFor="candidate-access-code" className="block text-sm font-semibold">Clave de acceso</label>
        <p id="access-instructions" className="text-sm text-slate-300">Introduce la clave completa que te compartió la organización, incluido IT-.</p>
        <input id="candidate-access-code" aria-describedby="access-instructions" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="Ej: IT-123456" value={accessCode} onChange={e => { setAccessCode(e.target.value); setDetails(null); setResume(null); setError(''); }} className="min-h-12 w-full rounded-lg border border-slate-600 bg-slate-950 p-3 text-base uppercase focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        <button type="submit" disabled={busy} className="min-h-11 w-full rounded-lg bg-indigo-600 px-5 py-3 disabled:opacity-50">{busy ? 'Verificando…' : error ? 'Reintentar' : 'Verificar Acceso'}</button>
      </form>}
      <aside className="space-y-2 border-t border-slate-700 pt-4 text-sm text-slate-300"><p>Sin cámara ni monitoreo de navegación.</p><p>¿Necesitas ayuda? Contacta a la organización por el mismo medio en que recibiste la invitación. Si ya comenzaste, usa este mismo navegador y no borres sus datos.</p></aside>
    </section>
  </main>;
}
