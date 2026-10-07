import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ShareAction, ShareBatch, ShareJson } from '../api';
import { Modal } from './Modal';

/** Niveaux de droit (ordre croissant) + libellés FR — communs calendrier/événement. */
const LEVELS: { key: string; fr: string }[] = [
  { key: 'timelinegenerator.read', fr: 'Lecture' },
  { key: 'timelinegenerator.contrib', fr: 'Contribution' },
  { key: 'timelinegenerator.manager', fr: 'Gestion' },
];

type Kind = 'group' | 'user';
interface Row {
  id: string;
  kind: Kind;
  label: string;
  levels: Set<string>;
}

/**
 * Partage d'une ressource (calendrier OU événement) via le modèle entcore batch.
 * Générique : les fonctions `getShare`/`shareBatch` déterminent la ressource ciblée.
 */
export function ShareDialog({
  resourceId,
  resourceName,
  title,
  getShare,
  shareBatch,
  onClose,
}: {
  resourceId: string;
  resourceName: string;
  title: string;
  getShare: (id: string) => Promise<ShareJson>;
  shareBatch: (id: string, batch: ShareBatch) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation(['timelinegenerator', 'common']);
  const qc = useQueryClient();
  const shareQuery = useQuery({ queryKey: ['timeline', 'share', resourceId], queryFn: () => getShare(resourceId) });

  const [rows, setRows] = useState<Row[] | null>(null);
  const [search, setSearch] = useState('');

  const actionsByLevel = useMemo(() => {
    const m = new Map<string, ShareAction>();
    shareQuery.data?.actions.forEach((a) => m.set(a.displayName, a));
    return m;
  }, [shareQuery.data]);

  const initialRows = useMemo<Row[]>(() => {
    const data = shareQuery.data;
    if (!data) return [];
    const active = (checked: string[], lvl: string) => (actionsByLevel.get(lvl)?.name ?? []).every((n) => checked.includes(n));
    const out: Row[] = [];
    const push = (kind: Kind, id: string, label: string, checked: string[]) =>
      out.push({ id, kind, label, levels: new Set(LEVELS.map((l) => l.key).filter((k) => active(checked, k))) });
    Object.entries(data.groups.checked).forEach(([id, ch]) => push('group', id, data.groups.visibles.find((v) => v.id === id)?.name ?? id, ch));
    Object.entries(data.users.checked).forEach(([id, ch]) => push('user', id, data.users.visibles.find((v) => v.id === id)?.username ?? id, ch));
    return out;
  }, [shareQuery.data, actionsByLevel]);

  const current = rows ?? initialRows;

  const candidates = useMemo(() => {
    const data = shareQuery.data;
    if (!data || search.trim().length < 1) return [];
    const q = search.trim().toLowerCase();
    const present = new Set(current.map((r) => r.id));
    const groups = data.groups.visibles.filter((g) => !present.has(g.id) && (g.name ?? '').toLowerCase().includes(q)).map((g) => ({ id: g.id, kind: 'group' as Kind, label: g.name ?? g.id }));
    const users = data.users.visibles.filter((u) => !present.has(u.id) && (u.username ?? '').toLowerCase().includes(q)).map((u) => ({ id: u.id, kind: 'user' as Kind, label: u.username ?? u.id }));
    return [...groups, ...users].slice(0, 12);
  }, [shareQuery.data, search, current]);

  const toggleLevel = (id: string, lvl: string) =>
    setRows(current.map((r) => {
      if (r.id !== id) return r;
      const levels = new Set(r.levels);
      if (levels.has(lvl)) levels.delete(lvl);
      else levels.add(lvl);
      return { ...r, levels };
    }));
  const addRecipient = (c: { id: string; kind: Kind; label: string }) => {
    setRows([...current, { ...c, levels: new Set(['timelinegenerator.read']) }]);
    setSearch('');
  };
  const removeRow = (id: string) => setRows(current.filter((r) => r.id !== id));

  const saveMut = useMutation({
    mutationFn: async () => {
      const batch = { users: {} as Record<string, string[]>, groups: {} as Record<string, string[]>, bookmarks: {} };
      current.forEach((r) => {
        if (r.levels.size === 0) return;
        const acts = new Set<string>();
        r.levels.forEach((lvl) => (actionsByLevel.get(lvl)?.name ?? []).forEach((n) => acts.add(n)));
        (r.kind === 'group' ? batch.groups : batch.users)[r.id] = [...acts];
      });
      await shareBatch(resourceId, batch);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timeline', 'share', resourceId] });
      onClose();
    },
  });

  return (
    <Modal title={`${title} — ${resourceName}`} onClose={onClose}>
      {shareQuery.isLoading && <p>{t('timeline.loading', { defaultValue: 'Chargement…' })}</p>}
      {shareQuery.isError && (
        <div className="alert alert-warning" role="alert">
          {t('timeline.error', { defaultValue: 'Une erreur est survenue.' })}
        </div>
      )}

      {shareQuery.data && (
        <>
          <div className="mb-16 position-relative">
            <input
              type="text"
              className="form-control"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('timeline.share.search', { defaultValue: 'Rechercher un groupe ou une personne…' })}
              aria-label={t('timeline.share.search', { defaultValue: 'Rechercher un destinataire' })}
            />
            {candidates.length > 0 && (
              <ul className="list-unstyled border rounded bg-white position-absolute w-100 mt-2" style={{ zIndex: 10, maxHeight: 240, overflow: 'auto' }}>
                {candidates.map((c) => (
                  <li key={`${c.kind}-${c.id}`}>
                    <button type="button" className="btn btn-link text-start w-100 px-12 py-8" onClick={() => addRecipient(c)}>
                      {c.kind === 'group' ? '👥 ' : '👤 '}
                      {c.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {current.length === 0 ? (
            <p className="text-muted">{t('timeline.share.empty', { defaultValue: 'Aucun partage. Recherchez un destinataire ci-dessus.' })}</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t('timeline.share.recipient', { defaultValue: 'Destinataire' })}</th>
                  {LEVELS.map((l) => (
                    <th key={l.key} className="text-center">{l.fr}</th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {current.map((r) => (
                  <tr key={`${r.kind}-${r.id}`}>
                    <td>
                      {r.kind === 'group' ? '👥 ' : '👤 '}
                      {r.label}
                    </td>
                    {LEVELS.map((l) => (
                      <td key={l.key} className="text-center">
                        <input type="checkbox" checked={r.levels.has(l.key)} aria-label={`${r.label} — ${l.fr}`} onChange={() => toggleLevel(r.id, l.key)} />
                      </td>
                    ))}
                    <td className="text-end">
                      <button type="button" className="btn btn-link p-0 text-danger" onClick={() => removeRow(r.id)} aria-label={t('timeline.delete', { defaultValue: 'Supprimer' })}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {saveMut.isError && (
            <div className="alert alert-warning" role="alert">
              {t('timeline.error', { defaultValue: 'Une erreur est survenue.' })}
            </div>
          )}

          <div className="d-flex justify-content-end gap-8 mt-16">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t('timeline.cancel', { defaultValue: 'Annuler' })}
            </button>
            <button type="button" className="btn btn-primary" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
              {t('timeline.share.submit', { defaultValue: 'Partager' })}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

export default ShareDialog;
