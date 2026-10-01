/**
 * Abstraction de cache partagée entre le navigateur et les tests.
 * Les valeurs sont stockées en texte (JSON sérialisé).
 */
export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

interface Entry {
  value: string;
  expiresAt: number;
}

/** Cache en mémoire avec expiration. Utilisé côté navigateur et dans les tests. */
export function memoryCache(now: () => number = Date.now): CacheStore {
  const entries = new Map<string, Entry>();

  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key, value, ttlSeconds) {
      entries.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
    },
  };
}

/**
 * Cache persistant pour le navigateur : mémoire d'abord, puis localStorage si
 * disponible (best-effort, jamais bloquant).
 */
export function browserCache(now: () => number = Date.now): CacheStore {
  const memory = memoryCache(now);

  const storage = (): Storage | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  };

  const prefix = 'distance-cache:';

  return {
    async get(key) {
      const fromMemory = await memory.get(key);
      if (fromMemory !== null) return fromMemory;

      const store = storage();
      if (!store) return null;

      const raw = store.getItem(prefix + key);
      if (!raw) return null;

      try {
        const entry = JSON.parse(raw) as Entry;
        if (!entry || typeof entry.value !== 'string' || entry.expiresAt <= now()) {
          store.removeItem(prefix + key);
          return null;
        }
        await memory.set(key, entry.value, Math.max(1, (entry.expiresAt - now()) / 1000));
        return entry.value;
      } catch {
        store.removeItem(prefix + key);
        return null;
      }
    },
    async set(key, value, ttlSeconds) {
      await memory.set(key, value, ttlSeconds);
      const store = storage();
      if (!store) return;
      try {
        store.setItem(
          prefix + key,
          JSON.stringify({ value, expiresAt: now() + ttlSeconds * 1000 }),
        );
      } catch {
        // Quota dépassé ou stockage indisponible : le cache mémoire suffit.
      }
    },
  };
}
