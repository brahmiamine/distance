import { describe, expect, it } from 'vitest';
import { jsonResponse, stubFetch } from '../test/helpers';
import { memoryCache } from './cache';
import type { GeocodedAddress } from '../types';
import { buildWalkJourney, COST_WEIGHTS, findRecommendedJourney } from './transitous';

const paris: GeocodedAddress = { input: '', label: 'Paris', lat: 48.8566, lon: 2.3522 };
const near: GeocodedAddress = { input: '', label: 'Proche', lat: 48.857, lon: 2.353 };
const marseille: GeocodedAddress = { input: '', label: 'Marseille', lat: 43.2965, lon: 5.3698 };
const proche: GeocodedAddress = { input: '', label: 'Proche banlieue', lat: 48.88, lon: 2.36 };

function leg(mode: string, duration: number, extra: Record<string, unknown> = {}) {
  return { mode, duration, ...extra };
}

function itinerary(legs: unknown[], duration: number, transfers = 0, startTime?: string) {
  return { duration, transfers, legs, ...(startTime ? { startTime } : {}) };
}

const departureTime = new Date('2026-10-08T07:00:00Z');
const at = (minutes: number) => new Date(departureTime.getTime() + minutes * 60_000).toISOString();

describe('buildWalkJourney', () => {
  it('construit un trajet à pied cohérent', () => {
    const journey = buildWalkJourney(paris, near);
    expect(journey.kind).toBe('walk');
    expect(journey.transportCount).toBe(0);
    expect(journey.transfers).toBe(0);
    expect(journey.walkingMeters).toBeGreaterThan(0);
    expect(journey.durationMinutes).toBeCloseTo(journey.walkingMinutes);
    expect(journey.preferenceCost).toBeCloseTo(journey.walkingMinutes * COST_WEIGHTS.walk);
  });
});

describe('findRecommendedJourney', () => {
  it('résume un itinéraire en transport', async () => {
    const fetchImpl = stubFetch(() =>
      jsonResponse({
        itineraries: [
          itinerary(
            [
              leg('WALK', 120, { distance: 150 }),
              leg('SUBWAY', 600, { routeShortName: '1', from: { name: 'A' }, to: { name: 'B' } }),
            ],
            720,
            0,
          ),
        ],
      }),
    );

    const journey = await findRecommendedJourney(paris, marseille, ['metro'], { fetchImpl });

    expect(journey.kind).toBe('transit');
    expect(journey.transportCount).toBe(1);
    expect(journey.transfers).toBe(0);
    expect(journey.lines).toEqual(['1']);
    expect(journey.startStopName).toBe('A');
    expect(journey.endStopName).toBe('B');
    expect(journey.walkingMinutes).toBeCloseTo(2);
    expect(journey.walkingMeters).toBe(150);
    expect(journey.preferenceCost).toBeGreaterThan(0);
  });

  it('estime la distance de marche sans champ distance', async () => {
    const fetchImpl = stubFetch(() =>
      jsonResponse({
        itineraries: [itinerary([leg('WALK', 120), leg('BUS', 600, { routeShortName: 'X' })], 720, 0)],
      }),
    );

    const journey = await findRecommendedJourney(paris, marseille, ['bus'], { fetchImpl });
    expect(journey.walkingMeters).toBeCloseTo(120 * 1.35);
  });

  it('retient l’itinéraire au coût le plus bas', async () => {
    const fetchImpl = stubFetch(() =>
      jsonResponse({
        itineraries: [
          itinerary([leg('WALK', 120), leg('BUS', 1080, { routeShortName: 'A' })], 1200, 1),
          itinerary([leg('WALK', 120), leg('BUS', 1080, { routeShortName: 'B' })], 1200, 0),
        ],
      }),
    );

    const journey = await findRecommendedJourney(paris, marseille, ['bus'], { fetchImpl });
    expect(journey.transfers).toBe(0);
    expect(journey.lines).toEqual(['B']);
  });

  it('ignore les itinéraires inexploitables', async () => {
    const fetchImpl = stubFetch(() =>
      jsonResponse({
        itineraries: [
          itinerary([], 0),
          itinerary([leg('WALK', 300)], 300, 0),
          itinerary([leg('SUBWAY', 'abc' as unknown as number, { routeShortName: '2' })], 900, 0),
        ],
      }),
    );

    const journey = await findRecommendedJourney(paris, marseille, ['metro'], { fetchImpl });
    expect(journey.kind).toBe('transit');
    expect(journey.lines).toEqual(['2']);
  });

  it('replie sur la marche quand aucun transport n’est trouvé', async () => {
    const fetchImpl = stubFetch(() => jsonResponse({ itineraries: [] }));

    const journey = await findRecommendedJourney(paris, near, ['metro'], { fetchImpl });

    expect(journey.kind).toBe('walk');
    expect(journey.transportCount).toBe(0);
    expect(journey.startWalkMeters).toBeGreaterThan(0);
  });

  it('replie sur la marche quand rien de marchable n’est trouvé mais la distance est courte', async () => {
    const fetchImpl = stubFetch(() => jsonResponse({ itineraries: [] }));

    const journey = await findRecommendedJourney(paris, proche, ['bus'], { fetchImpl });
    expect(journey.kind).toBe('walk');
    expect(journey.durationMinutes).toBeLessThanOrEqual(60);
  });

  it('échoue pour une destination lointaine sans aucun transport', async () => {
    const fetchImpl = stubFetch(() => jsonResponse({ itineraries: [] }));

    await expect(findRecommendedJourney(paris, marseille, ['metro'], { fetchImpl })).rejects.toThrow(
      'Aucun itinéraire en transport trouvé.',
    );
  });

  it('exige au moins un mode de transport', async () => {
    await expect(findRecommendedJourney(paris, marseille, [])).rejects.toThrow(
      'Sélectionnez au moins un transport.',
    );
  });

  it('préfère la marche directe à un bus qui impose presque autant de marche', async () => {
    // Cas réel Argenteuil : 17 min à pied, ou 11 min de marche + bus 4 min + 3 min de marche.
    const bus = (start: number) =>
      itinerary(
        [leg('WALK', 660, { distance: 656 }), leg('BUS', 240, { routeShortName: '6403' }), leg('WALK', 180, { distance: 121 })],
        1080,
        0,
        at(start),
      );
    const fetchImpl = stubFetch(() =>
      jsonResponse({
        direct: [itinerary([leg('WALK', 1027, { distance: 1250 })], 1027)],
        itineraries: [bus(5), bus(17)],
      }),
    );

    const journey = await findRecommendedJourney(paris, near, ['bus'], { fetchImpl, departureTime });
    expect(journey.kind).toBe('walk');
    expect(journey.walkingMeters).toBe(1250);
    expect(journey.averageWaitMinutes).toBe(0);
  });

  it('pénalise une ligne peu fréquente par l’attente moyenne', async () => {
    const trip = (line: string, rideSeconds: number, start: number) =>
      itinerary(
        [leg('WALK', 180), leg('BUS', rideSeconds, { routeShortName: line }), leg('WALK', 120)],
        rideSeconds + 300,
        0,
        at(start),
      );
    // Ligne rapide toutes les 60 min vs ligne un peu plus lente toutes les 6 min.
    const frequent = Array.from({ length: 10 }, (_, index) => trip('F', 1200, index * 6 + 1));
    const fetchImpl = stubFetch(() => jsonResponse({ itineraries: [trip('R', 900, 30), ...frequent] }));

    const journey = await findRecommendedJourney(paris, marseille, ['bus'], { fetchImpl, departureTime });
    expect(journey.lines).toEqual(['F']);
    expect(journey.averageWaitMinutes).toBeGreaterThan(0);
    expect(journey.averageWaitMinutes).toBeLessThan(6);
  });

  it('intègre l’attente moyenne au coût', async () => {
    const trip = (start: number) =>
      itinerary([leg('BUS', 600, { routeShortName: 'A' })], 600, 0, at(start));
    const fetchImpl = stubFetch(() => jsonResponse({ itineraries: [trip(0), trip(20), trip(40)] }));

    const journey = await findRecommendedJourney(paris, marseille, ['bus'], { fetchImpl, departureTime });
    const base = 10 * COST_WEIGHTS.inVehicle + COST_WEIGHTS.boarding;
    expect(journey.averageWaitMinutes).toBeCloseTo(9.5, 0);
    expect(journey.preferenceCost).toBeCloseTo(base + journey.averageWaitMinutes * COST_WEIGHTS.initialWait);
  });

  it('ignore les départs antérieurs à l’horaire de référence', async () => {
    const fetchImpl = stubFetch(() =>
      jsonResponse({
        itineraries: [
          itinerary([leg('BUS', 300, { routeShortName: 'TOT' })], 300, 0, at(-30)),
          itinerary([leg('BUS', 600, { routeShortName: 'OK' })], 600, 0, at(2)),
        ],
      }),
    );

    const journey = await findRecommendedJourney(paris, marseille, ['bus'], { fetchImpl, departureTime });
    expect(journey.lines).toEqual(['OK']);
  });

  it('met en cache l’itinéraire retenu (compact), pas la réponse brute', async () => {
    let calls = 0;
    const fetchImpl = stubFetch(() => {
      calls += 1;
      return jsonResponse({
        itineraries: [itinerary([leg('BUS', 600, { routeShortName: 'A', intermediateStops: 'x'.repeat(50_000) })], 600, 0, at(1))],
      });
    });
    const stored: string[] = [];
    const base = memoryCache();
    const cache = {
      get: base.get,
      set: async (key: string, value: string, ttl: number) => {
        stored.push(value);
        await base.set(key, value, ttl);
      },
    };

    const first = await findRecommendedJourney(paris, marseille, ['bus'], { fetchImpl, cache, departureTime });
    const second = await findRecommendedJourney(paris, marseille, ['bus'], { fetchImpl, cache, departureTime });

    expect(calls).toBe(1);
    expect(second).toEqual(first);
    expect(stored).toHaveLength(1);
    expect(stored[0].length).toBeLessThan(2_000);
  });

  it('demande la marche directe et un horaire fixe à MOTIS', async () => {
    let captured = '';
    const fetchImpl = stubFetch((url) => {
      captured = url;
      return jsonResponse({ itineraries: [] });
    });

    await findRecommendedJourney(near, near, ['bus'], { fetchImpl, departureTime });

    const params = new URL(captured).searchParams;
    expect(params.get('directModes')).toBe('WALK');
    expect(params.get('time')).toBe(departureTime.toISOString());
  });

  it('transmet les modes attendus à MOTIS', async () => {
    let captured = '';
    const fetchImpl = stubFetch((url) => {
      captured = url;
      return jsonResponse({ itineraries: [] });
    });

    await findRecommendedJourney(near, near, ['metro', 'rail'], { fetchImpl });

    const decoded = decodeURIComponent(captured);
    expect(decoded).toContain('SUBWAY');
    expect(decoded).toContain('RAIL');
    expect(decoded).toContain('transitModes=');
  });
});
