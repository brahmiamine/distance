import { FormEvent, useMemo, useState } from 'react';
import { geocodeAddress } from './services/geocoding';
import { findNearestStops } from './services/idfm';
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

const DEFAULT_TYPES: TransitType[] = ['metro', 'rail', 'tram'];
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

function walkingMinutes(value: number): number {
  return Math.max(1, Math.round(value / 80));
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

export default function App() {
  const [referenceText, setReferenceText] = useState(
    () => localStorage.getItem(REFERENCE_STORAGE_KEY) ?? '',
  );
  const [addressesText, setAddressesText] = useState(
    () => localStorage.getItem(ADDRESSES_STORAGE_KEY) ?? '',
  );
  const [selectedTypes, setSelectedTypes] = useState<TransitType[]>(DEFAULT_TYPES);
  const [referenceAnalysis, setReferenceAnalysis] = useState<RankedAddress | null>(null);
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
    setReferenceAnalysis(null);

    if (!referenceText.trim()) {
      setGlobalError('Renseignez une adresse de référence.');
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
      setProgress('Analyse de l’adresse de référence…');
      const referenceAddress = await geocodeAddress(referenceText.trim());
      const referenceStops = await findNearestStops(referenceAddress, selectedTypes);
      const referenceNearestStop = referenceStops[0];

      if (!referenceNearestStop) {
        throw new Error('Aucune station correspondant aux filtres trouvée près de l’adresse de référence.');
      }

      const reference: RankedAddress = {
        address: referenceAddress,
        stops: referenceStops,
        nearestStop: referenceNearestStop,
      };
      setReferenceAnalysis(reference);

      const collected: RankedAddress[] = [];

      for (let index = 0; index < addresses.length; index += 1) {
        const input = addresses[index];
        setProgress(`Analyse ${index + 1}/${addresses.length} — ${input}`);

        try {
          const address = await geocodeAddress(input);
          const stops = await findNearestStops(address, selectedTypes);
          const nearestStop = stops[0];

          collected.push({
            address,
            stops,
            nearestStop,
            totalAccessMeters: nearestStop
              ? referenceNearestStop.distanceMeters + nearestStop.distanceMeters
              : undefined,
            directDistanceMeters: haversineDistanceMeters(referenceAddress, address),
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
        if (a.totalAccessMeters == null) return 1;
        if (b.totalAccessMeters == null) return -1;
        return a.totalAccessMeters - b.totalAccessMeters;
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
    setReferenceAnalysis(null);
    setResults([]);
    setGlobalError('');
    localStorage.removeItem(REFERENCE_STORAGE_KEY);
    localStorage.removeItem(ADDRESSES_STORAGE_KEY);
  };

  return (
    <main className="page-shell">
      <section className="hero">
        <div className="eyebrow">Île-de-France · données IDFM</div>
        <h1>Comparer des adresses par leur accès aux transports</h1>
        <p>
          Indiquez une adresse de référence, puis une liste d’adresses. L’application compare
          l’accès aux stations aux deux extrémités et classe les adresses les mieux desservies.
        </p>
      </section>

      <section className="panel form-panel">
        <form onSubmit={compare}>
          <div className="field-heading">
            <div>
              <label htmlFor="reference">Adresse de référence</label>
              <span>Votre domicile, travail ou lieu de destination principal</span>
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
              <label htmlFor="addresses">Liste des adresses à comparer</label>
              <span>Une adresse par ligne · 1 à 20 adresses</span>
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
            {loading
              ? 'Analyse en cours…'
              : `Comparer ${addresses.length || ''} adresse${addresses.length > 1 ? 's' : ''}`}
          </button>
          {progress && <p className="progress">{progress}</p>}
        </form>
      </section>

      {referenceAnalysis?.nearestStop && results.length > 0 && (
        <section className="results-section">
          <div className="reference-card">
            <span className="eyebrow">Adresse de référence</span>
            <h2>{referenceAnalysis.address.label}</h2>
            <div className="reference-stop">
              <span className={`mode-icon mode-${referenceAnalysis.nearestStop.type}`}>
                {TYPE_ICONS[referenceAnalysis.nearestStop.type]}
              </span>
              <div>
                <strong>{referenceAnalysis.nearestStop.name}</strong>
                <span>
                  {TYPE_LABELS[referenceAnalysis.nearestStop.type]} ·{' '}
                  {formatDistance(referenceAnalysis.nearestStop.distanceMeters)} ≈{' '}
                  {walkingMinutes(referenceAnalysis.nearestStop.distanceMeters)} min à pied*
                </span>
              </div>
            </div>
          </div>

          <div className="results-heading">
            <div>
              <span className="eyebrow">Classement</span>
              <h2>Meilleur accès transport vers la référence</h2>
            </div>
            <span className="method-note">Somme des accès aux stations aux deux extrémités</span>
          </div>

          <div className="results-list">
            {results.map((result, index) => (
              <article className="result-card" key={`${result.address.input}-${index}`}>
                <div className="rank">#{index + 1}</div>
                <div className="result-main">
                  <h3>{result.address.label}</h3>
                  {result.error || !result.nearestStop ? (
                    <div className="alert error compact">{result.error ?? 'Station introuvable'}</div>
                  ) : (
                    <>
                      <div className="score-line">
                        <span>Accès transport total*</span>
                        <strong>{formatDistance(result.totalAccessMeters!)}</strong>
                      </div>

                      <div className="nearest-line">
                        <span className={`mode-icon mode-${result.nearestStop.type}`}>
                          {TYPE_ICONS[result.nearestStop.type]}
                        </span>
                        <div>
                          <strong>{result.nearestStop.name}</strong>
                          <span>
                            {TYPE_LABELS[result.nearestStop.type]}
                            {result.nearestStop.town ? ` · ${result.nearestStop.town}` : ''}
                          </span>
                        </div>
                        <div className="distance-box">
                          <strong>{formatDistance(result.nearestStop.distanceMeters)}</strong>
                          <span>≈ {walkingMinutes(result.nearestStop.distanceMeters)} min à pied*</span>
                        </div>
                      </div>

                      <div className="meta-row">
                        <span>Distance directe jusqu’à la référence</span>
                        <strong>{formatDistance(result.directDistanceMeters!)}</strong>
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
                          href={googleMapsUrl(result.address, referenceAnalysis.address)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Trajet Google Maps
                        </a>
                        <a
                          href={citymapperUrl(result.address, referenceAnalysis.address)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Trajet Citymapper
                        </a>
                      </div>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>

          <p className="footnote">
            * La V1 classe selon la proximité des stations aux deux extrémités. Le temps de marche est
            indicatif. Les boutons Google Maps et Citymapper ouvrent le vrai trajet en transports en commun.
          </p>
        </section>
      )}

      <footer>Géocodage : BAN / IGN · Arrêts : Open Data Île-de-France Mobilités</footer>
    </main>
  );
}
