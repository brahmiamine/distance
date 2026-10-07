import type { GeocodedAddress, RankedAddress, TransitType } from '../types';
import type { CacheStore } from './cache';
import { referenceDepartureTime } from './departureTime';
import { geocodeAddress } from './geocoding';
import { haversineDistanceMeters } from './geo';
import { buildComparisonLinks } from './links';
import { findRecommendedJourney } from './transitous';
import { postcodeInZone, preFilterByZone, type Zone } from './zoneFilter';

/** Destinations calculées au plus en une fois (après filtre de zone). */
export const MAX_ADDRESSES = 50;
export const DEFAULT_TRANSIT_TYPES: TransitType[] = ['metro', 'rail', 'tram', 'bus'];
export const ALL_TRANSIT_TYPES: TransitType[] = ['metro', 'rail', 'tram', 'bus', 'cableway'];
export const DEFAULT_CONCURRENCY = 4;
/** Transitous limite le débit par client : plus de parallélisme n'accélère pas. */
export const DEFAULT_JOURNEY_CONCURRENCY = 2;

/** Deux coûts sont considérés ex æquo en dessous de 2 % d'écart relatif. */
const TIE_RATIO = 0.02;

/** Critère secondaire : 0,3 « minute ressentie » par km à vol d'oiseau. */
const DISTANCE_WEIGHT_PER_KM = 0.3;

export interface RankContext {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  cache?: CacheStore | null;
  /** Géocodages simultanés. */
  concurrency?: number;
  /** Calculs d'itinéraires simultanés. */
  journeyConcurrency?: number;
  /** Heure de départ de référence (défaut : prochain jour ouvré à 9 h). */
  departureTime?: Date;
}

export interface RankAddressesOptions {
  origin: string;
  addresses: string[];
  types: TransitType[];
  /** Zone des destinations à calculer (défaut : toutes). */
  zone?: Zone;
  onProgress?: (message: string) => void;
  context?: RankContext;
}

export interface RankAddressesResult {
  origin: GeocodedAddress;
  ranking: RankedAddress[];
  /** Horaire de référence utilisé pour tous les itinéraires. */
  departureTime: Date;
  /** Destinations ignorées car hors de la zone choisie (non calculées). */
  excluded: ExcludedAddress[];
}

export interface ExcludedAddress {
  input: string;
  /** Libellé géocodé, si l'exclusion a été décidée après géocodage. */
  label?: string;
  postcode?: string;
}

function isTied(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * TIE_RATIO;
}

/** Exécute `worker` sur `items` en limitant le nombre de tâches simultanées. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * Attribue rang, statut ex æquo et percentile relatif.
 * Plus bas coût = meilleur rang. En cas d'égalité (à 2 %), le rang est partagé.
 */
function applyRanks(entries: RankedAddress[]): void {
  const scored = entries
    .filter((entry): entry is RankedAddress & { cost: number } => typeof entry.cost === 'number')
    .sort((a, b) => a.cost - b.cost);

  const total = scored.length;
  const groups: Array<{ cost: number; members: Array<RankedAddress & { cost: number }> }> = [];

  for (const entry of scored) {
    const last = groups[groups.length - 1];
    if (last && isTied(last.cost, entry.cost)) last.members.push(entry);
    else groups.push({ cost: entry.cost, members: [entry] });
  }

  let rank = 1;
  for (const group of groups) {
    for (const entry of group.members) {
      entry.rank = rank;
      entry.tied = group.members.length > 1;
      entry.tiedCount = group.members.length;
      entry.percentile = total <= 1 ? undefined : Math.round((100 * (total - rank)) / (total - 1));
    }
    rank += group.members.length;
  }
}

function compareRanked(a: RankedAddress, b: RankedAddress): number {
  const aScored = typeof a.cost === 'number';
  const bScored = typeof b.cost === 'number';
  if (aScored && bScored) return (a.cost as number) - (b.cost as number);
  if (aScored) return -1;
  if (bScored) return 1;
  return 0;
}

/**
 * Géocode une adresse de départ puis classe une liste de destinations selon le
 * coût généralisé moyen (marche, attente, correspondances, temps) puis la distance. Logique utilisée par
 * l'interface React et par les tests.
 */
export async function rankAddresses({
  origin,
  addresses,
  types,
  zone = 'all',
  onProgress,
  context = {},
}: RankAddressesOptions): Promise<RankAddressesResult> {
  onProgress?.('Géocodage de l’adresse de départ…');
  const originAddress = await geocodeAddress(origin, context);

  const departureTime = context.departureTime ?? referenceDepartureTime();
  const journeyContext = { ...context, departureTime };
  const concurrency = context.concurrency ?? DEFAULT_CONCURRENCY;
  const journeyConcurrency = context.journeyConcurrency ?? DEFAULT_JOURNEY_CONCURRENCY;

  // Tri préalable sans réseau d'après le code postal saisi : les adresses
  // hors zone ne sont ni géocodées ni calculées.
  const { kept, excluded: preExcluded } = preFilterByZone(addresses, zone);
  const excluded: ExcludedAddress[] = preExcluded.map((input) => ({ input }));

  // 1. Géocodage (IGN, rapide) de toutes les destinations.
  onProgress?.(`Géocodage de ${kept.length} destination${kept.length > 1 ? 's' : ''}…`);
  const geocoded = await mapWithConcurrency(kept, concurrency, async (input) => {
    try {
      return { input, destination: await geocodeAddress(input, context) };
    } catch (error) {
      return { input, error: error instanceof Error ? error.message : 'Erreur inconnue' };
    }
  });

  const collected: RankedAddress[] = [];
  const toRoute: Array<{ input: string; destination: GeocodedAddress }> = [];
  for (const item of geocoded) {
    if ('error' in item) {
      collected.push({ address: { input: item.input, label: item.input, lat: 0, lon: 0 }, error: item.error });
    } else if (item.destination.postcode && !postcodeInZone(item.destination.postcode, zone)) {
      // Adresse saisie sans code postal : la zone est vérifiée sur le géocodage.
      excluded.push({ input: item.input, label: item.destination.label, postcode: item.destination.postcode });
    } else {
      toRoute.push(item);
    }
  }

  // 2. Itinéraires (Transitous, débit limité) : peu de requêtes simultanées.
  let completed = 0;
  const routed = await mapWithConcurrency(toRoute, journeyConcurrency, async ({ input, destination }) => {
    try {
      const directDistanceMeters = haversineDistanceMeters(originAddress, destination);
      const journey = await findRecommendedJourney(originAddress, destination, types, journeyContext);

      const distancePenalty = (directDistanceMeters / 1000) * DISTANCE_WEIGHT_PER_KM;
      const cost = journey.preferenceCost + distancePenalty;

      return {
        address: destination,
        directDistanceMeters,
        journey,
        comparison: buildComparisonLinks(originAddress, destination),
        cost,
      } satisfies RankedAddress;
    } catch (error) {
      return {
        address: { ...destination, input },
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      } satisfies RankedAddress;
    } finally {
      completed += 1;
      onProgress?.(`Itinéraire ${completed}/${toRoute.length} — ${input}`);
    }
  });
  collected.push(...routed);

  applyRanks(collected);
  collected.sort(compareRanked);

  return { origin: originAddress, ranking: collected, departureTime, excluded };
}
