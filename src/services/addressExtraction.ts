import { MAX_ADDRESSES } from './ranking';

/**
 * Code postal français plausible :
 * - métropole : 01xxx à 95xxx ;
 * - outre-mer : 971xx à 976xx et 984xx à 989xx.
 */
const POSTCODE_PATTERN =
  '(?:(?:0[1-9]|[1-8]\\d|9[0-5])\\d{3}|97[1-6]\\d{2}|98[4-9]\\d{2})';

const CITY_WORD = "[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]*";
const CITY_PATTERN = `${CITY_WORD}(?: ${CITY_WORD})*`;

// Priorité au motif ancré en fin de ligne (cas Doctolib : « 92300 Levallois-Perret »).
const POSTAL_CITY_END = new RegExp(
  `(?:^|\\D)(${POSTCODE_PATTERN})(?!\\d) (${CITY_PATTERN})$`,
  'i',
);
const POSTAL_CITY_ANY = new RegExp(
  `(?:^|\\D)(${POSTCODE_PATTERN})(?!\\d) (${CITY_PATTERN})`,
  'i',
);

const STREET_TYPES = [
  'boulevard', 'avenue', 'rond-point', 'rond point', 'lotissement', 'résidence',
  'residence', 'esplanade', 'impasse', 'montée', 'montee', 'descente', 'chemin',
  'sentier', 'traverse', 'domaine', 'allée', 'allee', 'square', 'passage', 'villa',
  'place', 'route', 'quai', 'cours', 'sente', 'voie', 'clos', 'cité', 'cite', 'hameau',
  'avenue', 'bd', 'bld', 'rue', 'av', 'côte', 'cote',
].join('|');

const STREET_RE = new RegExp(`^\\d{1,4}\\s?(?:bis|ter|quater)?[,]?\\s+(?:${STREET_TYPES})\\b`, 'i');

interface PostalCity {
  postcode: string;
  city: string;
  /** Position du code postal dans la ligne nettoyée. */
  start: number;
}

function matchPostalCity(rawLine: string): PostalCity | null {
  const line = rawLine.replace(/\s+/g, ' ').trim();
  const match = POSTAL_CITY_END.exec(line) ?? POSTAL_CITY_ANY.exec(line);
  if (!match) return null;

  const postcode = match[1];
  const city = match[2].replace(/\s+cedex.*$/i, '').trim();
  const start = line.indexOf(postcode, match.index);

  return { postcode, city, start };
}

function isStreetLine(line: string): boolean {
  return STREET_RE.test(line.replace(/\s+/g, ' ').trim());
}

/** Clé de comparaison insensible à la casse, aux accents et à la ponctuation. */
export function addressKey(address: string): string {
  return address
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Détecte les adresses postales dans un texte libre (ex. fiche Doctolib).
 *
 * Gère :
 * - la voie et le code postal / ville sur deux lignes successives ;
 * - l'adresse complète sur une seule ligne (« 67 Rue Voltaire 92300 Levallois-Perret ») ;
 * - les numéros bis / ter / quater, les CEDEX, les principaux types de voie.
 *
 * Ne détecte pas : lieux-dits, adresses sans numéro, adresses hors de France.
 * Le résultat est dédoublonné et limité à `max` entrées.
 */
export function extractAddresses(text: string, max = MAX_ADDRESSES): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim());
  const consumed = new Set<number>();
  const found: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (consumed.has(index)) continue;

    const line = lines[index];
    if (!line) continue;

    const postal = matchPostalCity(line);
    const street = isStreetLine(line);

    // Adresse complète sur une seule ligne.
    if (street && postal) {
      const streetPart = line.slice(0, postal.start).replace(/[,\s]+$/, '');
      if (streetPart) found.push(`${streetPart}, ${postal.postcode} ${postal.city}`);
      continue;
    }

    // Voie sur une ligne, code postal sur l'une des deux lignes suivantes.
    if (street) {
      for (let next = index + 1; next <= index + 2 && next < lines.length; next += 1) {
        if (consumed.has(next)) continue;
        const nextPostal = matchPostalCity(lines[next]);
        if (nextPostal) {
          found.push(`${line}, ${nextPostal.postcode} ${nextPostal.city}`);
          consumed.add(next);
          break;
        }
      }
    }
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const address of found) {
    const key = addressKey(address);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(address);
    if (result.length >= max) break;
  }

  return result;
}
