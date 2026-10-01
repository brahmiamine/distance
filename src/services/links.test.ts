import { describe, expect, it } from 'vitest';
import { buildComparisonLinks, citymapperUrl, googleMapsUrl } from './links';

const origin = { label: 'Départ Étoile', lat: 48.8738, lon: 2.295 };
const destination = { label: 'Arrivée Bastille', lat: 48.853, lon: 2.369 };

describe('googleMapsUrl', () => {
  it('encode les libellés et force le mode transit', () => {
    const url = googleMapsUrl(origin, destination);
    const params = new URLSearchParams(url.split('?')[1]);

    expect(url.startsWith('https://www.google.com/maps/dir/?')).toBe(true);
    expect(params.get('api')).toBe('1');
    expect(params.get('origin')).toBe('Départ Étoile');
    expect(params.get('destination')).toBe('Arrivée Bastille');
    expect(params.get('travelmode')).toBe('transit');
  });
});

describe('citymapperUrl', () => {
  it('inclut les coordonnées et les libellés', () => {
    const params = new URLSearchParams(citymapperUrl(origin, destination).split('?')[1]);

    expect(params.get('startcoord')).toBe('48.8738,2.295');
    expect(params.get('endcoord')).toBe('48.853,2.369');
    expect(params.get('startname')).toBe('Départ Étoile');
    expect(params.get('endname')).toBe('Arrivée Bastille');
  });
});

describe('buildComparisonLinks', () => {
  it('regroupe les deux liens', () => {
    const links = buildComparisonLinks(origin, destination);
    expect(links.googleMaps).toContain('google.com/maps');
    expect(links.citymapper).toContain('citymapper.com');
  });
});
