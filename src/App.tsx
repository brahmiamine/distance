import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Bus,
  CableCar,
  ClipboardPaste,
  Clock,
  ExternalLink,
  Footprints,
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
import { browserCache } from './services/cache';
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

function readStoredZone(): Zone {
  const stored = localStorage.getItem(ZONE_STORAGE_KEY);
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
    () => localStorage.getItem(REFERENCE_STORAGE_KEY) ?? '',
  );
  const [addressesText, setAddressesText] = useState(
    () => localStorage.getItem(ADDRESSES_STORAGE_KEY) ?? '',
  );
  const [selectedTypes, setSelectedTypes] = useState<TransitType[]>(DEFAULT_TRANSIT_TYPES);
  const [zone, setZone] = useState<Zone>(readStoredZone);
  const [excluded, setExcluded] = useState<ExcludedAddress[]>([]);
  const [resultZone, setResultZone] = useState<Zone>('all');
  const [referenceAddress, setReferenceAddress] = useState<GeocodedAddress | null>(null);
  const [results, setResults] = useState<RankedAddress[]>([]);
  const [departureTime, setDepartureTime] = useState<Date | null>(null);
  const [mapFocus, setMapFocus] = useState<{ index: number; nonce: number } | null>(null);

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
    localStorage.setItem(REFERENCE_STORAGE_KEY, referenceText);
  }, [referenceText]);

  useEffect(() => {
    localStorage.setItem(ADDRESSES_STORAGE_KEY, addressesText);
  }, [addressesText]);

  useEffect(() => {
    localStorage.setItem(ZONE_STORAGE_KEY, zone);
  }, [zone]);

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
              <span>Une adresse par ligne · {MAX_ADDRESSES} calculées au plus (après filtre de zone)</span>
            </div>
            <button
              type="button"
              className="text-button extract-toggle"
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
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleExtract}
                  disabled={!pasteText.trim()}
                >
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

          <fieldset>
            <legend>Zone des destinations à calculer</legend>
            <div className="transport-options zone-options" role="radiogroup">
              {ZONES.map((option) => (
                <label key={option} className={zone === option ? 'chip active' : 'chip'}>
                  <input
                    type="radio"
                    name="zone"
                    value={option}
                    checked={zone === option}
                    onChange={() => setZone(option)}
                  />
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
            <span><Clock size={16} /> Temps et attente raisonnables</span>
            <span><Navigation size={16} /> Distance plus courte</span>
          </div>

          {globalError && <div className="alert error">{globalError}</div>}

          <button className={loading ? 'primary-button loading' : 'primary-button'} type="submit" disabled={loading}>
            <span className="button-content">
              {loading ? <span className="spinner" /> : <Sparkles size={18} />}
              {loading
                ? 'Calcul des itinéraires…'
                : `Classer ${zonePreview.kept.length || ''} destination${zonePreview.kept.length > 1 ? 's' : ''}`}
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
              <p>
                Tous les itinéraires ci-dessous partent de cette adresse
                {departureTime ? `, horaires du ${formatDepartureTime(departureTime)}` : ''}.
              </p>
              {referenceAddress.confidence && referenceAddress.confidence !== 'high' && (
                <p className="confidence-note">{confidenceLabel(referenceAddress.confidence)}</p>
              )}
            </div>
          </div>

          <ResultsMap
            origin={referenceAddress}
            results={results}
            focus={mapFocus}
            onShowCard={showCard}
          />

          <div className="results-heading">
            <div>
              <span className="eyebrow">
                <Sparkles size={14} />
                Recommandations
              </span>
              <h2>Meilleures adresses pour les transports</h2>
            </div>
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
            {results.map((result, index) => (
              <article
                className={index === 0 ? 'result-card top-result result-reveal' : 'result-card result-reveal'}
                key={`${result.address.input}-${index}`}
                id={`result-${index}`}
                style={{ animationDelay: `${index * 90}ms` }}
              >
                <div className={index === 0 ? 'rank rank-first' : 'rank'}>
                  {index === 0 ? <Trophy size={20} /> : `#${result.rank ?? index + 1}`}
                </div>
                <div className="result-main">
                  <div className="result-title-row">
                    <div className="destination-title">
                      <MapPin size={17} />
                      <h3>{result.address.label}</h3>
                    </div>
                    <div className="result-flags">
                      {result.tied && <span className="flag tie">ex æquo</span>}
                      {result.journey?.kind === 'walk' && (
                        <span className="flag walk"><Footprints size={13} /> à pied</span>
                      )}
                    </div>
                  </div>

                  {result.percentile != null && (
                    <div className="relative-score">
                      <div className="relative-bar">
                        <span style={{ width: `${result.percentile}%` }} />
                      </div>
                      <small>{percentileLabel(result.percentile)}</small>
                    </div>
                  )}

                  {result.error || !result.journey ? (
                    <div className="alert error compact">{result.error ?? 'Itinéraire introuvable'}</div>
                  ) : (
                    <>
                      <div className="metrics-grid">
                        <div className="metric">
                          <Clock size={17} />
                          <span>Trajet</span>
                          <strong>{formatMinutes(result.journey.durationMinutes)}</strong>
                          {result.journey.averageWaitMinutes >= 1 && (
                            <small>+ {formatMinutes(result.journey.averageWaitMinutes)} d’attente moy.</small>
                          )}
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

                      {result.journey.kind === 'walk' ? (
                        <div className="walk-details">
                          <div>
                            <span><Footprints size={15} /> Trajet direct à pied (plus simple qu’en transport)</span>
                            <strong>
                              {formatMinutes(result.journey.walkingMinutes)} ·{' '}
                              {formatDistance(result.journey.walkingMeters)}
                            </strong>
                          </div>
                        </div>
                      ) : (
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
                      )}

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

                      {result.comparison && (
                        <div className="actions">
                          <button type="button" onClick={() => showOnMap(index)}>
                            Voir sur la carte <MapIcon size={14} />
                          </button>
                          <a href={result.comparison.googleMaps} target="_blank" rel="noreferrer">
                            Google Maps <ExternalLink size={14} />
                          </a>
                          <a href={result.comparison.citymapper} target="_blank" rel="noreferrer">
                            Citymapper <ExternalLink size={14} />
                          </a>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>

          <p className="footnote">
            Le calcul utilise les horaires d’un jour ouvré à 9 h et un coût « ressenti » : une
            minute de marche ou d’attente pèse plus qu’une minute assis, chaque correspondance est
            pénalisée et la marche directe est retenue quand elle est plus simple. Le pourcentage indiqué est un percentile <strong>relatif
            au lot comparé</strong>, pas une note absolue.
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
