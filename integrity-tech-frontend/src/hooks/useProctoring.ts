import { useEffect, useRef } from 'react';
import { syncEngine } from '../services/sync-engine';
import { useExamStore } from '../store/exam.store';

interface UseProctoringProps {
  idleTimeoutMs?: number; // Tiempo límite de inactividad (ej: 60 segundos)
}

async function generateLocalSignature(message: string, secret: string): Promise<string | null> {
  if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
    console.error('[Crypto] WebCrypto no está disponible; el evento de proctoring se registrará sin firma.');
    return null;
  }
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(message);

    const key = await window.crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await window.crypto.subtle.sign('HMAC', key, messageData);
    const hashArray = Array.from(new Uint8Array(signatureBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (error) {
    console.error('[Crypto] Error firmando evento:', error);
    return null;
  }
}

export function useProctoring({ idleTimeoutMs = 60000 }: UseProctoringProps = {}) {
  const attemptId = useExamStore((state) => state.attemptId);
  const status = useExamStore((state) => state.status);
  
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const sequenceRef = useRef<number>(0);

  // Helper para registrar eventos de proctoring de forma segura
  const logEvent = async (eventType: string, riskLevel: string, metadata: Record<string, any> = {}) => {
    if (process.env.NEXT_PUBLIC_ENABLE_PROCTORING !== 'true') return;
    if (!attemptId || status !== 'IN_PROGRESS' || !syncEngine) return;

    sequenceRef.current += 1;
    const timestampStr = new Date().toISOString();

    // Protocolo de Seguridad: Firmar criptográficamente el evento para validar integridad en el backend
    const messageToSign = `${attemptId}:${eventType}:${sequenceRef.current}:${timestampStr}`;
    const signature = await generateLocalSignature(messageToSign, attemptId);

    const logPayload = {
      eventType,
      riskLevel,
      timestamp: timestampStr,
      metadata: {
        ...metadata,
        sequence: sequenceRef.current,
        signature,
        signatureStatus: signature ? 'SIGNED' : 'UNAVAILABLE',
        screenResolution: typeof window !== 'undefined' ? `${window.screen.width}x${window.screen.height}` : 'unknown',
        url: typeof window !== 'undefined' ? window.location.href : 'unknown',
      },
    };

    console.log(`[Proctoring] Encolando evento local (${riskLevel}): ${eventType}`, logPayload);
    
    // Enviamos el log al SyncEngine para que lo encole en IndexedDB y lo envíe en batch
    await syncEngine.queueProctoringLog(attemptId, logPayload);
  };

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ENABLE_PROCTORING !== 'true') return;
    if (!attemptId || status !== 'IN_PROGRESS') return;

    // ============================================================================
    // 1. DETECCIÓN DE CAMBIO DE PESTAÑA (visibilitychange)
    // ============================================================================
    const handleVisibilityChange = () => {
      if (document.hidden) {
        logEvent('tab_focus_lost', 'WARNING', { trigger: 'visibility_hidden' });
        // Notificar al store global para alertas visuales del componente ProctoringMonitor
        useExamStore.getState().incrementFocusLoss();
      } else {
        logEvent('tab_focus_gained', 'INFO', { trigger: 'visibility_visible' });
      }
    };

    // ============================================================================
    // 2. DETECCIÓN DE PÉRDIDA DE FOCO DE LA VENTANA (blur/focus)
    // ============================================================================
    const handleWindowBlur = () => {
      logEvent('tab_focus_lost', 'WARNING', { trigger: 'window_blur' });
      useExamStore.getState().incrementFocusLoss();
    };

    const handleWindowFocus = () => {
      logEvent('tab_focus_gained', 'INFO', { trigger: 'window_focus' });
    };

    // ============================================================================
    // 3. DETECCIÓN DE INACTIVIDAD (Idle Timeout - Debounced)
    // ============================================================================
    const resetIdleTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      
      idleTimerRef.current = setTimeout(() => {
        logEvent('student_idle', 'WARNING', { idleDurationMs: idleTimeoutMs });
      }, idleTimeoutMs);
    };

    // Eventos que indican actividad del estudiante
    const activityEvents = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];

    // Registrar listeners de eventos de red y navegador
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    
    activityEvents.forEach((event) => {
      window.addEventListener(event, resetIdleTimer);
    });

    // Iniciar temporizador de inactividad inicial
    resetIdleTimer();

    // Limpieza de event listeners al desmontar
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      activityEvents.forEach((event) => {
        window.removeEventListener(event, resetIdleTimer);
      });
    };
  }, [attemptId, status, idleTimeoutMs]);
}
