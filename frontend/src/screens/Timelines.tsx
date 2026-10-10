import { Modal, useEdificeClient, useHasWorkflow } from '@open-ent/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, ReactNode, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { api, Timeline } from '../api';
import {
  canManage,
  childFolders,
  descendants,
  Folder,
  foldersContaining,
  itemsIn,
  Location,
  moveTargets,
  pathTo,
  ROOT,
  trashContent,
} from '../library';
import { ShareDialog } from './ShareDialog';

/** Droits de workflow (mêmes noms que behaviours.ts de l'AngularJS). */
const WORKFLOW = {
  create: 'net.atos.entng.timelinegenerator.controllers.TimelineController|createTimeline',
  createFolder: 'net.atos.entng.timelinegenerator.controllers.FoldersController|add',
  print: 'net.atos.entng.timelinegenerator.controllers.TimelineController|printView',
};

type Dialog =
  | { kind: 'newFolder' }
  | { kind: 'renameFolder'; folder: Folder }
  | { kind: 'properties'; timeline: Timeline }
  | { kind: 'move' }
  | { kind: 'removeForever' }
  | null;

/**
 * Bibliothèque des frises, comme l'AngularJS (template/timelines.html) : « Mes frises », dossiers
 * et corbeille ; sélection par case à cocher puis actions (ouvrir, renommer un dossier, propriétés,
 * dupliquer, partager, déplacer, imprimer, mettre à la corbeille ; dans la corbeille : restaurer,
 * supprimer définitivement). Ex. cocher « Révolution » → « Déplacer » vers le dossier « Histoire ».
 */
export function Timelines() {
  const { t } = useTranslation(['timelinegenerator', 'common']);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useEdificeClient();
  const me = { userId: user?.userId ?? '', groupsIds: (user as { groupsIds?: string[] } | undefined)?.groupsIds ?? [] };
  const canCreate = useHasWorkflow(WORKFLOW.create) === true;
  const canCreateFolder = useHasWorkflow(WORKFLOW.createFolder) === true;
  const canPrint = useHasWorkflow(WORKFLOW.print) === true;
  const dialogId = useId();

  const timelinesQuery = useQuery({ queryKey: ['timeline', 'list'], queryFn: api.getTimelines });
  const foldersQuery = useQuery({ queryKey: ['timeline', 'folders'], queryFn: api.getFolders });
  const timelines = timelinesQuery.data ?? [];
  const folders = foldersQuery.data ?? [];
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['timeline', 'list'] });
    qc.invalidateQueries({ queryKey: ['timeline', 'folders'] });
  };

  const [location, setLocation] = useState<Location>({ kind: 'root' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<Dialog>(null);
  const [sharing, setSharing] = useState<{ id: string; name: string } | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [headline, setHeadline] = useState('');

  const go = (l: Location) => {
    setLocation(l);
    setSelected(new Set());
  };
  const inTrash = location.kind === 'trash';
  const parentId = location.kind === 'folder' ? location.id : ROOT;

  // Contenu de l'emplacement courant (la recherche porte sur toutes les frises non supprimées).
  const norm = (s: string) => s.toLocaleLowerCase('fr-FR');
  const view = useMemo(() => {
    if (inTrash) return trashContent(timelines, folders);
    if (search.trim()) {
      const q = norm(search.trim());
      return { folders: [] as Folder[], items: timelines.filter((x) => !x.trashed && norm(x.headline ?? '').includes(q)) };
    }
    return { folders: childFolders(folders, parentId), items: itemsIn(timelines, folders, parentId) };
  }, [inTrash, search, timelines, folders, parentId]);

  const selFolders = view.folders.filter((f) => selected.has(f._id));
  const selItems = view.items.filter((x) => selected.has(x._id));
  const selCount = selFolders.length + selItems.length;
  const oneItem = selCount === 1 && selItems.length === 1 ? selItems[0] : null;
  const oneFolder = selCount === 1 && selFolders.length === 1 ? selFolders[0] : null;
  const manageAll = selItems.every((x) => canManage(x, me)) && selFolders.every((f) => !f.owner || f.owner.userId === me.userId);
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  /** Lance une action groupée, rafraîchit, vide la sélection et affiche le résultat. */
  const run = useMutation({
    mutationFn: async ({ work }: { work: () => Promise<unknown>; ok: string }) => work(),
    onSuccess: (_d, v) => {
      setNotice({ ok: true, text: v.ok });
      setSelected(new Set());
      setDialog(null);
      refresh();
    },
    onError: () => setNotice({ ok: false, text: t('timeline.error', { defaultValue: 'Une erreur est survenue.' }) }),
  });

  // ── Corbeille (même logique que models/folder.ts et models/timeline.ts) ──────────────────────
  const trashTimeline = async (x: Timeline) => {
    if (canManage(x, me)) await api.updateTimeline(x._id, { headline: x.headline, text: x.text, icon: x.icon, trashed: true });
    // Frise partagée sans droit de gestion : elle sort seulement de ses dossiers.
    else for (const f of foldersContaining(folders, x._id)) await api.updateFolder({ ...f, ressourceIds: (f.ressourceIds ?? []).filter((id) => id !== x._id) });
  };
  const trashSelection = () =>
    run.mutate({
      ok: t('timeline.selection.trashed', { defaultValue: 'Les éléments ont été déplacés vers la corbeille' }),
      work: async () => {
        for (const f of selFolders)
          for (const d of descendants(folders, f._id)) {
            await api.updateFolder({ ...d, trashed: true });
            for (const x of itemsIn(timelines, folders, d._id)) await trashTimeline(x);
          }
        for (const x of selItems) await trashTimeline(x);
      },
    });
  const restoreSelection = () =>
    run.mutate({
      ok: t('timeline.restored', { defaultValue: 'Les éléments ont été restaurés' }),
      work: async () => {
        // Dossiers d'abord : une frise dont le dossier reste à la corbeille revient à la racine.
        const restored = new Set<string>();
        for (const f of selFolders)
          for (const d of descendants(folders, f._id)) {
            const parentTrashed = d._id === f._id && folders.some((p) => p._id === d.parentId && p.trashed);
            await api.updateFolder({ ...d, trashed: false, parentId: parentTrashed ? ROOT : d.parentId });
            restored.add(d._id);
            for (const id of d.ressourceIds ?? []) {
              const x = timelines.find((y) => y._id === id && y.trashed);
              if (x) await api.updateTimeline(x._id, { headline: x.headline, text: x.text, icon: x.icon, trashed: false });
            }
          }
        for (const x of selItems) {
          await api.updateTimeline(x._id, { headline: x.headline, text: x.text, icon: x.icon, trashed: false });
          for (const f of foldersContaining(folders, x._id))
            if (f.trashed && !restored.has(f._id)) await api.updateFolder({ ...f, ressourceIds: (f.ressourceIds ?? []).filter((id) => id !== x._id) });
        }
      },
    });
  const removeForever = () =>
    run.mutate({
      ok: t('timeline.selection.removed', { defaultValue: 'Les éléments ont été supprimés' }),
      work: async () => {
        for (const f of selFolders) for (const d of descendants(folders, f._id).reverse()) await api.deleteFolder(d._id);
        for (const x of selItems) await api.deleteTimeline(x._id);
      },
    });

  // ── Déplacement (frise : retirée de ses dossiers puis rangée ; dossier : nouveau parent) ─────
  const moveSelection = (target: string) =>
    run.mutate({
      ok: t('timeline.moved', { defaultValue: 'Les éléments ont été déplacés' }),
      work: async () => {
        let current = folders;
        for (const x of selItems) {
          for (const f of foldersContaining(current, x._id)) {
            const upd = { ...f, ressourceIds: (f.ressourceIds ?? []).filter((id) => id !== x._id) };
            await api.updateFolder(upd);
            current = current.map((c) => (c._id === upd._id ? upd : c));
          }
          if (target !== ROOT) {
            const dest = current.find((f) => f._id === target)!;
            const upd = { ...dest, ressourceIds: [...(dest.ressourceIds ?? []), x._id] };
            await api.updateFolder(upd);
            current = current.map((c) => (c._id === upd._id ? upd : c));
          }
        }
        for (const f of selFolders) await api.updateFolder({ ...f, parentId: target });
      },
    });

  const createTimeline = useMutation({
    mutationFn: async () => {
      const created = await api.createTimeline({ headline: headline.trim() });
      // Créée dans le dossier ouvert, comme l'AngularJS.
      const dest = folders.find((f) => f._id === parentId);
      if (dest && created?._id) await api.updateFolder({ ...dest, ressourceIds: [...(dest.ressourceIds ?? []), created._id] });
    },
    onSuccess: () => {
      setHeadline('');
      setCreating(false);
      refresh();
    },
  });

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    if (headline.trim()) createTimeline.mutate();
  };

  const navItem = (label: ReactNode, l: Location, active: boolean, depth = 0) => (
    <button
      type="button"
      className={`btn btn-sm text-start w-100 ${active ? 'btn-primary' : 'btn-link'}`}
      style={{ paddingLeft: 8 + depth * 16 }}
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        setSearch('');
        go(l);
      }}
    >
      {label}
    </button>
  );
  const tree = (pid: string, depth: number): ReactNode =>
    childFolders(folders, pid).map((f) => (
      <li key={f._id}>
        {navItem(f.name, { kind: 'folder', id: f._id }, location.kind === 'folder' && location.id === f._id, depth)}
        <ul className="list-unstyled m-0">{tree(f._id, depth + 1)}</ul>
      </li>
    ));

  const loading = timelinesQuery.isLoading || foldersQuery.isLoading;
  const title =
    location.kind === 'trash'
      ? t('folder.trash', { defaultValue: 'Corbeille' })
      : location.kind === 'folder'
        ? pathTo(folders, location.id).map((f) => f.name).join(' / ')
        : t('projects.root', { defaultValue: 'Mes frises' });

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
      <div className="d-flex align-items-center justify-content-between mb-16 gap-8 flex-wrap">
        <h1 className="m-0">{t('timeline.title', { defaultValue: 'Frises chronologiques' })}</h1>
        <div className="d-flex gap-8">
          {canCreateFolder && !inTrash && (
            <button type="button" className="btn btn-secondary" onClick={() => setDialog({ kind: 'newFolder' })}>
              {t('timelinegenerator.folder.new', { defaultValue: 'Créer un dossier' })}
            </button>
          )}
          {canCreate && !inTrash && !creating && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              {t('timeline.new', { defaultValue: 'Nouvelle frise' })}
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className={`alert ${notice.ok ? 'alert-success' : 'alert-danger'}`} role={notice.ok ? 'status' : 'alert'}>
          {notice.text}
        </div>
      )}

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
          <button type="submit" className="btn btn-primary" disabled={!headline.trim() || createTimeline.isPending}>
            {t('timeline.save', { defaultValue: 'Créer' })}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setCreating(false)}>
            {t('timeline.cancel', { defaultValue: 'Annuler' })}
          </button>
        </form>
      )}

      <div className="d-flex gap-16 flex-wrap">
        <nav aria-label={t('timeline.library', { defaultValue: 'Bibliothèque' })} style={{ width: 240, flexShrink: 0 }}>
          <ul className="list-unstyled m-0">
            <li>
              {navItem(t('projects.root', { defaultValue: 'Mes frises' }), { kind: 'root' }, location.kind === 'root')}
              <ul className="list-unstyled m-0">{tree(ROOT, 1)}</ul>
            </li>
            <li className="mt-8">{navItem(t('folder.trash', { defaultValue: 'Corbeille' }), { kind: 'trash' }, inTrash)}</li>
          </ul>
        </nav>

        <section className="flex-grow-1" style={{ minWidth: 280 }} aria-labelledby="tl-location-title">
          <div className="d-flex align-items-center justify-content-between gap-8 mb-12 flex-wrap">
            <div id="tl-location-title" role="heading" aria-level={2} style={{ fontSize: 17, fontWeight: 700 }}>
              {title}
            </div>
            {!inTrash && (
              <input
                type="search"
                className="form-control"
                style={{ maxWidth: 320 }}
                placeholder={t('timeline.search', { defaultValue: 'Rechercher une frise…' })}
                aria-label={t('timeline.search', { defaultValue: 'Rechercher une frise…' })}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            )}
          </div>

          {selCount > 0 && (
            <div className="d-flex gap-8 flex-wrap align-items-center mb-12 p-8 border rounded" role="toolbar" aria-label={t('timeline.actions', { defaultValue: 'Actions sur la sélection' })}>
              <span role="status" className="me-8">
                {t('timeline.selected.count', { defaultValue: '[[count]] élément(s) sélectionné(s)', count: selCount })}
              </span>
              {inTrash ? (
                manageAll && (
                  <>
                    <button type="button" className="btn btn-sm btn-secondary" disabled={run.isPending} onClick={restoreSelection}>
                      {t('restore', { defaultValue: 'Restaurer' })}
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => setDialog({ kind: 'removeForever' })}>
                      {t('timeline.remove.forever', { defaultValue: 'Supprimer définitivement' })}
                    </button>
                  </>
                )
              ) : (
                <>
                  {oneItem && (
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => navigate(`/timeline/${oneItem._id}`)}>
                      {t('open', { defaultValue: 'Ouvrir' })}
                    </button>
                  )}
                  {oneFolder && (
                    <>
                      <button type="button" className="btn btn-sm btn-secondary" onClick={() => go({ kind: 'folder', id: oneFolder._id })}>
                        {t('open', { defaultValue: 'Ouvrir' })}
                      </button>
                      <button type="button" className="btn btn-sm btn-secondary" onClick={() => setDialog({ kind: 'renameFolder', folder: oneFolder })}>
                        {t('rename', { defaultValue: 'Renommer' })}
                      </button>
                    </>
                  )}
                  {oneItem && canManage(oneItem, me) && (
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => setDialog({ kind: 'properties', timeline: oneItem })}>
                      {t('properties', { defaultValue: 'Propriétés' })}
                    </button>
                  )}
                  {oneItem && canCreate && (
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      disabled={run.isPending}
                      onClick={() => run.mutate({ ok: t('duplicate.done', { defaultValue: 'Duplication terminée' }), work: () => api.duplicateTimeline(oneItem._id) })}
                    >
                      {t('duplicate', { defaultValue: 'Dupliquer' })}
                    </button>
                  )}
                  {oneItem && canManage(oneItem, me) && (
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => setSharing({ id: oneItem._id, name: oneItem.headline })}>
                      {t('share', { defaultValue: 'Partager' })}
                    </button>
                  )}
                  {canCreateFolder && (
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => setDialog({ kind: 'move' })}>
                      {t('move', { defaultValue: 'Déplacer' })}
                    </button>
                  )}
                  {oneItem && canPrint && (
                    <a className="btn btn-sm btn-secondary" href={`/timelinegenerator/print#/print/${oneItem._id}/`} target="_blank" rel="noreferrer">
                      {t('print', { defaultValue: 'Imprimer' })}
                    </a>
                  )}
                  {manageAll && (
                    <button type="button" className="btn btn-sm btn-outline-danger" disabled={run.isPending} onClick={trashSelection}>
                      {t('remove', { defaultValue: 'Supprimer' })}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {loading && <p>{t('timeline.loading', { defaultValue: 'Chargement…' })}</p>}
          {(timelinesQuery.isError || foldersQuery.isError) && (
            <div className="alert alert-warning" role="alert">
              {t('timeline.error', { defaultValue: 'Une erreur est survenue.' })}
            </div>
          )}
          {!loading && view.folders.length + view.items.length === 0 && (
            <p className="text-muted">
              {inTrash
                ? t('explorer.emptyScreen.trash.empty', { defaultValue: 'Aucune frise dans la corbeille pour le moment.' })
                : t('timeline.empty', { defaultValue: 'Aucune frise. Créez-en une.' })}
            </p>
          )}

          <ul className="list-unstyled" data-library>
            {view.folders.map((f) => (
              <li key={f._id} className="py-8 border-bottom d-flex gap-8 align-items-center" data-folder-id={f._id}>
                <input type="checkbox" aria-label={f.name} checked={selected.has(f._id)} onChange={() => toggle(f._id)} />
                {inTrash ? (
                  <span style={{ fontSize: 17 }}>📁 {f.name}</span>
                ) : (
                  <button type="button" className="btn btn-link p-0 fw-bold" style={{ fontSize: 17 }} onClick={() => go({ kind: 'folder', id: f._id })}>
                    📁 {f.name}
                  </button>
                )}
              </li>
            ))}
            {view.items.map((x) => (
              <li key={x._id} className="py-8 border-bottom d-flex gap-8 align-items-center" data-timeline-id={x._id}>
                <input type="checkbox" aria-label={x.headline} checked={selected.has(x._id)} onChange={() => toggle(x._id)} />
                {inTrash ? (
                  <span style={{ fontSize: 17 }}>{x.headline}</span>
                ) : (
                  <Link to={`/timeline/${x._id}`} className="fw-bold" style={{ fontSize: 17 }}>
                    {x.headline}
                  </Link>
                )}
                {x.owner && x.owner.userId !== me.userId && <span className="text-muted small">— {x.owner.displayName}</span>}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {dialog?.kind === 'newFolder' && (
        <NameDialog
          id={dialogId}
          title={t('timelinegenerator.folder.new', { defaultValue: 'Créer un dossier' })}
          label={t('timelinegenerator.folder.placeholder', { defaultValue: 'Nom du dossier' })}
          initial=""
          pending={run.isPending}
          onClose={() => setDialog(null)}
          onSave={(name) =>
            run.mutate({
              ok: t('timeline.folder.created', { defaultValue: 'Dossier créé' }),
              work: () => api.createFolder({ name, parentId, trashed: false, ressourceIds: [] }),
            })
          }
        />
      )}
      {dialog?.kind === 'renameFolder' && (
        <NameDialog
          id={dialogId}
          title={t('rename', { defaultValue: 'Renommer' })}
          label={t('timelinegenerator.folder.placeholder', { defaultValue: 'Nom du dossier' })}
          initial={dialog.folder.name}
          pending={run.isPending}
          onClose={() => setDialog(null)}
          onSave={(name) => run.mutate({ ok: t('timeline.folder.renamed', { defaultValue: 'Dossier renommé' }), work: () => api.updateFolder({ ...dialog.folder, name }) })}
        />
      )}
      {dialog?.kind === 'properties' && (
        <PropertiesDialog
          id={dialogId}
          timeline={dialog.timeline}
          pending={run.isPending}
          onClose={() => setDialog(null)}
          onSave={(headline2, text) =>
            run.mutate({
              ok: t('timeline.saved', { defaultValue: 'Frise enregistrée' }),
              work: () => api.updateTimeline(dialog.timeline._id, { ...dialog.timeline, headline: headline2, text }),
            })
          }
        />
      )}
      {dialog?.kind === 'move' && (
        <Modal id={dialogId} isOpen onModalClose={() => setDialog(null)} size="md">
          <Modal.Header onModalClose={() => setDialog(null)}>{t('move', { defaultValue: 'Déplacer' })}</Modal.Header>
          <Modal.Body>
            <p>{t('timeline.move.choose', { defaultValue: 'Choisissez le dossier de destination :' })}</p>
            <ul className="list-unstyled d-flex flex-column gap-4 m-0" data-move-targets>
              <li>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => moveSelection(ROOT)}>
                  {t('projects.root', { defaultValue: 'Mes frises' })}
                </button>
              </li>
              {moveTargets(folders, selFolders.map((f) => f._id)).map((f) => (
                <li key={f._id}>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => moveSelection(f._id)}>
                    📁 {pathTo(folders, f._id).map((p) => p.name).join(' / ')}
                  </button>
                </li>
              ))}
            </ul>
          </Modal.Body>
          <Modal.Footer>
            <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)}>
              {t('timeline.cancel', { defaultValue: 'Annuler' })}
            </button>
          </Modal.Footer>
        </Modal>
      )}
      {dialog?.kind === 'removeForever' && (
        <Modal id={dialogId} isOpen onModalClose={() => setDialog(null)} size="md">
          <Modal.Header onModalClose={() => setDialog(null)}>{t('timeline.remove.forever', { defaultValue: 'Supprimer définitivement' })}</Modal.Header>
          <Modal.Body>
            <p className="m-0">{t('confirm.remove.elements', { defaultValue: 'Voulez-vous vraiment supprimer les éléments sélectionnés ?' })}</p>
          </Modal.Body>
          <Modal.Footer>
            <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)}>
              {t('timeline.cancel', { defaultValue: 'Annuler' })}
            </button>
            <button type="button" className="btn btn-danger" disabled={run.isPending} onClick={removeForever}>
              {t('remove', { defaultValue: 'Supprimer' })}
            </button>
          </Modal.Footer>
        </Modal>
      )}
    </div>
  );
}

/** Saisie d'un nom (création ou renommage d'un dossier). Ex. « Histoire ». */
function NameDialog(props: { id: string; title: string; label: string; initial: string; pending: boolean; onClose: () => void; onSave: (name: string) => void }) {
  const { t } = useTranslation(['timelinegenerator', 'common']);
  const [name, setName] = useState(props.initial);
  return (
    <Modal id={props.id} isOpen onModalClose={props.onClose} size="md">
      <Modal.Header onModalClose={props.onClose}>{props.title}</Modal.Header>
      <Modal.Body>
        <label htmlFor="tl-name" className="form-label" style={{ fontWeight: 700 }}>
          {props.label}
        </label>
        <input id="tl-name" className="form-control" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Modal.Body>
      <Modal.Footer>
        <button type="button" className="btn btn-secondary" onClick={props.onClose}>
          {t('timeline.cancel', { defaultValue: 'Annuler' })}
        </button>
        <button type="button" className="btn btn-primary" disabled={!name.trim() || props.pending} onClick={() => props.onSave(name.trim())}>
          {t('timeline.save', { defaultValue: 'Enregistrer' })}
        </button>
      </Modal.Footer>
    </Modal>
  );
}

/** Propriétés d'une frise : titre et description (l'image reste celle déjà choisie). */
function PropertiesDialog(props: { id: string; timeline: Timeline; pending: boolean; onClose: () => void; onSave: (headline: string, text: string) => void }) {
  const { t } = useTranslation(['timelinegenerator', 'common']);
  const [headline, setHeadline] = useState(props.timeline.headline);
  const [text, setText] = useState(props.timeline.text ?? '');
  return (
    <Modal id={props.id} isOpen onModalClose={props.onClose} size="md">
      <Modal.Header onModalClose={props.onClose}>{t('properties', { defaultValue: 'Propriétés' })}</Modal.Header>
      <Modal.Body>
        <label htmlFor="tl-headline" className="form-label" style={{ fontWeight: 700 }}>
          {t('timeline.headline', { defaultValue: 'Titre de la frise' })}
        </label>
        <input id="tl-headline" className="form-control mb-12" value={headline} onChange={(e) => setHeadline(e.target.value)} autoFocus />
        <label htmlFor="tl-text" className="form-label" style={{ fontWeight: 700 }}>
          {t('timelinegenerator.timeline.text', { defaultValue: 'Description' })}
        </label>
        <textarea id="tl-text" className="form-control" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </Modal.Body>
      <Modal.Footer>
        <button type="button" className="btn btn-secondary" onClick={props.onClose}>
          {t('timeline.cancel', { defaultValue: 'Annuler' })}
        </button>
        <button type="button" className="btn btn-primary" disabled={!headline.trim() || props.pending} onClick={() => props.onSave(headline.trim(), text)}>
          {t('timeline.save', { defaultValue: 'Enregistrer' })}
        </button>
      </Modal.Footer>
    </Modal>
  );
}

export default Timelines;
