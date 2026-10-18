import { useExamStore } from '../store/exam.store';
import { apiClient } from './api-client';
import { shouldRemoveQueuedAnswerAfterResponse } from './sync-engine-policy';

export interface QueuedAnswer {
  id: string; // UUID de la subida
  attemptId: string;
  questionId: string;
  response: any;
  timestamp: number;
  revision?: string;
  attempts: number;
  tiempoMs?: number;
  itemVersionId?: string | null;
  nextRetryTimestamp?: number;
}

export interface QueuedProctoringLog {
  id: string; // Generado localmente
  attemptId: string;
  eventType: string;
  riskLevel: string; // Nivel de riesgo (INFO, WARNING, CRITICAL)
  metadata: any;
  timestamp: number;
  attempts: number;
  nextRetryTimestamp?: number;
}

export class SyncEngine {
  private dbName = 'integrity-tech-offline-db-v1';
  private answersStore = 'answers-queue';
  private proctoringStore = 'proctoring-queue';
  private db: IDBDatabase | null = null;
  
  private isProcessingAnswers = false;
  private isProcessingProctoring = false;
  private retryTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.initDatabase().then(() => {
      this.registerNetworkEvents();
      this.processQueues();
    });
  }

  /**
   * Inicializa IndexedDB creando ambos almacenes (Respuestas y Logs de Telemetría).
   */
  private async initDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 3); // Nueva versión de la DB

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.answersStore)) {
          db.createObjectStore(this.answersStore, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(this.proctoringStore)) {
          db.createObjectStore(this.proctoringStore, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  private registerNetworkEvents() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        useExamStore.getState().setOfflineStatus(false);
        this.processQueues();
      });
      window.addEventListener('offline', () => {
        useExamStore.getState().setOfflineStatus(true);
      });
      // Estado de conexión inicial
      useExamStore.getState().setOfflineStatus(!navigator.onLine);
    }
  }

  /**
   * Encola una respuesta en IndexedDB.
   */
  async queueAnswer(attemptId: string, questionId: string, response: any, tiempoMs?: number, itemVersionId?: string | null): Promise<void> {
    if (!this.db) await this.initDatabase();

    const queuedItem: QueuedAnswer = {
      id: `ans:${attemptId}:${questionId}`,
      revision: crypto.randomUUID(),
      attemptId,
      questionId,
      response,
      tiempoMs,
      itemVersionId,
      timestamp: Date.now(),
      attempts: 0,
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(this.answersStore, 'readwrite');
      const store = transaction.objectStore(this.answersStore);
      const request = store.put(queuedItem);

      request.onsuccess = () => {
        resolve();
        this.processAnswers();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Encola un log de proctoring en IndexedDB para procesamiento en lotes.
   */
  async queueProctoringLog(attemptId: string, log: { eventType: string; riskLevel: string; metadata: any; timestamp: string }): Promise<void> {
    if (!this.db) await this.initDatabase();

    const timestampMs = Date.parse(log.timestamp) || Date.now();

    const queuedItem: QueuedProctoringLog = {
      id: `log:${attemptId}:${timestampMs}:${Math.random().toString(36).substring(2, 7)}`,
      attemptId,
      eventType: log.eventType,
      riskLevel: log.riskLevel,
      metadata: log.metadata,
      timestamp: timestampMs,
      attempts: 0,
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(this.proctoringStore, 'readwrite');
      const store = transaction.objectStore(this.proctoringStore);
      const request = store.put(queuedItem);

      request.onsuccess = () => {
        resolve();
        this.processProctoringBatch();
      };
      request.onerror = () => reject(request.error);
    });
  }

  private processQueues() {
    this.processAnswers();
    this.processProctoringBatch();
  }

  async flushAnswers(timeoutMs = 5000, attemptId?: string): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await this.processAnswers();
      const remaining = await this.getAllItems<QueuedAnswer>(this.answersStore);
      if (remaining.filter(item => !attemptId || item.attemptId === attemptId).length === 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const remaining = await this.getAllItems<QueuedAnswer>(this.answersStore);
    return remaining.filter(item => !attemptId || item.attemptId === attemptId).length === 0;
  }

  /**
   * Envía las respuestas procesables una por una aplicando Backoff Exponencial.
   */
  private async processAnswers() {
    if (this.isProcessingAnswers || !navigator.onLine) return;
    this.isProcessingAnswers = true;

    try {
      const items = await this.getAllItems<QueuedAnswer>(this.answersStore);
      const now = Date.now();

      // Procesar únicamente ítems cuyo retraso por backoff haya expirado
      const processableItems = items.filter(item => !item.nextRetryTimestamp || item.nextRetryTimestamp <= now);

      for (const item of processableItems) {
        if (!navigator.onLine) break;

        const success = await this.sendAnswerToServer(item);
        if (success) {
          await this.finishAnswer(item);
        } else {
          // Si falla, incrementamos su contador de intentos y programamos backoff
          await this.incrementRetry(this.answersStore, item);
          this.scheduleQueueProcessing();
          continue; // An older attempt must not block another candidate.
        }
      }
    } catch (error) {
      console.error('Error procesando cola de respuestas:', error);
    } finally {
      this.isProcessingAnswers = false;
      this.scheduleQueueProcessing();
    }
  }

  /**
   * Envía los logs de proctoring en lotes de hasta 10 elementos.
   */
  private async processProctoringBatch() {
    if (this.isProcessingProctoring || !navigator.onLine) return;
    this.isProcessingProctoring = true;

    try {
      const allLogs = await this.getAllItems<QueuedProctoringLog>(this.proctoringStore);
      const now = Date.now();

      // Filtrar logs que no se encuentren en su ventana de espera por backoff
      const processableLogs = allLogs.filter(log => !log.nextRetryTimestamp || log.nextRetryTimestamp <= now);

      if (processableLogs.length === 0) {
        this.isProcessingProctoring = false;
        return;
      }

      const batchSize = 10;
      const batch = processableLogs.slice(0, batchSize);
      const attemptId = batch[0].attemptId;

      const success = await this.sendProctoringBatchToServer(attemptId, batch);
      if (success) {
        // Eliminar logs del IndexedDB
        const deletePromises = batch.map(log => this.removeItem(this.proctoringStore, log.id));
        await Promise.all(deletePromises);
        
        // Ejecución recursiva si quedan elementos procesables
        if (processableLogs.length > batchSize) {
          setTimeout(() => this.processProctoringBatch(), 500);
        }
      } else {
        // Incrementar reintentos y aplicar backoff a todos los elementos del lote
        const incrementPromises = batch.map(log => this.incrementRetry(this.proctoringStore, log));
        await Promise.all(incrementPromises);
        this.scheduleQueueProcessing();
      }
    } catch (error) {
      console.error('Error procesando lote de proctoring:', error);
    } finally {
      this.isProcessingProctoring = false;
    }
  }

  private async sendAnswerToServer(item: QueuedAnswer): Promise<boolean> {
    try {
      const response = await apiClient.raw(`/evaluations/attempts/${item.attemptId}/submit`, {
        method: 'POST',
        body: JSON.stringify({
          questionId: item.questionId,
          response: item.response,
          tiempoMs: item.tiempoMs,
          itemVersionId: item.itemVersionId,
        }),
      });

      if (shouldRemoveQueuedAnswerAfterResponse(response.status)) return true;
      if ([400, 401, 403, 404, 409, 422, 429].includes(response.status)) {
        console.warn(`Respuesta no sincronizada; se conserva en IndexedDB. HTTP ${response.status}`);
        return false;
      }
    } catch (error) {
      console.warn('Fallo de conexión al enviar respuesta:', error);
    }
    return false;
  }

  private async sendProctoringBatchToServer(attemptId: string, batch: QueuedProctoringLog[]): Promise<boolean> {
    try {
      // Mapear campos adecuadamente para cumplir estrictamente con el DTO de NestJS (incluye riskLevel)
      const cleanLogs = batch.map(log => ({
        eventType: log.eventType,
        riskLevel: log.riskLevel || 'INFO',
        timestamp: new Date(log.timestamp).toISOString(),
        metadata: log.metadata || {},
      }));

      const response = await apiClient.raw(`/proctoring/attempts/${attemptId}/logs/batch`, {
        method: 'POST',
        token: this.getAuthToken(),
        body: JSON.stringify({ logs: cleanLogs }),
      });

      if (response.ok) return true;
      if (response.status >= 400 && response.status < 500 && response.status !== 429) return true;
    } catch (error) {
      console.warn('Fallo de conexión al enviar lote de proctoring:', error);
    }
    return false;
  }

  private calculateBackoffDelay(attempts: number): number {
    // delay = 2^attempts * 1000ms, tope máximo de 30 segundos
    return Math.min(Math.pow(2, attempts) * 1000, 30000);
  }

  private async incrementRetry(storeName: string, item: any): Promise<void> {
    if (!this.db) return;

    const nextAttempts = item.attempts + 1;
    const delay = this.calculateBackoffDelay(nextAttempts);
    const updatedItem = {
      ...item,
      attempts: nextAttempts,
      nextRetryTimestamp: Date.now() + delay,
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      // Do not restore an older response over a new local selection.
      const current = store.get(item.id);
      current.onsuccess = () => { if (current.result?.revision === item.revision) store.put(updatedItem); };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  private scheduleQueueProcessing() {
    if (this.retryTimeout) clearTimeout(this.retryTimeout);

    // Revisar las colas de reintento tras un retardo fijo de 5 segundos
    this.retryTimeout = setTimeout(() => {
      this.processQueues();
    }, 5000);
  }

  private async getAllItems<T>(storeName: string): Promise<T[]> {
    if (!this.db) await this.initDatabase();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        const sorted = (request.result as any[]).sort((a, b) => a.timestamp - b.timestamp);
        resolve(sorted as T[]);
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async removeItem(storeName: string, id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async pendingAnswers(attemptId: string) {
    return (await this.getAllItems<QueuedAnswer>(this.answersStore)).filter(item => item.attemptId === attemptId);
  }

  private async finishAnswer(item: QueuedAnswer): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(this.answersStore, 'readwrite');
      const store = tx.objectStore(this.answersStore);
      const request = store.get(item.id);
      request.onsuccess = () => { if (request.result?.revision === item.revision) store.delete(item.id); };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private getAuthToken(): string {
    return typeof window !== 'undefined' ? localStorage.getItem('auth-token') || '' : '';
  }
}

export const syncEngine = typeof window !== 'undefined' ? new SyncEngine() : null;
