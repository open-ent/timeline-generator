/**
 * Bibliothèque des frises (dossiers, corbeille), fonctions pures — même modèle que l'AngularJS
 * (public/ts/models/folder.ts) :
 *  - un dossier porte `parentId` (« root » ou l'id du parent), `trashed` et `ressourceIds`
 *    (ids des frises qu'il contient) ;
 *  - une frise est « à la racine » si elle n'est dans aucun dossier ;
 *  - la corbeille montre les frises et dossiers `trashed`.
 * Ex. dossier « Histoire » {parentId: 'root', ressourceIds: ['t1']} → t1 n'apparaît que dans « Histoire ».
 */

export interface Folder {
  _id: string;
  name: string;
  parentId?: string;
  trashed?: boolean;
  ressourceIds?: string[];
  owner?: { userId: string; displayName: string };
}

export interface LibraryItem {
  _id: string;
  trashed?: boolean;
}

/** Emplacement courant : la racine (« Mes frises »), la corbeille ou un dossier. */
export type Location = { kind: 'root' } | { kind: 'trash' } | { kind: 'folder'; id: string };

export const ROOT = 'root';

const isRootParent = (f: Folder) => !f.parentId || f.parentId === ROOT;

/** Dossiers enfants directs (non supprimés) d'un emplacement, triés par nom. */
export function childFolders(folders: Folder[], parentId: string): Folder[] {
  return folders
    .filter((f) => !f.trashed && (parentId === ROOT ? isRootParent(f) : f.parentId === parentId))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
}

/** Frises (non supprimées) d'un emplacement : celles d'aucun dossier pour la racine. */
export function itemsIn<T extends LibraryItem>(items: T[], folders: Folder[], parentId: string): T[] {
  if (parentId === ROOT) {
    const filed = new Set(folders.flatMap((f) => f.ressourceIds ?? []));
    return items.filter((t) => !t.trashed && !filed.has(t._id));
  }
  const folder = folders.find((f) => f._id === parentId);
  const ids = new Set(folder?.ressourceIds ?? []);
  return items.filter((t) => !t.trashed && ids.has(t._id));
}

/** Contenu de la corbeille : frises et dossiers supprimés. */
export function trashContent<T extends LibraryItem>(items: T[], folders: Folder[]): { folders: Folder[]; items: T[] } {
  return { folders: folders.filter((f) => f.trashed), items: items.filter((t) => t.trashed) };
}

/** Dossier et tous ses sous-dossiers (pour la mise à la corbeille récursive). */
export function descendants(folders: Folder[], id: string): Folder[] {
  const out: Folder[] = [];
  const walk = (pid: string) => {
    for (const f of folders.filter((x) => x.parentId === pid)) {
      out.push(f);
      walk(f._id);
    }
  };
  const self = folders.find((f) => f._id === id);
  if (self) out.push(self);
  walk(id);
  return out;
}

/** Dossiers contenant une frise (une frise peut, par historique, être rangée dans plusieurs). */
export function foldersContaining(folders: Folder[], itemId: string): Folder[] {
  return folders.filter((f) => (f.ressourceIds ?? []).includes(itemId));
}

/**
 * Destinations possibles pour déplacer un dossier : jamais lui-même ni un de ses descendants
 * (sinon cycle). Ex. déplacer « Histoire » : « Histoire/Antiquité » est exclu.
 */
export function moveTargets(folders: Folder[], movingFolderIds: string[]): Folder[] {
  const banned = new Set(movingFolderIds.flatMap((id) => descendants(folders, id).map((f) => f._id)));
  return folders.filter((f) => !f.trashed && !banned.has(f._id));
}

/** Chemin d'un dossier depuis la racine (fil d'Ariane). Ex. [Histoire, Antiquité]. */
export function pathTo(folders: Folder[], id: string): Folder[] {
  const out: Folder[] = [];
  let cur = folders.find((f) => f._id === id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur._id)) {
    seen.add(cur._id);
    out.unshift(cur);
    cur = isRootParent(cur) ? undefined : folders.find((f) => f._id === cur!.parentId);
  }
  return out;
}

/** Données envoyées au serveur pour un dossier (même forme que Folder.toJSON en AngularJS). */
export function folderPayload(f: Folder): Required<Pick<Folder, 'name' | 'parentId' | 'trashed' | 'ressourceIds'>> {
  return { name: f.name, parentId: f.parentId || ROOT, trashed: !!f.trashed, ressourceIds: f.ressourceIds ?? [] };
}

/** Droit AngularJS « manage » d'une frise : modifier, partager, mettre à la corbeille. */
export const MANAGE_RIGHT = 'net-atos-entng-timelinegenerator-controllers-TimelineController|updateTimeline';

/** Droit AngularJS « contrib » d'une frise : créer, modifier, supprimer ses événements. */
export const CONTRIB_RIGHT = 'net-atos-entng-timelinegenerator-controllers-EventController|createEvent';

type Shared = Array<Record<string, unknown> & { userId?: string; groupId?: string }>;

/**
 * A le droit sur la frise : propriétaire, ou partage (à soi ou à un de ses groupes) portant ce droit.
 * Ex. frise partagée au groupe « Enseignants » avec `…|updateTimeline: true` → gestion autorisée.
 */
export function hasRight(item: { owner?: { userId: string }; shared?: Shared }, me: { userId: string; groupsIds?: string[] }, right: string): boolean {
  if (item.owner?.userId === me.userId) return true;
  const groups = new Set(me.groupsIds ?? []);
  return (item.shared ?? []).some((s) => s[right] === true && ((s.userId && s.userId === me.userId) || (s.groupId && groups.has(s.groupId))));
}

/** Peut gérer la frise (modifier, partager, mettre à la corbeille). */
export const canManage = (item: { owner?: { userId: string }; shared?: Shared }, me: { userId: string; groupsIds?: string[] }) =>
  hasRight(item, me, MANAGE_RIGHT);

/** Peut contribuer à la frise (événements). */
export const canContrib = (item: { owner?: { userId: string }; shared?: Shared }, me: { userId: string; groupsIds?: string[] }) =>
  hasRight(item, me, CONTRIB_RIGHT);
