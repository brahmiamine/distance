export type FetchResponder = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** Réponse JSON utilisable comme retour de `fetch`. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Construit un `fetch` de test à partir d'un répondeur simple. */
export function stubFetch(responder: FetchResponder): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return responder(url, init);
  }) as typeof fetch;
}
