import { describe, expect, it } from 'vitest';
import { browserCache, memoryCache } from './cache';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  } as Storage;
}

describe('memoryCache', () => {
  it('stocke et relit une valeur', async () => {
    const cache = memoryCache();
    await cache.set('a', 'valeur', 60);
    await expect(cache.get('a')).resolves.toBe('valeur');
  });

  it('renvoie null pour une clé absente', async () => {
    const cache = memoryCache();
    await expect(cache.get('absente')).resolves.toBeNull();
  });

  it('expire après le TTL', async () => {
    let clock = 0;
    const cache = memoryCache(() => clock);
    await cache.set('a', 'valeur', 10);
    clock = 11_000;
    await expect(cache.get('a')).resolves.toBeNull();
  });
});

describe('browserCache', () => {
  it('fonctionne en mémoire quand localStorage est absent', async () => {
    const cache = browserCache();
    await cache.set('a', 'valeur', 60);
    await expect(cache.get('a')).resolves.toBe('valeur');
  });

  it('persiste dans localStorage et se relit via une nouvelle instance', async () => {
    const original = (globalThis as { localStorage?: Storage }).localStorage;
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();

    try {
      const first = browserCache();
      await first.set('a', 'valeur', 60);

      const second = browserCache();
      await expect(second.get('a')).resolves.toBe('valeur');
    } finally {
      if (original) (globalThis as { localStorage?: Storage }).localStorage = original;
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });

  it('ignore une entrée localStorage corrompue', async () => {
    const original = (globalThis as { localStorage?: Storage }).localStorage;
    const store = fakeStorage();
    (globalThis as { localStorage?: Storage }).localStorage = store;
    store.setItem('distance-cache:a', '{ pas du json');

    try {
      const cache = browserCache();
      await expect(cache.get('a')).resolves.toBeNull();
    } finally {
      if (original) (globalThis as { localStorage?: Storage }).localStorage = original;
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });

  it('ignore une entrée expirée', async () => {
    const original = (globalThis as { localStorage?: Storage }).localStorage;
    const store = fakeStorage();
    (globalThis as { localStorage?: Storage }).localStorage = store;

    try {
      let clock = 0;
      const writer = browserCache(() => clock);
      await writer.set('a', 'valeur', 10);

      clock = 20_000;
      const reader = browserCache(() => clock);
      await expect(reader.get('a')).resolves.toBeNull();
    } finally {
      if (original) (globalThis as { localStorage?: Storage }).localStorage = original;
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });
});
