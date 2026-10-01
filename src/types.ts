export type TransitType = 'metro' | 'rail' | 'tram' | 'bus' | 'cableway';

export interface GeocodedAddress {
  input: string;
  label: string;
  lat: number;
  lon: number;
  city?: string;
  postcode?: string;
}

export interface TransitStop {
  id: string;
  name: string;
  type: TransitType;
  town?: string;
  lat: number;
  lon: number;
  distanceMeters: number;
}

export interface RankedAddress {
  address: GeocodedAddress;
  stops: TransitStop[];
  nearestStop?: TransitStop;
  error?: string;
}
