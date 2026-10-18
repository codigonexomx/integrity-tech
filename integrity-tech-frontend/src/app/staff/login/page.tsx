'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import { apiClient, ApiClientError } from '../../../services/api-client';

type LoginResponse = { accessToken: string; refreshToken: string; user: { email: string; roles: string[]; permissions: string[]; organizationName: string } };

export default function StaffLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationSlug, setOrganizationSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const session = await apiClient.post<LoginResponse>('/auth/login', {
        email,
        password,
        organizationSlug: organizationSlug.trim() || undefined,
      }, { auth: false });
      localStorage.setItem('auth-token', session.accessToken);
      localStorage.setItem('refresh-token', session.refreshToken);
      localStorage.setItem('staff-profile', JSON.stringify({ organizationName: session.user.organizationName, permissions: session.user.permissions }));
      const permissions = session.user.permissions || [];
      window.location.assign(permissions.includes('admin.manage') ? '/staff/admin' : permissions.includes('attempts.read') ? '/recruiter/dashboard' : '/staff/psychometrics');
    } catch (err: any) {
      if (err instanceof ApiClientError) setError(err.message);
      else setError(err.message || 'No se pudo iniciar sesión.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
      <form onSubmit={submit} className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <Link href="/" className="text-sm font-semibold text-indigo-300 hover:text-indigo-200">Volver</Link>
        <h1 className="mt-4 text-2xl font-extrabold text-white">Acceso Staff</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">Ingresa con credenciales de administrador, psicóloga, evaluador o reclutador.</p>

        <label htmlFor="staff-email" className="mt-6 block text-xs font-bold uppercase tracking-wider text-slate-500">Correo</label>
        <input id="staff-email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-400" />

        <label htmlFor="staff-password" className="mt-4 block text-xs font-bold uppercase tracking-wider text-slate-500">Contraseña</label>
        <input id="staff-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} type="password" required className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-400" />

        <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-slate-500">Organización</label>
        <input value={organizationSlug} onChange={(e) => setOrganizationSlug(e.target.value)} placeholder="slug opcional" className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-400" />

        {error && <p className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</p>}

        <button disabled={loading} className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-500 disabled:opacity-60">
          {loading ? 'Validando...' : 'Entrar al panel'}
        </button>
      </form>
    </main>
  );
}
