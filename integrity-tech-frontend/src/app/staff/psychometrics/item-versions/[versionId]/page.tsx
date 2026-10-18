'use client';

import { useParams } from 'next/navigation';

import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminShell } from '../../../../../components/staff/AdminShell';

type Notice = { type: 'success' | 'error'; message: string } | null;

const statusTone: Record<string, string> = {
  DRAFT: 'border-slate-700 bg-slate-900 text-slate-300',
  INTERNAL_REVIEW: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
  PSYCHOLOGIST_REVIEW: 'border-violet-500/40 bg-violet-500/10 text-violet-200',
  APPROVED: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  PUBLISHED: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  RETIRED: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
};

function formatDate(value?: string | null) {
  if (!value) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-md border px-2 py-1 text-xs font-bold ${statusTone[status] || statusTone.DRAFT}`}>
      {status}
    </span>
  );
}

function apiError(status: number) {
  const messages: Record<number, string> = {
    401: 'Tu sesión expiró. Inicia sesión nuevamente.',
    403: 'No tienes permisos para revisar este reactivo.',
    404: 'La versión no está disponible.',
    409: 'El estado editorial no permite esta acción.',
  };
  return messages[status] || 'No se pudo completar la operación.';
}

export default function ItemVersionDetailPage() {
  const params = useParams<{ versionId: string }>();
  const [detail, setDetail] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [draftText, setDraftText] = useState('{}');
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);

  const authToken = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('auth-token') || '';
  }, []);

  const apiFetch = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      const res = await fetch(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
          ...(options.headers || {}),
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || apiError(res.status));
      }
      return res.json();
    },
    [authToken],
  );

  const load = useCallback(async () => {
    if (!authToken) {
      setNotice({ type: 'error', message: 'Sesión requerida.' });
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [detailData, historyData] = await Promise.all([
        apiFetch<any>(`/api/psychometric-governance/item-versions/${params.versionId}/detail`),
        apiFetch<any[]>(`/api/psychometric-governance/versions/itemVersion/${params.versionId}/history`),
      ]);
      setDetail(detailData);
      setHistory(historyData);
      setDraftText(
        JSON.stringify(
          {
            stemJson: detailData.stemJson,
            tags: detailData.tags,
            language: detailData.language,
            difficulty: detailData.difficulty,
            discrimination: detailData.discrimination,
            expectedTimeSeconds: detailData.expectedTimeSeconds,
          },
          null,
          2,
        ),
      );
      setNotice(null);
    } catch (error: any) {
      setNotice({ type: 'error', message: error.message || 'No se pudo cargar el detalle.' });
    } finally {
      setIsLoading(false);
    }
  }, [apiFetch, authToken, params.versionId]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (action: string) => {
    let reason: string | undefined;
    if (action === 'publish' && !window.confirm('Publicar hará inmutable esta versión. ¿Continuar?')) return;
    if (action === 'retire' || action === 'return_to_draft') {
      reason = window.prompt(action === 'retire' ? 'Razón obligatoria de retiro:' : 'Comentario obligatorio:') || '';
      if (!reason.trim()) {
        setNotice({ type: 'error', message: 'El comentario es obligatorio para esta acción.' });
        return;
      }
    }

    setIsBusy(true);
    try {
      await apiFetch('/api/psychometric-governance/workflow', {
        method: 'POST',
        body: JSON.stringify({ model: 'itemVersion', versionId: params.versionId, action, reason }),
      });
      setNotice({ type: 'success', message: 'Acción editorial completada.' });
      await load();
    } catch (error: any) {
      setNotice({ type: 'error', message: error.message || 'No se pudo ejecutar la acción.' });
    } finally {
      setIsBusy(false);
    }
  };

  const saveDraft = async () => {
    setIsBusy(true);
    try {
      const parsed = JSON.parse(draftText);
      await apiFetch('/api/psychometric-governance/versions', {
        method: 'PATCH',
        body: JSON.stringify({ model: 'itemVersion', versionId: params.versionId, data: parsed }),
      });
      setNotice({ type: 'success', message: 'Borrador actualizado.' });
      await load();
    } catch (error: any) {
      setNotice({ type: 'error', message: error.message || 'No se pudo guardar el borrador.' });
    } finally {
      setIsBusy(false);
    }
  };

  const editable = detail && ['DRAFT', 'INTERNAL_REVIEW'].includes(detail.status);

  return (
    <AdminShell active="Banco de Reactivos">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-3 border-b border-slate-800 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <Link href="/staff/admin/item-bank" className="text-sm font-semibold text-indigo-300 hover:text-indigo-200">
              Volver a consola
            </Link>
            <h1 className="mt-2 text-2xl font-extrabold text-white">Detalle de versión de reactivo</h1>
            <p className="mt-1 text-sm text-slate-400">{detail?.item?.itemCode || 'ItemVersion'}</p>
          </div>
          {detail && <StatusBadge status={detail.status} />}
        </header>

        {notice && (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              notice.type === 'success'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-100'
            }`}
          >
            {notice.message}
          </div>
        )}

        {isLoading || !detail ? (
          <section className="rounded-lg border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300">
            Cargando detalle...
          </section>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
            <section className="flex flex-col gap-5">
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
                <h2 className="text-lg font-bold text-white">
                  {detail.item.itemCode} · v{detail.version}
                </h2>
                <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                  <Info label="Idioma" value={detail.language || 'Sin idioma'} />
                  <Info label="Tipo" value={detail.stemJson?.type || detail.stemJson?.questionType || 'No especificado'} />
                  <Info label="Competencia" value={detail.item.competency?.name || 'Sin competencia'} />
                  <Info label="Escala" value={detail.item.scale?.name || 'Sin escala'} />
                  <Info label="Subescala" value={detail.item.subscale?.name || 'Sin subescala'} />
                  <Info label="Dificultad" value={String(detail.difficulty ?? 'Sin dato')} />
                  <Info label="Discriminación" value={String(detail.discrimination ?? 'Sin dato')} />
                  <Info label="Tiempo esperado" value={detail.expectedTimeSeconds ? `${detail.expectedTimeSeconds}s` : 'Sin dato'} />
                  <Info label="Autor" value={detail.createdBy?.email || 'No registrado'} />
                  <Info label="Revisor" value={detail.approvedBy?.email || 'No registrado'} />
                </dl>
                <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                  {detail.hasScoringKey
                    ? 'Este reactivo tiene clave de scoring. Los detalles están protegidos y no se muestran en esta consola.'
                    : 'Este reactivo no registra clave de scoring.'}
                </div>
              </div>

              <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
                <h2 className="text-lg font-bold text-white">Contenido del reactivo</h2>
                <pre className="mt-4 max-h-80 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
                  {JSON.stringify(detail.stemJson, null, 2)}
                </pre>
              </section>

              <Readiness readiness={detail.readiness} />
              <Editor editable={editable} value={draftText} onChange={setDraftText} onSave={saveDraft} busy={isBusy} />
            </section>

            <aside className="flex flex-col gap-5">
              <Actions busy={isBusy} onAction={runAction} />
              <History events={history} />
            </aside>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-1 text-slate-200">{value}</dd>
    </div>
  );
}

function Readiness({ readiness }: { readiness: any }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
      <h2 className="text-lg font-bold text-white">Validación para publicación</h2>
      <p className={`mt-2 text-sm font-semibold ${readiness?.ready ? 'text-emerald-300' : 'text-rose-300'}`}>
        {readiness?.ready ? 'Lista para publicar' : 'No lista para publicar'}
      </p>
      <IssueList title="Bloqueos" items={readiness?.blockingIssues || []} tone="rose" />
      <IssueList title="Advertencias" items={readiness?.warnings || []} tone="amber" />
    </section>
  );
}

function IssueList({ title, items, tone }: { title: string; items: string[]; tone: 'rose' | 'amber' }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className={`text-xs font-bold uppercase tracking-wider ${tone === 'rose' ? 'text-rose-300' : 'text-amber-300'}`}>
        {title}
      </h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Editor({
  editable,
  value,
  onChange,
  onSave,
  busy,
}: {
  editable: boolean;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  busy: boolean;
}) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Edición segura de borrador</h2>
          <p className="text-xs text-slate-500">Solo disponible en DRAFT o INTERNAL_REVIEW.</p>
        </div>
        <button
          onClick={onSave}
          disabled={!editable || busy}
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Guardar
        </button>
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={!editable}
        className="mt-4 min-h-56 w-full rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-200 outline-none focus:border-indigo-400 disabled:opacity-60"
      />
    </section>
  );
}

function Actions({ busy, onAction }: { busy: boolean; onAction: (action: string) => void }) {
  const actions = [
    ['request_internal_review', 'Enviar a revisión interna'],
    ['request_psychologist_review', 'Enviar a revisión psicológica'],
    ['approve', 'Aprobar'],
    ['publish', 'Publicar'],
    ['retire', 'Retirar'],
    ['return_to_draft', 'Devolver a borrador'],
  ];
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
      <h2 className="text-lg font-bold text-white">Acciones editoriales</h2>
      <div className="mt-4 flex flex-col gap-2">
        {actions.map(([action, label]) => (
          <button
            key={action}
            onClick={() => onAction(action)}
            disabled={busy}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-left text-sm font-semibold text-slate-200 hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

function History({ events }: { events: any[] }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
      <h2 className="text-lg font-bold text-white">Historial editorial</h2>
      <div className="mt-4 flex flex-col gap-3">
        {events.length === 0 && <p className="text-sm text-slate-400">Sin eventos editoriales registrados.</p>}
        {events.map((event) => (
          <article key={event.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
            <p className="text-sm font-bold text-slate-100">{event.action}</p>
            <p className="mt-1 text-xs text-slate-500">{formatDate(event.createdAt)} · {event.actor?.email || event.actorType}</p>
            <p className="mt-2 text-xs text-slate-400">
              {event.metadata?.from || 'N/A'} → {event.metadata?.to || 'N/A'}
              {event.metadata?.reason ? ` · ${event.metadata.reason}` : ''}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
