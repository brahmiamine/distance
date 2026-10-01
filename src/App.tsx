import { FormEvent, useMemo, useState } from 'react';
import { geocodeAddress } from './services/geocoding';
import { findNearestStops } from './services/idfm';
import type { RankedAddress, TransitStop, TransitType } from './types';
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

const DEFAULT_TYPES: TransitType[] = ['metro', 'rail', 'tram'];
const STORAGE_KEY = 'distance-transports-addresses';

function formatDistance(value: number): string {
  if (value < 1000) return `${Math.round(value)} m`;
  return `${(value / 1000).toFixed(1)} km`;
}

function walkingMinutes(value: number): number {
  return Math.max(1, Math.round(value / 80));
}

function googleMapsUrl(address: string, stop: TransitStop): string {
  const params = new URLSearchParams({
    api: '1',
    origin: address,
    destination: `${stop.lat},${stop.lon}`,
    travelmode: 'walking',
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function citymapperUrl(address: RankedAddress, stop: TransitStop): string {
  const params = new URLSearchParams({
    startcoord: `${address.address.lat},${address.address.lon}`,
    startname: address.address.label,
    endcoord: `${stop.lat},${stop.lon}`,
    endname: stop.name,
  });
  return `https://citymapper.com/directions?${params.toString()}`;
}

export default function App() {
  const [addressesText, setAddressesText] = useState(
    () => localStorage.getItem(STORAGE_KEY) ?? '',
  );
  const [selectedTypes, setSelectedTypes] = useState<TransitType[]>(DEFAULT_TYPES);
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

    if (addresses.length < 2) {
      setGlobalError('Ajoutez au moins deux adresses, une par ligne.');
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

    localStorage.setItem(STORAGE_KEY, addressesText);
    setLoading(true);
    const collected: RankedAddress[] = [];

    for (let index = 0; index < addresses.length; index += 1) {
      const input = addresses[index];
      setProgress(`Analyse ${index + 1}/${addresses.length} — ${input}`);

      try {
        const address = await geocodeAddress(input);
        const stops = await findNearestStops(address, selectedTypes);
        collected.push({
          address,
          stops,
          nearestStop: stops[0],
          error: stops.length === 0 ? 'Aucun arrêt trouvé dans un rayon de 10 km.' : undefined,
        });
      } catch (error) {
        collected.push({
          address: { input, label: input, lat: 0, lon: 0 },
          stops: [],
          error: error instanceof Error ? error.message : 'Erreur inconnue',
        });
      }
    }

    collected.sort((a, b) => {
      if (!a.nearestStop) return 1;
      if (!b.nearestStop) return -1;
      return a.nearestStop.distanceMeters - b.nearestStop.distanceMeters;
    });

    setResults(collected);
    setProgress('');
    setLoading(false);
  };

  const clearAll = () => {
    setAddressesText('');
    setResults([]);
    setGlobalError('');
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <main className="page-shell">
      <section className="hero">
        <div className="eyebrow">Île-de-France · données IDFM</div>
        <h1>Quelles adresses sont les plus proches des transports ?</h1>
        <p>
          Collez plusieurs adresses. L’application les géocode puis les classe selon la station
          sélectionnée la plus proche.
        </p>
      </section>

      <section className="panel form-panel">
        <form onSubmit={compare}>
          <div className="field-heading">
            <div>
              <label htmlFor="addresses">Adresses à comparer</label>
              <span>Une adresse par ligne · 2 à 20 adresses</span>
            </div>
            <button type="button" className="text-button" onClick={clearAll}>
              Effacer
            </button>
          </div>

          <textarea
            id="addresses"
            value={addressesText}
            onChange={(event) => setAddressesText(event.target.value)}
            placeholder={'12 rue de Rivoli, Paris\n10 avenue de Paris, Vincennes\n1 place de la Défense, Puteaux'}
            rows={7}
          />

          <fieldset>
            <legend>Transports pris en compte</legend>
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

          {globalError && <div className="alert error">{globalError}</div>}

          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? 'Analyse en cours…' : `Comparer ${addresses.length || ''} adresses`}
          </button>
          {progress && <p className="progress">{progress}</p>}
        </form>
      </section>

      {results.length > 0 && (
        <section className="results-section">
          <div className="results-heading">
            <div>
              <span className="eyebrow">Classement</span>
              <h2>Du plus proche au plus éloigné</h2>
            </div>
            <span className="method-note">Distance géographique jusqu’à l’arrêt IDFM</span>
          </div>

          <div className="results-list">
            {results.map((result, index) => (
              <article className="result-card" key={`${result.address.input}-${index}`}>
                <div className="rank">#{index + 1}</div>
                <div className="result-main">
                  <h3>{result.address.label}</h3>
                  {result.error ? (
                    <div className="alert error compact">{result.error}</div>
                  ) : (
                    <>
                      <div className="nearest-line">
                        <span className={`mode-icon mode-${result.nearestStop!.type}`}>
                          {TYPE_ICONS[result.nearestStop!.type]}
                        </span>
                        <div>
                          <strong>{result.nearestStop!.name}</strong>
                          <span>
                            {TYPE_LABELS[result.nearestStop!.type]}
                            {result.nearestStop!.town ? ` · ${result.nearestStop!.town}` : ''}
                          </span>
                        </div>
                        <div className="distance-box">
                          <strong>{formatDistance(result.nearestStop!.distanceMeters)}</strong>
                          <span>≈ {walkingMinutes(result.nearestStop!.distanceMeters)} min à pied*</span>
                        </div>
                      </div>

                      <div className="other-stops">
                        {result.stops.slice(1, 4).map((stop) => (
                          <div className="stop-row" key={stop.id}>
                            <span className={`mode-icon small mode-${stop.type}`}>
                              {TYPE_ICONS[stop.type]}
                            </span>
                            <span>{stop.name}</span>
                            <span>{formatDistance(stop.distanceMeters)}</span>
                          </div>
                        ))}
                      </div>

                      <div className="actions">
                        <a
                          href={googleMapsUrl(result.address.label, result.nearestStop!)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Google Maps
                        </a>
                        <a
                          href={citymapperUrl(result, result.nearestStop!)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Citymapper
                        </a>
                      </div>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>

          <p className="footnote">
            * Temps de marche indicatif calculé à partir de la distance géographique. Google Maps et
            Citymapper permettent de vérifier le chemin piéton réel.
          </p>
        </section>
      )}

      <footer>Géocodage : BAN / IGN · Arrêts : Open Data Île-de-France Mobilités</footer>
    </main>
  );
}
