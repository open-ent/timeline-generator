import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { api, TimelineEvent } from '../api';
import { formatDate, sortKey, toDateInput } from '../utils';

/** Détail d'une frise : événements en ordre chronologique + création / édition / suppression. */
export function Timeline() {
  const { timelineId = '' } = useParams();
  const { t } = useTranslation(['timelinegenerator', 'common']);
  const qc = useQueryClient();
  const eventsKey = ['timeline', timelineId, 'events'];

  const timelineQuery = useQuery({ queryKey: ['timeline', timelineId], queryFn: () => api.getTimeline(timelineId), enabled: !!timelineId });
  const eventsQuery = useQuery({ queryKey: eventsKey, queryFn: () => api.getEvents(timelineId), enabled: !!timelineId });
  const invalidate = () => qc.invalidateQueries({ queryKey: eventsKey });

  const empty = { headline: '', startDate: '', endDate: '', text: '' };
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');

  const saveMut = useMutation({
    mutationFn: () => {
      const data = { headline: form.headline.trim(), startDate: form.startDate, endDate: form.endDate || undefined, text: form.text.trim() || undefined };
      return editingId ? api.updateEvent(timelineId, editingId, data) : api.createEvent(timelineId, data);
    },
    onSuccess: () => {
      setForm(empty);
      setEditingId(null);
      setFormError('');
      invalidate();
    },
    onError: () => setFormError(t('timeline.event.error', { defaultValue: "L'enregistrement a échoué." })),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteEvent(timelineId, id),
    onSuccess: invalidate,
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.headline.trim() || !form.startDate) {
      setFormError(t('timeline.event.incomplete', { defaultValue: 'Renseignez un titre et une date de début.' }));
      return;
    }
    setFormError('');
    saveMut.mutate();
  };

  const startEdit = (ev: TimelineEvent) => {
    setEditingId(ev._id);
    setForm({ headline: ev.headline, startDate: toDateInput(ev.startDate), endDate: toDateInput(ev.endDate), text: ev.text ?? '' });
  };

  const events = [...(eventsQuery.data ?? [])].sort((a, b) => sortKey(a.startDate) - sortKey(b.startDate));

  return (
    <div>
      <p>
        <Link to="/">← {t('timeline.back', { defaultValue: 'Retour aux frises' })}</Link>
      </p>
      <h1 className="mb-16">{timelineQuery.data?.headline ?? t('timeline.title', { defaultValue: 'Frise' })}</h1>

      {/* Formulaire d'événement */}
      <form className="card p-16 mb-16" onSubmit={onSubmit}>
        <h2 style={{ fontSize: 18 }} className="mb-12">
          {editingId ? t('timeline.event.edit', { defaultValue: "Modifier l'événement" }) : t('timeline.event.new', { defaultValue: 'Nouvel événement' })}
        </h2>
        <div className="mb-8">
          <label htmlFor="tl-headline" className="form-label">{t('timeline.event.title', { defaultValue: 'Titre' })}</label>
          <input id="tl-headline" type="text" className="form-control" value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} />
        </div>
        <div className="d-flex gap-16 flex-wrap mb-8">
          <div>
            <label htmlFor="tl-start" className="form-label">{t('timeline.event.start', { defaultValue: 'Date de début' })}</label>
            <input id="tl-start" type="date" className="form-control" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </div>
          <div>
            <label htmlFor="tl-end" className="form-label">{t('timeline.event.end', { defaultValue: 'Date de fin (facultative)' })}</label>
            <input id="tl-end" type="date" className="form-control" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </div>
        </div>
        <div className="mb-8">
          <label htmlFor="tl-text" className="form-label">{t('timeline.event.text', { defaultValue: 'Description' })}</label>
          <textarea id="tl-text" className="form-control" rows={2} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
        </div>
        {formError && <div className="alert alert-warning" role="alert">{formError}</div>}
        <div className="d-flex gap-8">
          <button type="submit" className="btn btn-primary" disabled={saveMut.isPending}>
            {editingId ? t('timeline.save', { defaultValue: 'Enregistrer' }) : t('timeline.event.add', { defaultValue: 'Ajouter' })}
          </button>
          {editingId && (
            <button type="button" className="btn btn-secondary" onClick={() => { setEditingId(null); setForm(empty); }}>
              {t('timeline.cancel', { defaultValue: 'Annuler' })}
            </button>
          )}
        </div>
      </form>

      {/* Frise chronologique */}
      <h2 style={{ fontSize: 18 }} className="mb-12">{t('timeline.events', { defaultValue: 'Événements' })}</h2>
      {eventsQuery.isLoading && <p>{t('timeline.loading', { defaultValue: 'Chargement…' })}</p>}
      {!eventsQuery.isLoading && events.length === 0 && (
        <p className="text-muted">{t('timeline.events.empty', { defaultValue: 'Aucun événement dans cette frise.' })}</p>
      )}
      <ol className="list-unstyled" style={{ borderLeft: '3px solid #2a9cc8', paddingLeft: 16 }}>
        {events.map((ev) => (
          <li key={ev._id} className="mb-16" style={{ position: 'relative' }}>
            <span aria-hidden style={{ position: 'absolute', left: -22, top: 4, width: 10, height: 10, borderRadius: '50%', background: '#2a9cc8' }} />
            <div className="d-flex justify-content-between align-items-start">
              <div>
                <div className="text-muted" style={{ fontSize: 13 }}>
                  {formatDate(ev.startDate)}
                  {ev.endDate ? ` → ${formatDate(ev.endDate)}` : ''}
                </div>
                <div className="fw-bold">{ev.headline}</div>
                {ev.text && <div style={{ fontSize: 14 }}>{ev.text}</div>}
              </div>
              <div className="d-flex gap-8">
                <button type="button" className="btn btn-link p-0" onClick={() => startEdit(ev)}>{t('timeline.edit', { defaultValue: 'Modifier' })}</button>
                <button
                  type="button"
                  className="btn btn-link p-0 text-danger"
                  onClick={() => {
                    if (window.confirm(t('timeline.event.confirm.delete', { defaultValue: 'Supprimer cet événement ?' }))) deleteMut.mutate(ev._id);
                  }}
                >
                  {t('timeline.delete', { defaultValue: 'Supprimer' })}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default Timeline;
