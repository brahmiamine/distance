import type { GeocodedAddress, RankedAddress } from '../types';

export type MarkerTier = 'best' | 'good' | 'average' | 'poor';

export const TIER_LABELS: Record<MarkerTier, string> = {
  best: 'Meilleure',
  good: 'Bien placée',
  average: 'Moyenne',
  poor: 'Moins pratique',
};

/** Catégorie de couleur d'un repère selon son rang et son percentile dans le lot. */
export function markerTier(result: RankedAddress): MarkerTier {
  if (result.rank === 1) return 'best';
  const percentile = result.percentile ?? 100;
  if (percentile >= 60) return 'good';
  if (percentile >= 30) return 'average';
  return 'poor';
}

/** Coordonnées exploitables (géocodage réussi, hors valeur par défaut 0,0). */
export function hasCoordinates(address: GeocodedAddress): boolean {
  return (
    Number.isFinite(address.lat) &&
    Number.isFinite(address.lon) &&
    !(address.lat === 0 && address.lon === 0)
  );
}

export interface MapPoint {
  /** Index dans la liste des résultats affichée. */
  index: number;
  result: RankedAddress;
  tier: MarkerTier;
}

/** Destinations à placer sur la carte : classées et correctement géocodées. */
export function mapPoints(results: RankedAddress[]): MapPoint[] {
  return results
    .map((result, index) => ({ index, result, tier: markerTier(result) }))
    .filter(({ result }) => !result.error && result.rank != null && hasCoordinates(result.address));
}
