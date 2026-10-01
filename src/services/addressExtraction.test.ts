import { describe, expect, it } from 'vitest';
import { addressKey, extractAddresses } from './addressExtraction';

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

describe('extractAddresses', () => {
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
