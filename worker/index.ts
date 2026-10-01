import { ALL_TRANSIT_TYPES, DEFAULT_TRANSIT_TYPES, MAX_ADDRESSES, rankAddresses } from '../src/services/ranking';
import type { TransitType } from '../src/types';

interface Env {
  /** Binding Cloudflare vers les fichiers statiques du build Vite. */
  ASSETS: { fetch(request: Request): Promise<Response> };
}

// L'API est publique et lisible : on autorise les appels depuis n'importe quelle origine.
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

function normalizeTypes(value: unknown): TransitType[] {
  if (!Array.isArray(value)) return DEFAULT_TRANSIT_TYPES;
  const valid = value.filter(
    (type): type is TransitType =>
      typeof type === 'string' && ALL_TRANSIT_TYPES.includes(type as TransitType),
  );
  return valid.length ? valid : DEFAULT_TRANSIT_TYPES;
}

async function handleRank(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Méthode non autorisée. Utilisez POST.' }, 405);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Corps JSON invalide.' }, 400);
  }

  const { origin, addresses, types } = (body ?? {}) as {
    origin?: unknown;
    addresses?: unknown;
    types?: unknown;
  };

  if (typeof origin !== 'string' || !origin.trim()) {
    return json({ error: 'Champ "origin" requis (adresse de départ).' }, 400);
  }
  if (!Array.isArray(addresses)) {
    return json({ error: 'Champ "addresses" requis (liste d’adresses).' }, 400);
  }

  const cleaned = [
    ...new Set(
      addresses
        .filter((address): address is string => typeof address === 'string')
        .map((address) => address.trim())
        .filter(Boolean),
    ),
  ];

  if (cleaned.length < 1) {
    return json({ error: 'Ajoutez au moins une adresse à comparer.' }, 400);
  }
  if (cleaned.length > MAX_ADDRESSES) {
    return json({ error: `Maximum ${MAX_ADDRESSES} adresses par requête.` }, 400);
  }

  try {
    const result = await rankAddresses({
      origin: origin.trim(),
      addresses: cleaned,
      types: normalizeTypes(types),
    });
    return json(result);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Erreur inconnue' }, 502);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/rank' || url.pathname === '/api/rank/') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }
      return handleRank(request);
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Route API inconnue. Utilisez POST /api/rank.' }, 404);
    }

    // Tout le reste est servi par les fichiers statiques (le front React).
    return env.ASSETS.fetch(request);
  },
};
