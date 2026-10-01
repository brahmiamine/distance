import type { GeocodedAddress, TransitStop, TransitType } from '../types';

const IDFM_STOPS_URL =
  'https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/arrets/records';

interface IdfmStopRecord {
  arrid?: string;
  arrname?: string;
  arrtype?: string;
  arrtown?: string;
  arrgeopoint?: [number, number];
}

interface IdfmResponse {
  results?: IdfmStopRecord[];
}

const SUPPORTED_TYPES = new Set<TransitType>(['metro', 'rail', 'tram', 'bus', 'cableway']);

function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const radius = 6_371_000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function typeFilter(types: TransitType[]): string {
  return types.map((type) => `arrtype = "${type}"`).join(' or ');
}

async function queryStops(
  address: GeocodedAddress,
  types: TransitType[],
  radiusKm: number,
): Promise<TransitStop[]> {
  const point = `geom'POINT(${address.lon} ${address.lat})'`;
  const where = `within_distance(arrgeopoint, ${point}, ${radiusKm} km) and (${typeFilter(types)})`;
  const params = new URLSearchParams({
    where,
    order_by: `distance(arrgeopoint, ${point})`,
    limit: '30',
  });

  const response = await fetch(`${IDFM_STOPS_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Données IDFM indisponibles (${response.status})`);
  }

  const data = (await response.json()) as IdfmResponse;

  return (data.results ?? [])
    .map((record): TransitStop | null => {
      const coords = record.arrgeopoint;
      const type = record.arrtype as TransitType | undefined;
      if (!coords || !type || !SUPPORTED_TYPES.has(type)) return null;

      const [lat, lon] = coords;
      return {
        id: record.arrid ?? `${record.arrname}-${lat}-${lon}`,
        name: record.arrname ?? 'Arrêt sans nom',
        type,
        town: record.arrtown,
        lat,
        lon,
        distanceMeters: haversineDistanceMeters(address.lat, address.lon, lat, lon),
      };
    })
    .filter((stop): stop is TransitStop => stop !== null)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export async function findNearestStops(
  address: GeocodedAddress,
  types: TransitType[],
): Promise<TransitStop[]> {
  for (const radius of [2, 5, 10]) {
    const stops = await queryStops(address, types, radius);
    if (stops.length > 0) return stops.slice(0, 5);
  }
  return [];
}
