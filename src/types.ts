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

export interface JourneyRecommendation {
  durationMinutes: number;
  transfers: number;
  transportCount: number;
  walkingMinutes: number;
  walkingMeters: number;
  startWalkMinutes: number;
  startWalkMeters: number;
  endWalkMinutes: number;
  endWalkMeters: number;
  transferWalkMinutes: number;
  startStopName?: string;
  endStopName?: string;
  lines: string[];
  preferenceCost: number;
}

export interface RankedAddress {
  address: GeocodedAddress;
  directDistanceMeters?: number;
  journey?: JourneyRecommendation;
  recommendationScore?: number;
  error?: string;
}
