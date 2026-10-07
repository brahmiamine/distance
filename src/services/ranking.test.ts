import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeocodedAddress, JourneyRecommendation } from '../types';

vi.mock('./geocoding', () => ({ geocodeAddress: vi.fn() }));
vi.mock('./transitous', () => ({ findRecommendedJourney: vi.fn() }));

import { geocodeAddress } from './geocoding';
import { findRecommendedJourney } from './transitous';
import { mapWithConcurrency, rankAddresses } from './ranking';

const mockGeocode = vi.mocked(geocodeAddress);
const mockJourney = vi.mocked(findRecommendedJourney);

function address(label: string): GeocodedAddress {
  return { input: label, label, lat: 48.85, lon: 2.35 };
}

function journey(cost: number, kind: JourneyRecommendation['kind'] = 'transit'): JourneyRecommendation {
  return {
    kind,
    durationMinutes: 20,
    transfers: 0,
    transportCount: kind === 'walk' ? 0 : 1,
    walkingMinutes: 2,
    walkingMeters: 150,
    startWalkMinutes: 2,
    startWalkMeters: 150,
    endWalkMinutes: 0,
    endWalkMeters: 0,
    transferWalkMinutes: 0,
    averageWaitMinutes: 0,
    lines: kind === 'walk' ? [] : ['1'],
    preferenceCost: cost,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGeocode.mockImplementation(async (input: string) => address(input.trim()));
});

describe('rankAddresses', () => {
  it('classe par coût croissant et calcule rang + percentile', async () => {
    const costs: Record<string, number> = { a: 30, b: 40, c: 50 };
    mockJourney.mockImplementation(async (_origin, destination) => journey(costs[destination.label]));

    const { origin, ranking, departureTime } = await rankAddresses({
      origin: 'depart',
      addresses: ['a', 'b', 'c'],
      types: ['metro'],
    });

    expect(origin.label).toBe('depart');
    expect(departureTime).toBeInstanceOf(Date);
    expect(ranking.map((entry) => entry.rank)).toEqual([1, 2, 3]);
    expect(ranking.map((entry) => entry.percentile)).toEqual([100, 50, 0]);
    expect(ranking.every((entry) => entry.tied === false)).toBe(true);
    expect(ranking[0].comparison?.googleMaps).toContain('google.com/maps');
    expect(ranking[0].comparison?.citymapper).toContain('citymapper.com');
  });

  it('partage le rang en cas d’égalité (ex æquo)', async () => {
    const costs: Record<string, number> = { a: 30, b: 30, c: 50 };
    mockJourney.mockImplementation(async (_origin, destination) => journey(costs[destination.label]));

    const { ranking } = await rankAddresses({
      origin: 'depart',
      addresses: ['a', 'b', 'c'],
      types: ['metro'],
    });

    expect(ranking.map((entry) => entry.rank)).toEqual([1, 1, 3]);
    expect(ranking[0].tied).toBe(true);
    expect(ranking[0].tiedCount).toBe(2);
    expect(ranking[1].tied).toBe(true);
    expect(ranking[2].tied).toBe(false);
    expect(ranking[2].percentile).toBe(0);
  });

  it('laisse le percentile indéfini pour une adresse unique', async () => {
    mockJourney.mockResolvedValue(journey(30));

    const { ranking } = await rankAddresses({ origin: 'depart', addresses: ['a'], types: ['metro'] });

    expect(ranking[0].rank).toBe(1);
    expect(ranking[0].percentile).toBeUndefined();
  });

  it('place les erreurs en fin de classement, sans rang', async () => {
    mockGeocode.mockImplementation(async (input: string) => {
      if (input.trim() === 'bad') throw new Error('Adresse introuvable');
      return address(input.trim());
    });
    mockJourney.mockResolvedValue(journey(30));

    const { ranking } = await rankAddresses({
      origin: 'depart',
      addresses: ['bad', 'ok'],
      types: ['metro'],
    });

    expect(ranking[0].address.label).toBe('ok');
    expect(ranking[1].error).toBe('Adresse introuvable');
    expect(ranking[1].rank).toBeUndefined();
    expect(ranking[1].percentile).toBeUndefined();
  });

  it('signale la progression une fois par adresse (plus le départ)', async () => {
    mockJourney.mockResolvedValue(journey(30));
    const onProgress = vi.fn();

    await rankAddresses({
      origin: 'depart',
      addresses: ['a', 'b', 'c', 'd'],
      types: ['metro'],
      onProgress,
      context: { concurrency: 2 },
    });

    expect(onProgress).toHaveBeenCalledTimes(5);
    expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('Géocodage'));
  });

  it('transmet le cache et la concurrence au calcul', async () => {
    mockJourney.mockResolvedValue(journey(30));
    const cache = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) };

    await rankAddresses({
      origin: 'depart',
      addresses: ['a'],
      types: ['metro'],
      context: { cache, concurrency: 1 },
    });

    expect(mockGeocode).toHaveBeenCalledWith('depart', expect.objectContaining({ cache }));
    expect(mockJourney).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ['metro'],
      expect.objectContaining({ cache, departureTime: expect.any(Date) }),
    );
  });
});

describe('mapWithConcurrency', () => {
  it('traite tous les éléments et respecte la limite', async () => {
    let active = 0;
    let maxActive = 0;

    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return value * 2;
    });

    expect(result).toEqual([2, 4, 6, 8, 10]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('gère une liste vide', async () => {
    await expect(mapWithConcurrency([], 4, async (value) => value)).resolves.toEqual([]);
  });
});
