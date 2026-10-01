import { describe, expect, it } from 'vitest';
import { jsonResponse, stubFetch } from '../test/helpers';
import type { GeocodedAddress } from '../types';
import { buildWalkJourney, findRecommendedJourney } from './transitous';

const paris: GeocodedAddress = { input: '', label: 'Paris', lat: 48.8566, lon: 2.3522 };
const near: GeocodedAddress = { input: '', label: 'Proche', lat: 48.857, lon: 2.353 };
const marseille: GeocodedAddress = { input: '', label: 'Marseille', lat: 43.2965, lon: 5.3698 };
const proche: GeocodedAddress = { input: '', label: 'Proche banlieue', lat: 48.88, lon: 2.36 };

function leg(mode: string, duration: number, extra: Record<string, unknown> = {}) {
  return { mode, duration, ...extra };
}

function itinerary(legs: unknown[], duration: number, transfers = 0) {
  return { duration, transfers, legs };
}

describe('buildWalkJourney', () => {
  it('construit un trajet à pied cohérent', () => {
    const journey = buildWalkJourney(paris, near);
    expect(journey.kind).toBe('walk');
    expect(journey.transportCount).toBe(0);
    expect(journey.transfers).toBe(0);
    expect(journey.walkingMeters).toBeGreaterThan(0);
    expect(journey.durationMinutes).toBeCloseTo(journey.walkingMinutes);
    expect(journey.preferenceCost).toBeCloseTo(journey.walkingMinutes * 2.25);
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
      'Aucun itinéraire en transport trouvé actuellement.',
    );
  });

  it('exige au moins un mode de transport', async () => {
    await expect(findRecommendedJourney(paris, marseille, [])).rejects.toThrow(
      'Sélectionnez au moins un transport.',
    );
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
