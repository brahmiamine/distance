import { describe, expect, it } from 'vitest';
import type { RankedAddress } from '../types';
import { hasCoordinates, mapPoints, markerTier } from './mapMarkers';

function ranked(rank: number | undefined, percentile?: number, extra: Partial<RankedAddress> = {}): RankedAddress {
  return {
    address: { input: 'x', label: 'x', lat: 48.9, lon: 2.25 },
    rank,
    percentile,
    ...extra,
  };
}

describe('markerTier', () => {
  it('distingue le meilleur, puis classe par percentile', () => {
    expect(markerTier(ranked(1, 100))).toBe('best');
    expect(markerTier(ranked(2, 90))).toBe('good');
    expect(markerTier(ranked(5, 40))).toBe('average');
    expect(markerTier(ranked(9, 10))).toBe('poor');
  });

  it('traite une adresse unique comme la meilleure', () => {
    expect(markerTier(ranked(1))).toBe('best');
  });
});

describe('hasCoordinates', () => {
  it('rejette la position par défaut des erreurs', () => {
    expect(hasCoordinates({ input: '', label: '', lat: 0, lon: 0 })).toBe(false);
    expect(hasCoordinates({ input: '', label: '', lat: Number.NaN, lon: 2 })).toBe(false);
    expect(hasCoordinates({ input: '', label: '', lat: 48.9, lon: 2.2 })).toBe(true);
  });
});

describe('mapPoints', () => {
  it('ignore les erreurs et conserve l’index d’affichage', () => {
    const points = mapPoints([
      ranked(1, 100),
      ranked(2, 0),
      ranked(undefined, undefined, {
        address: { input: 'bad', label: 'bad', lat: 0, lon: 0 },
        error: 'Adresse introuvable',
      }),
    ]);

    expect(points.map((point) => point.index)).toEqual([0, 1]);
    expect(points.map((point) => point.tier)).toEqual(['best', 'poor']);
  });
});
