import { describe, expect, it } from 'vitest';
import { formatDepartureTime, referenceDepartureTime } from './departureTime';

describe('referenceDepartureTime', () => {
  it('prend le jour même avant 9 h un jour ouvré (heure d’été)', () => {
    // Mercredi 7 octobre 2026, 7 h 30 à Paris (UTC+2).
    const result = referenceDepartureTime(new Date('2026-10-07T05:30:00Z'));
    expect(result.toISOString()).toBe('2026-10-07T07:00:00.000Z');
  });

  it('passe au lendemain après 9 h', () => {
    const result = referenceDepartureTime(new Date('2026-10-07T09:37:00Z'));
    expect(result.toISOString()).toBe('2026-10-08T07:00:00.000Z');
  });

  it('saute le week-end', () => {
    // Vendredi 9 octobre 2026, 18 h → lundi 12 octobre 9 h.
    const result = referenceDepartureTime(new Date('2026-10-09T16:00:00Z'));
    expect(result.toISOString()).toBe('2026-10-12T07:00:00.000Z');
  });

  it('gère l’heure d’hiver (UTC+1)', () => {
    const result = referenceDepartureTime(new Date('2026-12-01T12:00:00Z'));
    expect(result.toISOString()).toBe('2026-12-02T08:00:00.000Z');
  });
});

describe('formatDepartureTime', () => {
  it('affiche le jour et l’heure de Paris', () => {
    const label = formatDepartureTime(new Date('2026-10-08T07:00:00Z'));
    expect(label).toContain('jeudi');
    expect(label).toContain('8 octobre');
    expect(label).toMatch(/9/);
  });
});
