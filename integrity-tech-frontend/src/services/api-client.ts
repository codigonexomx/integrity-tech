import type { ApiErrorResponse } from '../generated/api/types';

type ApiRequestOptions = RequestInit & {
  token?: string | null;
  auth?: boolean;
};

function readStoredAuthToken(path: string) {
  if (typeof window === 'undefined') return '';
  const candidateAttempt = path.match(/\/evaluations\/attempts\/([^/]+)\/(?:session|consent|submit|finalize|feedback|snapshots)(?:$|\?)/)?.[1];
  if (candidateAttempt) return localStorage.getItem(`candidate-token:${candidateAttempt}`) || localStorage.getItem('auth-token') || '';
  return localStorage.getItem('auth-token') || '';
}

function getApiBaseUrl() {
  if (process.env.NEXT_PUBLIC_API_BASE_URL) return process.env.NEXT_PUBLIC_API_BASE_URL;
  if (typeof window !== 'undefined') return '';
  return 'http://localhost:3001/api';
}

function normalizePath(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const baseUrl = getApiBaseUrl().replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!baseUrl) {
    if (normalizedPath.startsWith('/api/') || normalizedPath.startsWith('/health/') || normalizedPath === '/metrics') {
      return normalizedPath;
    }
    return `/api${normalizedPath}`;
  }
  if (normalizedPath.startsWith('/api/')) return `${baseUrl}${normalizedPath.slice(4)}`;
  return `${baseUrl}${normalizedPath}`;
}

async function parseJsonSafely(response: Response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return null;
  return response.json().catch(() => null);
}

function messageFromPayload(payload: ApiErrorResponse | null, fallback: string) {
  if (!payload?.message) return fallback;
  return Array.isArray(payload.message) ? payload.message.join(', ') : payload.message;
}

export class ApiClientError extends Error {
  status: number;
  error?: string;
  requestId?: string | null;
  traceId?: string | null;
  body?: unknown;

  constructor(status: number, message: string, payload?: ApiErrorResponse | null) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.error = payload?.error;
    this.requestId = payload?.requestId || null;
    this.traceId = payload?.traceId || null;
    this.body = payload;
  }

  static fromPayload(status: number, payload?: ApiErrorResponse | null) {
    return new ApiClientError(status, messageFromPayload(payload || null, defaultErrorMessage(status)), payload || null);
  }

  get isAuthError() {
    return this.status === 401;
  }

  get isForbidden() {
    return this.status === 403;
  }

  get isConflict() {
    return this.status === 409;
  }

  get isRateLimited() {
    return this.status === 429;
  }

  get isServerError() {
    return this.status >= 500;
  }
}

function defaultErrorMessage(status: number) {
  const messages: Record<number, string> = {
    400: 'La solicitud no tiene un formato válido.',
    401: 'La sesión no es válida o expiró.',
    403: 'No tienes permisos para realizar esta acción.',
    404: 'El recurso solicitado no está disponible.',
    409: 'El estado actual no permite completar la acción.',
    429: 'Demasiadas solicitudes. Intenta nuevamente más tarde.',
  };
  if (status >= 500) return 'El servicio no está disponible temporalmente.';
  return messages[status] || 'No se pudo completar la solicitud.';
}

function buildHeaders(options: ApiRequestOptions, path: string) {
  const headers = new Headers(options.headers);
  const hasBody = options.body !== undefined && options.body !== null;
  if (hasBody && !headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (options.auth !== false) {
    const token = options.token ?? readStoredAuthToken(path);
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  return headers;
}

export async function apiRawRequest(path: string, options: ApiRequestOptions = {}) {
  const { token: _token, auth: _auth, ...fetchOptions } = options;
  // Authenticated reads must never reuse an earlier identity or attempt snapshot,
  // including browsers/proxies that retain a response despite cache directives.
  const url = normalizePath(path);
  const readUrl = !fetchOptions.method || fetchOptions.method === 'GET'
    ? `${url}${url.includes('?') ? '&' : '?'}_request=${crypto.randomUUID()}` : url;
  return fetch(readUrl, {
    ...fetchOptions,
    cache: 'no-store',
    headers: buildHeaders(options, path),
  });
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const response = await apiRawRequest(path, options);
  const payload = await parseJsonSafely(response);

  if (!response.ok) {
    const errorPayload: ApiErrorResponse = {
      ...(payload || {}),
      requestId: (payload as ApiErrorResponse | null)?.requestId || response.headers.get('x-request-id'),
      traceId: (payload as ApiErrorResponse | null)?.traceId || response.headers.get('x-trace-id'),
    };
    throw ApiClientError.fromPayload(response.status, errorPayload);
  }

  return (payload ?? {}) as T;
}

export const apiClient = {
  raw: apiRawRequest,
  get<T>(path: string, options: ApiRequestOptions = {}) {
    return apiRequest<T>(path, { ...options, method: 'GET' });
  },
  post<T>(path: string, body?: unknown, options: ApiRequestOptions = {}) {
    return apiRequest<T>(path, {
      ...options,
      method: 'POST',
      body: body === undefined ? options.body : JSON.stringify(body),
    });
  },
  patch<T>(path: string, body?: unknown, options: ApiRequestOptions = {}) {
    return apiRequest<T>(path, {
      ...options,
      method: 'PATCH',
      body: body === undefined ? options.body : JSON.stringify(body),
    });
  },
  delete<T>(path: string, options: ApiRequestOptions = {}) {
    return apiRequest<T>(path, { ...options, method: 'DELETE' });
  },
};
