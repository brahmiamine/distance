# Distance Transports

Application React + Vite qui classe une liste d'adresses selon la facilité réelle d'accès en transports depuis une **adresse de départ unique**.

## Principe

1. Saisir une adresse de référence : elle est **toujours le départ**.
2. Coller 1 à 20 adresses de destination, une par ligne.
3. Géocoder les adresses via BAN / IGN.
4. Calculer plusieurs itinéraires réels en transports via Transitous / MOTIS.
5. Choisir pour chaque destination l'itinéraire le plus adapté aux priorités du projet.
6. Classer les destinations par recommandation.

## Critères de recommandation

Le classement privilégie volontairement :

1. peu de marche entre l'adresse et les transports ;
2. peu de correspondances ;
3. peu de véhicules / lignes à prendre ;
4. un temps de trajet raisonnable ;
5. une distance globale plus courte comme critère secondaire.

Le moteur examine plusieurs itinéraires et ne retient pas forcément le plus rapide s'il nécessite beaucoup de marche ou de changements.

## Fiabilité

- **Géocodage validé** : le code postal et la ville saisis sont comparés aux candidats IGN, les adresses précises (numéro/voie) et le score IGN sont privilégiés, et un rattachement manifestement faux est rejeté avec un message clair.
- **Résilience réseau** : les appels BAN / MOTIS ont un délai maximal, des nouvelles tentatives (5xx / 429 / réseau) et un cache (mémoire + `localStorage`).
- **Repli marche** : si aucun transport n'est pertinent (destination proche), un trajet à pied raisonnable est proposé au lieu d'une erreur.
- **Classement honnête** : le rang est partagé en cas d'égalité (mention « ex æquo ») et le pourcentage affiché est un **percentile relatif au lot comparé**, jamais une note absolue.
- **Appels parallélisés** (4 en parallèle) pour comparer plus vite.

## Coller un texte (extraction d'adresses)

Le bouton **« Coller un texte »** analyse un texte libre (par ex. une fiche Doctolib) et détecte les adresses postales :

- voie et code postal / ville sur deux lignes successives ;
- adresse complète sur une seule ligne (« 67 Rue Voltaire 92300 Levallois-Perret ») ;
- numéros `bis` / `ter` / `quater`, mentions `CEDEX`, principaux types de voie.

Les adresses détectées sont dédoublonnées puis ajoutées au champ « Adresses de destination ». L'extraction ne gère pas les lieux-dits, les adresses sans numéro ni les adresses hors de France ; c'est ensuite le géocodage qui valide chaque adresse.

## Sources

- Géocodage : https://data.geopf.fr/geocodage/search
- Routage transports : https://transitous.org/
- Moteur MOTIS : https://github.com/motis-project/motis
- Données cartographiques : OpenStreetMap
- Vérification utilisateur : liens Google Maps et Citymapper

Transitous est utilisé pour ce projet open-source non commercial conformément à sa politique d'utilisation.

## Développement

```bash
npm install
npm run dev
```

Build :

```bash
npm run build
```

## Tests

```bash
npm test              # suite de tests
npm run test:coverage # rapport de couverture
```

Les tests couvrent le géocodage (validation, cache, erreurs), le routage (coût, repli marche), le classement (rang, ex æquo, percentile, parallélisation), la couche HTTP (timeout, retry, cache), le cache, la construction des liens Google Maps / Citymapper et l'extraction d'adresses depuis un texte.

## GitHub Pages

Le workflow `.github/workflows/deploy-pages.yml` construit et déploie automatiquement `main`.

URL : https://brahmiamine.github.io/distance/

## Important

Les itinéraires sont calculés au moment de la recherche et peuvent donc varier avec les horaires et les données de transport disponibles.
