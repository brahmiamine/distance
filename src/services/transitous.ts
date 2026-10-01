import type { GeocodedAddress, JourneyRecommendation, TransitType } from '../types';

const PLAN_URL = 'https://api.transitous.org/api/v6/plan';

interface Place {
  name?: string;
}

interface Leg {
  mode?: string;
  duration?: number;
  distance?: number;
  routeShortName?: string;
  displayName?: string;
  from?: Place;
  to?: Place;
}

interface Itinerary {
  duration?: number;
  transfers?: number;
  legs?: Leg[];
}

interface PlanResponse {
  itineraries?: Itinerary[];
}

const TRANSIT_MODES = new Set([
  'TRANSIT', 'TRAM', 'SUBWAY', 'FERRY', 'AIRPLANE', 'BUS', 'COACH', 'RAIL',
  'HIGHSPEED_RAIL', 'LONG_DISTANCE', 'NIGHT_RAIL', 'REGIONAL_FAST_RAIL',
  'REGIONAL_RAIL', 'SUBURBAN', 'FUNICULAR', 'AERIAL_LIFT', 'METRO',
]);

function apiModes(types: TransitType[]): string[] {
  const modes = new Set<string>();
  for (const type of types) {
    if (type === 'metro') modes.add('SUBWAY');
    if (type === 'tram') modes.add('TRAM');
    if (type === 'bus') modes.add('BUS');
    if (type === 'cableway') {
      modes.add('FUNICULAR');
      modes.add('AERIAL_LIFT');
    }
    if (type === 'rail') {
      modes.add('SUBURBAN');
      modes.add('RAIL');
      modes.add('REGIONAL_RAIL');
      modes.add('REGIONAL_FAST_RAIL');
      modes.add('LONG_DISTANCE');
      modes.add('HIGHSPEED_RAIL');
      modes.add('NIGHT_RAIL');
    }
  }
  return [...modes];
}

function numberOrZero(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function legDistance(leg: Leg): number {
  const distance = Number(leg.distance);
  if (Number.isFinite(distance) && distance >= 0) return distance;
  return numberOrZero(leg.duration) * 1.35;
}

function summarize(itinerary: Itinerary): JourneyRecommendation | null {
  const legs = Array.isArray(itinerary.legs) ? itinerary.legs : [];
  const durationSeconds = numberOrZero(itinerary.duration);
  if (!durationSeconds || !legs.length) return null;

  const transitLegs = legs.filter((leg) => leg.mode && TRANSIT_MODES.has(leg.mode));
  if (!transitLegs.length) return null;

  const walkLegs = legs.filter((leg) => leg.mode === 'WALK');
  const walkingSeconds = walkLegs.reduce((sum, leg) => sum + numberOrZero(leg.duration), 0);
  const walkingMeters = walkLegs.reduce((sum, leg) => sum + legDistance(leg), 0);

  const first = legs[0];
  const last = legs[legs.length - 1];
  const startWalkSeconds = first?.mode === 'WALK' ? numberOrZero(first.duration) : 0;
  const endWalkSeconds = last?.mode === 'WALK' ? numberOrZero(last.duration) : 0;
  const startWalkMeters = first?.mode === 'WALK' ? legDistance(first) : 0;
  const endWalkMeters = last?.mode === 'WALK' ? legDistance(last) : 0;

  const walkingMinutes = walkingSeconds / 60;
  const startWalkMinutes = startWalkSeconds / 60;
  const endWalkMinutes = endWalkSeconds / 60;
  const transferWalkMinutes = Math.max(0, walkingMinutes - startWalkMinutes - endWalkMinutes);
  const durationMinutes = durationSeconds / 60;
  const transfers = Math.max(0, Math.round(numberOrZero(itinerary.transfers)));
  const transportCount = transitLegs.length;

  const lines = transitLegs
    .map((leg) => leg.routeShortName || leg.displayName || leg.mode || '')
    .filter(Boolean)
    .filter((line, index, all) => index === 0 || line !== all[index - 1]);

  // Lower is better. Walking and changes are deliberately expensive because
  // the app is meant to recommend an address that is easy to reach every day.
  const preferenceCost =
    durationMinutes * 0.45 +
    (startWalkMinutes + endWalkMinutes) * 1.8 +
    transferWalkMinutes * 1.2 +
    transfers * 12 +
    Math.max(0, transportCount - 1) * 5;

  return {
    durationMinutes,
    transfers,
    transportCount,
    walkingMinutes,
    walkingMeters,
    startWalkMinutes,
    startWalkMeters,
    endWalkMinutes,
    endWalkMeters,
    transferWalkMinutes,
    startStopName: transitLegs[0]?.from?.name,
    endStopName: transitLegs[transitLegs.length - 1]?.to?.name,
    lines,
    preferenceCost,
  };
}

export async function findRecommendedJourney(
  origin: GeocodedAddress,
  destination: GeocodedAddress,
  types: TransitType[],
): Promise<JourneyRecommendation> {
  const modes = apiModes(types);
  if (!modes.length) throw new Error('Sélectionnez au moins un transport.');

  const params = new URLSearchParams({
    fromPlace: `${origin.lat},${origin.lon}`,
    toPlace: `${destination.lat},${destination.lon}`,
    transitModes: modes.join(','),
    preTransitModes: 'WALK',
    postTransitModes: 'WALK',
    directModes: '',
    maxTransfers: '4',
    maxPreTransitTime: '1200',
    maxPostTransitTime: '1200',
    timetableView: 'true',
    numItineraries: '5',
    maxItineraries: '8',
    detailedLegs: 'false',
    detailedTransfers: 'false',
    joinInterlinedLegs: 'true',
  });

  const response = await fetch(`${PLAN_URL}?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Calcul transport indisponible (${response.status})`);
  }

  const data = (await response.json()) as PlanResponse;
  const itineraries = Array.isArray(data.itineraries) ? data.itineraries : [];
  const choices = itineraries
    .map(summarize)
    .filter((journey): journey is JourneyRecommendation => journey !== null)
    .sort((a, b) => a.preferenceCost - b.preferenceCost);

  if (!choices.length) {
    throw new Error('Aucun itinéraire en transport trouvé actuellement.');
  }

  return choices[0];
}
