export const INTEGRITY_LABORAL_ASSESSMENT_CODE = 'EVALUACION_INTEGRIDAD_LABORAL';
export const INTEGRITY_LABORAL_SCORING_REVISION = '1.1.0';
export const INTEGRITY_LABORAL_NOTICE = 'Cuestionario experimental de autoinforme. Sin baremos ni validez predictiva acreditada. No determina honestidad ni aptitud de contratación.';
export const INTEGRITY_LABORAL_MODEL = {
  factor: 'Honestidad-Humildad (H)',
  model: 'HEXACO',
  authors: 'Lee & Ashton',
} as const;

export const INTEGRITY_LABORAL_DIMENSIONS = [
  {
    key: 'SINCERIDAD',
    name: 'Sinceridad',
    description:
      'Tendencia a ser genuino en las relaciones interpersonales. Evalúa transparencia, ausencia de manipulación y comunicación honesta.',
  },
  {
    key: 'JUSTICIA',
    name: 'Justicia',
    description: 'Evalúa rechazo al fraude, favoritismo y aprovechamiento de recursos organizacionales.',
  },
  {
    key: 'MODESTIA',
    name: 'Modestia',
    description: 'Evalúa humildad profesional, ausencia de sentido de superioridad y apertura al aprendizaje.',
  },
  {
    key: 'AUSENCIA_AVARICIA',
    name: 'Ausencia de Avaricia',
    description: 'Evalúa si la motivación principal del individuo va más allá del dinero y del estatus.',
  },
] as const;

export const INTEGRITY_LABORAL_LIKERT_OPTIONS = [
  { value: 1, label: 'Totalmente en desacuerdo' },
  { value: 2, label: 'En desacuerdo' },
  { value: 3, label: 'Ni de acuerdo ni en desacuerdo' },
  { value: 4, label: 'De acuerdo' },
  { value: 5, label: 'Totalmente de acuerdo' },
] as const;

export const INTEGRITY_LABORAL_ITEMS = [
  { dimensionKey: 'SINCERIDAD', order: 1, reverseScored: false, text: 'Si cometo un error en el trabajo que podría ocultar sin que nadie se diera cuenta, mi conciencia no me dejaría en paz.' },
  { dimensionKey: 'SINCERIDAD', order: 2, reverseScored: true, text: 'Para conseguir el apoyo de una persona influyente, no veo mal halagarla o exagerar mi admiración por ella.' },
  { dimensionKey: 'SINCERIDAD', order: 3, reverseScored: true, text: 'Siempre es mejor ser diplomático y decirle a la gente lo que quiere oír que ser completamente honesto y crear un conflicto innecesario.' },
  { dimensionKey: 'SINCERIDAD', order: 4, reverseScored: false, text: 'Prefiero un ambiente donde la gente se dice las cosas de frente aunque a veces resulte incómodo.' },
  { dimensionKey: 'SINCERIDAD', order: 5, reverseScored: true, text: 'He fingido estar de acuerdo con una opinión de mi jefe, aunque pensara lo contrario, solo para evitar problemas.' },
  { dimensionKey: 'JUSTICIA', order: 6, reverseScored: true, text: 'Si supiera que nunca me descubrirían, estaría tentado a llevarme dinero de la caja chica para resolver un problema personal.' },
  { dimensionKey: 'JUSTICIA', order: 7, reverseScored: false, text: 'Un empleado jamás debería aprovechar su puesto para recibir beneficios personales.' },
  { dimensionKey: 'JUSTICIA', order: 8, reverseScored: true, text: 'Si un amigo participa en un proceso de selección que yo superviso, le daría algunas ventajas.' },
  { dimensionKey: 'JUSTICIA', order: 9, reverseScored: false, text: 'No me gustaría aprovechar vacíos legales para evitar pagar lo que corresponde.' },
  { dimensionKey: 'JUSTICIA', order: 10, reverseScored: false, text: 'Inflar gastos personales durante un viaje de trabajo es inaceptable, aunque el monto sea pequeño.' },
  { dimensionKey: 'MODESTIA', order: 11, reverseScored: false, text: 'No me molesta que otro compañero reciba un reconocimiento que yo esperaba.' },
  { dimensionKey: 'MODESTIA', order: 12, reverseScored: true, text: 'Creo que merezco un trato mejor que la mayoría de las personas con las que trabajo.' },
  { dimensionKey: 'MODESTIA', order: 13, reverseScored: true, text: 'Una persona con mis capacidades no debería empezar desde abajo.' },
  { dimensionKey: 'MODESTIA', order: 14, reverseScored: false, text: 'Acepto con naturalidad recibir retroalimentación incluso cuando es negativa.' },
  { dimensionKey: 'MODESTIA', order: 15, reverseScored: true, text: 'Me cuesta trabajar con personas que considero menos capaces.' },
  { dimensionKey: 'AUSENCIA_AVARICIA', order: 16, reverseScored: true, text: 'Cambiaría inmediatamente de empresa si me ofrecieran un salario ligeramente mayor.' },
  { dimensionKey: 'AUSENCIA_AVARICIA', order: 17, reverseScored: true, text: 'La principal razón para trabajar es acceder a lujos y bienes materiales.' },
  { dimensionKey: 'AUSENCIA_AVARICIA', order: 18, reverseScored: true, text: 'Poseer artículos de lujo es una fuente importante de satisfacción para mí.' },
  { dimensionKey: 'AUSENCIA_AVARICIA', order: 19, reverseScored: false, text: 'Admiro más a quien desarrolla una carrera con propósito que a quien solo acumula riqueza.' },
  { dimensionKey: 'AUSENCIA_AVARICIA', order: 20, reverseScored: false, text: 'Mi satisfacción laboral depende mucho más del propósito de mi trabajo que del dinero.' },
] as const;

export function isIntegrityLaboralAssessmentCode(code?: string | null) {
  return code === INTEGRITY_LABORAL_ASSESSMENT_CODE;
}

export function likertWeights(reverseScored: boolean) {
  return reverseScored
    ? { '1': 5, '2': 4, '3': 3, '4': 2, '5': 1 }
    : { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5 };
}

export function dimensionByKey(key: string) {
  return INTEGRITY_LABORAL_DIMENSIONS.find((dimension) => dimension.key === key);
}
