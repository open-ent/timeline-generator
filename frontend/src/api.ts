// Client REST du module Timeline-generator (frises chronologiques) — session ENT, même origine.
// Mêmes endpoints que la version AngularJS (backend Java inchangé).
// Header X-XSRF-TOKEN injecté sur les mutations (comme calendar).

const APP = '/timelinegenerator';

export interface Timeline {
  _id: string;
  headline: string;
  text?: string;
  type: string;
  icon?: string;
  owner?: { userId: string; displayName: string };
  folder?: string;
  trashed?: boolean;
}

/** Événement d'une frise. `startDate`/`endDate` sont des chaînes (« YYYY-MM-DD »). */
export interface TimelineEvent {
  _id: string;
  headline: string;
  text?: string;
  startDate: string;
  endDate?: string;
  img?: string;
  video?: string;
  owner?: { userId: string; displayName: string };
}

export interface EventInput {
  headline: string;
  startDate: string;
  endDate?: string;
  text?: string;
}

function xsrfHeader(): Record<string, string> {
  const m = typeof document !== 'undefined' ? document.cookie.match(/XSRF-TOKEN=([^;]+)/) : null;
  return m ? { 'X-XSRF-TOKEN': decodeURIComponent(m[1]) } : {};
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(String(res.status));
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

const base = { credentials: 'include' as const };
const jsonHeaders = { 'Content-Type': 'application/json' };
const mutHeaders = () => ({ ...jsonHeaders, ...xsrfHeader() });

// ── Frises ────────────────────────────────────────────────────────────────────
export const getTimelines = async (): Promise<Timeline[]> =>
  json<Timeline[]>(await fetch(`${APP}/timelines`, base));

export const getTimeline = async (id: string): Promise<Timeline> =>
  json<Timeline>(await fetch(`${APP}/timeline/${id}`, base));

export const createTimeline = async (data: { headline: string; text?: string }): Promise<Timeline> =>
  json<Timeline>(
    await fetch(`${APP}/timelines`, { ...base, method: 'POST', headers: mutHeaders(), body: JSON.stringify({ ...data, type: 'timeline' }) }),
  );

export const updateTimeline = async (id: string, data: { headline: string; text?: string }): Promise<Timeline> =>
  json<Timeline>(
    await fetch(`${APP}/timeline/${id}`, { ...base, method: 'PUT', headers: mutHeaders(), body: JSON.stringify({ ...data, type: 'timeline' }) }),
  );

export const deleteTimeline = async (id: string): Promise<void> => {
  const res = await fetch(`${APP}/timeline/${id}`, { ...base, method: 'DELETE', headers: xsrfHeader() });
  if (!res.ok && res.status !== 204) throw new Error(String(res.status));
};

// ── Événements ──────────────────────────────────────────────────────────────
export const getEvents = async (timelineId: string): Promise<TimelineEvent[]> =>
  json<TimelineEvent[]>(await fetch(`${APP}/timeline/${timelineId}/events`, base));

export const createEvent = async (timelineId: string, data: EventInput): Promise<TimelineEvent> =>
  json<TimelineEvent>(
    await fetch(`${APP}/timeline/${timelineId}/events`, { ...base, method: 'POST', headers: mutHeaders(), body: JSON.stringify(data) }),
  );

export const updateEvent = async (timelineId: string, eventId: string, data: EventInput): Promise<TimelineEvent> =>
  json<TimelineEvent>(
    await fetch(`${APP}/timeline/${timelineId}/event/${eventId}`, { ...base, method: 'PUT', headers: mutHeaders(), body: JSON.stringify(data) }),
  );

export const deleteEvent = async (timelineId: string, eventId: string): Promise<void> => {
  const res = await fetch(`${APP}/timeline/${timelineId}/event/${eventId}`, { ...base, method: 'DELETE', headers: xsrfHeader() });
  if (!res.ok && res.status !== 204) throw new Error(String(res.status));
};

export const api = {
  getTimelines,
  getTimeline,
  createTimeline,
  updateTimeline,
  deleteTimeline,
  getEvents,
  createEvent,
  updateEvent,
  deleteEvent,
};
