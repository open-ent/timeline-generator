import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { api, Timeline } from '../api';
import { ShareDialog } from './ShareDialog';

/** Écran d'accueil : liste des frises + création / édition / suppression / partage. */
export function Timelines() {
  const { t } = useTranslation(['timelinegenerator', 'common']);
  const qc = useQueryClient();
  const [sharing, setSharing] = useState<{ id: string; name: string } | null>(null);
  const query = useQuery({ queryKey: ['timeline', 'list'], queryFn: api.getTimelines });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['timeline', 'list'] });

  const [creating, setCreating] = useState(false);
  const [headline, setHeadline] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const createMut = useMutation({
    mutationFn: () => api.createTimeline({ headline: headline.trim() }),
    onSuccess: () => {
      setHeadline('');
      setCreating(false);
      invalidate();
    },
  });
  const renameMut = useMutation({
    mutationFn: (id: string) => api.updateTimeline(id, { headline: editText.trim() }),
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteTimeline(id),
    onSuccess: invalidate,
  });

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    if (headline.trim()) createMut.mutate();
  };

  const timelines = query.data ?? [];

  return (
    <div>
      {sharing && (
        <ShareDialog
          resourceId={sharing.id}
          resourceName={sharing.name}
          title={t('timeline.share.title', { defaultValue: 'Partager la frise' })}
          getShare={api.getTimelineShare}
          shareBatch={api.shareTimelineBatch}
          onClose={() => setSharing(null)}
        />
      )}
      <div className="d-flex align-items-center justify-content-between mb-16">
        <h1 className="m-0">{t('timeline.title', { defaultValue: 'Frises chronologiques' })}</h1>
        {!creating && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            {t('timeline.new', { defaultValue: 'Nouvelle frise' })}
          </button>
        )}
      </div>

      {creating && (
        <form className="d-flex gap-8 mb-16" onSubmit={onCreate}>
          <input
            type="text"
            className="form-control"
            style={{ maxWidth: 420 }}
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder={t('timeline.name.placeholder', { defaultValue: 'Titre de la frise' })}
            aria-label={t('timeline.new', { defaultValue: 'Nouvelle frise' })}
            autoFocus
          />
          <button type="submit" className="btn btn-primary" disabled={!headline.trim() || createMut.isPending}>
            {t('timeline.save', { defaultValue: 'Créer' })}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setCreating(false)}>
            {t('timeline.cancel', { defaultValue: 'Annuler' })}
          </button>
        </form>
      )}

      {query.isLoading && <p>{t('timeline.loading', { defaultValue: 'Chargement…' })}</p>}
      {query.isError && (
        <div className="alert alert-warning" role="alert">
          {t('timeline.error', { defaultValue: 'Une erreur est survenue.' })}
        </div>
      )}
      {!query.isLoading && timelines.length === 0 && (
        <p className="text-muted">{t('timeline.empty', { defaultValue: 'Aucune frise. Créez-en une.' })}</p>
      )}

      <ul className="list-unstyled">
        {timelines.map((tl: Timeline) => (
          <li key={tl._id} className="py-12 border-bottom d-flex justify-content-between align-items-center">
            {editing === tl._id ? (
              <form
                className="d-flex gap-8 flex-grow-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (editText.trim()) renameMut.mutate(tl._id);
                }}
              >
                <input type="text" className="form-control" style={{ maxWidth: 420 }} value={editText} onChange={(e) => setEditText(e.target.value)} aria-label={t('timeline.rename', { defaultValue: 'Renommer la frise' })} autoFocus />
                <button type="submit" className="btn btn-primary" disabled={!editText.trim() || renameMut.isPending}>{t('timeline.save', { defaultValue: 'Enregistrer' })}</button>
                <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>{t('timeline.cancel', { defaultValue: 'Annuler' })}</button>
              </form>
            ) : (
              <>
                <Link to={`/timeline/${tl._id}`} className="fw-bold" style={{ fontSize: 17 }}>
                  {tl.headline}
                </Link>
                <div className="d-flex gap-8">
                  <button type="button" className="btn btn-link p-0" onClick={() => setSharing({ id: tl._id, name: tl.headline })}>
                    {t('timeline.share', { defaultValue: 'Partager' })}
                  </button>
                  <button type="button" className="btn btn-link p-0" onClick={() => { setEditText(tl.headline); setEditing(tl._id); }}>
                    {t('timeline.edit', { defaultValue: 'Renommer' })}
                  </button>
                  <button
                    type="button"
                    className="btn btn-link p-0 text-danger"
                    onClick={() => {
                      if (window.confirm(t('timeline.confirm.delete', { defaultValue: 'Supprimer cette frise et ses événements ?' }))) deleteMut.mutate(tl._id);
                    }}
                  >
                    {t('timeline.delete', { defaultValue: 'Supprimer' })}
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Timelines;
