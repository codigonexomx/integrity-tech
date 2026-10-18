'use client';

import React, { useState } from 'react';
import { apiClient } from '../../services/api-client';
import { analyticsService } from '../../services/analytics';

interface FeedbackLayerProps {
  attemptId: string;
  onFeedbackSubmitted: () => void;
}

export function FeedbackLayer({ attemptId, onFeedbackSubmitted }: FeedbackLayerProps) {
  const [npsScore, setNpsScore] = useState<number | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (npsScore === null) return;

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      // Envío de analíticas (NPS track) en Segment/PostHog
      analyticsService.track('nps_feedback_submitted', {
        attemptId,
        score: npsScore,
        hasComment: feedbackText.trim().length > 0,
      });

      await apiClient.post(`/evaluations/attempts/${attemptId}/feedback`, { npsScore, feedbackText: feedbackText.trim() || undefined });
      const response = { ok: true };

      if (response.ok) {
        setIsSubmitted(true);
        setTimeout(() => {
          onFeedbackSubmitted();
        }, 2000); // Dar tiempo para ver el mensaje de agradecimiento
      } else {
        throw new Error('Fallo al registrar retroalimentación en el servidor.');
      }
    } catch (error: any) {
      console.warn('[Feedback Layer] No se pudo registrar la retroalimentación:', error);
      setErrorMessage('No pudimos registrar tu feedback. Revisa tu conexión e inténtalo nuevamente.');
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-xl flex flex-col items-center justify-center text-center max-w-md mx-auto my-auto gap-4 animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center text-3xl">
          💖
        </div>
        <h3 className="text-lg font-bold text-white">¡Muchas gracias por tu feedback!</h3>
        <p className="text-xs text-slate-400">
          Tu opinión nos ayuda a perfeccionar la fiabilidad y el rendimiento técnico de la plataforma.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-xl max-w-lg w-full mx-auto my-auto flex flex-col gap-6 animate-slide-up">
      <div className="text-center">
        <h2 className="text-lg font-bold text-white tracking-wide">¿Cómo fue tu experiencia técnica hoy?</h2>
        <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
          Nos ayuda a validar la fluidez del examen y asegurar que el motor de sincronización responda correctamente.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        {/* ESCALA NPS (0 al 10) */}
        <div className="flex flex-col gap-3">
          <label className="text-xs font-semibold text-slate-400">
            Califica el rendimiento técnico global de la plataforma (0: Pésimo, 10: Excelente):
          </label>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 justify-center">
            {Array.from({ length: 11 }, (_, i) => i).map((score) => {
              const isSelected = npsScore === score;
              return (
                <button
                  key={score}
                  type="button"
                  onClick={() => setNpsScore(score)}
                  className={`min-h-11 w-full rounded-lg border font-mono font-bold text-xs flex items-center justify-center transition-all cursor-pointer ${
                    isSelected
                      ? score >= 9
                        ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                        : score >= 7
                          ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400'
                          : 'border-red-500 bg-red-500/10 text-red-400'
                      : 'border-slate-800 bg-slate-950 text-slate-500 hover:bg-slate-800/30'
                  }`}
                >
                  {score}
                </button>
              );
            })}
          </div>
          <div className="flex justify-between text-3xs font-medium text-slate-500 px-1">
            <span>Detractor (0-6)</span>
            <span>Pasivo (7-8)</span>
            <span>Promotor (9-10)</span>
          </div>
        </div>

        {/* COMENTARIO CUALITATIVO */}
        {npsScore !== null && (
          <div className="flex flex-col gap-2 animate-fade-in">
            <label className="text-xs font-semibold text-slate-400">
              {npsScore <= 6 
                ? '¿Qué fallos técnicos, lentitud o incidencias experimentaste? (Opcional):' 
                : '¿Qué podríamos mejorar para que tu experiencia sea aún más fluida? (Opcional):'}
            </label>
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="Detalla tu experiencia aquí..."
              rows={4}
              maxLength={1000}
              className="w-full p-4 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/10 transition-all font-sans text-xs resize-none"
            />
            <div className="text-right text-3xs text-slate-500">
              {feedbackText.length}/1000 caracteres
            </div>
          </div>
        )}

        {/* ERROR MESSAGE */}
        {errorMessage && (
          <p className="text-xs text-red-500 font-medium text-center">{errorMessage}</p>
        )}

        {/* BOTON DE ENVÍO */}
        <button
          type="submit"
          disabled={npsScore === null || isSubmitting}
          className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 shadow-md disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
        >
          {isSubmitting ? 'Enviando...' : 'Enviar Comentarios'}
        </button>
      </form>
    </div>
  );
}
