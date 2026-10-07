import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { mapPoints, TIER_LABELS, type MapPoint, type MarkerTier } from '../services/mapMarkers';
import type { GeocodedAddress, RankedAddress } from '../types';

interface ResultsMapProps {
  origin: GeocodedAddress;
  results: RankedAddress[];
  /** Index du résultat à mettre en avant (bouton « Voir sur la carte »). */
  focus: { index: number; nonce: number } | null;
  /** Clic sur « Voir la fiche » dans une bulle. */
  onShowCard: (index: number) => void;
}

const ORIGIN_ICON = L.divIcon({
  className: 'map-pin-wrapper',
  html: '<span class="map-pin map-pin-origin" aria-label="Départ"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg></span>',
  // Épingle ancrée par sa pointe : elle se dessine au-dessus du point de départ
  // et masque moins les destinations toutes proches.
  iconSize: [34, 34],
  iconAnchor: [17, 41],
  popupAnchor: [0, -40],
});

function destinationIcon(point: MapPoint): L.DivIcon {
  const label = point.result.rank === 1 ? '★' : String(point.result.rank ?? point.index + 1);
  return L.divIcon({
    className: 'map-pin-wrapper',
    html: `<span class="map-pin map-pin-${point.tier}">${label}</span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16],
  });
}

function formatMinutes(value: number): string {
  return `${Math.max(0, Math.round(value))} min`;
}

/** Bulle construite en DOM (textContent) : les libellés viennent d'API externes. */
function popupContent(point: MapPoint, onShowCard: (index: number) => void): HTMLElement {
  const { result } = point;
  const root = document.createElement('div');
  root.className = 'map-popup';

  const title = document.createElement('strong');
  title.textContent = `#${result.rank} · ${result.address.label}`;
  root.append(title);

  const journey = result.journey;
  if (journey) {
    const summary = document.createElement('span');
    const mode =
      journey.kind === 'walk'
        ? 'à pied'
        : `${journey.lines.join(' → ')} · ${journey.transfers} corresp.`;
    summary.textContent = `${formatMinutes(journey.durationMinutes)} · ${mode}`;
    root.append(summary);

    const walk = document.createElement('span');
    walk.textContent = `Marche ${formatMinutes(journey.walkingMinutes)}`;
    root.append(walk);
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Voir la fiche';
  button.addEventListener('click', () => onShowCard(point.index));
  root.append(button);

  return root;
}

export default function ResultsMap({ origin, results, focus, onShowCard }: ResultsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef(new Map<number, L.Marker>());
  const onShowCardRef = useRef(onShowCard);
  onShowCardRef.current = onShowCard;

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const map = L.map(containerRef.current, { scrollWheelZoom: false, zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    // Molette active seulement après un clic sur la carte (évite de piéger le défilement).
    map.on('click', () => map.scrollWheelZoom.enable());
    map.on('mouseout', () => map.scrollWheelZoom.disable());
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    markersRef.current.clear();

    const originLatLng = L.latLng(origin.lat, origin.lon);
    const route = L.polyline([], { color: '#3158e8', weight: 3, opacity: 0.75, dashArray: '6 8' });
    layer.addLayer(route);

    L.marker(originLatLng, { icon: ORIGIN_ICON, title: 'Départ' })
      .bindPopup(() => {
        const element = document.createElement('div');
        element.className = 'map-popup';
        const title = document.createElement('strong');
        title.textContent = 'Départ';
        const label = document.createElement('span');
        label.textContent = origin.label;
        element.append(title, label);
        return element;
      })
      .addTo(layer);

    const points = mapPoints(results);
    // Les mieux classés sont dessinés au-dessus en cas de chevauchement.
    for (const point of points) {
      const latLng = L.latLng(point.result.address.lat, point.result.address.lon);
      const marker = L.marker(latLng, {
        icon: destinationIcon(point),
        title: `#${point.result.rank} ${point.result.address.label}`,
        zIndexOffset: 1000 - point.index,
      })
        .bindPopup(() => popupContent(point, (index) => onShowCardRef.current(index)))
        .on('popupopen', () => route.setLatLngs([originLatLng, latLng]))
        .on('popupclose', () => route.setLatLngs([]))
        .addTo(layer);
      markersRef.current.set(point.index, marker);
    }

    const bounds = L.latLngBounds([originLatLng, ...points.map((point) =>
      L.latLng(point.result.address.lat, point.result.address.lon),
    )]);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [origin, results]);

  useEffect(() => {
    if (!focus) return;
    const map = mapRef.current;
    const marker = markersRef.current.get(focus.index);
    if (!map || !marker) return;
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 14), { duration: 0.6 });
    marker.openPopup();
  }, [focus]);

  const tiers = new Set<MarkerTier>(mapPoints(results).map((point) => point.tier));

  return (
    <div className="map-card result-reveal">
      <div ref={containerRef} className="results-map" role="region" aria-label="Carte des adresses" />
      <div className="map-legend">
        <span><i className="legend-dot legend-origin" /> Départ</span>
        {(Object.keys(TIER_LABELS) as MarkerTier[])
          .filter((tier) => tiers.has(tier))
          .map((tier) => (
            <span key={tier}><i className={`legend-dot legend-${tier}`} /> {TIER_LABELS[tier]}</span>
          ))}
        <small>Cliquez un repère pour le détail du trajet.</small>
      </div>
    </div>
  );
}
