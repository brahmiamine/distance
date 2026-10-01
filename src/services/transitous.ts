import type { GeocodedAddress, JourneyRecommendation, TransitType } from '../types';
import { haversineDistanceMeters } from './geo';
import { fetchJson, type HttpRequestOptions } from './http';

const PLAN_URL = 'https://api.transitous.org/api/v6/plan';
const PLAN_TTL_SECONDS = 60;
const WALK_SPEED_MPS = 1.35;
const WALK_DETOUR_FACTOR = 1.25;
const MAX_WALK_FALLBACK_MINUTES = 60;

export interface JourneyContext {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  cache?: HttpRequestOptions['cache'];
  timeoutMs?: number;
  retries?: number;
}

interface Place {
  name?: string;
}

interface Leg {
  mode?: string;
  duration?: number;
  distance?: number;
  routeShortName?: string;
  displayName?: string;
  from?: Place;
  to?: Place;
}

interface Itinerary {
  duration?: number;
  transfers?: number;
  legs?: Leg[];
}

interface PlanResponse {
  itineraries?: Itinerary[];
}

const TRANSIT_MODES = new Set([
  'TRANSIT', 'TRAM', 'SUBWAY', 'FERRY', 'AIRPLANE', 'BUS', 'COACH', 'RAIL',
  'HIGHSPEED_RAIL', 'LONG_DISTANCE', 'NIGHT_RAIL', 'REGIONAL_FAST_RAIL',
  'REGIONAL_RAIL', 'SUBURBAN', 'FUNICULAR', 'AERIAL_LIFT', 'METRO',
]);

function apiModes(types: TransitType[]): string[] {
  const modes = new Set<string>();
  for (const type of types) {
    if (type === 'metro') modes.add('SUBWAY');
    if (type === 'tram') modes.add('TRAM');
    if (type === 'bus') modes.add('BUS');
    if (type === 'cableway') {
      modes.add('FUNICULAR');
      modes.add('AERIAL_LIFT');
    }
    if (type === 'rail') {
      modes.add('SUBURBAN');
      modes.add('RAIL');
      modes.add('REGIONAL_RAIL');
      modes.add('REGIONAL_FAST_RAIL');
      modes.add('LONG_DISTANCE');
      modes.add('HIGHSPEED_RAIL');
      modes.add('NIGHT_RAIL');
    }
  }
  return [...modes];
}

function numberOrZero(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function legDistance(leg: Leg): number {
  const distance = Number(leg.distance);
  if (Number.isFinite(distance) && distance >= 0) return distance;
  return numberOrZero(leg.duration) * WALK_SPEED_MPS;
}

function summarize(itinerary: Itinerary): JourneyRecommendation | null {
  const legs = Array.isArray(itinerary.legs) ? itinerary.legs : [];
  const durationSeconds = numberOrZero(itinerary.duration);
  if (!durationSeconds || !legs.length) return null;

  const transitLegs = legs.filter((leg) => leg.mode && TRANSIT_MODES.has(leg.mode));
  if (!transitLegs.length) return null;

  const walkLegs = legs.filter((leg) => leg.mode === 'WALK');
  const walkingSeconds = walkLegs.reduce((sum, leg) => sum + numberOrZero(leg.duration), 0);
  const walkingMeters = walkLegs.reduce((sum, leg) => sum + legDistance(leg), 0);

  const first = legs[0];
  const last = legs[legs.length - 1];
  const startWalkSeconds = first?.mode === 'WALK' ? numberOrZero(first.duration) : 0;
  const endWalkSeconds = last?.mode === 'WALK' ? numberOrZero(last.duration) : 0;
  const startWalkMeters = first?.mode === 'WALK' ? legDistance(first) : 0;
  const endWalkMeters = last?.mode === 'WALK' ? legDistance(last) : 0;

  const walkingMinutes = walkingSeconds / 60;
  const startWalkMinutes = startWalkSeconds / 60;
  const endWalkMinutes = endWalkSeconds / 60;
  const transferWalkMinutes = Math.max(0, walkingMinutes - startWalkMinutes - endWalkMinutes);
  const durationMinutes = durationSeconds / 60;
  const transfers = Math.max(0, Math.round(numberOrZero(itinerary.transfers)));
  const transportCount = transitLegs.length;

  const lines = transitLegs
    .map((leg) => leg.routeShortName || leg.displayName || leg.mode || '')
    .filter(Boolean)
    .filter((line, index, all) => index === 0 || line !== all[index - 1]);

  // Plus bas = mieux. La marche et les changements sont volontairement coûteux.
  const preferenceCost =
    durationMinutes * 0.45 +
    (startWalkMinutes + endWalkMinutes) * 1.8 +
    transferWalkMinutes * 1.2 +
    transfers * 12 +
    Math.max(0, transportCount - 1) * 5;

  return {
    kind: 'transit',
    durationMinutes,
    transfers,
    transportCount,
    walkingMinutes,
    walkingMeters,
    startWalkMinutes,
    startWalkMeters,
    endWalkMinutes,
    endWalkMeters,
    transferWalkMinutes,
    startStopName: transitLegs[0]?.from?.name,
    endStopName: transitLegs[transitLegs.length - 1]?.to?.name,
    lines,
    preferenceCost,
  };
}

/**
 * Repli piéton : utilisé quand aucun itinéraire en transport n'existe.
 * La marche est pénalisée comme de la marche (× 1.8) pour rester comparable.
 */
export function buildWalkJourney(
  origin: GeocodedAddress,
  destination: GeocodedAddress,
): JourneyRecommendation {
  const meters = haversineDistanceMeters(origin, destination) * WALK_DETOUR_FACTOR;
  const minutes = meters / WALK_SPEED_MPS / 60;

  return {
    kind: 'walk',
    durationMinutes: minutes,
    transfers: 0,
    transportCount: 0,
    walkingMinutes: minutes,
    walkingMeters: meters,
    startWalkMinutes: minutes,
    startWalkMeters: meters,
    endWalkMinutes: 0,
    endWalkMeters: 0,
    transferWalkMinutes: 0,
    lines: [],
    preferenceCost: minutes * 0.45 + minutes * 1.8,
  };
}

export async function findRecommendedJourney(
  origin: GeocodedAddress,
  destination: GeocodedAddress,
  types: TransitType[],
  context: JourneyContext = {},
): Promise<JourneyRecommendation> {
  const modes = apiModes(types);
  if (!modes.length) throw new Error('Sélectionnez au moins un transport.');

  const params = new URLSearchParams({
    fromPlace: `${origin.lat},${origin.lon}`,
    toPlace: `${destination.lat},${destination.lon}`,
    transitModes: modes.join(','),
    preTransitModes: 'WALK',
    postTransitModes: 'WALK',
    directModes: '',
    maxTransfers: '4',
    maxPreTransitTime: '1200',
    maxPostTransitTime: '1200',
    timetableView: 'true',
    numItineraries: '5',
    maxItineraries: '8',
    detailedLegs: 'false',
    detailedTransfers: 'false',
    joinInterlinedLegs: 'true',
  });

  const url = `${PLAN_URL}?${params.toString()}`;
  const data = await fetchJson<PlanResponse>(url, {
    headers: { Accept: 'application/json' },
    fetchImpl: context.fetchImpl,
    signal: context.signal,
    cache: context.cache,
    cacheKey: `plan:${url}`,
    cacheTtlSeconds: PLAN_TTL_SECONDS,
    timeoutMs: context.timeoutMs,
    retries: context.retries,
  });

  const itineraries = Array.isArray(data.itineraries) ? data.itineraries : [];
  const choices = itineraries
    .map(summarize)
    .filter((journey): journey is JourneyRecommendation => journey !== null)
    .sort((a, b) => a.preferenceCost - b.preferenceCost);

  if (choices.length) return choices[0];

  // Aucun transport disponible : on propose la marche si elle reste raisonnable.
  const walk = buildWalkJourney(origin, destination);
  if (walk.durationMinutes <= MAX_WALK_FALLBACK_MINUTES) return walk;

  throw new Error('Aucun itinéraire en transport trouvé actuellement.');
}
