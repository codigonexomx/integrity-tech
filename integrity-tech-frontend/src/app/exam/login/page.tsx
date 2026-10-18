'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TopNavigation } from '../../../components/navigation/TopNavigation';
import { apiClient, ApiClientError } from '../../../services/api-client';
import type {
  ClaimInvitationRequest,
  ClaimInvitationResponse,
  VerifyInvitationRequest,
  VerifyInvitationResponse,
} from '../../../generated/api/types';

function getCandidateAccessErrorMessage(status: number, fallback: string) {
  const messages: Record<number, string> = {
    400: 'La clave no está disponible: verifica que sea correcta, siga vigente y no haya sido utilizada.',
    401: 'La sesión no es válida. Vuelve a intentar desde tu enlace de evaluación.',
    403: 'No tienes autorización para acceder a esta evaluación.',
    409: 'La invitación ya no está disponible para iniciar un nuevo intento.',
    429: 'Demasiados intentos con esta clave. Espera unos minutos antes de volver a intentar.',
  };
  return messages[status] || fallback;
}

export default function CandidateLoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center font-sans">
        <TopNavigation />
        <span className="w-8 h-8 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    }>
      <CandidateLoginForm />
    </Suspense>
  );
}

function CandidateLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [accessCode, setAccessCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Datos del candidato verificado
  const [invitationDetails, setInvitationDetails] = useState<{
    candidateName: string;
    email: string;
    examId: string;
    examTitle: string;
  } | null>(null);

  // Leer código desde la URL (?code=IT-123456)
  useEffect(() => {
    const code = searchParams.get('code');
    if (code) {
      setAccessCode(code);
      handleVerify(code);
    }
  }, [searchParams]);

  // Verificar el código ingresado contra el backend
  const handleVerify = async (codeToVerify?: string) => {
    const code = codeToVerify || accessCode;
    if (!code || code.trim() === '') {
      setError('Por favor, ingresa una clave de acceso válida.');
      return;
    }

    setIsVerifying(true);
    setError(null);

    try {
      const payload: VerifyInvitationRequest = { accessCode: code };
      const data = await apiClient.post<VerifyInvitationResponse>('/evaluations/invitations/verify', payload, { auth: false });
      setInvitationDetails(data);
    } catch (err: any) {
      console.error(err);
      const fallback = err.message || 'La clave de acceso ingresada es incorrecta o ya fue utilizada.';
      setError(err instanceof ApiClientError ? getCandidateAccessErrorMessage(err.status, fallback) : fallback);
      setInvitationDetails(null);
    } finally {
      setIsVerifying(false);
    }
  };

  // Reclamar la clave e iniciar el examen
  const handleClaim = async () => {
    if (!invitationDetails) return;

    setIsClaiming(true);
    setError(null);

    try {
      const payload: ClaimInvitationRequest = {
        accessCode: searchParams.get('code') || accessCode,
        candidateName: invitationDetails.candidateName,
        email: invitationDetails.email,
      };
      const data = await apiClient.post<ClaimInvitationResponse>('/evaluations/invitations/claim', payload, { auth: false });
      
      // Guardar el Token de Sesión JWT en localStorage para el header
      localStorage.setItem(`candidate-token:${data.attemptId}`, data.token);

      // Redirigir al examen del alumno
      router.push(`/exam/${data.attemptId}`);
    } catch (err: any) {
      console.error(err);
      const fallback = err.message || 'Fallo al iniciar el examen. Por favor, reintenta.';
      setError(err instanceof ApiClientError ? getCandidateAccessErrorMessage(err.status, fallback) : fallback);
    } finally {
      setIsClaiming(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 pt-20 text-center font-sans gap-8">
      <TopNavigation />
      
      {/* HEADER LOGO */}
      <div className="flex flex-col items-center gap-3">
        <img 
          src="/integrity-logo-2.png" 
          alt="Integrity Test Logo" 
          className="w-24 sm:w-28 h-auto object-contain hover:scale-105 transition-all duration-300"
        />
        <div className="flex flex-col items-center select-none mt-1">
          <h1 className="text-2xl font-light tracking-[0.2em] bg-gradient-to-r from-amber-100 via-yellow-300 to-amber-500 bg-clip-text text-transparent uppercase font-sans">
            Integrity
          </h1>
          <h2 className="text-sm font-light tracking-[0.3em] text-slate-300 uppercase font-sans mt-1">
            - Test -
          </h2>
        </div>
        <p className="text-2xs text-slate-400 max-w-xs leading-relaxed mt-1">
          Acceso a las prácticas técnicas del piloto. No determinan aptitud laboral.
        </p>
      </div>

      {/* LOGIN CARD */}
      <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl max-w-md w-full shadow-2xl flex flex-col gap-6 relative overflow-hidden">
        
        {/* EFECTO CRISTAL DETRÁS */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full filter blur-2xl pointer-events-none" />
        
        {!invitationDetails ? (
          // PASO 1: INGRESAR CÓDIGO
          <div className="flex flex-col gap-5">
            <div className="text-left">
              <h2 className="text-lg font-bold text-white">Puerta de Acceso</h2>
              <p className="text-xs text-slate-500 mt-1">
                Ingresa la clave de acceso de 6 dígitos provista por tu reclutador o en tu invitación por correo.
              </p>
            </div>

            <div className="flex flex-col gap-2 text-left">
              <label className="text-2xs font-bold text-slate-500 uppercase tracking-widest">
                Clave de Acceso
              </label>
              <input
                type="text"
                placeholder="Ej: IT-123456"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-base font-semibold tracking-wider text-center text-slate-200 placeholder-slate-700 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600/20 transition-all uppercase"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs py-2.5 px-3 rounded-lg text-left leading-relaxed">
                ⚠️ {error}
              </div>
            )}

            <button
              onClick={() => handleVerify()}
              disabled={isVerifying}
              className="w-full py-3 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-600/10 cursor-pointer flex items-center justify-center gap-2"
            >
              {isVerifying ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  Verificando...
                </>
              ) : (
                'Verificar Acceso'
              )}
            </button>
          </div>
        ) : (
          // PASO 2: CONFIRMAR DATOS DEL EXAMEN
          <div className="flex flex-col gap-6">
            <div className="text-left border-b border-slate-800/60 pb-4">
              <h2 className="text-lg font-bold text-white">Evaluación Encontrada</h2>
              <p className="text-xs text-slate-500 mt-1">
                Confirma tus datos antes de iniciar la prueba. Al presionar comenzar, se consumirá tu clave de acceso.
              </p>
            </div>

            {/* DETALLES DE LA INVITACION */}
            <div className="flex flex-col gap-3.5 bg-slate-950/60 p-4 border border-slate-950 rounded-xl text-left">
              <div>
                <span className="text-4xs font-bold text-slate-500 uppercase tracking-widest block">Evaluado</span>
                <span className="text-sm font-semibold text-slate-200 block mt-0.5">{invitationDetails.candidateName}</span>
                <span className="text-xs text-slate-500 block mt-0.5">{invitationDetails.email}</span>
              </div>
              <div className="border-t border-slate-900 pt-3">
                <span className="text-4xs font-bold text-slate-500 uppercase tracking-widest block">Prueba Asignada</span>
                <span className="text-sm font-bold text-indigo-400 block mt-0.5">{invitationDetails.examTitle}</span>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs py-2.5 px-3 rounded-lg text-left">
                ⚠️ {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setInvitationDetails(null);
                  setError(null);
                }}
                className="flex-1 py-3 rounded-xl border border-slate-800 text-slate-400 text-xs font-semibold hover:bg-slate-900 transition-colors cursor-pointer"
              >
                Volver
              </button>
              <button
                onClick={handleClaim}
                disabled={isClaiming}
                className="flex-1 py-3 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-600/10 cursor-pointer flex items-center justify-center gap-2"
              >
                {isClaiming ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    Iniciando...
                  </>
                ) : (
                  'Comenzar Examen'
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* METADATOS TÉCNICOS */}
      <div className="text-4xs text-slate-600 font-mono flex flex-col gap-0.5 leading-relaxed">
        <div>Acceso mediante clave de un solo uso</div>
        <div>Piloto de práctica · sin cámara ni monitoreo de navegación</div>
      </div>

    </div>
  );
}
