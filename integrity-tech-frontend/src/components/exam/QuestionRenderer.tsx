import React from 'react';
import { useExamStore } from '../../store/exam.store';
import { syncEngine } from '../../services/sync-engine';
import { saveCandidateAnswer } from '../../services/candidate-experience';
import type { QuestionDto } from '../../types/exam-contract';

export interface QuestionProps {
  question: QuestionDto;
}

export const QuestionRenderer: React.FC<QuestionProps> = ({ question }) => {
  // Obtenemos la respuesta guardada localmente si existe
  const currentResponse = useExamStore((state) => state.answers[question.id]);
  const setAnswerStore = useExamStore((state) => state.setAnswer);
  const attemptId = useExamStore((state) => state.attemptId);
  const [saveError, setSaveError] = React.useState('');

  const startTimeRef = React.useRef(Date.now());

  React.useEffect(() => {
    startTimeRef.current = Date.now();
  }, [question.id]);

  const handleResponseChange = async (responseValue: any) => {
    try {
      if (!attemptId) throw new Error('No active attempt');
      saveCandidateAnswer(attemptId, question.id, responseValue);
      setSaveError('');
    } catch {
      setSaveError('No pudimos guardar esta selección en el navegador. No cierres esta página y contacta a la organización que te invitó.');
      return;
    }
    // 1. Actualizar el estado en memoria de Zustand de forma inmediata (reactividad fluida)
    setAnswerStore(question.id, responseValue);

    // Calcular el tiempo transcurrido en ms
    const elapsedMs = Date.now() - startTimeRef.current;

    // 2. Encolar asíncronamente en IndexedDB para la sincronización resiliente con el servidor
    if (attemptId && syncEngine) {
      try {
        await syncEngine.queueAnswer(attemptId, question.id, responseValue, elapsedMs, question.itemVersionId);
      } catch (error) {
        console.error('Error al guardar la respuesta en cola local IndexedDB:', error);
      }
    }
  };

  switch (question.type) {
    case 'MULTIPLE_CHOICE':
      return (
        <div role="radiogroup" aria-labelledby={`question-title-${question.id}`} className="p-6 bg-slate-900 border border-slate-800 rounded-xl shadow-lg transition-all duration-300">
          {saveError && <p role="alert" className="mb-4 rounded-lg border border-amber-500 p-3 text-amber-200">{saveError}</p>}
          <h3 id={`question-title-${question.id}`} className="text-lg font-medium text-slate-100 mb-4">{question.content.text}</h3>
          <div className="space-y-3">
            {question.content.options?.map((option) => {
              const isSelected = currentResponse?.selectedOptionId === option.id;
              return (
                <label
                  key={option.id}
                  className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer focus-within:ring-2 focus-within:ring-indigo-300 focus-within:ring-offset-2 focus-within:ring-offset-slate-950 transition-all duration-200 hover:bg-slate-800/50 ${
                    isSelected 
                      ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400' 
                      : 'border-slate-800 bg-slate-950 text-slate-400'
                  }`}
                >
                  <input
                    type="radio"
                    name={`question-${question.id}`}
                    value={option.id}
                    checked={isSelected}
                    onChange={() => handleResponseChange({ selectedOptionId: option.id })}
                    className="sr-only" // Ocultar input nativo, estilar caja exterior
                  />
                  <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                    isSelected ? 'border-indigo-500 bg-indigo-500' : 'border-slate-700 bg-slate-900'
                  }`}>
                    {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-slate-900" />}
                  </div>
                  <span className="font-sans text-sm select-none">{option.text}</span>
                </label>
              );
            })}
          </div>
        </div>
      );

    case 'TRUE_FALSE':
      return (
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl shadow-lg">
          <h3 className="text-lg font-medium text-slate-100 mb-4">{question.content.text}</h3>
          <div className="flex gap-4">
            {['VERDADERO', 'FALSO'].map((val) => {
              const isSelected = currentResponse?.value === val;
              return (
                <button
                  key={val}
                  type="button"
                  onClick={() => handleResponseChange({ value: val })}
                  className={`flex-1 py-4 px-6 rounded-lg border font-medium text-sm transition-all duration-200 cursor-pointer ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400'
                      : 'border-slate-800 bg-slate-950 text-slate-400 hover:bg-slate-800/30'
                  }`}
                >
                  {val}
                </button>
              );
            })}
          </div>
        </div>
      );

    case 'SHORT_ANSWER':
    case 'TEXT_RESPONSE':
      return (
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl shadow-lg">
          <h3 className="text-lg font-medium text-slate-100 mb-4">{question.content.text}</h3>
          <textarea
            value={currentResponse?.text || ''}
            onChange={(e) => handleResponseChange({ text: e.target.value })}
            placeholder="Escribe tu respuesta detallada aquí..."
            rows={5}
            className="w-full p-4 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all font-sans text-sm resize-y"
          />
        </div>
      );

    case 'LIKERT':
      const min = question.content.scale?.min || 1;
      const max = question.content.scale?.max || 5;
      const labels = question.content.scale?.labels || {};
      const scaleArray = Array.from({ length: max - min + 1 }, (_, i) => min + i);

      return (
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl shadow-lg">
          <h3 className="text-lg font-medium text-slate-100 mb-4">{question.content.text}</h3>
          
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-4">
              {scaleArray.map((val) => {
                const isSelected = String(currentResponse?.value) === String(val);
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => handleResponseChange({ value: val })}
                    className={`w-12 h-12 rounded-full border font-bold text-sm flex items-center justify-center transition-all duration-200 cursor-pointer ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400 ring-2 ring-indigo-500/20'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:bg-slate-800/30'
                    }`}
                  >
                    {val}
                  </button>
                );
              })}
            </div>
            
            {/* Etiquetas descriptivas de extremos */}
            <div className="flex justify-between text-xs text-slate-500 px-1 font-medium">
              <span>{labels[String(min)] || 'Totalmente en desacuerdo'}</span>
              <span>{labels[String(max)] || 'Totalmente de acuerdo'}</span>
            </div>
          </div>
        </div>
      );

    default:
      return (
        <div className="p-6 bg-slate-900 border border-red-900/50 rounded-xl shadow-lg text-red-400 text-sm">
          Tipo de reactivo no soportado por el motor del cliente.
        </div>
      );
  }
};
