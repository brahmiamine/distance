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

## API

L'application expose une API HTTP servie par le même Worker Cloudflare que l'interface.

`POST /api/rank`

```json
{
  "origin": "10 avenue des Champs-Élysées, 75008 Paris",
  "addresses": [
    "56 avenue de l'Agent Sarre, 92700 Colombes",
    "5 boulevard des Bouvets, 92747 Nanterre"
  ],
  "types": ["metro", "rail", "tram", "bus"]
}
```

- `origin` (requis) : adresse de départ, texte libre (géocodée).
- `addresses` (requis) : 1 à 20 adresses de destination.
- `types` (optionnel) : `metro`, `rail`, `tram`, `bus`, `cableway`. Par défaut : métro, RER/train, tram, bus.

La réponse contient `origin` (adresse de départ géocodée) et `ranking`, un tableau déjà trié (meilleur score en premier), identique à ce qu'affiche l'interface.

```bash
curl -X POST https://<ton-worker>.workers.dev/api/rank \
  -H 'content-type: application/json' \
  -d '{"origin":"10 avenue des Champs-Élysées, 75008 Paris","addresses":["56 avenue de l Agent Sarre, 92700 Colombes"]}'
```

La logique de classement est partagée entre l'interface et l'API dans `src/services/ranking.ts`.

## Développement

```bash
npm install
npm run dev
```

API en local (nécessite un `dist/` à jour : lancer `npm run build` d'abord) :

```bash
npm run dev:worker
```

Build :

```bash
npm run build
```

## Déploiement Cloudflare Workers

Un seul Worker sert l'interface et l'API `/api/rank` (`wrangler.toml`).

```bash
npm run deploy   # build du front + déploiement Cloudflare
```

## GitHub Pages

Le workflow `.github/workflows/deploy-pages.yml` construit et déploie automatiquement `main` (build en mode `pages`, base `/distance/`).

URL : https://brahmiamine.github.io/distance/

GitHub Pages ne sert que l'interface statique ; l'API `/api/rank` est uniquement disponible via le Worker Cloudflare.

## Important

Les itinéraires sont calculés au moment de la recherche et peuvent donc varier avec les horaires et les données de transport disponibles.
