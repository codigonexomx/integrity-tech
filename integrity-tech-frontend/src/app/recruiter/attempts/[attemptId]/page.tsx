'use client';

import { StaffActions } from '../../../../components/navigation/StaffActions';
import { useParams } from 'next/navigation';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { TopNavigation } from '../../../../components/navigation/TopNavigation';
import { apiClient } from '../../../../services/api-client';
import type { AttemptReportResponse } from '../../../../generated/api/types';

export default function CandidateAttemptReport() {
  const params = useParams<{ attemptId: string }>();
  const attemptId = params.attemptId;
  const [report, setReport] = useState<AttemptReportResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    apiClient.get<AttemptReportResponse>(`/evaluations/attempts/${attemptId}`)
      .then(data => { if (active) setReport(data); })
      .catch(() => { if (active) setReport(null); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [attemptId]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <TopNavigation />
        <div className="text-sm text-slate-500 font-medium">Cargando reporte de evaluación...</div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 pt-20">
        <TopNavigation />
        <div className="max-w-md bg-slate-900 border border-slate-800 rounded-xl p-6 text-center">
          <StaffActions /><h1 className="text-lg font-bold text-white">Reporte no disponible</h1>
          <p className="text-sm text-slate-400 mt-2">No hay datos reales disponibles para este intento o tu sesión no tiene permisos.</p>
          <Link href="/recruiter/dashboard" className="inline-flex mt-5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold">
            Volver al dashboard
          </Link>
        </div>
      </div>
    );
  }

  const allAlerts = report.alerts || [];
  const trace = report.governanceTrace;
  const recordedVersion = trace && typeof trace === 'object' && 'assessmentVersionId' in trace && typeof trace.assessmentVersionId === 'string' ? trace.assessmentVersionId : null;
  const reportDimensions = report.dimensions || [];
  const integrityProfile = (report as any).integrityProfile;
  const reportProctoringLogs = report.proctoringLogs || [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-8 pt-20">
      <TopNavigation />
      <div className="max-w-6xl mx-auto flex flex-col gap-8"><StaffActions />
        
        {/* ENCABEZADO DE NAVEGACION */}
        <div className="flex items-center gap-4">
          <Link
            href="/recruiter/dashboard"
            className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white">Reporte de Evaluación</h1>
            <p className="text-xs text-slate-500">ID del Intento: {attemptId}</p>
          </div>
        </div>

        {/* DISEÑO EN DOS COLUMNAS */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* COLUMNA IZQUIERDA: PERFIL PSICOMÉTRICO (Ancho 2/3) */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            
            {/* CARD PRINCIPAL CANDIDATO */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl flex flex-col gap-6 shadow-md">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h2 className="text-xl font-bold text-white leading-tight">{report.candidateName}</h2>
                  <p className="text-xs text-slate-400 mt-1">{report.email}</p>
                </div>

                <p className="text-xs text-slate-400">Reporte descriptivo del piloto</p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-800/60 pt-5">
                {/* Panel 1: Info del Examen */}
                <div className="bg-slate-950 border border-slate-850 p-4 rounded-xl flex flex-col justify-center">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Batería Asignada</p>
                  <p className="text-xs font-semibold text-indigo-400 mt-1.5">{report.assessmentTitle}</p>
                </div>

                {/* Panel 2: Semáforo / Adecuación */}
                <div className="border border-slate-800 p-4 rounded-xl flex flex-col justify-center text-slate-300">
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">Uso del resultado</p>
                  <p className="text-xs font-bold mt-1.5">Sin recomendación automática de contratación</p>
                </div>

                {/* Panel 3: Puntuación Global */}
                <div className="bg-indigo-950/20 border border-indigo-900/40 p-4 rounded-xl flex flex-col justify-center relative overflow-hidden">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Puntuación</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">Suma de reactivos</p>
                    </div>
                    <span className="text-sm font-semibold text-indigo-300">{report.overallScore}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ALERTAS CRÍTICAS DE BAREMACIÓN */}
            {allAlerts.length > 0 && (
              <div className="flex flex-col gap-2.5 bg-red-950/20 border border-red-900/40 p-4 rounded-xl text-xs text-red-400 font-medium">
                {allAlerts.map((alert: string, aIdx: number) => (
                  <div key={aIdx} className="flex items-start gap-2">
                    <span>⚠️</span>
                    <span>{alert}</span>
                  </div>
                ))}
              </div>
            )}


            {integrityProfile?.notice && <p role="status" className="mb-4 rounded-lg border border-amber-500/40 bg-amber-950/30 p-4 text-sm text-amber-200">{integrityProfile.notice}</p>}
            {integrityProfile?.usable && (
              <div className="bg-slate-900 border border-slate-900 p-6 rounded-xl flex flex-col gap-6 shadow-md">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Perfil de Integridad Laboral</h3>
                  <p className="text-xs text-slate-500 mt-1">Puntajes sumatorios por dimensión. No utiliza percentiles ni baremos.</p>
                </div>

                <div className="rounded-xl border border-indigo-900/40 bg-indigo-950/20 p-4">
                  <div className="flex justify-between items-center text-sm font-semibold">
                    <span className="text-slate-200">{integrityProfile.global.name}</span>
                    <span className="font-mono text-indigo-300">{integrityProfile.global.score}/{integrityProfile.global.maxScore}</span>
                  </div>
                  <div className="mt-3 h-3 w-full overflow-hidden rounded-full border border-slate-900/50 bg-slate-950">
                    <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${integrityProfile.global.percentage}%` }} />
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-slate-400">{integrityProfile.global.description}</p>
                </div>

                <div className="space-y-5">
                  {integrityProfile.dimensions.map((dimension: any) => (
                    <div key={dimension.key} className="flex flex-col gap-2">
                      <div className="flex justify-between items-center text-sm font-semibold">
                        <span className="text-slate-200 tracking-wide">{dimension.name}</span>
                        <span className="text-slate-100 font-mono">{dimension.score}/{dimension.maxScore}</span>
                      </div>
                      <div className="w-full bg-slate-950 h-3 rounded-full overflow-hidden border border-slate-900/50">
                        <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${dimension.percentage}%` }} />
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed mt-1 font-light">{dimension.description}</p>
                    </div>
                  ))}
                </div>

                {integrityProfile.interviewQuestions.length > 0 && (
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Preguntas sugeridas para entrevista</h4>
                    <div className="mt-3 flex flex-col gap-3">
                      {integrityProfile.interviewQuestions.map((entry: any) => (
                        <div key={entry.dimension} className="text-xs leading-relaxed text-slate-300">
                          <span className="font-bold text-slate-100">{entry.dimension}: </span>{entry.question}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* DIMENSIONES PSICOMÉTRICAS */}
            <div className="bg-slate-900 border border-slate-900 p-6 rounded-xl flex flex-col gap-6 shadow-md">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Desglose por dimensiones</h3>
                <p className="text-xs text-slate-500 mt-1">Porcentaje del rango de puntuación. No es un percentil poblacional.</p>
              </div>

              <div className="space-y-6">
                {reportDimensions.map((dim: any, idx: number) => {
                  const score = dim.score;
                  const colorClass = 'bg-indigo-500';
                  
                  return (
                    <div key={idx} className="flex flex-col gap-2">
                      <div className="flex justify-between items-center text-sm font-semibold">
                        <span className="text-slate-200 tracking-wide">{dim.name}</span>
                        <span className="text-slate-100 font-mono">{score}%</span>
                      </div>
                      
                      <div className="w-full bg-slate-950 h-3 rounded-full overflow-hidden border border-slate-900/50">
                        <div
                          className={`h-full ${colorClass} transition-all duration-500`}
                          style={{ width: `${score}%` }}
                        />
                      </div>

                      <p className="text-xs text-slate-400 leading-relaxed mt-1 font-light">
                        {dim.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* AUDITORÍA DE FIRMAS HMAC */}
            <div className="bg-slate-900 border border-slate-900 p-4 rounded-xl flex items-center justify-between shadow-md text-xs">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-slate-500" />
                <span className="text-slate-300 font-medium">Versión registrada</span>
              </div>
              <div className="font-mono text-slate-500 select-all truncate max-w-xs lg:max-w-md">
                {recordedVersion || 'No disponible'}
              </div>
            </div>

          </div>

          {/* COLUMNA DERECHA: AUDIT TRAIL / PROCTORING TIMELINE (Ancho 1/3) */}
          <div className="flex flex-col gap-6">
            
            {/* INFO ADICIONAL SESION */}
            <div className="bg-slate-900 border border-slate-900 p-6 rounded-xl shadow-md">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">Detalles del Intento</h3>
              <div className="space-y-3 text-xs leading-relaxed">
                <div className="flex justify-between">
                  <span className="text-slate-500">Fecha Sesión:</span>
                  <span className="text-slate-300 font-semibold">{new Date(report.date).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short', timeZoneName: undefined })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Dirección IP:</span>
                  <span className="text-slate-300 font-mono font-semibold">{report.ipAddress}</span>
                </div>
                <div className="flex flex-col gap-1 border-t border-slate-950 pt-3">
                  <span className="text-slate-500">Entorno Navegador:</span>
                  <span className="text-2xs text-slate-400 font-medium break-all">{report.userAgent}</span>
                </div>
              </div>
            </div>

            {/* TIMELINE DE PROCTORING */}
            <div className="bg-slate-900 border border-slate-900 p-6 rounded-xl flex flex-col gap-6 shadow-md flex-1">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Eventos registrados</h3>
                <p className="text-2xs text-slate-500 mt-1">El piloto no recoge telemetría ni cámara por defecto.</p>
              </div>

              {/* Contenedor del timeline vertical */}
              <div className="relative border-l border-slate-800 pl-4 space-y-6">
                {reportProctoringLogs.length === 0 ? (
                  <p className="text-xs text-slate-500 font-medium">Sin eventos registrados. Esto no acredita ausencia de conductas ni fraude.</p>
                ) : (
                  reportProctoringLogs.map((log: any) => {
                    const isCritical = log.riskLevel === 'CRITICAL';
                    const isWarning = log.riskLevel === 'WARNING';
                    
                    const dotColorClass = isCritical
                      ? 'bg-red-500 ring-red-500/20'
                      : isWarning
                        ? 'bg-amber-500 ring-amber-500/20'
                        : 'bg-slate-700 ring-slate-700/20';

                    return (
                      <div key={log.id} className="relative group">
                        <span className={`absolute -left-6.5 top-1.5 flex h-2.5 w-2.5 items-center justify-center rounded-full ${dotColorClass} ring-4`} />
                        
                        <div className="flex flex-col gap-1">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-[10px] sm:text-2xs gap-0.5 sm:gap-2 text-left w-full">
                            <span className={`font-semibold tracking-wide block ${
                              isCritical 
                                ? 'text-red-400' 
                                : isWarning 
                                  ? 'text-amber-400' 
                                  : 'text-slate-400'
                            }`}>
                              {log.eventType.toUpperCase()}
                            </span>
                            <span className="text-slate-500 font-mono block sm:inline">{log.timestamp}</span>
                          </div>
                          
                          <p className="text-xs text-slate-300 font-light leading-relaxed">
                            {log.message}
                          </p>

                          {log.eventType === 'identity_snapshot' && (
                            <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950 p-2 text-3xs text-slate-500">
                              Captura facial no expuesta en reporte. Solo metadata registrada.
                            </div>
                          )}

                          <div className="mt-1 font-mono text-3xs text-slate-500 flex flex-col gap-0.5 bg-slate-950 p-2 rounded border border-slate-900/50">
                            <div>Seq: {log.metadata.sequence || '1'}</div>
                            {log.metadata.trigger && <div>Trig: {log.metadata.trigger}</div>}
                            {log.metadata.idleDurationMs && <div>Idle: {log.metadata.idleDurationMs}ms</div>}
                            <div className="truncate">Sign: {log.metadata.signature || 'No registrada'}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
