import { describe, expect, it } from 'vitest';
import { browserCache, memoryCache, pruneBrowserCache, safeStorageGet, safeStorageSet } from './cache';

/** Stockage factice ; `quota` = taille totale maximale (clés + valeurs). */
function fakeStorage(quota = Number.POSITIVE_INFINITY): Storage {
  const map = new Map<string, string>();
  const size = () => [...map].reduce((sum, [key, value]) => sum + key.length + value.length, 0);
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
      const previous = map.get(key);
      map.set(key, value);
      if (size() > quota) {
        if (previous === undefined) map.delete(key);
        else map.set(key, previous);
        throw new DOMException('quota', 'QuotaExceededError');
      }
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

function withStorage(store: Storage, run: () => Promise<void> | void) {
  const original = (globalThis as { localStorage?: Storage }).localStorage;
  (globalThis as { localStorage?: Storage }).localStorage = store;
  const restore = () => {
    if (original) (globalThis as { localStorage?: Storage }).localStorage = original;
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  };
  return Promise.resolve().then(run).finally(restore);
}

describe('quota du localStorage', () => {
  it('purge au démarrage les anciennes réponses brutes et les entrées expirées', async () => {
    const store = fakeStorage();
    store.setItem('distance-cache:plan:https://x', JSON.stringify({ value: 'x'.repeat(100), expiresAt: 9e15 }));
    store.setItem('distance-cache:old', JSON.stringify({ value: 'v', expiresAt: 1 }));
    store.setItem('distance-cache:fresh', JSON.stringify({ value: 'v', expiresAt: 9e15 }));
    store.setItem('distance-transports-addresses', 'mes adresses');

    await withStorage(store, () => {
      browserCache(() => 1000);
    });

    expect(store.getItem('distance-cache:plan:https://x')).toBeNull();
    expect(store.getItem('distance-cache:old')).toBeNull();
    expect(store.getItem('distance-cache:fresh')).not.toBeNull();
    expect(store.getItem('distance-transports-addresses')).toBe('mes adresses');
  });

  it('libère de la place quand le quota est atteint au lieu d’échouer', async () => {
    const store = fakeStorage(600);
    await withStorage(store, async () => {
      const cache = browserCache(() => 0);
      for (let index = 0; index < 10; index += 1) {
        await expect(cache.set(`k${index}`, 'v'.repeat(80), 60 + index)).resolves.toBeUndefined();
      }
      await expect(cache.get('k9')).resolves.toBe('v'.repeat(80));
    });
    expect(store.getItem('distance-cache:k9')).not.toBeNull();
  });

  it('safeStorageSet purge le cache pour enregistrer les champs du formulaire', async () => {
    const store = fakeStorage(300);
    store.setItem('distance-cache:a', JSON.stringify({ value: 'x'.repeat(200), expiresAt: 9e15 }));

    await withStorage(store, () => {
      expect(safeStorageSet('distance-transports-addresses', 'y'.repeat(150))).toBe(true);
      expect(safeStorageGet('distance-transports-addresses')).toBe('y'.repeat(150));
    });
    expect(store.getItem('distance-cache:a')).toBeNull();
  });

  it('safeStorageSet renvoie false sans lever d’exception si rien ne suffit', async () => {
    await withStorage(fakeStorage(10), () => {
      expect(safeStorageSet('distance-transports-addresses', 'z'.repeat(100))).toBe(false);
    });
  });

  it('pruneBrowserCache ne supprime que des entrées du cache', () => {
    const store = fakeStorage();
    store.setItem('autre', '1');
    store.setItem('distance-cache:a', JSON.stringify({ value: 'v', expiresAt: 9e15 }));
    expect(pruneBrowserCache(store, 0, 1)).toBe(1);
    expect(store.getItem('autre')).toBe('1');
  });
});
