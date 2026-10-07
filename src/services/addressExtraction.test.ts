import { describe, expect, it } from 'vitest';
import { addressKey, extractAddresses, normalizeStreet } from './addressExtraction';

const DOCTOLIB_TEXT = `Rendez-vous assuré par un remplaçant

Disponibilités à partir du jeudi, octobre 1

Dr Thomas Lafont, Consultation vidéo disponible
Médecin généraliste

67 Rue Voltaire
92300 Levallois-Perret

Conventionné secteur 1


jeudi
1 oct.
—
—
—
—
vendredi
2 oct.
—




67 Rue Voltaire
92300 Levallois-Perret
67 Rue Voltaire 92300 Levallois-Perret`;

const CENTRES_TEXT = `Paris - ACTE

Adresse : 12, rue Bellot, 75019 Paris
Contact : 01-85-09-18-85 / examens@acte-paris.org
Paris - AELF SNC - ILE International

Adresse : 241, rue de Bercy, 75012 Paris
Contact : 01-43-44-76-56 / info@ile-international.com
Paris - Alliance française Paris Ile-de-France

Adresse : 101, bld Raspail, 75006 Paris
Contact : 01-42-84-90-00 / examens@alliancefr.org
Paris - Cours de Civilisation Française de la Sorbonne

Adresse : 7-11 avenue des chasseurs, 75017 Paris
Contact : 01-44-10-77-00 / contact@ccfs-sorbonne.fr
Paris - Ecole de Langue Française pour étrangers (ELFE)

Adresse : 15, rue Montmartre, 75001 Paris
Contact : 01-48-78-73-00 / examens@elfe-paris.com
Paris - Etoile Institut de Langue

Adresse : 38 boulevard Raspail, 75007 Paris
Contact : 01-45-48-00-05 / contact@etoilecertifications.com
Paris - Forum ACCORD

Adresse : 3 bis, rue Jean-Pierre Bloch, 75015 Paris
Contact : 01-84-79-20-60 / info@accord-langues.com`;

describe('extractAddresses', () => {
  it('extrait une liste « Adresse : … » avec plages, bis et abréviations', () => {
    expect(extractAddresses(CENTRES_TEXT)).toEqual([
      '12 rue Bellot, 75019 Paris',
      '241 rue de Bercy, 75012 Paris',
      '101 boulevard Raspail, 75006 Paris',
      '7 avenue des chasseurs, 75017 Paris',
      '15 rue Montmartre, 75001 Paris',
      '38 boulevard Raspail, 75007 Paris',
      '3 bis rue Jean-Pierre Bloch, 75015 Paris',
    ]);
  });

  it('ignore un préfixe avant la voie sur une seule ligne', () => {
    expect(extractAddresses('Cabinet Dupont 2000, 12 rue de la Paix, 75002 Paris')).toEqual([
      '12 rue de la Paix, 75002 Paris',
    ]);
  });

  it('accepte « Adresse : » suivi du code postal à la ligne', () => {
    expect(extractAddresses('Adresse : 4 av. Foch\n75116 Paris')).toEqual(['4 avenue Foch, 75116 Paris']);
  });

  it('accepte une voie sans numéro après un libellé « Adresse : »', () => {
    expect(extractAddresses('Adresse : place de la Bastille, 75011 Paris')).toEqual([
      'place de la Bastille, 75011 Paris',
    ]);
  });

  it('ne prend pas un libellé « Adresse : » sans voie', () => {
    expect(extractAddresses('Adresse : voir ci-dessous\n75011 Paris')).toEqual([]);
  });

  it('ignore les lignes de contact (téléphone, e-mail)', () => {
    expect(extractAddresses('Contact : 01-85-09-18-85 / examens@acte-paris.org')).toEqual([]);
  });

  it('extrait l’adresse d’une fiche Doctolib (voie + CP sur deux lignes)', () => {
    expect(extractAddresses(DOCTOLIB_TEXT)).toEqual(['67 Rue Voltaire, 92300 Levallois-Perret']);
  });

  it('gère l’adresse complète sur une seule ligne', () => {
    expect(extractAddresses('67 Rue Voltaire 92300 Levallois-Perret')).toEqual([
      '67 Rue Voltaire, 92300 Levallois-Perret',
    ]);
  });

  it('gère l’adresse complète sur une ligne avec virgule', () => {
    expect(extractAddresses('67 Rue Voltaire, 92300 Levallois-Perret')).toEqual([
      '67 Rue Voltaire, 92300 Levallois-Perret',
    ]);
  });

  it('extrait plusieurs adresses', () => {
    const text = `Dr A\n12 bis Avenue de la République\n75011 Paris\n\nDr B\n5 Place du Capitole\n31000 Toulouse`;
    expect(extractAddresses(text)).toEqual([
      '12 bis Avenue de la République, 75011 Paris',
      '5 Place du Capitole, 31000 Toulouse',
    ]);
  });

  it('accepte une ligne vide entre la voie et le code postal', () => {
    expect(extractAddresses('8 Rue Catulle Mendès\n\n75017 Paris')).toEqual([
      '8 Rue Catulle Mendès, 75017 Paris',
    ]);
  });

  it('retire la mention CEDEX', () => {
    expect(extractAddresses('67 Rue Voltaire 92300 Levallois-Perret Cedex')).toEqual([
      '67 Rue Voltaire, 92300 Levallois-Perret',
    ]);
  });

  it('dédoublonne les adresses équivalentes', () => {
    const text = "67 Rue Voltaire\n92300 Levallois-Perret\n67 rue voltaire 92300 levallois-perret";
    expect(extractAddresses(text)).toEqual(['67 Rue Voltaire, 92300 Levallois-Perret']);
  });

  it('respecte la limite demandée', () => {
    const text = '1 Rue A\n75001 Paris\n2 Rue B\n75002 Paris';
    expect(extractAddresses(text, 1)).toEqual(['1 Rue A, 75001 Paris']);
  });

  it('ignore les lignes non postales (dates, téléphones, mentions)', () => {
    const text = `Conventionné secteur 1
01 23 45 67 89
jeudi 1 oct.
Médecin généraliste`;
    expect(extractAddresses(text)).toEqual([]);
  });

  it('ignore un code postal sans voie associée', () => {
    expect(extractAddresses('92300 Levallois-Perret')).toEqual([]);
  });

  it('ignore une voie sans code postal', () => {
    expect(extractAddresses('67 Rue Voltaire\nMédecin généraliste')).toEqual([]);
  });

  it('renvoie un tableau vide pour un texte vide', () => {
    expect(extractAddresses('   \n\n  ')).toEqual([]);
  });

  it('reconnaît les principaux types de voie', () => {
    const text = `1 Boulevard Voltaire 75011 Paris
2 Avenue de la Paix 75002 Paris
3 Impasse des Lilas 69003 Lyon
4 Allée des Roses 33000 Bordeaux`;
    expect(extractAddresses(text)).toHaveLength(4);
  });
});

describe('addressKey', () => {
  it('ignore casse, accents et ponctuation', () => {
    expect(addressKey('67 Rue Voltaire, 92300 Levallois-Perret')).toBe(
      addressKey('67 rue VOLTAIRE 92300 levallois perret'),
    );
  });
});

describe('normalizeStreet', () => {
  it('réduit une plage de numéros et développe les abréviations', () => {
    expect(normalizeStreet('7-11 avenue des chasseurs')).toBe('7 avenue des chasseurs');
    expect(normalizeStreet('101, bld Raspail')).toBe('101 boulevard Raspail');
    expect(normalizeStreet('3 bis, rue Jean-Pierre Bloch')).toBe('3 bis rue Jean-Pierre Bloch');
    expect(normalizeStreet('8 bd. Haussmann')).toBe('8 boulevard Haussmann');
    expect(normalizeStreet('12 avenue Foch')).toBe('12 avenue Foch');
  });
});
