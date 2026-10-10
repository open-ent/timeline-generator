/**
 * Événements d'une frise, fonctions pures — même stockage que l'AngularJS (models/model.ts) :
 *  - `startDate` / `endDate` : date ISO (ex. « 1789-07-13T23:50:39.000Z » = 14/07/1789 à Paris),
 *    `endDate` vide si absente ; les anciennes saisies React « AAAA-MM-JJ » restent lisibles ;
 *  - `dateFormat` : précision affichée, « year » (1789), « month » (07/1789) ou « day » (14/07/1789) ;
 *  - média : `img` (document de l'espace documentaire) OU `video` (adresse), jamais les deux.
 */

export type DateFormat = 'year' | 'month' | 'day';

export interface StoredEvent {
  _id?: string;
  headline: string;
  text?: string;
  startDate: string;
  endDate?: string;
  dateFormat?: DateFormat;
  img?: string | null;
  video?: string | null;
}

/** Lit une date stockée : ISO (AngularJS), « AAAA-MM-JJ » ou « AAAA,MM,JJ ». */
export function parseStoredDate(s?: string | null): Date | null {
  if (!s) return null;
  if (s.includes('T')) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const parts = s.split(s.includes(',') ? ',' : '-').map((p) => Number(p.trim()));
  if (parts.length < 1 || !Number.isFinite(parts[0])) return null;
  return localDate(parts[0], parts[1] || 1, parts[2] || 1);
}

/** Date locale à minuit, y compris pour les années < 100 (que `new Date(y, …)` décale en 19xx). */
export function localDate(year: number, month: number, day: number): Date {
  const d = new Date(2000, month - 1, day);
  d.setFullYear(year);
  return d;
}

const pad = (n: number) => String(n).padStart(2, '0');
const yearStr = (y: number) => (y < 0 ? `-${String(-y).padStart(4, '0')}` : String(y).padStart(4, '0'));

/** Date affichée selon la précision. Ex. (14/07/1789, « month ») → « 07/1789 ». */
export function formatEventDate(s: string | null | undefined, fmt: DateFormat = 'day'): string {
  const d = parseStoredDate(s);
  if (!d) return '';
  if (fmt === 'year') return String(d.getFullYear());
  if (fmt === 'month') return `${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Valeur du champ de saisie : `date` (AAAA-MM-JJ), `month` (AAAA-MM) ou nombre (AAAA). */
export function toFormValue(s: string | null | undefined, fmt: DateFormat): string {
  const d = parseStoredDate(s);
  if (!d) return '';
  const y = yearStr(d.getFullYear());
  if (fmt === 'year') return String(d.getFullYear());
  if (fmt === 'month') return `${y}-${pad(d.getMonth() + 1)}`;
  return `${y}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Date à stocker depuis le champ de saisie, en ISO comme l'AngularJS (minuit local). « » si
 * invalide. Ex. (« 1789 », « year ») → 01/01/1789 ; (« 1789-07 », « month ») → 01/07/1789.
 */
export function fromFormValue(v: string, fmt: DateFormat): string {
  const t = v.trim();
  if (!t) return '';
  let m: RegExpMatchArray | null;
  if (fmt === 'year') m = t.match(/^(-?\d{1,6})$/);
  else if (fmt === 'month') m = t.match(/^(-?\d{1,6})-(\d{1,2})$/);
  else m = t.match(/^(-?\d{1,6})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return '';
  const [y, mo = 1, d = 1] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return localDate(y, mo, d).toISOString();
}

/** Clé de tri chronologique ; +∞ si date absente (en fin de liste). */
export function eventSortKey(s?: string | null): number {
  const d = parseStoredDate(s);
  return d ? d.getTime() : Number.POSITIVE_INFINITY;
}

/** Erreurs de saisie d'un événement : titre, date de début, fin avant le début. */
export function validateEvent(e: { headline: string; startDate: string; endDate?: string }): Array<'headline' | 'start' | 'order'> {
  const errs: Array<'headline' | 'start' | 'order'> = [];
  if (!e.headline.trim()) errs.push('headline');
  if (!e.startDate) errs.push('start');
  if (e.startDate && e.endDate && eventSortKey(e.endDate) < eventSortKey(e.startDate)) errs.push('order');
  return errs;
}

/** Format TimelineJS par précision (behaviours.ts de l'AngularJS). */
const TIMELINEJS_FORMAT: Record<DateFormat, (d: Date) => string> = {
  year: (d) => yearStr(d.getFullYear()),
  month: (d) => `${yearStr(d.getFullYear())},${pad(d.getMonth() + 1)}`,
  day: (d) => `${yearStr(d.getFullYear())},${pad(d.getMonth() + 1)},${pad(d.getDate())}`,
};

/**
 * Données de la visionneuse TimelineJS (mode « Frise »), comme Timeline.toTimelineJsJSON :
 * image en adresse absolue, vidéo telle quelle. Ex. événement daté 1789 → startDate « 1789 ».
 */
export function timelineJsData(
  timeline: { headline: string; text?: string; icon?: string },
  events: StoredEvent[],
  origin: string,
) {
  const date = events
    .map((e) => {
      const fmt = e.dateFormat ?? 'day';
      const start = parseStoredDate(e.startDate);
      if (!start) return null;
      const end = parseStoredDate(e.endDate);
      const media = e.img ? origin + e.img : e.video || '';
      return {
        headline: e.headline,
        startDate: TIMELINEJS_FORMAT[fmt](start),
        ...(end ? { endDate: TIMELINEJS_FORMAT[fmt](end) } : {}),
        text: e.text || ' ',
        ...(media ? { asset: { media } } : {}),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  return {
    timeline: {
      headline: timeline.headline,
      type: 'default',
      text: timeline.text || ' ',
      ...(timeline.icon ? { asset: { media: origin + timeline.icon } } : {}),
      date,
    },
  };
}
