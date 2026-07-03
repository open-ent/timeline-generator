/** Fonctions pures du module Timeline-generator (testables). */

/**
 * Parse une date de frise, tolérante au format : « YYYY-MM-DD » (input HTML) ou
 * « YYYY,MM,DD » (format TimelineJS de l'ancienne IHM). Renvoie une Date ou null.
 */
export function parseFlexDate(s?: string): Date | null {
  if (!s) return null;
  const parts = s.includes(',') ? s.split(',') : s.split('-');
  if (parts.length < 3) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const [y, m, day] = parts.map((p) => Number(p.trim()));
  if (!y || !m || !day) return null;
  const d = new Date(y, m - 1, day);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Formate une date de frise en « jj/mm/aaaa » (locale FR), tolérante au format. */
export function formatDate(s?: string): string {
  const d = parseFlexDate(s);
  return d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
}

/** Convertit une date de frise en valeur `<input type="date">` (« YYYY-MM-DD »). */
export function toDateInput(s?: string): string {
  const d = parseFlexDate(s);
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Clé de tri chronologique (timestamp) d'une date de frise ; +∞ si absente. */
export function sortKey(s?: string): number {
  const d = parseFlexDate(s);
  return d ? d.getTime() : Number.POSITIVE_INFINITY;
}
