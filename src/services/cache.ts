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

const CACHE_PREFIX = 'distance-cache:';
/** Anciennes entrées (réponses brutes MOTIS de plusieurs centaines de Ko). */
const LEGACY_PREFIXES = [`${CACHE_PREFIX}plan:`];

function cacheKeys(store: Storage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
  }
  return keys;
}

function expiresAtOf(store: Storage, key: string): number {
  try {
    const entry = JSON.parse(store.getItem(key) ?? '') as Partial<Entry>;
    return typeof entry.expiresAt === 'number' ? entry.expiresAt : 0;
  } catch {
    return 0;
  }
}

/**
 * Libère le localStorage occupé par le cache :
 * - supprime les anciennes entrées volumineuses et les entrées expirées ;
 * - avec `fraction`, supprime en plus cette part des entrées les plus proches
 *   de l'expiration (utile quand le quota est atteint).
 * Ne touche jamais aux autres clés (champs du formulaire).
 */
export function pruneBrowserCache(store: Storage, now: number = Date.now(), fraction = 0): number {
  let removed = 0;
  const remaining: Array<{ key: string; expiresAt: number }> = [];

  for (const key of cacheKeys(store)) {
    const expiresAt = expiresAtOf(store, key);
    if (LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix)) || expiresAt <= now) {
      store.removeItem(key);
      removed += 1;
    } else {
      remaining.push({ key, expiresAt });
    }
  }

  if (fraction > 0 && remaining.length) {
    remaining.sort((a, b) => a.expiresAt - b.expiresAt);
    const count = Math.max(1, Math.ceil(remaining.length * fraction));
    for (const { key } of remaining.slice(0, count)) {
      store.removeItem(key);
      removed += 1;
    }
  }

  return removed;
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Écrit une valeur dans le localStorage sans jamais lever d'exception : en cas
 * de quota dépassé, le cache est purgé puis l'écriture retentée une fois.
 */
export function safeStorageSet(key: string, value: string): boolean {
  const store = browserStorage();
  if (!store) return false;
  try {
    store.setItem(key, value);
    return true;
  } catch {
    try {
      pruneBrowserCache(store, Date.now(), 1);
      store.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
}

/** Lecture du localStorage sans exception (navigation privée, stockage bloqué). */
export function safeStorageGet(key: string): string | null {
  try {
    return browserStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * Cache persistant pour le navigateur : mémoire d'abord, puis localStorage si
 * disponible (best-effort, jamais bloquant).
 */
export function browserCache(now: () => number = Date.now): CacheStore {
  const memory = memoryCache(now);
  const storage = browserStorage;
  const prefix = CACHE_PREFIX;

  // Nettoyage au démarrage : anciennes réponses brutes et entrées expirées.
  try {
    const store = storage();
    if (store) pruneBrowserCache(store, now());
  } catch {
    // Stockage indisponible : le cache mémoire suffit.
  }

  return {
    async get(key) {
      const fromMemory = await memory.get(key);
      if (fromMemory !== null) return fromMemory;

      const store = storage();
      if (!store) return null;

      try {
        const raw = store.getItem(prefix + key);
        if (!raw) return null;
        const entry = JSON.parse(raw) as Entry;
        if (!entry || typeof entry.value !== 'string' || entry.expiresAt <= now()) {
          store.removeItem(prefix + key);
          return null;
        }
        await memory.set(key, entry.value, Math.max(1, (entry.expiresAt - now()) / 1000));
        return entry.value;
      } catch {
        try {
          store.removeItem(prefix + key);
        } catch {
          // Ignoré.
        }
        return null;
      }
    },
    async set(key, value, ttlSeconds) {
      await memory.set(key, value, ttlSeconds);
      const store = storage();
      if (!store) return;
      const serialized = JSON.stringify({ value, expiresAt: now() + ttlSeconds * 1000 });
      try {
        store.setItem(prefix + key, serialized);
      } catch {
        // Quota dépassé : on libère de la place (expirées puis la moitié la plus
        // ancienne) et on retente une fois ; sinon le cache mémoire suffit.
        try {
          pruneBrowserCache(store, now(), 0.5);
          store.setItem(prefix + key, serialized);
        } catch {
          // Ignoré.
        }
      }
    },
  };
}
