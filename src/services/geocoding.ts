import type { GeocodedAddress } from '../types';

const GEOCODING_URL = 'https://data.geopf.fr/geocodage/search';

interface GeoFeature {
  geometry?: {
    coordinates?: [number, number];
  };
  properties?: {
    label?: string;
    city?: string;
    postcode?: string;
  };
}

interface GeoResponse {
  features?: GeoFeature[];
}

export async function geocodeAddress(input: string): Promise<GeocodedAddress> {
  const params = new URLSearchParams({
    q: input,
    limit: '1',
    returntruegeometry: 'false',
  });

  const response = await fetch(`${GEOCODING_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Géocodage indisponible (${response.status})`);
  }

  const data = (await response.json()) as GeoResponse;
  const feature = data.features?.[0];
  const coordinates = feature?.geometry?.coordinates;

  if (!feature || !coordinates) {
    throw new Error('Adresse introuvable');
  }

  const [lon, lat] = coordinates;

  return {
    input,
    label: feature.properties?.label ?? input,
    lat,
    lon,
    city: feature.properties?.city,
    postcode: feature.properties?.postcode,
  };
}
