import { describe, expect, it } from 'vitest';

import { formatDate, parseFlexDate, sortKey, toDateInput } from './utils';

describe('parseFlexDate', () => {
  it('accepte « YYYY-MM-DD »', () => {
    expect(parseFlexDate('2026-09-01')?.getFullYear()).toBe(2026);
    expect(parseFlexDate('2026-09-01')?.getMonth()).toBe(8); // septembre
  });
  it('accepte « YYYY,MM,DD » (TimelineJS)', () => {
    expect(parseFlexDate('2026,9,1')?.getDate()).toBe(1);
    expect(parseFlexDate('2026,9,1')?.getMonth()).toBe(8);
  });
  it('renvoie null pour une entrée absente/invalide', () => {
    expect(parseFlexDate(undefined)).toBeNull();
    expect(parseFlexDate('n/a')).toBeNull();
  });
});

describe('formatDate', () => {
  it('formate en jj/mm/aaaa quel que soit le format d\'entrée', () => {
    expect(formatDate('2026-09-01')).toBe('01/09/2026');
    expect(formatDate('2026,9,1')).toBe('01/09/2026');
    expect(formatDate('')).toBe('');
  });
});

describe('toDateInput', () => {
  it('normalise en YYYY-MM-DD', () => {
    expect(toDateInput('2026,9,1')).toBe('2026-09-01');
    expect(toDateInput('2026-09-01')).toBe('2026-09-01');
    expect(toDateInput(undefined)).toBe('');
  });
});

describe('sortKey', () => {
  it('ordonne chronologiquement (absent en dernier)', () => {
    expect(sortKey('2026-01-01')).toBeLessThan(sortKey('2026-12-31'));
    expect(sortKey(undefined)).toBe(Number.POSITIVE_INFINITY);
  });
});
