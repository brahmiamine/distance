import { useMemo, useState } from 'react';
import { ArrowLeft, Check, Copy, Send, Terminal } from 'lucide-react';
import { TYPE_LABELS } from './App';
import { DEFAULT_TRANSIT_TYPES, MAX_ADDRESSES } from './services/ranking';
import type { TransitType } from './types';

const REFERENCE_STORAGE_KEY = 'distance-transports-reference';
const ADDRESSES_STORAGE_KEY = 'distance-transports-addresses';
const API_PATH = '/api/rank';

interface TestState {
  status: 'idle' | 'loading' | 'done' | 'error';
  body: string;
}

export default function ApiPage() {
  const [origin, setOrigin] = useState(
    () =>
      localStorage.getItem(REFERENCE_STORAGE_KEY) ??
      '10 avenue des Champs-Élysées, 75008 Paris',
  );
  const [addressesText, setAddressesText] = useState(
    () =>
      localStorage.getItem(ADDRESSES_STORAGE_KEY) ??
      "56 avenue de l'Agent Sarre, 92700 Colombes\n5 Boulevard des Bouvets, 92747 Nanterre",
  );
  const [types, setTypes] = useState<TransitType[]>(DEFAULT_TRANSIT_TYPES);
  const [copied, setCopied] = useState(false);
  const [test, setTest] = useState<TestState>({ status: 'idle', body: '' });

  const apiUrl = `${window.location.origin}${API_PATH}`;

  const addresses = useMemo(
    () =>
      addressesText
        .split('\n')
        .map((address) => address.trim())
        .filter(Boolean)
        .filter((address, index, list) => list.indexOf(address) === index),
    [addressesText],
  );

  const payload = useMemo(
    () => ({ origin: origin.trim(), addresses, types }),
    [origin, addresses, types],
  );
  const payloadJson = useMemo(() => JSON.stringify(payload, null, 2), [payload]);

  const curlCommand = useMemo(() => {
    const shellJson = payloadJson.replace(/'/g, `'\\''`);
    return `curl -X POST '${apiUrl}' \\\n  -H 'content-type: application/json' \\\n  -d '${shellJson}'`;
  }, [apiUrl, payloadJson]);

  const validation = !origin.trim()
    ? 'Renseignez une adresse de départ.'
    : addresses.length < 1
      ? 'Ajoutez au moins une adresse.'
      : addresses.length > MAX_ADDRESSES
        ? `La V1 accepte au maximum ${MAX_ADDRESSES} adresses.`
        : types.length < 1
          ? 'Sélectionnez au moins un type de transport.'
          : '';

  const toggleType = (type: TransitType) => {
    setTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  };

  const copyCurl = async () => {
    try {
      await navigator.clipboard.writeText(curlCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const runTest = async () => {
    if (validation) {
      setTest({ status: 'error', body: validation });
      return;
    }

    setTest({ status: 'loading', body: '' });
    try {
      const response = await fetch(API_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payloadJson,
      });
      const text = await response.text();
      let body = text;
      try {
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Réponse non JSON : on affiche le texte brut.
      }
      setTest({ status: response.ok ? 'done' : 'error', body });
    } catch (error) {
      setTest({
        status: 'error',
        body: error instanceof Error ? error.message : 'Erreur inconnue',
      });
    }
  };

  return (
    <main className="page-shell">
      <a className="back-link" href="#/">
        <ArrowLeft size={15} />
        Retour au comparateur
      </a>

      <section className="hero api-hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <Terminal size={14} />
            API publique
          </span>
          <h1>Réutilisez le classement depuis vos propres outils</h1>
          <p>
            Envoyez une adresse de départ et une liste d’adresses, récupérez le classement en JSON,
            déjà trié. Testez la requête et inspectez la réponse directement depuis cette page.
          </p>
        </div>
      </section>

      <section className="panel api-panel animated-panel">
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

        <div className="api-form">
          <label>
            <span>Adresse de départ</span>
            <input
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
              placeholder="Ex. 10 avenue des Champs-Élysées, 75008 Paris"
            />
          </label>

          <label>
            <span>Adresses de destination (une par ligne)</span>
            <textarea
              rows={5}
              value={addressesText}
              onChange={(event) => setAddressesText(event.target.value)}
              placeholder="Une adresse par ligne"
            />
          </label>

          <div className="api-types">
            <span>Transports autorisés</span>
            <div className="transport-options">
              {(Object.keys(TYPE_LABELS) as TransitType[]).map((type) => (
                <label key={type} className={types.includes(type) ? 'chip active' : 'chip'}>
                  <input
                    type="checkbox"
                    checked={types.includes(type)}
                    onChange={() => toggleType(type)}
                  />
                  {TYPE_LABELS[type]}
                </label>
              ))}
            </div>
          </div>
        </div>

        <h3 className="api-subtitle">Corps de la requête (JSON)</h3>
        <pre className="api-code"><code>{payloadJson}</code></pre>

        <h3 className="api-subtitle">Commande curl équivalente</h3>
        <pre className="api-code"><code>{curlCommand}</code></pre>

        <div className="api-actions">
          <button
            type="button"
            className="api-test-button"
            onClick={runTest}
            disabled={test.status === 'loading'}
          >
            {test.status === 'loading' ? <span className="spinner" /> : <Send size={16} />}
            {test.status === 'loading' ? 'Appel en cours…' : 'Envoyer la requête'}
          </button>
          {validation && <span className="api-hint error">{validation}</span>}
        </div>

        {test.status !== 'idle' && test.body && (
          <>
            <h3 className="api-subtitle">
              Réponse JSON {test.status === 'error' ? '(erreur)' : ''}
            </h3>
            <pre
              className={
                test.status === 'error' ? 'api-code api-response error' : 'api-code api-response'
              }
            >
              <code>{test.body}</code>
            </pre>
          </>
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
