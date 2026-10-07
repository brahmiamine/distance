import { type CSSProperties, FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Armchair,
  ArrowRight,
  ArrowRightLeft,
  Bus,
  CableCar,
  ClipboardPaste,
  Clock,
  ExternalLink,
  Footprints,
  Hourglass,
  Map as MapIcon,
  MapPin,
  Navigation,
  Route,
  Sparkles,
  Train,
  TrainFront,
  Trophy,
  Wand2,
} from 'lucide-react';
import ResultsMap from './components/ResultsMap';
import { addressKey, extractAddresses } from './services/addressExtraction';
import { browserCache, safeStorageGet, safeStorageSet } from './services/cache';
import { formatDepartureTime } from './services/departureTime';
import { DEFAULT_TRANSIT_TYPES, MAX_ADDRESSES, rankAddresses, type ExcludedAddress } from './services/ranking';
import { preFilterByZone, ZONE_LABELS, ZONES, type Zone } from './services/zoneFilter';
import type { GeocodedAddress, RankedAddress, TransitType } from './types';
import './styles.css';

const APP_CACHE = browserCache();

const TYPE_LABELS: Record<TransitType, string> = {
  metro: 'Métro',
  rail: 'RER / Train',
  tram: 'Tram',
  bus: 'Bus',
  cableway: 'Téléphérique',
};

const REFERENCE_STORAGE_KEY = 'distance-transports-reference';
const ADDRESSES_STORAGE_KEY = 'distance-transports-addresses';
const ZONE_STORAGE_KEY = 'distance-transports-zone';

const ZONE_HINTS: Record<Zone, string> = {
  paris: 'Codes postaux 75',
  idf: '75, 77, 78, 91, 92, 93, 94, 95',
  all: 'Aucun filtre',
};


const HERO_WORDS = ['Quelle', 'adresse', 'est', 'la', 'plus', 'pratique', 'depuis', 'votre', 'point', 'de', 'départ ?'];

const HERO_MODES: { type: TransitType; note: string }[] = [
  { type: 'metro', note: 'Lignes 1 à 14' },
  { type: 'rail', note: 'RER, Transilien' },
  { type: 'tram', note: 'T1 à T13' },
  { type: 'bus', note: 'RATP, Optile' },
  { type: 'cableway', note: 'Câble C1' },
];

const TICKER_ITEMS = [
  'Géocodage BAN / IGN',
  'Routage Transitous / MOTIS',
  'Horaires d’un jour ouvré à 9 h',
  'Fréquence des lignes prise en compte',
  'Marche directe mise en concurrence',
  'Jusqu’à 50 destinations',
  'Rangs ex æquo partagés',
  'Coller un texte : adresses détectées',
];

const WEIGHTS = [
  { icon: Armchair, value: '×1', label: 'minute assis dans un véhicule', bar: 1 / 1.8 },
  { icon: Footprints, value: '×1,8', label: 'minute de marche (départ, arrivée, correspondances)', bar: 1 },
  { icon: Hourglass, value: '×1,5', label: 'minute d’attente en correspondance', bar: 1.5 / 1.8 },
  { icon: Clock, value: '×1', label: 'minute d’attente au premier arrêt', bar: 1 / 1.8 },
  { icon: Bus, value: '+5 min', label: 'chaque véhicule pris', bar: 5 / 8 },
  { icon: ArrowRightLeft, value: '+8 min', label: 'chaque correspondance', bar: 1 },
  { icon: Navigation, value: '+0,3', label: 'min / km à vol d’oiseau (critère secondaire)', bar: 0.3 / 1.8 },
];

/** Variables CSS passées en style inline (délais d'animation, valeurs de compteur…). */
const vars = (values: Record<string, string | number>) => values as CSSProperties;

function Count({ value, delay = '0s' }: { value: number; delay?: string }) {
  return <strong className="count" style={vars({ '--num': Math.round(value), '--d': delay })} aria-label={String(Math.round(value))} />;
}

function readStoredZone(): Zone {
  const stored = safeStorageGet(ZONE_STORAGE_KEY);
  return ZONES.includes(stored as Zone) ? (stored as Zone) : 'all';
}

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

function percentileLabel(percentile: number | undefined): string {
  if (percentile == null) return 'Adresse unique';
  if (percentile >= 100) return 'Meilleur du lot';
  return `Mieux classé que ${percentile} % du lot`;
}

function confidenceLabel(confidence: GeocodedAddress['confidence']): string {
  if (confidence === 'high') return 'Adresse bien reconnue';
  if (confidence === 'medium') return 'Adresse reconnue (vérifiez)';
  if (confidence === 'low') return 'Adresse incertaine (à vérifier)';
  return '';
}

export default function App() {
  const [referenceText, setReferenceText] = useState(
    () => safeStorageGet(REFERENCE_STORAGE_KEY) ?? '',
  );
  const [addressesText, setAddressesText] = useState(
    () => safeStorageGet(ADDRESSES_STORAGE_KEY) ?? '',
  );
  const [selectedTypes, setSelectedTypes] = useState<TransitType[]>(DEFAULT_TRANSIT_TYPES);
  const [zone, setZone] = useState<Zone>(readStoredZone);
  const [excluded, setExcluded] = useState<ExcludedAddress[]>([]);
  const [resultZone, setResultZone] = useState<Zone>('all');
  const [referenceAddress, setReferenceAddress] = useState<GeocodedAddress | null>(null);
  const [results, setResults] = useState<RankedAddress[]>([]);
  const [departureTime, setDepartureTime] = useState<Date | null>(null);
  const [mapFocus, setMapFocus] = useState<{ index: number; nonce: number } | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const showOnMap = (index: number) =>
    setMapFocus((current) => ({ index, nonce: (current?.nonce ?? 0) + 1 }));

  const showCard = (index: number) => {
    const card = document.getElementById(`result-${index}`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card?.classList.remove('card-highlight');
    void card?.offsetWidth;
    card?.classList.add('card-highlight');
  };
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [globalError, setGlobalError] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [extractStatus, setExtractStatus] = useState('');

  const addresses = useMemo(
    () =>
      addressesText
        .split('\n')
        .map((address) => address.trim())
        .filter(Boolean)
        .filter((address, index, list) => list.indexOf(address) === index),
    [addressesText],
  );

  // Persistance à chaque saisie : les champs survivent à un rafraîchissement
  // de la page jusqu'au prochain classement (et au-delà, tant qu'on ne les vide pas).
  useEffect(() => {
    safeStorageSet(REFERENCE_STORAGE_KEY, referenceText);
  }, [referenceText]);

  useEffect(() => {
    safeStorageSet(ADDRESSES_STORAGE_KEY, addressesText);
  }, [addressesText]);

  useEffect(() => {
    safeStorageSet(ZONE_STORAGE_KEY, zone);
  }, [zone]);

  // Révélation au défilement des blocs marqués data-reveal.
  useEffect(() => {
    const items = document.querySelectorAll<HTMLElement>('[data-reveal]');
    if (!('IntersectionObserver' in window)) {
      items.forEach((item) => item.classList.add('in-view'));
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }),
      { threshold: 0.12 },
    );
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  // Aperçu du filtre de zone avant calcul (d'après les codes postaux saisis).
  const zonePreview = useMemo(() => preFilterByZone(addresses, zone), [addresses, zone]);

  const toggleType = (type: TransitType) => {
    setSelectedTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  };

  const handleExtract = () => {
    const found = extractAddresses(pasteText);
    if (!found.length) {
      setExtractStatus('Aucune adresse détectée dans ce texte.');
      return;
    }

    const seen = new Set(addresses.map(addressKey));
    const merged = [...addresses];
    for (const address of found) {
      const key = addressKey(address);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(address);
    }

    // Pas de coupure ici : le filtre de zone choisit ensuite ce qui est calculé.
    setAddressesText(merged.join('\n'));
    setExtractStatus(
      `${found.length} adresse${found.length > 1 ? 's' : ''} détectée${found.length > 1 ? 's' : ''} · ` +
        `${merged.length} destination${merged.length > 1 ? 's' : ''} au total.` +
        (preFilterByZone(merged, zone).kept.length > MAX_ADDRESSES
          ? ` Choisissez une zone : ${MAX_ADDRESSES} adresses au plus sont calculées à la fois.`
          : ''),
    );
  };

  const compare = async (event: FormEvent) => {
    event.preventDefault();
    setGlobalError('');
    setResults([]);
    setMapFocus(null);
    setReferenceAddress(null);
    setExcluded([]);

    if (!referenceText.trim()) {
      setGlobalError('Renseignez une adresse de départ.');
      return;
    }
    if (addresses.length < 1) {
      setGlobalError('Ajoutez au moins une adresse à comparer.');
      return;
    }
    if (zonePreview.kept.length < 1) {
      setGlobalError(`Aucune adresse dans la zone « ${ZONE_LABELS[zone]} ».`);
      return;
    }
    if (zonePreview.kept.length > MAX_ADDRESSES) {
      setGlobalError(
        `${zonePreview.kept.length} adresses à calculer : le maximum est ${MAX_ADDRESSES} à la fois. ` +
          'Choisissez une zone plus restreinte ou retirez des adresses.',
      );
      return;
    }
    if (selectedTypes.length === 0) {
      setGlobalError('Sélectionnez au moins un type de transport.');
      return;
    }

    setLoading(true);

    try {
      const { origin, ranking, departureTime: usedTime, excluded: skipped } = await rankAddresses({
        origin: referenceText.trim(),
        addresses,
        types: selectedTypes,
        zone,
        onProgress: setProgress,
        context: { cache: APP_CACHE, concurrency: 4 },
      });

      setReferenceAddress(origin);
      setResults(ranking);
      setDepartureTime(usedTime);
      setExcluded(skipped);
      setResultZone(zone);
      if (!ranking.length) {
        setGlobalError(`Aucune adresse dans la zone « ${ZONE_LABELS[zone]} » après vérification.`);
      }
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : 'Erreur inconnue');
    } finally {
      setProgress('');
      setLoading(false);
    }
  };

  const clearAll = () => {
    setExcluded([]);
    setReferenceText('');
    setAddressesText('');
    setReferenceAddress(null);
    setResults([]);
    setGlobalError('');
    setShowPaste(false);
    setPasteText('');
    setExtractStatus('');
  };

  const listedCount = zonePreview.kept.length;

  return (
    <main className="page">
      {/* NOCTURNE : hero */}
      <section className="hero" data-screen-label="Hero">
        <div className="glow glow-a" aria-hidden="true" />
        <div className="glow glow-b" aria-hidden="true" />
        <nav className="topnav">
          <span className="brand">
            <span className="brand-mark"><Navigation size={15} /></span>
            Distance Transports
          </span>
          <span className="nav-status"><i />Horaires · jour ouvré, 09:00</span>
          <a href="#methode">Méthode</a>
          <a href="#calcul">Calcul</a>
          <a href="https://github.com/brahmiamine/distance" target="_blank" rel="noreferrer">Code source</a>
        </nav>
        <div className="hero-grid">
          <div className="hero-copy">
            <div className="eyebrow-pill"><Sparkles size={13} />Comparateur transport · Île-de-France</div>
            <h1>
              {HERO_WORDS.map((word, index) => (
                <span className="word" key={word}>
                  <span className={word === 'pratique' ? 'word-in accent' : 'word-in'} style={vars({ '--i': index })}>
                    {word}
                  </span>{' '}
                </span>
              ))}
            </h1>
            <p className="hero-lead">
              L’adresse de référence est toujours le départ. Les destinations sont classées par
              recommandation en privilégiant peu de marche, peu de correspondances, peu de transports
              à prendre et un trajet global raisonnable.
            </p>
            <div className="hero-actions">
              <a className="cta-ghost" href="#calcul">Comparer des adresses <ArrowRight size={16} /></a>
              <a className="cta-link" href="#methode">Comment c’est classé</a>
            </div>
          </div>
          <div className="hero-line" aria-hidden="true">
            <div className="line-rail"><i /></div>
            <div className="line-stops">
              {HERO_MODES.map(({ type, note }, index) => (
                <div className="line-stop" key={type} style={vars({ '--i': index })}>
                  <span className="stop-icon"><TransportIcon type={type} size={20} /></span>
                  <div><strong>{TYPE_LABELS[type]}</strong><span>{note}</span></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* BROADSHEET : bandeau */}
      <div className="ticker" aria-hidden="true">
        <div className="ticker-track">
          {[...TICKER_ITEMS, ...TICKER_ITEMS].map((text, index) => (
            <span key={`${text}-${index}`}><i className={index % 2 ? 'dot-magenta' : 'dot-cyan'} />{text}</span>
          ))}
        </div>
      </div>

      {/* INDUSTRY : méthode */}
      <section className="method" id="methode" data-screen-label="Méthode">
        <div className="method-head">
          <div data-reveal>
            <div className="kicker">01 — Critères de recommandation</div>
            <h2>Un coût généralisé, en minutes ressenties.</h2>
          </div>
          <p data-reveal style={vars({ '--d': '.1s' })}>
            Chaque destination reçoit un coût exprimé en « minutes ressenties » (plus bas = mieux).
            Horaires d’un jour ouvré à 9 h, fréquence des lignes prise en compte, marche directe mise
            en concurrence.
          </p>
        </div>
        <div className="weights">
          {WEIGHTS.map(({ icon: Icon, value, label, bar }, index) => (
            <div className="weight" data-reveal key={label} style={vars({ '--d': `${index * 0.07}s` })}>
              <Icon size={24} strokeWidth={1.5} />
              <strong>{value}</strong>
              <span className="weight-label">{label}</span>
              <div className="weight-bar"><div style={{ width: `${Math.round(bar * 100)}%` }} /></div>
            </div>
          ))}
        </div>
      </section>

      {/* ORGANIC : formulaire */}
      <section className="calc" id="calcul" data-screen-label="Formulaire">
        <div className="blob blob-a" aria-hidden="true" />
        <div className="blob blob-b" aria-hidden="true" />
        <form onSubmit={compare} className="calc-grid">
          <div className="form-col form-col-addresses">
            <div className="pill-label">02 — Calcul</div>
            <h2>Un départ, jusqu’à {MAX_ADDRESSES} destinations.</h2>

            <div className="field-heading">
              <label htmlFor="reference"><MapPin size={16} strokeWidth={2.5} />Adresse de départ</label>
              <button type="button" className="text-button" onClick={clearAll}>Effacer</button>
            </div>
            <input
              id="reference"
              className="address-input"
              value={referenceText}
              onChange={(event) => setReferenceText(event.target.value)}
              placeholder="Ex. 10 avenue des Champs-Élysées, 75008 Paris"
              autoComplete="street-address"
            />

            <div className="field-heading">
              <label htmlFor="addresses">
                <Route size={16} strokeWidth={2.5} />Adresses de destination
                <span className="count-label">{addresses.length} adresse{addresses.length > 1 ? 's' : ''}</span>
              </label>
              <button
                type="button"
                className="text-button"
                onClick={() => setShowPaste((current) => !current)}
                aria-expanded={showPaste}
              >
                <ClipboardPaste size={15} />
                {showPaste ? 'Fermer' : 'Coller un texte'}
              </button>
            </div>

            {showPaste && (
              <div className="paste-panel">
                <p className="paste-hint">
                  Collez un texte (par ex. une fiche Doctolib) : les adresses sont détectées
                  automatiquement.
                </p>
                <textarea
                  className="paste-input"
                  rows={6}
                  value={pasteText}
                  onChange={(event) => setPasteText(event.target.value)}
                  placeholder={'Ex.\n\nDr Thomas Lafont\nMédecin généraliste\n\n67 Rue Voltaire\n92300 Levallois-Perret'}
                />
                <div className="paste-actions">
                  <button type="button" className="secondary-button" onClick={handleExtract} disabled={!pasteText.trim()}>
                    <Wand2 size={16} />
                    Extraire les adresses
                  </button>
                  {extractStatus && <span className="paste-status">{extractStatus}</span>}
                </div>
              </div>
            )}

            <textarea
              id="addresses"
              value={addressesText}
              onChange={(event) => setAddressesText(event.target.value)}
              placeholder={EXAMPLE_ADDRESSES}
              rows={9}
            />
            <div className="field-note">
              Une adresse par ligne · {MAX_ADDRESSES} calculées au plus (après filtre de zone)
            </div>
          </div>

          <div className="form-col form-col-options">
            <fieldset>
              <legend>Zone des destinations à calculer</legend>
              <div className="transport-options zone-options" role="radiogroup">
                {ZONES.map((option) => (
                  <label key={option} className={zone === option ? 'chip active' : 'chip'}>
                    <input type="radio" name="zone" value={option} checked={zone === option} onChange={() => setZone(option)} />
                    <span className="zone-text">
                      <strong>{ZONE_LABELS[option]}</strong>
                      <small>{ZONE_HINTS[option]}</small>
                    </span>
                  </label>
                ))}
              </div>
              {addresses.length > 0 && (zone !== 'all' || zonePreview.kept.length > MAX_ADDRESSES) && (
                <p className={zonePreview.kept.length > MAX_ADDRESSES ? 'zone-summary over-limit' : 'zone-summary'}>
                  <strong>{zonePreview.kept.length}</strong> adresse{zonePreview.kept.length > 1 ? 's' : ''} à
                  calculer
                  {zonePreview.excluded.length > 0 && (
                    <> · <strong>{zonePreview.excluded.length}</strong> hors zone ignorée{zonePreview.excluded.length > 1 ? 's' : ''}</>
                  )}
                  {zonePreview.kept.length > MAX_ADDRESSES && <> · maximum {MAX_ADDRESSES} : restreignez la zone</>}
                  {zonePreview.unknown.length > 0 && (
                    <> · {zonePreview.unknown.length} sans code postal (vérifiée{zonePreview.unknown.length > 1 ? 's' : ''} après géocodage)</>
                  )}
                </p>
              )}
            </fieldset>

            <fieldset>
              <legend>Transports autorisés</legend>
              <div className="transport-options">
                {(Object.keys(TYPE_LABELS) as TransitType[]).map((type) => (
                  <label key={type} className={selectedTypes.includes(type) ? 'chip active' : 'chip'}>
                    <input type="checkbox" checked={selectedTypes.includes(type)} onChange={() => toggleType(type)} />
                    <span className={`mode-icon mode-${type}`}><TransportIcon type={type} size={16} /></span>
                    {TYPE_LABELS[type]}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="form-submit">
              {globalError && <div className="alert error">{globalError}</div>}
              <button className={loading ? 'primary-button loading' : 'primary-button'} type="submit" disabled={loading}>
                {loading ? <span className="spinner" /> : null}
                <span>
                  {loading
                    ? 'Calcul des itinéraires…'
                    : `Classer ${listedCount || ''} destination${listedCount > 1 ? 's' : ''}`}
                </span>
                <ArrowRight className="nudge" size={20} strokeWidth={2.5} />
              </button>
              {progress && <p className="progress"><span />{progress}</p>}
              <div className="field-note">Compter environ 1 min pour 30 destinations (débit Transitous respecté).</div>
            </div>
          </div>
        </form>
      </section>

      {/* CLASSICAL : résultats */}
      <section className="results" id="resultats" data-screen-label="Résultats">
        {loading && (
          <div className="results-loading" role="status">
            <div className="loading-bar"><div /></div>
            <p>{progress || 'Calcul des itinéraires…'}</p>
          </div>
        )}

        {referenceAddress && results.length > 0 && (
          <>
            <div className="reference-card result-reveal">
              <div className="reference-text">
                <div className="serif-kicker"><Navigation size={14} />Départ unique</div>
                <h2>{referenceAddress.label}</h2>
                <p>
                  Tous les itinéraires ci-dessous partent de cette adresse
                  {departureTime ? `, horaires du ${formatDepartureTime(departureTime)}` : ''}.
                </p>
                {referenceAddress.confidence && referenceAddress.confidence !== 'high' && (
                  <p className="confidence-note">{confidenceLabel(referenceAddress.confidence)}</p>
                )}
              </div>
              <div className="big-count">
                <Count value={results.length} delay=".2s" />
                <span>destinations<br />classées</span>
              </div>
            </div>

            <div className="results-layout">
              <aside className="results-map-col" aria-label="Carte des résultats">
                <ResultsMap
                  origin={referenceAddress}
                  results={results}
                  focus={mapFocus}
                  highlight={hoveredIndex}
                  onShowCard={showCard}
                />
              </aside>

              <div className="results-list-col">
                <div className="results-heading">
                  <div className="serif-kicker">03 — Recommandations</div>
                  <h2>Meilleures adresses pour les transports</h2>
                  <span className="method-note">Les rangs ex æquo partagent la même position</span>
                </div>

                {excluded.length > 0 && (
                  <details className="excluded-note">
                    <summary>
                      {excluded.length} adresse{excluded.length > 1 ? 's' : ''} hors zone « {ZONE_LABELS[resultZone]} »
                      non calculée{excluded.length > 1 ? 's' : ''}
                    </summary>
                    <ul>
                      {excluded.map((item) => (
                        <li key={item.input}>
                          {item.label ?? item.input}
                          {item.label && item.postcode ? ` (${item.postcode})` : ''}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                <div className="results-list">
                  {results.map((result, index) => {
                    const journey = result.journey;
                    const delay = `${0.15 + index * 0.12}s`;
                    return (
                      <article
                        className={`result-card result-reveal${hoveredIndex === index ? ' is-hovered' : ''}`}
                        key={`${result.address.input}-${index}`}
                        id={`result-${index}`}
                        onMouseEnter={() => setHoveredIndex(index)}
                        onMouseLeave={() => setHoveredIndex((current) => (current === index ? null : current))}
                        style={vars({ '--d': delay })}
                      >
                        <div className="rank"><span>{result.rank ?? index + 1}</span></div>
                        <div className="result-main">
                          <div className="result-title-row">
                            <h3>{result.address.label}</h3>
                            <div className="result-flags">
                              {index === 0 && <span className="flag best"><Trophy size={13} />Meilleur du lot</span>}
                              {result.tied && <span className="flag tie">ex æquo</span>}
                              {journey?.kind === 'walk' && <span className="flag walk"><Footprints size={13} /> à pied</span>}
                            </div>
                          </div>

                          {result.percentile != null && (
                            <div className="relative-score">
                              <div className="relative-bar"><span style={{ width: `${result.percentile}%` }} /></div>
                              <small>{percentileLabel(result.percentile)}</small>
                            </div>
                          )}

                          {result.error || !journey ? (
                            <div className="alert error compact">{result.error ?? 'Itinéraire introuvable'}</div>
                          ) : (
                            <>
                              <div className="metrics-grid">
                                <div className="metric">
                                  <span><Clock size={14} />Trajet</span>
                                  <div><Count value={journey.durationMinutes} delay={delay} /><em>min</em></div>
                                  {journey.averageWaitMinutes >= 1 && (
                                    <small>+ {formatMinutes(journey.averageWaitMinutes)} d’attente moy.</small>
                                  )}
                                </div>
                                <div className="metric">
                                  <span><Footprints size={14} />Marche totale</span>
                                  <div><Count value={journey.walkingMinutes} delay={delay} /><em>min</em></div>
                                  <small>{formatDistance(journey.walkingMeters)}</small>
                                </div>
                                <div className="metric">
                                  <span><ArrowRightLeft size={14} />Correspondances</span>
                                  <div><strong className="pop">{journey.transfers}</strong></div>
                                </div>
                                <div className="metric">
                                  <span><TrainFront size={14} />Transports pris</span>
                                  <div><strong className="pop">{journey.transportCount}</strong></div>
                                </div>
                              </div>

                              {journey.kind === 'walk' ? (
                                <div className="route-flow">
                                  <span className="route-end"><Footprints size={14} />Trajet direct à pied · {formatMinutes(journey.walkingMinutes)} · {formatDistance(journey.walkingMeters)}</span>
                                </div>
                              ) : (
                                <div className="route-flow">
                                  <span className="route-end">
                                    <Navigation size={14} />Départ · {formatMinutes(journey.startWalkMinutes)} · {formatDistance(journey.startWalkMeters)}
                                  </span>
                                  {journey.lines.map((line, lineIndex) => (
                                    <span className="route-leg" key={`${line}-${lineIndex}`}>
                                      <i style={vars({ '--d': `${0.65 + index * 0.12 + lineIndex * 0.15}s` })} />
                                      <span className="line-pill">{line}</span>
                                    </span>
                                  ))}
                                  <i className="route-tail" />
                                  <span className="route-end">
                                    <MapPin size={14} />{formatMinutes(journey.endWalkMinutes)} · {formatDistance(journey.endWalkMeters)} · arrivée
                                  </span>
                                </div>
                              )}

                              <div className="actions">
                                <span className="meta-row">
                                  Distance directe depuis le départ <strong>{formatDistance(result.directDistanceMeters!)}</strong>
                                </span>
                                {result.comparison && (
                                  <>
                                    <button type="button" onClick={() => showOnMap(index)}>
                                      Voir sur la carte <MapIcon size={14} />
                                    </button>
                                    <a href={result.comparison.googleMaps} target="_blank" rel="noreferrer">
                                      Google Maps <ExternalLink size={14} />
                                    </a>
                                    <a href={result.comparison.citymapper} target="_blank" rel="noreferrer">
                                      Citymapper <ExternalLink size={14} />
                                    </a>
                                  </>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {/* NOCTURNE : bande indigo */}
      <section className="note" data-screen-label="Note">
        <div className="glow glow-c" aria-hidden="true" />
        <p className="note-big" data-reveal>
          Le pourcentage indiqué est un percentile relatif au lot comparé, pas une note absolue.
        </p>
        <p className="note-small" data-reveal style={vars({ '--d': '.15s' })}>
          Les itinéraires sont calculés au moment de la recherche et peuvent donc varier avec les
          horaires et les données de transport disponibles.
        </p>
      </section>

      <footer>
        <span>Géocodage : BAN / IGN</span>
        <span>
          Routage transport : <a href="https://transitous.org/" target="_blank" rel="noreferrer">Transitous / MOTIS</a>
        </span>
        <span>Données cartographiques : OpenStreetMap</span>
        <a className="footer-source" href="https://github.com/brahmiamine/distance" target="_blank" rel="noreferrer">
          code source / contact
        </a>
      </footer>
    </main>
  );
}
