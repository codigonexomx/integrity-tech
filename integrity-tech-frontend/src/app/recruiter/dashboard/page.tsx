'use client';
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '../../../services/api-client';
import { StaffActions } from '../../../components/navigation/StaffActions';
import type { AttemptListItem, CreateInvitationResponse } from '../../../generated/api/types';

type Exam = { id: string; title: string };
export default function RecruiterDashboard() {
  const [attempts, setAttempts] = useState<AttemptListItem[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [organization, setOrganization] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ candidateName: '', email: '', examId: '' });
  const [invite, setInvite] = useState<CreateInvitationResponse | null>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const load = useCallback(async () => {
    setError(''); setLoading(true);
    try {
      const [a, e] = await Promise.all([apiClient.get<AttemptListItem[]>('/evaluations/attempts'), apiClient.get<Exam[]>('/exams')]);
      setAttempts(a); setExams(e); setForm(current => ({ ...current, examId: current.examId || e[0]?.id || '' }));
    } catch (e: any) { setAttempts([]); setExams([]); setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    try { setOrganization(JSON.parse(localStorage.getItem('staff-profile') || '{}').organizationName || 'Organización del piloto'); } catch { setOrganization('Organización del piloto'); }
    void load();
  }, [load]);
  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { setInvite(await apiClient.post<CreateInvitationResponse>('/evaluations/invitations', form)); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  const visible = attempts.filter(a => `${a.candidateName} ${a.email}`.toLowerCase().includes(search.toLowerCase()));
  return <main className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-8">
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap justify-between gap-4 border-b border-slate-800 pb-6"><div><p className="text-sm text-indigo-300">{organization}</p><h1 className="text-2xl font-bold">Consola de candidatos</h1><p className="mt-2 text-slate-400">Piloto de práctica: invitaciones, avance y resultados descriptivos.</p></div><StaffActions /></header>
      <p className="rounded-xl border border-indigo-900 bg-indigo-950/30 p-4 text-sm">Las prácticas no determinan aptitud laboral. Cámara y monitoreo de navegación desactivados. <Link href="/ciencia" className="underline">Alcance del piloto</Link></p>
      <div className="grid gap-3 sm:grid-cols-3">{[['Intentos', attempts.length], ['Completados', attempts.filter(a => a.statusLabel === 'Completado').length], ['En curso', attempts.filter(a => a.statusLabel === 'En curso').length]].map(([label, n]) => <div key={label} className="rounded-xl bg-slate-900 p-5"><p className="text-slate-400">{label}</p><p className="text-2xl font-bold">{n}</p></div>)}</div>
      <div className="flex flex-wrap gap-3"><input aria-label="Buscar candidato o correo" placeholder="Buscar candidato o correo..." value={search} onChange={e => setSearch(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 p-3" /><button disabled={loading} onClick={() => void load()} className="rounded-lg border border-slate-700 px-4 py-3">Actualizar</button><button disabled={!exams.length} onClick={() => { setModal(true); setInvite(null); setCopyMessage(''); setError(''); setForm(current => ({ ...current, candidateName: '', email: '' })); }} className="rounded-lg bg-indigo-600 px-4 py-3 disabled:opacity-40">Invitar Candidato</button></div>
      {error && <p role="alert" className="rounded-lg bg-amber-950 p-4 text-amber-100">{error}</p>}
      {loading ? <p>Cargando candidatos…</p> : <div className="grid gap-4 md:grid-cols-2">{visible.length === 0 && <p>No hay candidatos que coincidan con la búsqueda.</p>}{visible.map(a => <article key={a.id} className="min-w-0 space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="text-lg font-bold">{a.candidateName}</h2><p className="break-words text-sm text-slate-400">{a.email}</p><p>{a.assessmentTitle}</p><p className="text-sm">Estado: <strong>{a.statusLabel}</strong></p><p>Puntuación: <strong>{a.overallScore}</strong></p><p className="text-sm text-slate-400">{new Date(a.date).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })} · Monitoreo desactivado</p><Link href={`/recruiter/attempts/${a.id}`} className="inline-block rounded-lg border border-slate-700 px-4 py-2">Ver Reporte</Link></article>)}</div>}
      {modal && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-4"><section role="dialog" aria-modal="true" aria-label="Invitar candidato" className="my-auto w-full max-w-lg space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-6"><h2 className="text-xl font-bold">{invite ? 'Clave de Acceso Generada' : 'Invitar Nuevo Candidato'}</h2>{invite ? <><p>Comparte el enlace por tu canal habitual. No se ha enviado correo automático.</p><p>Candidato: {form.candidateName}</p><p>Clave: <strong>{invite.accessCode}</strong></p><label htmlFor="invite-link">Enlace de acceso</label><input id="invite-link" readOnly value={new URL(invite.directLink, window.location.origin).href} onFocus={e => e.target.select()} className="w-full rounded-lg bg-slate-950 p-3" /><button onClick={async () => { try { await navigator.clipboard.writeText(new URL(invite.directLink, window.location.origin).href); setCopyMessage('Enlace copiado'); } catch { setCopyMessage('Selecciona el enlace y cópialo manualmente.'); } }} className="rounded-lg border border-slate-600 px-4 py-3">Copiar Enlace</button><p role="status">{copyMessage}</p></> : <form onSubmit={create} className="space-y-4"><p className="text-sm text-slate-400">Invita a comprobar el funcionamiento de la evaluación de práctica.</p><label className="block">Nombre del candidato<input required value={form.candidateName} onChange={e => setForm({ ...form, candidateName: e.target.value })} className="mt-1 w-full rounded-lg bg-slate-950 p-3" /></label><label className="block">Correo electrónico<input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="mt-1 w-full rounded-lg bg-slate-950 p-3" /></label><label className="block">Evaluación asignada<select required value={form.examId} onChange={e => setForm({ ...form, examId: e.target.value })} className="mt-1 w-full rounded-lg bg-slate-950 p-3">{exams.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label><button disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-3">{busy ? 'Generando…' : 'Generar Clave de Acceso'}</button></form>}{error && <p role="alert">{error}</p>}<button onClick={() => { setModal(false); void load(); }} className="rounded-lg border border-slate-600 px-4 py-3">Entendido / Cerrar</button></section></div>}
    </div>
  </main>;
}
