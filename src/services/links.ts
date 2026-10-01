import type { ComparisonLinks } from '../types';
import type { Coordinates } from './geo';

interface LinkPlace extends Coordinates {
  label: string;
}

/** Lien Google Maps (transports en commun) entre deux adresses. */
export function googleMapsUrl(origin: LinkPlace, destination: LinkPlace): string {
  const params = new URLSearchParams({
    api: '1',
    origin: origin.label,
    destination: destination.label,
    travelmode: 'transit',
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Lien Citymapper entre deux adresses. */
export function citymapperUrl(origin: LinkPlace, destination: LinkPlace): string {
  const params = new URLSearchParams({
    startcoord: `${origin.lat},${origin.lon}`,
    startname: origin.label,
    endcoord: `${destination.lat},${destination.lon}`,
    endname: destination.label,
  });
  return `https://citymapper.com/directions?${params.toString()}`;
}

/** Construit les liens de vérification manuelle pour un couple origine/destination. */
export function buildComparisonLinks(origin: LinkPlace, destination: LinkPlace): ComparisonLinks {
  return {
    googleMaps: googleMapsUrl(origin, destination),
    citymapper: citymapperUrl(origin, destination),
  };
}
