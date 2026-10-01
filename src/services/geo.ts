export interface Coordinates {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

/** Distance orthodromique (à vol d'oiseau) entre deux points, en mètres. */
export function haversineDistanceMeters(a: Coordinates, b: Coordinates): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
