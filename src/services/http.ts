import type { CacheStore } from './cache';

/** Erreur HTTP avec code de statut éventuel. */
export class HttpError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  cache?: CacheStore | null;
  cacheKey?: string;
  cacheTtlSeconds?: number;
  retryDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES = 2;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * `fetch` JSON avec timeout, nouvelles tentatives (5xx / 429 / réseau) et cache
 * optionnel. Utilisé côté navigateur et dans les tests.
 */
export async function fetchJson<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
  const {
    headers = {},
    fetchImpl = fetch,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    cache = null,
    cacheKey,
    cacheTtlSeconds = 0,
    retryDelayMs = 250,
  } = options;

  if (cache && cacheKey) {
    const cached = await cache.get(cacheKey);
    if (cached !== null) {
      try {
        return JSON.parse(cached) as T;
      } catch {
        // Entrée corrompue : on l'ignore et on refait l'appel.
      }
    }
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw new HttpError('Requête annulée');

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, { headers, signal: controller.signal });

      if (!response.ok) {
        const error = new HttpError(`Réponse ${response.status}`, response.status);
        if (!isRetryableStatus(response.status) || attempt >= retries) throw error;
        lastError = error;
      } else {
        const text = await response.text();
        if (cache && cacheKey && cacheTtlSeconds > 0) {
          await cache.set(cacheKey, text, cacheTtlSeconds);
        }
        return JSON.parse(text) as T;
      }
    } catch (error) {
      if (signal?.aborted) throw new HttpError('Requête annulée');
      const status = error instanceof HttpError ? error.status : undefined;
      const retryable = status === undefined || isRetryableStatus(status);
      if (!retryable || attempt >= retries) throw error;
      lastError = error;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }

    await delay(retryDelayMs * (attempt + 1));
  }

  throw lastError instanceof Error ? lastError : new HttpError('Échec de la requête');
}
