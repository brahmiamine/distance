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

## GitHub Pages

Le workflow `.github/workflows/deploy-pages.yml` construit et déploie automatiquement `main`.

URL : https://brahmiamine.github.io/distance/

## Important

Les itinéraires sont calculés au moment de la recherche et peuvent donc varier avec les horaires et les données de transport disponibles.
