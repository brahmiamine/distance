import { describe, expect, it } from 'vitest';
import { jsonResponse, stubFetch } from '../test/helpers';
import { memoryCache } from './cache';
import { GeocodingError, extractCityHint, extractPostcode, geocodeAddress } from './geocoding';

interface GeoProperties {
  label?: string;
  postcode?: string;
  city?: string;
  type?: string;
  score?: number;
}

function feature(properties: GeoProperties, coordinates: [number, number] = [2.263674, 48.924221]) {
  return { geometry: { coordinates }, properties };
}

describe('extractPostcode / extractCityHint', () => {
  it('extrait le code postal à 5 chiffres', () => {
    expect(extractPostcode("56 avenue de l'Agent Sarre, 92700, COLOMBES")).toBe('92700');
  });

  it('renvoie undefined sans code postal', () => {
    expect(extractPostcode('Paris')).toBeUndefined();
  });

  it('extrait la ville du dernier segment sans chiffre', () => {
    expect(extractCityHint("56 avenue de l'Agent Sarre, 92700, COLOMBES")).toBe('COLOMBES');
  });

  it('renvoie undefined si aucun segment sans chiffre', () => {
    expect(extractCityHint('10 rue Y, 75008')).toBeUndefined();
  });
});

describe('geocodeAddress', () => {
  it('choisit le candidat dont le code postal correspond', async () => {
    const fetchImpl = stubFetch(() =>
      jsonResponse({
        features: [
          feature({ label: 'Mauvais candidat', postcode: '75001', city: 'Paris', type: 'street', score: 0.9 }),
          feature({ label: 'Bon candidat', postcode: '92700', city: 'Colombes', type: 'housenumber', score: 0.5 }),
        ],
      }),
    );

    const result = await geocodeAddress("56 avenue de l'Agent Sarre, 92700, Colombes", { fetchImpl });

    expect(result.label).toBe('Bon candidat');
    expect(result.confidence).toBe('high');
    expect(result.postcode).toBe('92700');
    expect(result.type).toBe('housenumber');
    expect(result.score).toBeCloseTo(0.5);
  });

  it('accepte un code postal CEDEX différent si la ville correspond', async () => {
    const fetchImpl = stubFetch(() =>
      jsonResponse({
        features: [
          feature({ label: 'Nanterre', postcode: '92000', city: 'Nanterre', type: 'street', score: 0.72 }),
        ],
      }),
    );

    const result = await geocodeAddress('5 Boulevard des Bouvets, 92747, NANTERRE', { fetchImpl });

    expect(result.postcode).toBe('92000');
    expect(result.confidence).not.toBe('high');
  });

  it('rejette un code postal introuvable sans correspondance de ville', async () => {
    const fetchImpl = stubFetch(() =>
      jsonResponse({
        features: [feature({ label: 'Bordeaux', postcode: '33000', city: 'Bordeaux', type: 'housenumber', score: 0.9 })],
      }),
    );

    await expect(geocodeAddress('10 rue X, 75001, PARIS', { fetchImpl })).rejects.toThrow(
      'Code postal 75001 non trouvé',
    );
  });

  it('signale un code postal introuvable quand le candidat n’en a pas', async () => {
    const fetchImpl = stubFetch(() =>
      jsonResponse({ features: [feature({ label: 'Lieu-dit', city: 'Bordeaux', type: 'locality', score: 0.4 })] }),
    );

    await expect(geocodeAddress('10 rue X, 75001, PARIS', { fetchImpl })).rejects.toBeInstanceOf(GeocodingError);
  });

  it('retombe en confiance faible pour un type peu précis sans correspondance', async () => {
    const fetchImpl = stubFetch(() =>
      jsonResponse({
        features: [feature({ label: 'Commune', city: 'Lyon', type: 'municipality', score: 0.3 })],
      }),
    );

    const result = await geocodeAddress('Rue de la Paix', { fetchImpl });
    expect(result.confidence).toBe('low');
  });

  it('échoue si aucun résultat', async () => {
    const fetchImpl = stubFetch(() => jsonResponse({ features: [] }));
    await expect(geocodeAddress('nimporte quoi', { fetchImpl })).rejects.toThrow('Adresse introuvable');
  });

  it('rejette une adresse vide', async () => {
    await expect(geocodeAddress('   ')).rejects.toBeInstanceOf(GeocodingError);
  });

  it('met en cache le géocodage', async () => {
    let calls = 0;
    const fetchImpl = stubFetch(() => {
      calls += 1;
      return jsonResponse({
        features: [feature({ label: 'X', postcode: '92700', city: 'Colombes', type: 'housenumber', score: 0.9 })],
      });
    });
    const cache = memoryCache();

    await geocodeAddress("56 avenue de l'Agent Sarre, 92700, Colombes", { fetchImpl, cache });
    await geocodeAddress("56 avenue de l'Agent Sarre, 92700, Colombes", { fetchImpl, cache });

    expect(calls).toBe(1);
  });

  it('propage une erreur HTTP', async () => {
    const fetchImpl = stubFetch(() => jsonResponse({}, 503));
    await expect(geocodeAddress('10 rue X, 75001, Paris', { fetchImpl, retries: 0 })).rejects.toThrow();
  });
});
