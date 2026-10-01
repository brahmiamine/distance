import type { GeocodedAddress, GeocodingConfidence } from '../types';
import { fetchJson, type HttpRequestOptions } from './http';

const GEOCODING_URL = 'https://data.geopf.fr/geocodage/search';
const GEOCODE_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface GeocodeContext {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  cache?: HttpRequestOptions['cache'];
  timeoutMs?: number;
  retries?: number;
}

export class GeocodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeocodingError';
  }
}

interface GeoFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    label?: string;
    city?: string;
    postcode?: string;
    type?: string;
    score?: number;
  };
}

interface GeoResponse {
  features?: GeoFeature[];
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Code postal à 5 chiffres présent dans la saisie. */
export function extractPostcode(input: string): string | undefined {
  return input.match(/\b(\d{5})\b/)?.[1];
}

/** Indice de ville : dernier segment sans chiffre (ex. « COLOMBES »). */
export function extractCityHint(input: string): string | undefined {
  const segments = input
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (!/\d/.test(segment) && segment.length >= 3) return segment;
  }
  return undefined;
}

const TYPE_BONUS: Record<string, number> = {
  housenumber: 2.2,
  street: 1.4,
  locality: 0.6,
  municipality: 0.2,
};

interface ScoredCandidate {
  feature: GeoFeature;
  total: number;
  matchedPostcode: boolean;
  matchedCity: boolean;
}

function scoreCandidate(
  feature: GeoFeature,
  inputPostcode: string | undefined,
  inputCity: string | undefined,
): ScoredCandidate {
  const properties = feature.properties ?? {};
  const postcode = properties.postcode;
  const city = properties.city;

  const matchedPostcode = Boolean(inputPostcode) && postcode === inputPostcode;
  const cityNorm = city ? normalize(city) : '';
  const inputCityNorm = inputCity ? normalize(inputCity) : '';
  const matchedCity =
    Boolean(inputCityNorm) &&
    Boolean(cityNorm) &&
    (cityNorm.includes(inputCityNorm) || inputCityNorm.includes(cityNorm));

  let total = 0;
  if (inputPostcode) total += matchedPostcode ? 4 : -3;
  if (matchedCity) total += 3;
  total += TYPE_BONUS[properties.type ?? ''] ?? 0;
  if (typeof properties.score === 'number' && Number.isFinite(properties.score)) {
    total += properties.score;
  }

  return { feature, total, matchedPostcode, matchedCity };
}

function confidenceFor(candidate: ScoredCandidate, hasPostcode: boolean): GeocodingConfidence {
  const type = candidate.feature.properties?.type;
  if (candidate.matchedPostcode && hasPostcode) return 'high';
  if (type === 'housenumber' && (!hasPostcode || candidate.matchedPostcode)) return 'high';
  if (candidate.matchedCity || type === 'street') return 'medium';
  return 'low';
}

/**
 * Géocode une adresse puis valide le résultat :
 * - compare le code postal et l'indice de ville saisis aux candidats ;
 * - privilégie les types précis (numéro, voie) et le score IGN ;
 * - rejette les rattachements manifestement faux (CP saisi introuvable partout).
 */
export async function geocodeAddress(
  input: string,
  context: GeocodeContext = {},
): Promise<GeocodedAddress> {
  const query = input.trim();
  if (!query) throw new GeocodingError('Adresse vide');

  const params = new URLSearchParams({ q: query, limit: '5', returntruegeometry: 'false' });
  const url = `${GEOCODING_URL}?${params.toString()}`;

  const data = await fetchJson<GeoResponse>(url, {
    headers: { Accept: 'application/json' },
    fetchImpl: context.fetchImpl,
    signal: context.signal,
    cache: context.cache,
    cacheKey: `geocode:${url}`,
    cacheTtlSeconds: GEOCODE_TTL_SECONDS,
    timeoutMs: context.timeoutMs,
    retries: context.retries,
  });

  const features = (Array.isArray(data.features) ? data.features : []).filter(
    (feature) => feature.geometry?.coordinates,
  );
  if (!features.length) throw new GeocodingError('Adresse introuvable');

  const inputPostcode = extractPostcode(query);
  const inputCity = extractCityHint(query);

  const candidates = features
    .map((feature) => scoreCandidate(feature, inputPostcode, inputCity))
    .sort((a, b) => b.total - a.total);

  const best = candidates[0];

  // Validation dure : le code postal saisi n'existe chez aucun candidat et la
  // ville ne compense pas → l'adresse est probablement mal comprise.
  if (inputPostcode && !candidates.some((candidate) => candidate.matchedPostcode)) {
    const anyCityMatch = candidates.some((candidate) => candidate.matchedCity);
    if (!anyCityMatch) {
      const found = best.feature.properties?.postcode;
      throw new GeocodingError(
        found
          ? `Code postal ${inputPostcode} non trouvé (proche : ${found})`
          : `Code postal ${inputPostcode} non trouvé`,
      );
    }
  }

  const coordinates = best.feature.geometry?.coordinates;
  if (!coordinates) throw new GeocodingError('Adresse introuvable');

  const properties = best.feature.properties ?? {};
  const [lon, lat] = coordinates;

  return {
    input: query,
    label: properties.label ?? query,
    lat,
    lon,
    city: properties.city,
    postcode: properties.postcode,
    type: properties.type,
    score: typeof properties.score === 'number' ? properties.score : undefined,
    confidence: confidenceFor(best, Boolean(inputPostcode)),
  };
}
