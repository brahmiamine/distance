import type { GeocodedAddress, JourneyRecommendation, TransitType } from '../types';
import { referenceDepartureTime } from './departureTime';
import { haversineDistanceMeters } from './geo';
import { fetchJson, type HttpRequestOptions } from './http';

const PLAN_URL = 'https://api.transitous.org/api/v6/plan';
const PLAN_TTL_SECONDS = 60 * 60 * 6;
const WALK_SPEED_MPS = 1.35;
const WALK_DETOUR_FACTOR = 1.25;
const MAX_WALK_FALLBACK_MINUTES = 60;
/** Au-delà, MOTIS ne propose pas de trajet direct à pied. */
const MAX_DIRECT_WALK_SECONDS = 45 * 60;
/**
 * Transitous limite le débit par client (≈ 1 requête / 3 s après une rafale) :
 * les requêtes patientent côté serveur, d'où un délai long et des nouvelles
 * tentatives espacées plutôt qu'un abandon après quelques secondes.
 */
const PLAN_TIMEOUT_MS = 45_000;
const PLAN_RETRIES = 3;
const PLAN_RETRY_DELAY_MS = 2_000;

export interface JourneyContext {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  cache?: HttpRequestOptions['cache'];
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  /** Heure de départ de référence (défaut : prochain jour ouvré à 9 h). */
  departureTime?: Date;
}

interface Place {
  name?: string;
}

interface Leg {
  mode?: string;
  duration?: number;
  distance?: number;
  startTime?: string;
  routeShortName?: string;
  displayName?: string;
  from?: Place;
  to?: Place;
}

interface Itinerary {
  duration?: number;
  startTime?: string;
  transfers?: number;
  legs?: Leg[];
}

interface PlanResponse {
  itineraries?: Itinerary[];
  direct?: Itinerary[];
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

function timeMs(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function legDistance(leg: Leg): number {
  const distance = Number(leg.distance);
  if (Number.isFinite(distance) && distance >= 0) return distance;
  return numberOrZero(leg.duration) * WALK_SPEED_MPS;
}

/**
 * Coût généralisé, exprimé en « minutes ressenties » (plus bas = mieux).
 * Pondérations inspirées des modèles de déplacement : une minute de marche ou
 * d'attente pèse plus qu'une minute assis dans un véhicule, chaque montée et
 * chaque correspondance ajoute une pénalité fixe.
 */
export const COST_WEIGHTS = {
  inVehicle: 1,
  walk: 1.8,
  transferWait: 1.5,
  initialWait: 1,
  boarding: 5,
  transfer: 8,
} as const;

/** Fenêtre (min) sur laquelle on moyenne l'attente au premier arrêt. */
const WAIT_WINDOW_MINUTES = 60;

interface Candidate {
  journey: JourneyRecommendation;
  /** Coût hors attente initiale. */
  baseCost: number;
  /** Heure de départ du domicile (ms), absente pour la marche directe. */
  departureMs?: number;
}

function summarize(itinerary: Itinerary): Candidate | null {
  const legs = Array.isArray(itinerary.legs) ? itinerary.legs : [];
  const durationSeconds = numberOrZero(itinerary.duration);
  if (!durationSeconds || !legs.length) return null;

  const transitLegs = legs.filter((leg) => leg.mode && TRANSIT_MODES.has(leg.mode));
  if (!transitLegs.length) return null;

  const walkLegs = legs.filter((leg) => leg.mode === 'WALK');
  const walkingSeconds = walkLegs.reduce((sum, leg) => sum + numberOrZero(leg.duration), 0);
  const walkingMeters = walkLegs.reduce((sum, leg) => sum + legDistance(leg), 0);
  const inVehicleSeconds = transitLegs.reduce((sum, leg) => sum + numberOrZero(leg.duration), 0);

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
  const inVehicleMinutes = inVehicleSeconds / 60;
  const transferWaitMinutes = Math.max(0, durationMinutes - walkingMinutes - inVehicleMinutes);
  const transfers = Math.max(0, Math.round(numberOrZero(itinerary.transfers)));
  const transportCount = transitLegs.length;

  const lines = transitLegs
    .map((leg) => leg.routeShortName || leg.displayName || leg.mode || '')
    .filter(Boolean)
    .filter((line, index, all) => index === 0 || line !== all[index - 1]);

  const baseCost =
    inVehicleMinutes * COST_WEIGHTS.inVehicle +
    walkingMinutes * COST_WEIGHTS.walk +
    transferWaitMinutes * COST_WEIGHTS.transferWait +
    transportCount * COST_WEIGHTS.boarding +
    transfers * COST_WEIGHTS.transfer;

  return {
    journey: {
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
      averageWaitMinutes: 0,
      startStopName: transitLegs[0]?.from?.name,
      endStopName: transitLegs[transitLegs.length - 1]?.to?.name,
      lines,
      preferenceCost: baseCost,
    },
    baseCost,
    departureMs: timeMs(itinerary.startTime ?? first?.startTime),
  };
}

function walkJourney(minutes: number, meters: number): JourneyRecommendation {
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
    averageWaitMinutes: 0,
    lines: [],
    preferenceCost: minutes * COST_WEIGHTS.walk,
  };
}

/** Trajet direct à pied calculé par MOTIS (réseau piéton OSM). */
function summarizeDirectWalk(itinerary: Itinerary): Candidate | null {
  const legs = Array.isArray(itinerary.legs) ? itinerary.legs : [];
  if (!legs.length || legs.some((leg) => leg.mode !== 'WALK')) return null;
  const seconds = numberOrZero(itinerary.duration);
  if (!seconds) return null;
  const meters = legs.reduce((sum, leg) => sum + legDistance(leg), 0);
  const journey = walkJourney(seconds / 60, meters);
  return { journey, baseCost: journey.preferenceCost };
}

/**
 * Repli piéton estimé (vol d'oiseau × détour) : utilisé quand MOTIS ne renvoie
 * ni transport ni trajet direct à pied.
 */
export function buildWalkJourney(
  origin: GeocodedAddress,
  destination: GeocodedAddress,
): JourneyRecommendation {
  const meters = haversineDistanceMeters(origin, destination) * WALK_DETOUR_FACTOR;
  return walkJourney(meters / WALK_SPEED_MPS / 60, meters);
}

/**
 * Simule un voyageur prêt à partir à un instant quelconque de la fenêtre
 * [début, début + 60 min] : à chaque minute il choisit l'option la moins
 * coûteuse (attente au domicile comprise, ou marche directe). On retient le
 * coût moyen — ce qui pénalise naturellement les lignes peu fréquentes — et
 * l'option la plus souvent choisie pour l'affichage.
 */
export function chooseJourney(
  transit: Candidate[],
  walk: Candidate | null,
  windowStartMs?: number,
): JourneyRecommendation | null {
  const timed = transit.filter((candidate) => candidate.departureMs != null);
  const untimed = transit.filter((candidate) => candidate.departureMs == null);

  // Sans horaires exploitables : simple comparaison des coûts hors attente.
  if (!timed.length) {
    const pool = [...untimed, ...(walk ? [walk] : [])].sort((a, b) => a.baseCost - b.baseCost);
    return pool[0]?.journey ?? null;
  }

  const earliest = Math.min(...timed.map((candidate) => candidate.departureMs as number));
  let start = windowStartMs ?? earliest;
  let options = timed.filter((candidate) => (candidate.departureMs as number) >= start - 60_000);
  if (!options.length) {
    options = timed;
    start = earliest;
  }
  const latest = Math.max(...options.map((candidate) => candidate.departureMs as number));
  const end = Math.min(start + WAIT_WINDOW_MINUTES * 60_000, Math.max(start, latest));
  const steps = Math.max(1, Math.round((end - start) / 60_000));

  const picks = new Map<Candidate, number>();
  let totalCost = 0;
  let totalWait = 0;

  for (let step = 0; step < steps; step += 1) {
    const t = start + step * 60_000;
    let best: Candidate | null = walk;
    let bestCost = walk ? walk.baseCost : Number.POSITIVE_INFINITY;
    let bestWait = 0;

    for (const candidate of options) {
      const departure = candidate.departureMs as number;
      if (departure < t) continue;
      const wait = Math.max(0, (departure - t) / 60_000);
      const cost = candidate.baseCost + wait * COST_WEIGHTS.initialWait;
      if (cost < bestCost) {
        best = candidate;
        bestCost = cost;
        bestWait = wait;
      }
    }

    if (!best) continue;
    picks.set(best, (picks.get(best) ?? 0) + 1);
    totalCost += bestCost;
    totalWait += bestWait;
  }

  const counted = [...picks.values()].reduce((sum, count) => sum + count, 0);
  if (!counted) return walk?.journey ?? null;

  // Option affichée : l'itinéraire (mêmes lignes) le plus souvent retenu ; à
  // égalité, le moins coûteux. Les départs successifs d'une ligne sont cumulés.
  const patternOf = (candidate: Candidate) =>
    `${candidate.journey.kind}:${candidate.journey.lines.join('>')}`;
  const patternPicks = new Map<string, number>();
  for (const [candidate, count] of picks) {
    const key = patternOf(candidate);
    patternPicks.set(key, (patternPicks.get(key) ?? 0) + count);
  }
  const shown = [...picks.keys()].sort(
    (a, b) =>
      (patternPicks.get(patternOf(b)) ?? 0) - (patternPicks.get(patternOf(a)) ?? 0) ||
      a.baseCost - b.baseCost,
  )[0];

  return {
    ...shown.journey,
    averageWaitMinutes: totalWait / counted,
    preferenceCost: totalCost / counted,
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

  const departure = context.departureTime ?? referenceDepartureTime();

  const params = new URLSearchParams({
    fromPlace: `${origin.lat},${origin.lon}`,
    toPlace: `${destination.lat},${destination.lon}`,
    time: departure.toISOString(),
    transitModes: modes.join(','),
    preTransitModes: 'WALK',
    postTransitModes: 'WALK',
    directModes: 'WALK',
    maxDirectTime: String(MAX_DIRECT_WALK_SECONDS),
    maxTransfers: '4',
    maxPreTransitTime: '1200',
    maxPostTransitTime: '1200',
    timetableView: 'true',
    numItineraries: '6',
    maxItineraries: '10',
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
    timeoutMs: context.timeoutMs ?? PLAN_TIMEOUT_MS,
    retries: context.retries ?? PLAN_RETRIES,
    retryDelayMs: context.retryDelayMs ?? PLAN_RETRY_DELAY_MS,
  });

  const itineraries = Array.isArray(data.itineraries) ? data.itineraries : [];
  const transit = itineraries
    .map(summarize)
    .filter((candidate): candidate is Candidate => candidate !== null);

  const direct = (Array.isArray(data.direct) ? data.direct : [])
    .map(summarizeDirectWalk)
    .filter((candidate): candidate is Candidate => candidate !== null)
    .sort((a, b) => a.baseCost - b.baseCost)[0] ?? null;

  const chosen = chooseJourney(transit, direct, departure.getTime());
  if (chosen) return chosen;

  // Aucun transport disponible : on propose la marche si elle reste raisonnable.
  const walk = buildWalkJourney(origin, destination);
  if (walk.durationMinutes <= MAX_WALK_FALLBACK_MINUTES) return walk;

  throw new Error('Aucun itinéraire en transport trouvé.');
}
