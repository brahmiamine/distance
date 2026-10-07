const PARIS_TIME_ZONE = 'Europe/Paris';
export const REFERENCE_HOUR = 9;

const PARTS_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: PARIS_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Décalage de l'heure de Paris par rapport à UTC (ms) à un instant donné. */
function parisOffsetMs(date: Date): number {
  const parts = PARTS_FORMAT.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Horaire de référence des calculs : le prochain jour ouvré (lundi → vendredi)
 * à 9 h, heure de Paris. Un horaire fixe rend le classement reproductible et
 * évite de comparer des trajets nocturnes ou de week-end selon l'heure du clic.
 */
export function referenceDepartureTime(now: Date = new Date(), hour = REFERENCE_HOUR): Date {
  const parisNow = new Date(now.getTime() + parisOffsetMs(now));

  for (let day = 0; day < 8; day += 1) {
    const localMs = Date.UTC(
      parisNow.getUTCFullYear(),
      parisNow.getUTCMonth(),
      parisNow.getUTCDate() + day,
      hour,
    );
    const weekday = new Date(localMs).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;

    const candidate = new Date(localMs - parisOffsetMs(new Date(localMs)));
    if (candidate.getTime() > now.getTime()) return candidate;
  }

  return now;
}

/** Libellé lisible de l'horaire de référence (ex. « jeudi 8 octobre à 9 h 00 »). */
export function formatDepartureTime(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: PARIS_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
