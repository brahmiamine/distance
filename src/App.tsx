import { FormEvent, useMemo, useState } from 'react';
import { geocodeAddress } from './services/geocoding';
import { findRecommendedJourney } from './services/transitous';
import type { GeocodedAddress, RankedAddress, TransitType } from './types';
import './styles.css';

const TYPE_LABELS: Record<TransitType, string> = {
  metro: 'Métro',
  rail: 'RER / Train',
  tram: 'Tram',
  bus: 'Bus',
  cableway: 'Téléphérique',
};

const TYPE_ICONS: Record<TransitType, string> = {
  metro: 'M',
  rail: 'R',
  tram: 'T',
  bus: 'B',
  cableway: 'C',
};

const DEFAULT_TYPES: TransitType[] = ['metro', 'rail', 'tram', 'bus'];
const REFERENCE_STORAGE_KEY = 'distance-transports-reference';
const ADDRESSES_STORAGE_KEY = 'distance-transports-addresses';

const EXAMPLE_ADDRESSES = `73, boulevard de Bezons, 78500, SARTROUVILLE
56 avenue de l'Agent Sarre, 92700, COLOMBES
5 Boulevard des Bouvets, 92747, NANTERRE
1 rue du 8 mai 1945, 92110, CLICHY-LA-GARENNE
8 rue Catulle Mendès, 75017, PARIS
86 rue cardinet, 75017, PARIS
38, boulevard Raspail, 75007, PARIS`;

function formatDistance(value: number): string {
  if (value < 1000) return `${Math.round(value)} m`;
  return `${(value / 1000).toFixed(1)} km`;
}

function formatMinutes(value: number): string {
  return `${Math.max(0, Math.round(value))} min`;
}

function haversineDistanceMeters(a: GeocodedAddress, b: GeocodedAddress): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const radius = 6_371_000;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function googleMapsUrl(origin: GeocodedAddress, destination: GeocodedAddress): string {
  const params = new URLSearchParams({
    api: '1',
    origin: origin.label,
    destination: destination.label,
    travelmode: 'transit',
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function citymapperUrl(origin: GeocodedAddress, destination: GeocodedAddress): string {
  const params = new URLSearchParams({
    startcoord: `${origin.lat},${origin.lon}`,
    startname: origin.label,
    endcoord: `${destination.lat},${destination.lon}`,
    endname: destination.label,
  });
  return `https://citymapper.com/directions?${params.toString()}`;
}

function recommendationLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 65) return 'Très bon';
  if (score >= 50) return 'Bon';
  return 'Correct';
}

export default function App() {
  const [referenceText, setReferenceText] = useState(
    () => localStorage.getItem(REFERENCE_STORAGE_KEY) ?? '',
  );
  const [addressesText, setAddressesText] = useState(
    () => localStorage.getItem(ADDRESSES_STORAGE_KEY) ?? '',
  );
  const [selectedTypes, setSelectedTypes] = useState<TransitType[]>(DEFAULT_TYPES);
  const [referenceAddress, setReferenceAddress] = useState<GeocodedAddress | null>(null);
  const [results, setResults] = useState<RankedAddress[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [globalError, setGlobalError] = useState('');

  const addresses = useMemo(
    () =>
      addressesText
        .split('\n')
        .map((address) => address.trim())
        .filter(Boolean)
        .filter((address, index, list) => list.indexOf(address) === index),
    [addressesText],
  );

  const toggleType = (type: TransitType) => {
    setSelectedTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  };

  const compare = async (event: FormEvent) => {
    event.preventDefault();
    setGlobalError('');
    setResults([]);
    setReferenceAddress(null);

    if (!referenceText.trim()) {
      setGlobalError('Renseignez une adresse de départ.');
      return;
    }
    if (addresses.length < 1) {
      setGlobalError('Ajoutez au moins une adresse à comparer.');
      return;
    }
    if (addresses.length > 20) {
      setGlobalError('La V1 accepte au maximum 20 adresses à la fois.');
      return;
    }
    if (selectedTypes.length === 0) {
      setGlobalError('Sélectionnez au moins un type de transport.');
      return;
    }

    localStorage.setItem(REFERENCE_STORAGE_KEY, referenceText.trim());
    localStorage.setItem(ADDRESSES_STORAGE_KEY, addressesText);
    setLoading(true);

    try {
      setProgress('Géocodage de l’adresse de départ…');
      const origin = await geocodeAddress(referenceText.trim());
      setReferenceAddress(origin);

      const collected: RankedAddress[] = [];

      for (let index = 0; index < addresses.length; index += 1) {
        const input = addresses[index];
        setProgress(`Itinéraire ${index + 1}/${addresses.length} — ${input}`);

        try {
          const destination = await geocodeAddress(input);
          const directDistanceMeters = haversineDistanceMeters(origin, destination);
          const journey = await findRecommendedJourney(origin, destination, selectedTypes);

          const distancePenalty = (directDistanceMeters / 1000) * 0.35;
          const rankingCost = journey.preferenceCost + distancePenalty;
          const recommendationScore = Math.max(1, Math.round(100 - rankingCost * 0.72));

          collected.push({
            address: destination,
            directDistanceMeters,
            journey,
            recommendationScore,
          });
        } catch (error) {
          collected.push({
            address: { input, label: input, lat: 0, lon: 0 },
            error: error instanceof Error ? error.message : 'Erreur inconnue',
          });
        }
      }

      collected.sort((a, b) => {
        if (a.recommendationScore == null) return 1;
        if (b.recommendationScore == null) return -1;
        return b.recommendationScore - a.recommendationScore;
      });

      setResults(collected);
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : 'Erreur inconnue');
    } finally {
      setProgress('');
      setLoading(false);
    }
  };

  const clearAll = () => {
    setReferenceText('');
    setAddressesText('');
    setReferenceAddress(null);
    setResults([]);
    setGlobalError('');
    localStorage.removeItem(REFERENCE_STORAGE_KEY);
    localStorage.removeItem(ADDRESSES_STORAGE_KEY);
  };

  return (
    <main className="page-shell">
      <section className="hero">
        <div className="eyebrow">Comparateur transport · Île-de-France</div>
        <h1>Quelle adresse est la plus pratique depuis votre point de départ ?</h1>
        <p>
          L’adresse de référence est toujours le départ. Les destinations sont classées par
          recommandation en privilégiant peu de marche, peu de correspondances, peu de transports
          à prendre et un trajet global raisonnable.
        </p>
      </section>

      <section className="panel form-panel">
        <form onSubmit={compare}>
          <div className="field-heading">
            <div>
              <label htmlFor="reference">Adresse de départ</label>
              <span>Adresse de référence utilisée comme origine pour tous les trajets</span>
            </div>
            <button type="button" className="text-button" onClick={clearAll}>
              Effacer
            </button>
          </div>

          <input
            id="reference"
            className="address-input"
            value={referenceText}
            onChange={(event) => setReferenceText(event.target.value)}
            placeholder="Ex. 10 avenue des Champs-Élysées, 75008 Paris"
            autoComplete="street-address"
          />

          <div className="field-heading list-heading">
            <div>
              <label htmlFor="addresses">Adresses de destination</label>
              <span>Une adresse par ligne · 1 à 20 destinations</span>
            </div>
          </div>

          <textarea
            id="addresses"
            value={addressesText}
            onChange={(event) => setAddressesText(event.target.value)}
            placeholder={EXAMPLE_ADDRESSES}
            rows={9}
          />

          <fieldset>
            <legend>Transports autorisés</legend>
            <div className="transport-options">
              {(Object.keys(TYPE_LABELS) as TransitType[]).map((type) => (
                <label key={type} className={selectedTypes.includes(type) ? 'chip active' : 'chip'}>
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes(type)}
                    onChange={() => toggleType(type)}
                  />
                  <span className={`mode-icon mode-${type}`}>{TYPE_ICONS[type]}</span>
                  {TYPE_LABELS[type]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="criteria-box">
            <strong>Priorités du classement</strong>
            <span>1. Peu de marche</span>
            <span>2. Peu de correspondances / transports</span>
            <span>3. Temps de trajet raisonnable</span>
            <span>4. Distance globale plus courte</span>
          </div>

          {globalError && <div className="alert error">{globalError}</div>}

          <button className="primary-button" type="submit" disabled={loading}>
            {loading
              ? 'Calcul des itinéraires…'
              : `Classer ${addresses.length || ''} destination${addresses.length > 1 ? 's' : ''}`}
          </button>
          {progress && <p className="progress">{progress}</p>}
        </form>
      </section>

      {referenceAddress && results.length > 0 && (
        <section className="results-section">
          <div className="reference-card">
            <span className="eyebrow">Départ unique</span>
            <h2>{referenceAddress.label}</h2>
            <p>Tous les itinéraires ci-dessous partent de cette adresse.</p>
          </div>

          <div className="results-heading">
            <div>
              <span className="eyebrow">Recommandations</span>
              <h2>Meilleures adresses pour les transports</h2>
            </div>
            <span className="method-note">Le rang #1 correspond au meilleur compromis</span>
          </div>

          <div className="results-list">
            {results.map((result, index) => (
              <article
                className={index === 0 ? 'result-card top-result' : 'result-card'}
                key={`${result.address.input}-${index}`}
              >
                <div className="rank">#{index + 1}</div>
                <div className="result-main">
                  <div className="result-title-row">
                    <h3>{result.address.label}</h3>
                    {result.recommendationScore != null && (
                      <div className="recommendation-badge">
                        <strong>{result.recommendationScore}/100</strong>
                        <span>{recommendationLabel(result.recommendationScore)}</span>
                      </div>
                    )}
                  </div>

                  {result.error || !result.journey ? (
                    <div className="alert error compact">{result.error ?? 'Itinéraire introuvable'}</div>
                  ) : (
                    <>
                      <div className="metrics-grid">
                        <div className="metric">
                          <span>Trajet</span>
                          <strong>{formatMinutes(result.journey.durationMinutes)}</strong>
                        </div>
                        <div className="metric priority">
                          <span>Marche totale</span>
                          <strong>{formatMinutes(result.journey.walkingMinutes)}</strong>
                          <small>{formatDistance(result.journey.walkingMeters)}</small>
                        </div>
                        <div className="metric priority">
                          <span>Correspondances</span>
                          <strong>{result.journey.transfers}</strong>
                        </div>
                        <div className="metric">
                          <span>Transports pris</span>
                          <strong>{result.journey.transportCount}</strong>
                        </div>
                      </div>

                      <div className="walk-details">
                        <div>
                          <span>Départ → 1er transport</span>
                          <strong>
                            {formatMinutes(result.journey.startWalkMinutes)} ·{' '}
                            {formatDistance(result.journey.startWalkMeters)}
                          </strong>
                        </div>
                        <div>
                          <span>Dernier transport → adresse</span>
                          <strong>
                            {formatMinutes(result.journey.endWalkMinutes)} ·{' '}
                            {formatDistance(result.journey.endWalkMeters)}
                          </strong>
                        </div>
                      </div>

                      {result.journey.lines.length > 0 && (
                        <div className="journey-lines">
                          <span>Itinéraire recommandé</span>
                          <strong>{result.journey.lines.join(' → ')}</strong>
                        </div>
                      )}

                      <div className="meta-row">
                        <span>Distance directe depuis le départ</span>
                        <strong>{formatDistance(result.directDistanceMeters!)}</strong>
                      </div>

                      <div className="actions">
                        <a
                          href={googleMapsUrl(referenceAddress, result.address)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Vérifier sur Google Maps
                        </a>
                        <a
                          href={citymapperUrl(referenceAddress, result.address)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Vérifier sur Citymapper
                        </a>
                      </div>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>

          <p className="footnote">
            Le calcul utilise les itinéraires disponibles au moment de la recherche. Le score donne
            davantage de poids à la marche et aux correspondances qu’à la distance pure.
          </p>
        </section>
      )}

      <footer>
        Géocodage : BAN / IGN · Routage transport :{' '}
        <a href="https://transitous.org/" target="_blank" rel="noreferrer">Transitous / MOTIS</a>
        {' '}· Données cartographiques : OpenStreetMap ·{' '}
        <a href="https://github.com/brahmiamine/distance" target="_blank" rel="noreferrer">
          code source / contact
        </a>
      </footer>
    </main>
  );
}
