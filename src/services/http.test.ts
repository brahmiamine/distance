import { describe, expect, it } from 'vitest';
import { jsonResponse, stubFetch } from '../test/helpers';
import { memoryCache } from './cache';
import { HttpError, fetchJson } from './http';

describe('fetchJson', () => {
  it('retourne le JSON en cas de succès', async () => {
    const fetchImpl = stubFetch(() => jsonResponse({ ok: true }));
    await expect(fetchJson('https://api.test/x', { fetchImpl })).resolves.toEqual({ ok: true });
  });

  it('réessaie sur 500 puis réussit', async () => {
    let calls = 0;
    const fetchImpl = stubFetch(() => {
      calls += 1;
      return calls === 1 ? jsonResponse({ error: 1 }, 500) : jsonResponse({ ok: true });
    });

    const result = await fetchJson('https://api.test/x', { fetchImpl, retries: 2, retryDelayMs: 1 });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('réessaie sur 429', async () => {
    let calls = 0;
    const fetchImpl = stubFetch(() => {
      calls += 1;
      return calls === 1 ? jsonResponse({}, 429) : jsonResponse({ ok: true });
    });

    await expect(fetchJson('https://api.test/x', { fetchImpl, retries: 1, retryDelayMs: 1 })).resolves.toEqual({
      ok: true,
    });
    expect(calls).toBe(2);
  });

  it('ne réessaie pas sur 400', async () => {
    let calls = 0;
    const fetchImpl = stubFetch(() => {
      calls += 1;
      return jsonResponse({}, 400);
    });

    await expect(fetchJson('https://api.test/x', { fetchImpl, retries: 3, retryDelayMs: 1 })).rejects.toThrow(
      'Réponse 400',
    );
    expect(calls).toBe(1);
  });

  it('réessaie sur erreur réseau puis abandonne', async () => {
    let calls = 0;
    const fetchImpl = stubFetch(() => {
      calls += 1;
      throw new Error('réseau indisponible');
    });

    await expect(fetchJson('https://api.test/x', { fetchImpl, retries: 1, retryDelayMs: 1 })).rejects.toThrow(
      'réseau indisponible',
    );
    expect(calls).toBe(2);
  });

  it('abandonne au délai maximal', async () => {
    const fetchImpl = stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    await expect(
      fetchJson('https://api.test/x', { fetchImpl, timeoutMs: 10, retries: 0 }),
    ).rejects.toBeInstanceOf(Error);
  });

  it('met en cache puis sert depuis le cache', async () => {
    const cache = memoryCache();
    let calls = 0;
    const fetchImpl = stubFetch(() => {
      calls += 1;
      return jsonResponse({ n: calls });
    });

    const options = { fetchImpl, cache, cacheKey: 'k', cacheTtlSeconds: 60 };
    await fetchJson('https://api.test/x', options);
    await expect(fetchJson('https://api.test/x', options)).resolves.toEqual({ n: 1 });
    expect(calls).toBe(1);
  });

  it('ignore une entrée de cache corrompue', async () => {
    const cache = memoryCache();
    await cache.set('k', 'pas du json', 60);
    const fetchImpl = stubFetch(() => jsonResponse({ ok: true }));

    await expect(
      fetchJson('https://api.test/x', { fetchImpl, cache, cacheKey: 'k', cacheTtlSeconds: 60 }),
    ).resolves.toEqual({ ok: true });
  });

  it('respecte une annulation externe', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = stubFetch(() => jsonResponse({}));

    await expect(
      fetchJson('https://api.test/x', { fetchImpl, signal: controller.signal }),
    ).rejects.toThrow('Requête annulée');
  });

  it('annule en cours de requête si le signal externe se déclenche', async () => {
    const controller = new AbortController();
    const fetchImpl = stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            if (controller.signal.aborted) reject(new Error('aborted'));
          });
          setTimeout(() => controller.abort(), 5);
        }),
    );

    await expect(
      fetchJson('https://api.test/x', { fetchImpl, signal: controller.signal, timeoutMs: 1000, retries: 0 }),
    ).rejects.toBeInstanceOf(HttpError);
  });
});
