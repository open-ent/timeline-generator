import { describe, expect, it } from 'vitest';

import { eventSortKey, formatEventDate, fromFormValue, localDate, parseStoredDate, timelineJsData, toFormValue, validateEvent } from './events';

describe('dates des événements', () => {
  it('lit les dates ISO enregistrées par l\'AngularJS et les anciennes saisies React', () => {
    expect(parseStoredDate('1789-10-10T16:31:36.919Z')?.getFullYear()).toBe(1789);
    expect(parseStoredDate('2026-09-01')?.getMonth()).toBe(8);
    expect(parseStoredDate('1789,07,14')?.getDate()).toBe(14);
    expect(parseStoredDate('')).toBeNull();
  });
  it('affiche selon la précision année / mois / jour', () => {
    const iso = localDate(1789, 7, 14).toISOString();
    expect(formatEventDate(iso, 'year')).toBe('1789');
    expect(formatEventDate(iso, 'month')).toBe('07/1789');
    expect(formatEventDate(iso, 'day')).toBe('14/07/1789');
  });
  it('aller-retour saisie → stockage → saisie, années anciennes comprises', () => {
    for (const [v, fmt] of [['1789-07-14', 'day'], ['1789-07', 'month'], ['1789', 'year'], ['0052', 'year']] as const) {
      expect(toFormValue(fromFormValue(v, fmt), fmt)).toBe(fmt === 'year' ? String(Number(v)) : v);
    }
    expect(fromFormValue('1789-13', 'month')).toBe('');
    expect(fromFormValue('abc', 'year')).toBe('');
  });
  it('tri chronologique, date absente en fin de liste', () => {
    expect(eventSortKey(localDate(1789, 7, 14).toISOString())).toBeLessThan(eventSortKey(localDate(1792, 9, 21).toISOString()));
    expect(eventSortKey('')).toBe(Number.POSITIVE_INFINITY);
  });
  it('validation : titre, date de début, fin après le début', () => {
    const a = localDate(1792, 1, 1).toISOString();
    const b = localDate(1789, 1, 1).toISOString();
    expect(validateEvent({ headline: '', startDate: '' })).toEqual(['headline', 'start']);
    expect(validateEvent({ headline: 'X', startDate: a, endDate: b })).toEqual(['order']);
    expect(validateEvent({ headline: 'X', startDate: b, endDate: a })).toEqual([]);
  });
});

describe('visionneuse TimelineJS', () => {
  it('formats et médias comme l\'AngularJS', () => {
    const data = timelineJsData(
      { headline: 'Révolution', icon: '/workspace/document/i1' },
      [
        { headline: 'Bastille', startDate: localDate(1789, 7, 14).toISOString(), dateFormat: 'day', img: '/workspace/document/d1' },
        { headline: 'République', startDate: localDate(1792, 9, 21).toISOString(), dateFormat: 'year', video: 'https://video/x' },
        { headline: 'Sans date', startDate: '' },
      ],
      'https://ent.fr',
    );
    expect(data.timeline.asset).toEqual({ media: 'https://ent.fr/workspace/document/i1' });
    expect(data.timeline.date).toEqual([
      { headline: 'Bastille', startDate: '1789,07,14', text: ' ', asset: { media: 'https://ent.fr/workspace/document/d1' } },
      { headline: 'République', startDate: '1792', text: ' ', asset: { media: 'https://video/x' } },
    ]);
  });
});
