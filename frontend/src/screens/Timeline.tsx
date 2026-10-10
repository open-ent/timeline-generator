import { MediaLibrary, Modal, useEdificeClient, useMediaLibrary } from '@open-ent/react';
import { Editor, type EditorInstance } from '@open-ent/react/editor';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { api, EventInput, TimelineEvent } from '../api';
import { DateFormat, eventSortKey, formatEventDate, fromFormValue, timelineJsData, toFormValue, validateEvent } from '../events';
import { canContrib } from '../library';

type SortKey = 'headline' | 'startDate' | 'endDate';

/** Brouillon du formulaire : dates telles que saisies (cf. toFormValue / fromFormValue). */
interface Draft {
  id?: string;
  headline: string;
  dateFormat: DateFormat;
  start: string;
  hasEnd: boolean;
  end: string;
  media: 'img' | 'video';
  img: string;
  video: string;
  text: string;
}

const EMPTY: Draft = { headline: '', dateFormat: 'day', start: '', hasEnd: false, end: '', media: 'img', img: '', video: '', text: '' };

const draftOf = (e: TimelineEvent): Draft => {
  const fmt = e.dateFormat ?? 'day';
  return {
    id: e._id,
    headline: e.headline,
    dateFormat: fmt,
    start: toFormValue(e.startDate, fmt),
    hasEnd: !!e.endDate,
    end: toFormValue(e.endDate, fmt),
    media: e.video ? 'video' : 'img',
    img: e.img ?? '',
    video: e.video ?? '',
    text: e.text ?? '',
  };
};

/** Une chaîne VIDE fait planter l'éditeur du socle (erreur React #321) : paragraphe vide à la place. */
const editorContent = (html: string) => (html && html.trim() ? html : '<p></p>');

/**
 * Détail d'une frise, comme l'AngularJS (template/events.html, edit-event.html, read-timeline.html) :
 *  - mode « Tableau » : événements triables (titre, début, fin), sélection et suppression groupée ;
 *  - mode « Frise » : visionneuse TimelineJS du module ;
 *  - événement : titre, précision de la date (année, mois, jour), date de fin facultative, image de
 *    l'espace documentaire OU vidéo, description riche. Ex. « Prise de la Bastille », 14/07/1789.
 * Création et modification réservées au droit de contribution sur la frise.
 */
export function Timeline() {
  const { timelineId = '' } = useParams();
  const { t } = useTranslation(['timelinegenerator', 'common']);
  const qc = useQueryClient();
  const { user, appCode } = useEdificeClient();
  const me = { userId: user?.userId ?? '', groupsIds: (user as { groupsIds?: string[] } | undefined)?.groupsIds ?? [] };
  const { ref: mediaLibraryRef, ...mediaLibraryHandlers } = useMediaLibrary();
  const dialogId = useId();
  const eventsKey = ['timeline', timelineId, 'events'];

  const timelineQuery = useQuery({ queryKey: ['timeline', timelineId], queryFn: () => api.getTimeline(timelineId), enabled: !!timelineId });
  const eventsQuery = useQuery({ queryKey: eventsKey, queryFn: () => api.getEvents(timelineId), enabled: !!timelineId });
  const timeline = timelineQuery.data;
  const contrib = !!timeline && canContrib(timeline, me);

  const [mode, setMode] = useState<'table' | 'timeline'>('table');
  const [sort, setSort] = useState<{ key: SortKey; reverse: boolean }>({ key: 'startDate', reverse: false });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const events = useMemo(() => {
    const list = [...(eventsQuery.data ?? [])];
    const key = (e: TimelineEvent) => (sort.key === 'headline' ? e.headline.toLocaleLowerCase('fr') : eventSortKey(sort.key === 'startDate' ? e.startDate : e.endDate));
    list.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      const c = typeof ka === 'string' ? ka.localeCompare(kb as string, 'fr') : (ka as number) - (kb as number);
      return sort.reverse ? -c : c;
    });
    return list;
  }, [eventsQuery.data, sort]);

  const refresh = () => qc.invalidateQueries({ queryKey: eventsKey });
  const save = useMutation({
    mutationFn: (input: EventInput) => (draft?.id ? api.updateEvent(timelineId, draft.id, input) : api.createEvent(timelineId, input)),
    onSuccess: () => {
      setNotice({ ok: true, text: t('timeline.event.saved', { defaultValue: 'Événement enregistré' }) });
      setDraft(null);
      refresh();
    },
    onError: () => setErrors([t('timeline.event.error', { defaultValue: "L'enregistrement a échoué." })]),
  });
  const removeSelected = useMutation({
    mutationFn: async () => {
      for (const id of selected) await api.deleteEvent(timelineId, id);
    },
    onSuccess: () => {
      setNotice({ ok: true, text: t('timeline.events.removed', { defaultValue: 'Événement(s) supprimé(s)' }) });
      setSelected(new Set());
      setConfirmDelete(false);
      refresh();
    },
  });

  const onSave = () => {
    if (!draft) return;
    const startDate = fromFormValue(draft.start, draft.dateFormat);
    const endDate = draft.hasEnd ? fromFormValue(draft.end, draft.dateFormat) : '';
    const errs = validateEvent({ headline: draft.headline, startDate, endDate });
    if (draft.hasEnd && !endDate) errs.push('order');
    const labels: Record<string, string> = {
      headline: t('timeline.event.error.headline', { defaultValue: 'Renseignez un titre.' }),
      start: t('timeline.event.error.start', { defaultValue: 'Renseignez une date de début valide.' }),
      order: t('timeline.event.error.end', { defaultValue: 'La date de fin doit être valide et postérieure à la date de début.' }),
    };
    if (errs.length) {
      setErrors([...new Set(errs)].map((e) => labels[e]));
      return;
    }
    setErrors([]);
    save.mutate({
      headline: draft.headline.trim(),
      dateFormat: draft.dateFormat,
      startDate,
      endDate,
      text: draft.text,
      // Image OU vidéo, comme l'AngularJS (resetEventImage / resetEventVideo).
      img: draft.media === 'img' ? draft.img || null : null,
      video: draft.media === 'video' ? draft.video.trim() || null : null,
    });
  };

  /** Change la précision en gardant la date saisie (ex. 14/07/1789 → « année » : 1789). */
  const switchFormat = (fmt: DateFormat) =>
    setDraft((d) =>
      d && {
        ...d,
        dateFormat: fmt,
        start: toFormValue(fromFormValue(d.start, d.dateFormat), fmt),
        end: toFormValue(fromFormValue(d.end, d.dateFormat), fmt),
      },
    );

  const sortBy = (key: SortKey) => setSort((s) => ({ key, reverse: s.key === key ? !s.reverse : false }));
  const sortMark = (key: SortKey) => (sort.key === key ? (sort.reverse ? ' ▼' : ' ▲') : '');
  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.reverse ? 'descending' : 'ascending') : 'none');
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const dateInput = (id: string, value: string, onChange: (v: string) => void, label: string) =>
    draft?.dateFormat === 'year' ? (
      <input id={id} type="number" className="form-control" style={{ maxWidth: 160 }} placeholder="AAAA" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
    ) : (
      <input id={id} type={draft?.dateFormat === 'month' ? 'month' : 'date'} className="form-control" style={{ maxWidth: 200 }} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
    );

  return (
    <div>
      <p>
        <Link to="/">← {t('timeline.back', { defaultValue: 'Retour aux frises' })}</Link>
      </p>
      <div className="d-flex gap-16 align-items-start mb-16 flex-wrap">
        {timeline?.icon && <img src={timeline.icon} alt="" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8 }} />}
        <div className="flex-grow-1">
          <h1 className="mb-8">{timeline?.headline ?? t('timeline.title', { defaultValue: 'Frise' })}</h1>
          {timeline?.text && <Editor content={editorContent(timeline.text)} mode="read" focus={false} variant="ghost" visibility="protected" />}
        </div>
      </div>

      {notice && (
        <div className={`alert ${notice.ok ? 'alert-success' : 'alert-danger'}`} role={notice.ok ? 'status' : 'alert'}>
          {notice.text}
        </div>
      )}

      <div className="d-flex justify-content-between align-items-center gap-8 flex-wrap mb-12">
        <div className="btn-group" role="group" aria-label={t('timeline.mode', { defaultValue: 'Affichage' })}>
          <button type="button" className={`btn ${mode === 'table' ? 'btn-primary' : 'btn-outline-primary'}`} aria-pressed={mode === 'table'} onClick={() => setMode('table')}>
            {t('timelinegenerator.mode.table', { defaultValue: 'Tableau' })}
          </button>
          <button type="button" className={`btn ${mode === 'timeline' ? 'btn-primary' : 'btn-outline-primary'}`} aria-pressed={mode === 'timeline'} onClick={() => setMode('timeline')}>
            {t('timelinegenerator.mode.timeline', { defaultValue: 'Frise' })}
          </button>
        </div>
        {contrib && !draft && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setErrors([]);
              setDraft(EMPTY);
            }}
          >
            {t('timelinegenerator.event.new', { defaultValue: 'Nouvel événement' })}
          </button>
        )}
      </div>

      {draft && (
        <section className="card p-16 mb-16" aria-labelledby="tl-event-form-title">
          <div id="tl-event-form-title" role="heading" aria-level={2} className="mb-12" style={{ fontSize: 17, fontWeight: 700 }}>
            {draft.id ? t('timeline.event.edit', { defaultValue: "Modifier l'événement" }) : t('timelinegenerator.event.new', { defaultValue: 'Nouvel événement' })}
          </div>
          <div className="mb-12">
            <label htmlFor="tl-ev-headline" className="form-label" style={{ fontWeight: 700 }}>
              {t('timelinegenerator.event.headline', { defaultValue: 'Titre' })} *
            </label>
            <input id="tl-ev-headline" className="form-control" value={draft.headline} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} autoFocus />
          </div>
          <div className="d-flex gap-16 flex-wrap mb-12">
            <div>
              <label htmlFor="tl-ev-format" className="form-label" style={{ fontWeight: 700 }}>
                {t('timelinegenerator.date.format', { defaultValue: 'Précision de la date' })}
              </label>
              <select id="tl-ev-format" className="form-select" value={draft.dateFormat} onChange={(e) => switchFormat(e.target.value as DateFormat)}>
                <option value="year">{t('timelinegenerator.year', { defaultValue: 'Année' })}</option>
                <option value="month">{t('timelinegenerator.month', { defaultValue: 'Mois' })}</option>
                <option value="day">{t('timelinegenerator.day', { defaultValue: 'Jour' })}</option>
              </select>
            </div>
            <div>
              <label htmlFor="tl-ev-start" className="form-label" style={{ fontWeight: 700 }}>
                {t('timelinegenerator.event.startdate', { defaultValue: 'Date de début' })} *
              </label>
              {dateInput('tl-ev-start', draft.start, (v) => setDraft({ ...draft, start: v }), t('timelinegenerator.event.startdate', { defaultValue: 'Date de début' }))}
            </div>
            <div>
              <label className="form-label d-flex gap-4 align-items-center" style={{ fontWeight: 700 }}>
                <input type="checkbox" checked={draft.hasEnd} onChange={(e) => setDraft({ ...draft, hasEnd: e.target.checked, end: e.target.checked ? draft.end : '' })} />
                {t('timelinegenerator.event.enddate', { defaultValue: 'Date de fin' })}
              </label>
              {draft.hasEnd && dateInput('tl-ev-end', draft.end, (v) => setDraft({ ...draft, end: v }), t('timelinegenerator.event.enddate', { defaultValue: 'Date de fin' }))}
            </div>
          </div>

          <fieldset className="mb-12">
            <legend className="form-label" style={{ fontSize: 15, fontWeight: 700 }}>
              {t('timelinegenerator.select.media.type', { defaultValue: 'Média' })}
            </legend>
            <div className="d-flex gap-16 mb-8">
              <label className="d-flex gap-4 align-items-center m-0">
                <input type="radio" name="tl-media" checked={draft.media === 'img'} onChange={() => setDraft({ ...draft, media: 'img' })} />
                {t('timelinegenerator.image', { defaultValue: 'Image' })}
              </label>
              <label className="d-flex gap-4 align-items-center m-0">
                <input type="radio" name="tl-media" checked={draft.media === 'video'} onChange={() => setDraft({ ...draft, media: 'video' })} />
                {t('timelinegenerator.video', { defaultValue: 'Vidéo' })}
              </label>
            </div>
            {draft.media === 'img' ? (
              <div className="d-flex gap-12 align-items-center">
                {draft.img && <img src={draft.img} alt="" data-event-image style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8 }} />}
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => mediaLibraryRef.current?.show('image')}>
                  {t('timeline.image.choose', { defaultValue: 'Choisir une image' })}
                </button>
                {draft.img && (
                  <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setDraft({ ...draft, img: '' })}>
                    {t('timeline.image.remove', { defaultValue: "Retirer l'image" })}
                  </button>
                )}
              </div>
            ) : (
              <input
                type="url"
                className="form-control"
                aria-label={t('timelinegenerator.video', { defaultValue: 'Vidéo' })}
                placeholder={t('timelinegenerator.event.video.placeholder', { defaultValue: 'Adresse de la vidéo (YouTube, Dailymotion…)' })}
                value={draft.video}
                onChange={(e) => setDraft({ ...draft, video: e.target.value })}
              />
            )}
          </fieldset>

          <div className="mb-12">
            <div className="form-label" style={{ fontSize: 15, fontWeight: 700 }}>
              {t('timelinegenerator.event.text', { defaultValue: 'Description' })}
            </div>
            <Editor
              key={draft.id ?? 'new'}
              content={editorContent(draft.text)}
              mode="edit"
              focus={false}
              variant="outline"
              visibility="protected"
              onContentChange={({ editor }: { editor: EditorInstance }) => setDraft((d) => d && { ...d, text: editor.isEmpty ? '' : editor.getHTML() })}
            />
          </div>

          {errors.length > 0 && (
            <div className="alert alert-warning" role="alert">
              {errors.map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          )}
          <div className="d-flex gap-8">
            <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={onSave}>
              {t('timeline.save', { defaultValue: 'Enregistrer' })}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setDraft(null)}>
              {t('timeline.cancel', { defaultValue: 'Annuler' })}
            </button>
          </div>
        </section>
      )}

      {mode === 'timeline' ? (
        timeline && <TimelineViewer timeline={timeline} events={events} />
      ) : (
        <>
          {contrib && selected.size > 0 && (
            <div className="d-flex gap-8 align-items-center mb-12 p-8 border rounded" role="toolbar" aria-label={t('timeline.actions', { defaultValue: 'Actions sur la sélection' })}>
              <span role="status">{t('timeline.selected.count', { defaultValue: '[[count]] élément(s) sélectionné(s)', count: selected.size })}</span>
              <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setConfirmDelete(true)}>
                {t('remove', { defaultValue: 'Supprimer' })}
              </button>
            </div>
          )}
          {eventsQuery.isLoading && <p>{t('timeline.loading', { defaultValue: 'Chargement…' })}</p>}
          {!eventsQuery.isLoading && events.length === 0 ? (
            <p className="text-muted">{t('timelinegenerator.no.event.created.in.timeline', { defaultValue: "Aucun événement n'a été créé dans cette frise." })}</p>
          ) : (
            <table className="table" data-events-table>
              <thead>
                <tr>
                  {contrib && <th style={{ width: 32 }} />}
                  <th aria-sort={ariaSort('headline')}>
                    <button type="button" className="btn btn-link p-0 fw-bold" onClick={() => sortBy('headline')}>
                      {t('timelinegenerator.event', { defaultValue: 'Événement' })}
                      {sortMark('headline')}
                    </button>
                  </th>
                  <th aria-sort={ariaSort('startDate')}>
                    <button type="button" className="btn btn-link p-0 fw-bold" onClick={() => sortBy('startDate')}>
                      {t('timelinegenerator.event.startdate', { defaultValue: 'Date de début' })}
                      {sortMark('startDate')}
                    </button>
                  </th>
                  <th aria-sort={ariaSort('endDate')}>
                    <button type="button" className="btn btn-link p-0 fw-bold" onClick={() => sortBy('endDate')}>
                      {t('timelinegenerator.event.enddate', { defaultValue: 'Date de fin' })}
                      {sortMark('endDate')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev._id} data-event-id={ev._id}>
                    {contrib && (
                      <td>
                        <input type="checkbox" aria-label={ev.headline} checked={selected.has(ev._id)} onChange={() => toggle(ev._id)} />
                      </td>
                    )}
                    <td>
                      {contrib ? (
                        <button
                          type="button"
                          className="btn btn-link p-0"
                          onClick={() => {
                            setErrors([]);
                            setDraft(draftOf(ev));
                          }}
                        >
                          {ev.headline}
                        </button>
                      ) : (
                        ev.headline
                      )}
                    </td>
                    <td>{formatEventDate(ev.startDate, ev.dateFormat)}</td>
                    <td>{formatEventDate(ev.endDate, ev.dateFormat)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {confirmDelete && (
        <Modal id={dialogId} isOpen onModalClose={() => setConfirmDelete(false)} size="md">
          <Modal.Header onModalClose={() => setConfirmDelete(false)}>{t('remove', { defaultValue: 'Supprimer' })}</Modal.Header>
          <Modal.Body>
            <p className="m-0">
              {selected.size === 1
                ? t('timelinegenerator.confirm.delete.event', { defaultValue: 'Êtes-vous sûr de vouloir supprimer cet événement ?' })
                : t('timelinegenerator.confirm.delete.events', { defaultValue: 'Êtes-vous sûr de vouloir supprimer ces événements ?' })}
            </p>
          </Modal.Body>
          <Modal.Footer>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>
              {t('timeline.cancel', { defaultValue: 'Annuler' })}
            </button>
            <button type="button" className="btn btn-danger" disabled={removeSelected.isPending} onClick={() => removeSelected.mutate()}>
              {t('remove', { defaultValue: 'Supprimer' })}
            </button>
          </Modal.Footer>
        </Modal>
      )}

      <MediaLibrary
        appCode={appCode}
        ref={mediaLibraryRef}
        visibility="protected"
        {...mediaLibraryHandlers}
        onSuccess={(result: unknown) => {
          const file = (Array.isArray(result) ? result[0] : result) as { _id?: string; id?: string } | undefined;
          const id = file?._id ?? file?.id;
          if (id) setDraft((d) => d && { ...d, img: `/workspace/document/${id}` });
          mediaLibraryRef.current?.hide();
        }}
      />
    </div>
  );
}

/**
 * Mode « Frise » : visionneuse TimelineJS embarquée par le module (public/js), dans un cadre isolé
 * comme le sniplet AngularJS (behaviours.ts). Ex. trois événements → trois diapositives datées.
 */
function TimelineViewer({ timeline, events }: { timeline: { headline: string; text?: string; icon?: string }; events: TimelineEvent[] }) {
  const { t } = useTranslation(['timelinegenerator', 'common']);
  if (events.length === 0) return <p className="text-muted">{t('timelinegenerator.no.event.created.in.timeline', { defaultValue: "Aucun événement n'a été créé dans cette frise." })}</p>;
  const data = JSON.stringify(timelineJsData(timeline, events, window.location.origin)).replace(/</g, '\\u003c');
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><base target="_parent"/></head><body style="margin:0"><div id="timeline"></div>' +
    '<script src="/infra/public/js/jquery-1.10.2.min.js"></script>' +
    '<script src="/timelinegenerator/public/js/storyjs-embed.js"></script>' +
    `<script>createStoryJS({type:'timeline',width:'100%',height:'600',source:${data},embed_id:'timeline',lang:'fr',` +
    "css:'/timelinegenerator/public/css/timeline/timeline.css',js:'/timelinegenerator/public/js/timeline-min.js'});</script>" +
    '</body></html>';
  return <iframe title={t('timelinegenerator.mode.timeline', { defaultValue: 'Frise' })} srcDoc={html} style={{ width: '100%', height: 620, border: 0 }} data-timeline-viewer />;
}

export default Timeline;
