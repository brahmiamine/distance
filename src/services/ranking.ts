import type { GeocodedAddress, RankedAddress, TransitType } from '../types';
import type { CacheStore } from './cache';
import { geocodeAddress } from './geocoding';
import { haversineDistanceMeters } from './geo';
import { buildComparisonLinks } from './links';
import { findRecommendedJourney } from './transitous';

export const MAX_ADDRESSES = 20;
export const DEFAULT_TRANSIT_TYPES: TransitType[] = ['metro', 'rail', 'tram', 'bus'];
export const ALL_TRANSIT_TYPES: TransitType[] = ['metro', 'rail', 'tram', 'bus', 'cableway'];
export const DEFAULT_CONCURRENCY = 4;

/** Deux coûts sont considérés ex æquo en dessous de 2 % d'écart relatif. */
const TIE_RATIO = 0.02;

export interface RankContext {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  cache?: CacheStore | null;
  concurrency?: number;
}

export interface RankAddressesOptions {
  origin: string;
  addresses: string[];
  types: TransitType[];
  onProgress?: (message: string) => void;
  context?: RankContext;
}

export interface RankAddressesResult {
  origin: GeocodedAddress;
  ranking: RankedAddress[];
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
 * compromis marche / correspondances / temps / distance. Logique utilisée par
 * l'interface React et par les tests.
 */
export async function rankAddresses({
  origin,
  addresses,
  types,
  onProgress,
  context = {},
}: RankAddressesOptions): Promise<RankAddressesResult> {
  onProgress?.('Géocodage de l’adresse de départ…');
  const originAddress = await geocodeAddress(origin, context);

  const concurrency = context.concurrency ?? DEFAULT_CONCURRENCY;
  let completed = 0;

  const collected = await mapWithConcurrency(addresses, concurrency, async (input) => {
    try {
      const destination = await geocodeAddress(input, context);
      const directDistanceMeters = haversineDistanceMeters(originAddress, destination);
      const journey = await findRecommendedJourney(originAddress, destination, types, context);

      const distancePenalty = (directDistanceMeters / 1000) * 0.35;
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
        address: { input, label: input, lat: 0, lon: 0 },
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      } satisfies RankedAddress;
    } finally {
      completed += 1;
      onProgress?.(`Itinéraire ${completed}/${addresses.length} — ${input}`);
    }
  });

  applyRanks(collected);
  collected.sort(compareRanked);

  return { origin: originAddress, ranking: collected };
}
