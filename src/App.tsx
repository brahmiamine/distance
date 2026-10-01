import { FormEvent, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Bus,
  CableCar,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Footprints,
  MapPin,
  Navigation,
  Route,
  Send,
  Sparkles,
  Terminal,
  Train,
  TrainFront,
  Trophy,
} from 'lucide-react';
import { DEFAULT_TRANSIT_TYPES, MAX_ADDRESSES, rankAddresses } from './services/ranking';
import type { GeocodedAddress, RankedAddress, TransitType } from './types';
import './styles.css';

const TYPE_LABELS: Record<TransitType, string> = {
  metro: 'Métro',
  rail: 'RER / Train',
  tram: 'Tram',
  bus: 'Bus',
  cableway: 'Téléphérique',
};

const REFERENCE_STORAGE_KEY = 'distance-transports-reference';
const ADDRESSES_STORAGE_KEY = 'distance-transports-addresses';

const EXAMPLE_ADDRESSES = `73, boulevard de Bezons, 78500, SARTROUVILLE
56 avenue de l'Agent Sarre, 92700, COLOMBES
5 Boulevard des Bouvets, 92747, NANTERRE
1 rue du 8 mai 1945, 92110, CLICHY-LA-GARENNE
8 rue Catulle Mendès, 75017, PARIS
86 rue cardinet, 75017, PARIS
38, boulevard Raspail, 75007, PARIS`;

function TransportIcon({ type, size = 18 }: { type: TransitType; size?: number }) {
  if (type === 'metro') return <TrainFront size={size} strokeWidth={2.2} />;
  if (type === 'rail') return <Train size={size} strokeWidth={2.2} />;
  if (type === 'tram') return <TrainFront size={size} strokeWidth={1.8} />;
  if (type === 'bus') return <Bus size={size} strokeWidth={2.2} />;
  return <CableCar size={size} strokeWidth={2.2} />;
}

function formatDistance(value: number): string {
  if (value < 1000) return `${Math.round(value)} m`;
  return `${(value / 1000).toFixed(1)} km`;
}

function formatMinutes(value: number): string {
  return `${Math.max(0, Math.round(value))} min`;
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
  const [selectedTypes, setSelectedTypes] = useState<TransitType[]>(DEFAULT_TRANSIT_TYPES);
  const [referenceAddress, setReferenceAddress] = useState<GeocodedAddress | null>(null);
  const [results, setResults] = useState<RankedAddress[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [globalError, setGlobalError] = useState('');
  const [copied, setCopied] = useState(false);
  const [apiTest, setApiTest] = useState<{
    status: 'idle' | 'loading' | 'done' | 'error';
    body: string;
  }>({ status: 'idle', body: '' });

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
    if (addresses.length > MAX_ADDRESSES) {
      setGlobalError(`La V1 accepte au maximum ${MAX_ADDRESSES} adresses à la fois.`);
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
      const { origin, ranking } = await rankAddresses({
        origin: referenceText.trim(),
        addresses,
        types: selectedTypes,
        onProgress: setProgress,
      });

      setReferenceAddress(origin);
      setResults(ranking);
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

  const apiUrl = `${window.location.origin}/api/rank`;

  const apiPayload = useMemo(
    () => ({
      origin: referenceText.trim() || '10 avenue des Champs-Élysées, 75008 Paris',
      addresses: addresses.length ? addresses : ["56 avenue de l'Agent Sarre, 92700 Colombes"],
      types: selectedTypes,
    }),
    [referenceText, addresses, selectedTypes],
  );

  const curlCommand = useMemo(() => {
    const shellJson = JSON.stringify(apiPayload, null, 2).replace(/'/g, `'\\''`);
    return `curl -X POST '${apiUrl}' \\\n  -H 'content-type: application/json' \\\n  -d '${shellJson}'`;
  }, [apiPayload, apiUrl]);

  const copyCurl = async () => {
    try {
      await navigator.clipboard.writeText(curlCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const testApi = async () => {
    setApiTest({ status: 'loading', body: '' });
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(apiPayload),
      });
      const text = await response.text();
      let body = text;
      try {
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Réponse non JSON : on affiche le texte brut.
      }
      setApiTest({ status: response.ok ? 'done' : 'error', body });
    } catch (error) {
      setApiTest({
        status: 'error',
        body: error instanceof Error ? error.message : 'Erreur inconnue',
      });
    }
  };

  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow animated-eyebrow">
            <Sparkles size={14} />
            Comparateur transport · Île-de-France
          </div>
          <h1>Quelle adresse est la plus pratique depuis votre point de départ ?</h1>
          <p>
            L’adresse de référence est toujours le départ. Les destinations sont classées par
            recommandation en privilégiant peu de marche, peu de correspondances, peu de transports
            à prendre et un trajet global raisonnable.
          </p>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          {(['metro', 'rail', 'tram', 'bus', 'cableway'] as TransitType[]).map((type, index) => (
            <div
              key={type}
              className={`hero-mode mode-${type} hero-mode-${index + 1}`}
              title={TYPE_LABELS[type]}
            >
              <TransportIcon type={type} size={22} />
            </div>
          ))}
          <div className="hero-pin">
            <MapPin size={24} />
          </div>
        </div>
      </section>

      <section className="panel form-panel animated-panel">
        <form onSubmit={compare}>
          <div className="field-heading">
            <div>
              <label htmlFor="reference">
                <MapPin size={17} />
                Adresse de départ
              </label>
              <span>Adresse de référence utilisée comme origine pour tous les trajets</span>
            </div>
            <button type="button" className="text-button" onClick={clearAll}>
              Effacer
            </button>
          </div>

          <div className="input-shell">
            <Navigation size={18} />
            <input
              id="reference"
              className="address-input"
              value={referenceText}
              onChange={(event) => setReferenceText(event.target.value)}
              placeholder="Ex. 10 avenue des Champs-Élysées, 75008 Paris"
              autoComplete="street-address"
            />
          </div>

          <div className="field-heading list-heading">
            <div>
              <label htmlFor="addresses">
                <Route size={17} />
                Adresses de destination
              </label>
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
                  <span className={`mode-icon mode-${type}`}>
                    <TransportIcon type={type} size={17} />
                  </span>
                  {TYPE_LABELS[type]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="criteria-box">
            <strong>
              <Trophy size={17} />
              Priorités du classement
            </strong>
            <span><Footprints size={16} /> Peu de marche</span>
            <span><ArrowRightLeft size={16} /> Peu de correspondances</span>
            <span><Clock size={16} /> Temps raisonnable</span>
            <span><Navigation size={16} /> Distance plus courte</span>
          </div>

          {globalError && <div className="alert error">{globalError}</div>}

          <button className={loading ? 'primary-button loading' : 'primary-button'} type="submit" disabled={loading}>
            <span className="button-content">
              {loading ? <span className="spinner" /> : <Sparkles size={18} />}
              {loading
                ? 'Calcul des itinéraires…'
                : `Classer ${addresses.length || ''} destination${addresses.length > 1 ? 's' : ''}`}
            </span>
          </button>
          {progress && <p className="progress"><span />{progress}</p>}
        </form>
      </section>

      {referenceAddress && results.length > 0 && (
        <section className="results-section">
          <div className="reference-card result-reveal">
            <div className="reference-icon">
              <Navigation size={20} />
            </div>
            <div>
              <span className="eyebrow">Départ unique</span>
              <h2>{referenceAddress.label}</h2>
              <p>Tous les itinéraires ci-dessous partent de cette adresse.</p>
            </div>
          </div>

          <div className="results-heading">
            <div>
              <span className="eyebrow">
                <Sparkles size={14} />
                Recommandations
              </span>
              <h2>Meilleures adresses pour les transports</h2>
            </div>
            <span className="method-note">Le rang #1 correspond au meilleur compromis</span>
          </div>

          <div className="results-list">
            {results.map((result, index) => (
              <article
                className={index === 0 ? 'result-card top-result result-reveal' : 'result-card result-reveal'}
                key={`${result.address.input}-${index}`}
                style={{ animationDelay: `${index * 90}ms` }}
              >
                <div className={index === 0 ? 'rank rank-first' : 'rank'}>
                  {index === 0 ? <Trophy size={20} /> : `#${index + 1}`}
                </div>
                <div className="result-main">
                  <div className="result-title-row">
                    <div className="destination-title">
                      <MapPin size={17} />
                      <h3>{result.address.label}</h3>
                    </div>
                    {result.recommendationScore != null && (
                      <div className="recommendation-score">
                        <div
                          className="score-ring"
                          style={{
                            background: `conic-gradient(#3158e8 ${result.recommendationScore * 3.6}deg, #e6eaf3 0deg)`,
                          }}
                        >
                          <div>
                            <strong>{result.recommendationScore}</strong>
                            <span>/100</span>
                          </div>
                        </div>
                        <small>{recommendationLabel(result.recommendationScore)}</small>
                      </div>
                    )}
                  </div>

                  {result.error || !result.journey ? (
                    <div className="alert error compact">{result.error ?? 'Itinéraire introuvable'}</div>
                  ) : (
                    <>
                      <div className="metrics-grid">
                        <div className="metric">
                          <Clock size={17} />
                          <span>Trajet</span>
                          <strong>{formatMinutes(result.journey.durationMinutes)}</strong>
                        </div>
                        <div className="metric priority">
                          <Footprints size={17} />
                          <span>Marche totale</span>
                          <strong>{formatMinutes(result.journey.walkingMinutes)}</strong>
                          <small>{formatDistance(result.journey.walkingMeters)}</small>
                        </div>
                        <div className="metric priority">
                          <ArrowRightLeft size={17} />
                          <span>Correspondances</span>
                          <strong>{result.journey.transfers}</strong>
                        </div>
                        <div className="metric">
                          <TrainFront size={17} />
                          <span>Transports pris</span>
                          <strong>{result.journey.transportCount}</strong>
                        </div>
                      </div>

                      <div className="walk-details">
                        <div>
                          <span><Navigation size={15} /> Départ → 1er transport</span>
                          <strong>
                            {formatMinutes(result.journey.startWalkMinutes)} ·{' '}
                            {formatDistance(result.journey.startWalkMeters)}
                          </strong>
                        </div>
                        <div>
                          <span><MapPin size={15} /> Dernier transport → adresse</span>
                          <strong>
                            {formatMinutes(result.journey.endWalkMinutes)} ·{' '}
                            {formatDistance(result.journey.endWalkMeters)}
                          </strong>
                        </div>
                      </div>

                      {result.journey.lines.length > 0 && (
                        <div className="journey-lines">
                          <span><Route size={15} /> Itinéraire recommandé</span>
                          <div className="line-flow">
                            {result.journey.lines.map((line, lineIndex) => (
                              <span className="line-pill" key={`${line}-${lineIndex}`}>
                                {line}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="meta-row">
                        <span><Navigation size={15} /> Distance directe depuis le départ</span>
                        <strong>{formatDistance(result.directDistanceMeters!)}</strong>
                      </div>

                      <div className="actions">
                        <a
                          href={googleMapsUrl(referenceAddress, result.address)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Google Maps <ExternalLink size={14} />
                        </a>
                        <a
                          href={citymapperUrl(referenceAddress, result.address)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Citymapper <ExternalLink size={14} />
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

      <section className="panel api-panel animated-panel">
        <div className="api-head">
          <span className="eyebrow">
            <Terminal size={14} />
            API publique
          </span>
          <h2>Réutilisez le classement depuis vos propres outils</h2>
          <p>
            Le même moteur est exposé en HTTP. Envoyez une adresse de départ et une liste
            d’adresses, récupérez le classement dans l’ordre. Pratique pour un script, un tableur
            ou une autre application.
          </p>
        </div>

        <div className="api-endpoint">
          <span className="api-method">POST</span>
          <code>{apiUrl}</code>
          <button type="button" className="text-button api-copy" onClick={copyCurl}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? 'Copié' : 'Copier le curl'}
          </button>
        </div>

        <div className="api-fields">
          <div>
            <code>origin</code>
            <span>Adresse de départ · requis</span>
          </div>
          <div>
            <code>addresses</code>
            <span>1 à 20 adresses · requis</span>
          </div>
          <div>
            <code>types</code>
            <span>metro, rail, tram, bus, cableway · optionnel</span>
          </div>
        </div>

        <pre className="api-code"><code>{curlCommand}</code></pre>

        <div className="api-actions">
          <button
            type="button"
            className="api-test-button"
            onClick={testApi}
            disabled={apiTest.status === 'loading'}
          >
            {apiTest.status === 'loading' ? <span className="spinner" /> : <Send size={16} />}
            {apiTest.status === 'loading' ? 'Appel en cours…' : 'Tester l’API maintenant'}
          </button>
          <span className="api-hint">
            Exécute la requête ci-dessus (avec l’adresse de départ et les destinations saisies plus
            haut) directement depuis cette page.
          </span>
        </div>

        {apiTest.status !== 'idle' && apiTest.body && (
          <pre
            className={
              apiTest.status === 'error'
                ? 'api-code api-response error'
                : 'api-code api-response'
            }
          >
            <code>{apiTest.body}</code>
          </pre>
        )}
      </section>

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
