/** Plafond de sécurité de l'extraction (le filtre de zone trie ensuite). */
export const MAX_EXTRACTED_ADDRESSES = 500;

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
  'chaussée', 'chaussee', 'parvis', 'promenade', 'faubourg', 'galerie', 'cour', 'mail',
  'ruelle', 'rocade', 'bd', 'bld', 'blvd', 'bvd', 'rue', 'av', 'côte', 'cote',
].join('|');

/**
 * Début de voie : numéro (plage « 7-11 », suffixe « bis » / « B » éventuels)
 * suivi d'un type de voie. Recherché n'importe où dans la ligne pour ignorer
 * les préfixes (« Adresse : », nom d'établissement…).
 */
const STREET_START_RE = new RegExp(
  `(?:^|[^\\p{L}\\d-])(\\d{1,4}(?:\\s?[-/]\\s?\\d{1,4})?(?:,?\\s?(?:bis|ter|quater|[a-d])\\b)?[,.]?\\s+(?:${STREET_TYPES})\\.?(?=\\s))`,
  'iu',
);

const STREET_TYPE_RE = new RegExp(`(?:^|\\s)(?:${STREET_TYPES})\\.?(?=\\s)`, 'i');

/** Libellé explicite précédant une adresse, même sans numéro de voie. */
const ADDRESS_LABEL_RE =
  /^(?:adresse(?:\s+postale)?|address|lieu|localisation|si[eè]ge(?:\s+social)?)\s*:\s*/i;

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/^(\S+(?:\s(?:bis|ter|quater|[a-d]))?\s)(?:bd|bld|blvd|bvd)\.?(?=\s)/i, '$1boulevard'],
  [/^(\S+(?:\s(?:bis|ter|quater|[a-d]))?\s)av\.?(?=\s)/i, '$1avenue'],
];

interface PostalCity {
  postcode: string;
  city: string;
  /** Position du code postal dans la ligne nettoyée. */
  start: number;
}

/** Boîte postale / CS : leur numéro à 5 chiffres n'est pas un code postal. */
const POSTAL_BOX_RE = /\b(?:B\.?\s?P\.?|CS)\s?\d+/gi;

function matchPostalCity(rawLine: string): PostalCity | null {
  const line = rawLine.replace(/\s+/g, ' ').trim();
  // Masque de même longueur : les positions restent valables sur `line`.
  const masked = line.replace(POSTAL_BOX_RE, (box) => '#'.repeat(box.length));
  const match = POSTAL_CITY_END.exec(masked) ?? POSTAL_CITY_ANY.exec(masked);
  if (!match) return null;

  const postcode = match[1];
  const city = match[2].replace(/\s+cedex.*$/i, '').trim();
  const start = masked.indexOf(postcode, match.index);

  return { postcode, city, start };
}

/** Ligne réduite à « code postal ville » (ex. « 20600 Bastia »). */
function isPostalOnlyLine(line: string | undefined): boolean {
  if (!line) return false;
  const postal = matchPostalCity(line);
  return postal !== null && postal.start === 0;
}

/** Position du début de la voie dans la ligne, ou -1. */
function streetStart(line: string): number {
  const match = STREET_START_RE.exec(line);
  if (!match) return -1;
  return match.index + match[0].length - match[1].length;
}

/**
 * Compléments qui gênent le géocodeur : boîte postale, CS, bâtiment, étage,
 * « code porte », parenthèses, ou suite après un séparateur « - ».
 */
const NOISE_RE =
  /\s(?:-\s|-$|B\.?\s?P\.?\s?\d|CS\s?\d|code porte\b|b[aâ]t(?:\.|iment\b|\s)|immeuble\b|\d+\s?(?:er|e|[eè]me)\s+[ée]tage\b|[ée]tage\b|rdc\b|bureau\b|z\.?[ai]\.?\s|\().*$/i;

/**
 * Nettoie la voie pour le géocodeur : plage de numéros réduite au premier
 * (« 7-11 » → « 7 »), virgule après le numéro retirée, abréviations courantes
 * développées (« bld » → « boulevard »).
 */
export function normalizeStreet(street: string): string {
  let result = street
    .replace(/\s+/g, ' ')
    .replace(NOISE_RE, '')
    .replace(/^(\d{1,4})\s?[-/]\s?\d{1,4}\b/, '$1')
    .replace(/^(\d{1,4}),?\s?(bis|ter|quater)\b/i, '$1 $2')
    .replace(/^(\d{1,4}(?:\s?(?:bis|ter|quater|[a-d])\b)?)\s*[,.]\s*/i, '$1 ')
    .replace(/[,;\s-]+$/, '')
    .trim();
  for (const [pattern, replacement] of ABBREVIATIONS) result = result.replace(pattern, replacement);
  return result;
}

const STREET_TYPE_ANYWHERE_RE = new RegExp(
  `(?:^|[\\s,'’-])((?:${STREET_TYPES})\\.?\\s+\\S.*)$`,
  'iu',
);

/**
 * Voie sans numéro, éventuellement précédée d'un nom de lieu (« Lycée X
 * Avenue du 11 novembre ») : retenue seulement juste avant une ligne
 * « code postal ville », pour éviter les faux positifs dans du texte libre.
 */
function unnumberedStreet(line: string): string | null {
  if (/@|https?:|www\./i.test(line)) return null;
  const match = STREET_TYPE_ANYWHERE_RE.exec(line);
  if (!match) return null;
  const street = normalizeStreet(match[1]);
  return /\p{L}{3,}/u.test(street.replace(STREET_TYPE_RE, ' ')) ? street : null;
}

/** Partie « voie » d'une ligne : depuis le numéro, ou après un libellé « Adresse : ». */
function streetPart(line: string, end = line.length): string | null {
  const start = streetStart(line);
  if (start >= 0 && start < end) return normalizeStreet(line.slice(start, end));

  const label = ADDRESS_LABEL_RE.exec(line);
  if (label) {
    const rest = line.slice(label[0].length, end).replace(/[,;\s]+$/, '').trim();
    if (STREET_TYPE_RE.test(` ${rest}`)) return normalizeStreet(rest);
  }
  return null;
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
 * - un préfixe avant la voie (« Adresse : 12, rue Bellot, 75019 Paris ») ;
 * - les numéros bis / ter / quater / B, les plages (« 7-11 »), les CEDEX,
 *   les principaux types de voie et abréviations (bd, bld, av).
 *
 * Ne détecte pas : lieux-dits, adresses sans numéro (sauf après « Adresse : »),
 * adresses hors de France.
 * Le résultat est dédoublonné et limité à `max` entrées.
 */
export function extractAddresses(text: string, max = MAX_EXTRACTED_ADDRESSES): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim());
  const consumed = new Set<number>();
  const found: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (consumed.has(index)) continue;

    const line = lines[index];
    if (!line) continue;

    const postal = matchPostalCity(line);

    // Adresse complète sur une seule ligne.
    if (postal) {
      const street = streetPart(line, postal.start);
      if (street) {
        found.push(`${street}, ${postal.postcode} ${postal.city}`);
        continue;
      }
    }

    // Voie sur une ligne, code postal sur l'une des deux lignes suivantes.
    const street = streetPart(line) ?? (isPostalOnlyLine(lines[index + 1]) ? unnumberedStreet(line) : null);
    if (street && !postal) {
      for (let next = index + 1; next <= index + 2 && next < lines.length; next += 1) {
        if (consumed.has(next)) continue;
        const nextPostal = matchPostalCity(lines[next]);
        if (nextPostal) {
          // La ligne suivante peut répéter le reste de l'adresse avant le CP.
          found.push(`${street}, ${nextPostal.postcode} ${nextPostal.city}`);
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
