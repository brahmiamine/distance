import { geocodeAddress } from './geocoding';
import { findRecommendedJourney } from './transitous';
import type { GeocodedAddress, RankedAddress, TransitType } from '../types';

export const MAX_ADDRESSES = 20;

export const DEFAULT_TRANSIT_TYPES: TransitType[] = ['metro', 'rail', 'tram', 'bus'];

export const ALL_TRANSIT_TYPES: TransitType[] = ['metro', 'rail', 'tram', 'bus', 'cableway'];

export function haversineDistanceMeters(a: GeocodedAddress, b: GeocodedAddress): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const radius = 6_371_000;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export interface RankAddressesOptions {
  /** Adresse de départ (texte libre, géocodée). */
  origin: string;
  /** Adresses de destination (texte libre, géocodées). */
  addresses: string[];
  /** Types de transport autorisés. */
  types: TransitType[];
  /** Progression optionnelle, pour afficher un état côté interface. */
  onProgress?: (message: string) => void;
}

export interface RankAddressesResult {
  origin: GeocodedAddress;
  ranking: RankedAddress[];
}

/**
 * Geocode une adresse de départ puis classe une liste de destinations selon le
 * compromis marche / correspondances / temps / distance. Logique partagée entre
 * l'interface React et l'API Cloudflare.
 */
export async function rankAddresses({
  origin,
  addresses,
  types,
  onProgress,
}: RankAddressesOptions): Promise<RankAddressesResult> {
  onProgress?.('Géocodage de l’adresse de départ…');
  const originAddress = await geocodeAddress(origin);

  const collected: RankedAddress[] = [];

  for (let index = 0; index < addresses.length; index += 1) {
    const input = addresses[index];
    onProgress?.(`Itinéraire ${index + 1}/${addresses.length} — ${input}`);

    try {
      const destination = await geocodeAddress(input);
      const directDistanceMeters = haversineDistanceMeters(originAddress, destination);
      const journey = await findRecommendedJourney(originAddress, destination, types);

      const distancePenalty = (directDistanceMeters / 1000) * 0.35;
      const rankingCost = journey.preferenceCost + distancePenalty;
      const recommendationScore = Math.max(1, Math.round(100 - rankingCost * 0.72));

      collected.push({
        address: destination,
        directDistanceMeters,
        journey,
        recommendationScore,
      });
    } catch (error) {
      collected.push({
        address: { input, label: input, lat: 0, lon: 0 },
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      });
    }
  }

  collected.sort((a, b) => {
    if (a.recommendationScore == null) return 1;
    if (b.recommendationScore == null) return -1;
    return b.recommendationScore - a.recommendationScore;
  });

  return { origin: originAddress, ranking: collected };
}
