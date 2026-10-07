export type TransitType = 'metro' | 'rail' | 'tram' | 'bus' | 'cableway';

export type GeocodingConfidence = 'high' | 'medium' | 'low';

export interface GeocodedAddress {
  input: string;
  label: string;
  lat: number;
  lon: number;
  city?: string;
  postcode?: string;
  /** Type IGN : housenumber, street, locality, municipality… */
  type?: string;
  /** Score de pertinence IGN (0 à 1). */
  score?: number;
  /** Fiabilité estimée du rattachement à l'adresse saisie. */
  confidence?: GeocodingConfidence;
}

export type JourneyKind = 'transit' | 'walk';

export interface JourneyRecommendation {
  /** `transit` = itinéraire en transport, `walk` = repli piéton sans transport. */
  kind: JourneyKind;
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
  /** Attente moyenne au premier arrêt sur l'heure de référence (fréquence). */
  averageWaitMinutes: number;
  startStopName?: string;
  endStopName?: string;
  lines: string[];
  /** Coût généralisé moyen en « minutes ressenties » (plus bas = mieux). */
  preferenceCost: number;
}

/** Liens de vérification manuelle de l'itinéraire. */
export interface ComparisonLinks {
  googleMaps: string;
  citymapper: string;
}

export interface RankedAddress {
  address: GeocodedAddress;
  directDistanceMeters?: number;
  journey?: JourneyRecommendation;
  comparison?: ComparisonLinks;
  /** Coût absolu interne : plus bas = mieux. */
  cost?: number;
  /** Rang (1 = meilleur). Les adresses ex æquo partagent le même rang. */
  rank?: number;
  /** Vrai si le rang est partagé avec au moins une autre adresse. */
  tied?: boolean;
  /** Nombre d'adresses partageant ce rang. */
  tiedCount?: number;
  /** Percentile relatif au lot (0 à 100, 100 = meilleur). Absent si une seule adresse. */
  percentile?: number;
  error?: string;
}
