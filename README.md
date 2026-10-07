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

Chaque destination reçoit un **coût généralisé** exprimé en « minutes ressenties » (plus bas = mieux) :

| Élément | Poids |
| --- | --- |
| minute assis dans un véhicule | × 1 |
| minute de marche (départ, arrivée, correspondances) | × 1,8 |
| minute d'attente en correspondance | × 1,5 |
| minute d'attente au premier arrêt | × 1 |
| chaque véhicule pris | + 5 min |
| chaque correspondance | + 8 min |
| distance à vol d'oiseau (critère secondaire) | + 0,3 min / km |

- **Horaire de référence fixe** : les itinéraires sont calculés pour le prochain jour ouvré à 9 h (heure de Paris), et non à l'heure du clic, pour un classement reproductible.
- **Fréquence des lignes** : on simule un voyageur prêt à partir à n'importe quelle minute de l'heure qui suit ; il prend l'option la moins coûteuse (attente comprise). Le coût retenu est la moyenne : une ligne rapide mais rare est pénalisée par son attente moyenne.
- **Marche directe** : le trajet à pied calculé par MOTIS est mis en concurrence avec les transports. Une destination à 15 min à pied n'est plus battue par un bus qui impose presque autant de marche.

## Fiabilité

- **Géocodage validé** : le code postal et la ville saisis sont comparés aux candidats IGN, les adresses précises (numéro/voie) et le score IGN sont privilégiés, et un rattachement manifestement faux est rejeté avec un message clair.
- **Résilience réseau** : les appels BAN / MOTIS ont un délai maximal, des nouvelles tentatives (5xx / 429 / réseau) et un cache (mémoire + `localStorage`).
- **Repli marche** : si aucun transport n'est pertinent (destination proche), un trajet à pied raisonnable est proposé au lieu d'une erreur.
- **Classement honnête** : le rang est partagé en cas d'égalité (mention « ex æquo ») et le pourcentage affiché est un **percentile relatif au lot comparé**, jamais une note absolue.
- **Appels parallélisés** (4 en parallèle) pour comparer plus vite.

## Carte des résultats

Après le calcul, une carte (Leaflet + OpenStreetMap) affiche l'adresse de départ et chaque destination classée :

- repères numérotés par rang, colorés selon le percentile (★ = meilleure, vert, bleu, gris) ;
- clic sur un repère : résumé du trajet retenu, tracé départ → destination et bouton « Voir la fiche » ;
- bouton « Voir sur la carte » sur chaque fiche pour centrer la carte sur la destination.

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
