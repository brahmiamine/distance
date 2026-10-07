import { describe, expect, it } from 'vitest';
import { departmentOf, inputPostcode, postcodeInZone, preFilterByZone } from './zoneFilter';

describe('inputPostcode', () => {
  it('prend le dernier code postal de la saisie', () => {
    expect(inputPostcode('12, rue Bellot, 75019 Paris')).toBe('75019');
    expect(inputPostcode('10000 rue X, 92100 Boulogne')).toBe('92100');
    expect(inputPostcode('1 rue du 8 mai 1945, 92110 Clichy')).toBe('92110');
    expect(inputPostcode('Place de la Bastille, Paris')).toBeUndefined();
  });
});

describe('postcodeInZone', () => {
  it('distingue Paris, l’Île-de-France et le reste', () => {
    expect(postcodeInZone('75019', 'paris')).toBe(true);
    expect(postcodeInZone('92100', 'paris')).toBe(false);
    expect(postcodeInZone('92100', 'idf')).toBe(true);
    expect(postcodeInZone('77600', 'idf')).toBe(true);
    expect(postcodeInZone('60200', 'idf')).toBe(false);
    expect(postcodeInZone('13001', 'all')).toBe(true);
  });

  it('gère les départements d’outre-mer', () => {
    expect(departmentOf('97400')).toBe('974');
    expect(postcodeInZone('97500', 'idf')).toBe(false);
  });
});

describe('preFilterByZone', () => {
  const addresses = [
    '12, rue Bellot, 75019 Paris',
    '23, avenue Gabriel Péri, 95100 Argenteuil',
    '1 place Masséna, 06000 Nice',
    'Place de la Bastille, Paris',
  ];

  it('Paris : garde le 75 et les adresses sans code postal', () => {
    const result = preFilterByZone(addresses, 'paris');
    expect(result.kept).toEqual([addresses[0], addresses[3]]);
    expect(result.excluded).toEqual([addresses[1], addresses[2]]);
    expect(result.unknown).toEqual([addresses[3]]);
  });

  it('Île-de-France : écarte la province', () => {
    const result = preFilterByZone(addresses, 'idf');
    expect(result.excluded).toEqual([addresses[2]]);
  });

  it('Toutes : ne filtre rien', () => {
    const result = preFilterByZone(addresses, 'all');
    expect(result.kept).toEqual(addresses);
    expect(result.excluded).toEqual([]);
    expect(result.unknown).toEqual([]);
  });
});
