import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';

// ============================================================================
// ADAPTADOR DE PERSISTENCIA PERSONALIZADO: ZUSTAND + INDEXEDDB
// ============================================================================
const INDEXED_DB_NAME = 'evaluartest-zustand-db';
const STORE_NAME = 'zustand-store';

const idbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return new Promise((resolve) => {
      const openRequest = indexedDB.open(INDEXED_DB_NAME, 1);
      
      openRequest.onupgradeneeded = () => {
        openRequest.result.createObjectStore(STORE_NAME);
      };
      
      openRequest.onsuccess = () => {
        const db = openRequest.result;
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const getRequest = store.get(name);
        
        getRequest.onsuccess = () => {
          resolve(getRequest.result || null);
        };
        getRequest.onerror = () => resolve(null);
      };

      openRequest.onerror = () => resolve(null);
    });
  },

  setItem: async (name: string, value: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const openRequest = indexedDB.open(INDEXED_DB_NAME, 1);
      
      openRequest.onupgradeneeded = () => {
        openRequest.result.createObjectStore(STORE_NAME);
      };
      
      openRequest.onsuccess = () => {
        const db = openRequest.result;
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const putRequest = store.put(value, name);
        
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      };

      openRequest.onerror = () => reject(openRequest.error);
    });
  },

  removeItem: async (name: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const openRequest = indexedDB.open(INDEXED_DB_NAME, 1);
      
      openRequest.onsuccess = () => {
        const db = openRequest.result;
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const deleteRequest = store.delete(name);
        
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error);
      };

      openRequest.onerror = () => reject(openRequest.error);
    });
  },
};

// ============================================================================
// DEFINICIÓN DEL ESTADO GLOBAL DEL EXAMEN (ZUSTAND STORE)
// ============================================================================
interface ExamState {
  attemptId: string | null;
  examId: string | null;
  answers: Record<string, any>; // questionId -> response
  flaggedQuestions: Record<string, boolean>; // questionId -> flagged_for_review (boolean)
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED';
  isOffline: boolean;
  
  // Proctoring UI States
  focusLossCount: number;
  showProctoringWarning: boolean;
  
  // Acciones
  startExam: (attemptId: string, examId: string) => void;
  setAnswer: (questionId: string, response: any) => void;
  toggleFlag: (questionId: string) => void;
  setStatus: (status: 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED') => void;
  setOfflineStatus: (isOffline: boolean) => void;
  incrementFocusLoss: () => void;
  dismissProctoringWarning: () => void;
  resetExam: () => void;
}

export const useExamStore = create<ExamState>()(
  persist(
    (set) => ({
      attemptId: null,
      examId: null,
      answers: {},
      flaggedQuestions: {},
      status: 'IN_PROGRESS',
      isOffline: false,
      focusLossCount: 0,
      showProctoringWarning: false,

      startExam: (attemptId, examId) => set(state => ({
        attemptId,
        examId,
        answers: state.attemptId === attemptId ? state.answers : {},
        flaggedQuestions: state.attemptId === attemptId ? state.flaggedQuestions : {},
        status: 'IN_PROGRESS',
        focusLossCount: 0,
        showProctoringWarning: false,
      })),

      setAnswer: (questionId, response) => set((state) => ({
        answers: {
          ...state.answers,
          [questionId]: response,
        },
      })),

      toggleFlag: (questionId) => set((state) => ({
        flaggedQuestions: {
          ...state.flaggedQuestions,
          [questionId]: !state.flaggedQuestions[questionId],
        },
      })),

      setStatus: (status) => set({ status }),

      setOfflineStatus: (isOffline) => set({ isOffline }),

      incrementFocusLoss: () => set((state) => {
        const nextCount = state.focusLossCount + 1;
        // Disparar advertencia visual si pierde el foco
        return {
          focusLossCount: nextCount,
          showProctoringWarning: true,
        };
      }),

      dismissProctoringWarning: () => set({ showProctoringWarning: false }),

      resetExam: () => set({
        attemptId: null,
        examId: null,
        answers: {},
        flaggedQuestions: {},
        status: 'IN_PROGRESS',
        isOffline: false,
        focusLossCount: 0,
        showProctoringWarning: false,
      }),
    }),
    {
      name: 'evaluartest-active-exam-v3',
      storage: createJSONStorage(() => idbStorage), // Soportado por IndexedDB asíncrono
    },
  ),
);
