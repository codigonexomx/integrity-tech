'use client';
import { useState } from 'react';
import Link from 'next/link';
import { apiClient } from '../../services/api-client';

export function StaffActions() {
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try { await apiClient.post('/auth/logout', { refreshToken: localStorage.getItem('refresh-token') || '' }); }
    finally {
      localStorage.removeItem('auth-token'); localStorage.removeItem('refresh-token'); localStorage.removeItem('staff-profile');
      window.location.replace('/staff/login');
    }
  }
  return <div className="flex flex-wrap gap-3 text-sm"><Link href="/recruiter/dashboard" className="rounded-lg border border-slate-700 px-4 py-2">Candidatos</Link><button disabled={busy} onClick={logout} className="rounded-lg border border-slate-700 px-4 py-2">{busy ? 'Cerrando…' : 'Cerrar sesión'}</button></div>;
}
