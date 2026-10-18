'use client';

import { StaffActions } from '../navigation/StaffActions';
import Link from 'next/link';
import { TopNavigation } from '../navigation/TopNavigation';
import { usePathname } from 'next/navigation';
import React from 'react';

type AdminShellProps = {
  children: React.ReactNode;
  active?: string;
  title?: string;
  subtitle?: string;
};

const navigation = [
  { label: 'Candidatos', href: '/recruiter/dashboard' },
  { label: 'Dashboard', href: '/staff/admin' },
  { label: 'Evaluaciones', href: '/staff/admin/evaluations' },
  { label: 'Test Builder', href: '/staff/admin/test-builder' },
  { label: 'Banco de Reactivos', href: '/staff/admin/item-bank' },
  { label: 'Publicaciones', href: '/staff/admin/publications' },
  { label: 'Usuarios', href: '/staff/admin/users' },
  { label: 'Organizaciones', href: '/staff/admin/organizations' },
  { label: 'Auditoría', href: '/staff/admin/audit' },
  { label: 'Configuración', href: '/staff/admin/settings' },
  { label: 'Sistema', href: '/staff/system' },
];

export function AdminShell({ children, active, title, subtitle }: AdminShellProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="border-b border-slate-800 bg-slate-950/95 lg:sticky lg:top-0 lg:h-screen lg:w-72 lg:border-b-0 lg:border-r">
          <div className="border-b border-slate-800 px-5 py-4"><StaffActions />
            <TopNavigation variant="inline" />
          </div>
          <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-5">
            <img src="/integrity-logo-2.png" alt="Integrity Test" className="h-10 w-10 rounded-lg object-contain" />
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-amber-200">Integrity</p>
              <p className="text-sm font-semibold text-slate-300">Panel Administrativo</p>
            </div>
          </div>
          <nav className="flex gap-2 overflow-x-auto px-4 py-4 lg:flex-col lg:overflow-visible">
            {navigation.map((item) => {
              const isActive = active === item.label || pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                    isActive
                      ? 'border-indigo-400 bg-indigo-500/10 text-indigo-100'
                      : 'border-transparent text-slate-400 hover:border-slate-700 hover:bg-slate-900 hover:text-slate-100'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="hidden px-5 pb-5 text-xs text-slate-500 lg:block">
            <p>Operación SaaS por organización. Todos los datos provienen de APIs protegidas.</p>
          </div>
        </aside>

        <main className="flex-1 px-4 py-6 md:px-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-6">
            {(title || subtitle) && (
              <header className="border-b border-slate-800 pb-5">
                {title && <h1 className="text-2xl font-extrabold text-white md:text-3xl">{title}</h1>}
                {subtitle && <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{subtitle}</p>}
              </header>
            )}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    DRAFT: 'border-slate-700 bg-slate-900 text-slate-300',
    INTERNAL_REVIEW: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
    PSYCHOLOGIST_REVIEW: 'border-violet-500/40 bg-violet-500/10 text-violet-200',
    APPROVED: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    PUBLISHED: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    RETIRED: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
    ACTIVE: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  };
  return <span className={`rounded-md border px-2 py-1 text-[11px] font-bold ${tone[status] || tone.DRAFT}`}>{status}</span>;
}
