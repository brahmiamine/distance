export type Zone = 'paris' | 'idf' | 'all';

export const ZONES: Zone[] = ['paris', 'idf', 'all'];

export const ZONE_LABELS: Record<Zone, string> = {
  paris: 'Paris',
  idf: 'Île-de-France',
  all: 'Toutes',
};

/** Départements d'Île-de-France. */
const IDF_DEPARTMENTS = new Set(['75', '77', '78', '91', '92', '93', '94', '95']);

/** Dernier code postal à 5 chiffres de la saisie (évite un numéro de voie en tête). */
export function inputPostcode(input: string): string | undefined {
  const matches = input.match(/(?<!\d)\d{5}(?!\d)/g);
  return matches?.[matches.length - 1];
}

/** Département d'un code postal (2 chiffres, 3 pour l'outre-mer). */
export function departmentOf(postcode: string): string {
  return postcode.startsWith('97') || postcode.startsWith('98')
    ? postcode.slice(0, 3)
    : postcode.slice(0, 2);
}

export function postcodeInZone(postcode: string, zone: Zone): boolean {
  if (zone === 'all') return true;
  const department = departmentOf(postcode);
  if (zone === 'paris') return department === '75';
  return IDF_DEPARTMENTS.has(department);
}

export interface ZonePreFilter {
  /** Adresses à calculer (dans la zone, ou sans code postal à vérifier après géocodage). */
  kept: string[];
  /** Adresses écartées d'après le code postal saisi. */
  excluded: string[];
  /** Adresses sans code postal : la zone sera vérifiée après géocodage. */
  unknown: string[];
}

/** Tri préalable, sans appel réseau, à partir du code postal saisi. */
export function preFilterByZone(addresses: string[], zone: Zone): ZonePreFilter {
  const result: ZonePreFilter = { kept: [], excluded: [], unknown: [] };
  for (const address of addresses) {
    const postcode = inputPostcode(address);
    if (!postcode) {
      result.kept.push(address);
      if (zone !== 'all') result.unknown.push(address);
    } else if (postcodeInZone(postcode, zone)) {
      result.kept.push(address);
    } else {
      result.excluded.push(address);
    }
  }
  return result;
}
