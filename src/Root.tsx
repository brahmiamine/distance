import { useEffect, useState } from 'react';
import App from './App';
import ApiPage from './ApiPage';

type Route = 'home' | 'api';

function readRoute(): Route {
  return window.location.hash.replace(/^#/, '') === '/api' ? 'api' : 'home';
}

/**
 * Petit routeur par hash : `#/` pour le comparateur, `#/api` pour la page API.
 * Le hash est utilisé (plutôt que des chemins) pour rester compatible avec
 * GitHub Pages et ne pas entrer en conflit avec l'endpoint `/api/rank`.
 */
export default function Root() {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const onHashChange = () => {
      setRoute(readRoute());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route === 'api' ? <ApiPage /> : <App />;
}
