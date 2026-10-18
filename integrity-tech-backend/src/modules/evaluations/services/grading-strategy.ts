export interface GradingStrategy {
  grade(response: any, correctConfig: any, questionPoints: number): { isCorrect: boolean; pointsEarned: number };
}

/**
 * Estrategia para calificar reactivos de opción múltiple y verdadero/falso.
 */
export class MultipleChoiceStrategy implements GradingStrategy {
  grade(response: any, correctConfig: any, questionPoints: number): { isCorrect: boolean; pointsEarned: number } {
    const selectedOptionId = response.selectedOptionId;
    const correctOptionId = correctConfig.correctOptionId;

    if (!selectedOptionId || !correctOptionId) {
      return { isCorrect: false, pointsEarned: 0.00 };
    }

    const isCorrect = selectedOptionId === correctOptionId;
    return {
      isCorrect,
      pointsEarned: isCorrect ? questionPoints : 0.00,
    };
  }
}

/**
 * Estrategia para calificar reactivos de respuesta corta.
 * Realiza normalización de texto para mitigar errores tipográficos menores (espacios, mayúsculas).
 */
export class ShortAnswerStrategy implements GradingStrategy {
  grade(response: any, correctConfig: any, questionPoints: number): { isCorrect: boolean; pointsEarned: number } {
    const userAnswer = (response.text || '').trim().toLowerCase();
    
    // Lista de respuestas correctas aceptables (ej. sinónimos o variaciones permitidas)
    const acceptableAnswers: string[] = (correctConfig.correctAnswers || [])
      .map((ans: string) => ans.trim().toLowerCase());

    if (userAnswer === '' || acceptableAnswers.length === 0) {
      return { isCorrect: false, pointsEarned: 0.00 };
    }

    const isCorrect = acceptableAnswers.includes(userAnswer);
    return {
      isCorrect,
      pointsEarned: isCorrect ? questionPoints : 0.00,
    };
  }
}

/**
 * Estrategia para calificar reactivos de escala Likert (psicometría).
 * No hay respuestas correctas/incorrectas absolutas; las respuestas obtienen pesos ponderados.
 */
export class LikertStrategy implements GradingStrategy {
  grade(response: any, correctConfig: any, questionPoints: number): { isCorrect: boolean; pointsEarned: number } {
    const selectedValue = String(response?.value);
    if (!response || !Object.prototype.hasOwnProperty.call(correctConfig.weights || {}, selectedValue)) {
      throw new Error('Respuesta Likert fuera de la escala publicada.');
    }
    
    // correctConfig contiene un objeto 'weights' que asocia el valor de escala a un peso (de 0.0 a 1.0)
    const weights = correctConfig.weights || {};
    const weightFactor = weights[selectedValue] !== undefined ? Number(weights[selectedValue]) : 0.00;

    const pointsEarned = Number((questionPoints * weightFactor).toFixed(2));

    // En Likert, si responde la pregunta se considera válida
    return {
      isCorrect: true,
      pointsEarned,
    };
  }
}

/**
 * Fábrica y Registro de Estrategias de Calificación.
 */
export class GradingStrategyFactory {
  private static strategies = new Map<string, GradingStrategy>([
    ['MULTIPLE_CHOICE', new MultipleChoiceStrategy()],
    ['TRUE_FALSE', new MultipleChoiceStrategy()], // Comparte la misma lógica de opción seleccionada
    ['SHORT_ANSWER', new ShortAnswerStrategy()],
    ['LIKERT', new LikertStrategy()], // Registro de la estrategia psicométrica
  ]);

  static getStrategy(questionType: string): GradingStrategy {
    const strategy = this.strategies.get(questionType);
    if (!strategy) {
      throw new Error(`Estrategia de calificación no soportada para el tipo: ${questionType}`);
    }
    return strategy;
  }
}
