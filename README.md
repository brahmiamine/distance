# Distance Transports

Application React + Vite qui classe plusieurs adresses selon leur proximité avec les stations et arrêts de transport en Île-de-France.

## Fonctionnement

1. Coller 2 à 20 adresses, une par ligne.
2. Géocodage avec l'API Géoplateforme (BAN / IGN).
3. Recherche des arrêts voisins dans l'Open Data Île-de-France Mobilités.
4. Classement par distance jusqu'à l'arrêt du type sélectionné le plus proche.
5. Ouverture de Google Maps ou Citymapper pour vérifier le trajet piéton réel.

## Sources

- Géocodage : https://data.geopf.fr/geocodage/search
- Arrêts IDFM : https://data.iledefrance-mobilites.fr/explore/dataset/arrets/
- API IDFM OpenDataSoft : https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/arrets/records

La V1 n'a besoin d'aucune clé API.

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

Dans **Settings → Pages**, sélectionner **GitHub Actions** comme source de déploiement.

URL attendue : https://brahmiamine.github.io/distance/

## Limite actuelle

Le classement utilise la distance géographique directe jusqu'à l'arrêt IDFM. Le temps de marche est indicatif ; les boutons Google Maps et Citymapper servent à vérifier le chemin piéton réel.
