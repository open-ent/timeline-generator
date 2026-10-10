import { describe, expect, it } from 'vitest';

import { canManage, childFolders, descendants, folderPayload, Folder, foldersContaining, itemsIn, moveTargets, pathTo, trashContent } from './library';

// Arborescence de test : Histoire (t1) > Antiquité (t2) ; Sciences (supprimé, t3) ; t4 à la racine ; t5 supprimée.
const folders: Folder[] = [
  { _id: 'h', name: 'Histoire', parentId: 'root', ressourceIds: ['t1'] },
  { _id: 'a', name: 'Antiquité', parentId: 'h', ressourceIds: ['t2'] },
  { _id: 's', name: 'Sciences', parentId: 'root', trashed: true, ressourceIds: ['t3'] },
  { _id: 'b', name: 'Biologie', ressourceIds: [] },
];
const items = [{ _id: 't1' }, { _id: 't2' }, { _id: 't3' }, { _id: 't4' }, { _id: 't5', trashed: true }];

describe('bibliothèque des frises', () => {
  it('dossiers de la racine : non supprimés, sans parent ou parent « root », triés', () => {
    expect(childFolders(folders, 'root').map((f) => f.name)).toEqual(['Biologie', 'Histoire']);
    expect(childFolders(folders, 'h').map((f) => f._id)).toEqual(['a']);
  });
  it('frises de la racine : rangées dans aucun dossier et non supprimées', () => {
    expect(itemsIn(items, folders, 'root').map((t) => t._id)).toEqual(['t4']);
    expect(itemsIn(items, folders, 'h').map((t) => t._id)).toEqual(['t1']);
  });
  it('corbeille : dossiers et frises supprimés', () => {
    const c = trashContent(items, folders);
    expect(c.folders.map((f) => f._id)).toEqual(['s']);
    expect(c.items.map((t) => t._id)).toEqual(['t5']);
  });
  it('descendants : le dossier et tous ses sous-dossiers', () => {
    expect(descendants(folders, 'h').map((f) => f._id)).toEqual(['h', 'a']);
  });
  it('déplacement : un dossier ne peut aller ni en lui-même ni dans ses descendants', () => {
    expect(moveTargets(folders, ['h']).map((f) => f._id)).toEqual(['b']);
  });
  it('fil d\'Ariane et dossiers contenant une frise', () => {
    expect(pathTo(folders, 'a').map((f) => f.name)).toEqual(['Histoire', 'Antiquité']);
    expect(foldersContaining(folders, 't2').map((f) => f._id)).toEqual(['a']);
  });
  it('données envoyées : parent « root » par défaut, liste vide par défaut', () => {
    expect(folderPayload({ _id: 'x', name: 'X' })).toEqual({ name: 'X', parentId: 'root', trashed: false, ressourceIds: [] });
  });
  it('gestion : propriétaire, ou partage avec le droit de modification', () => {
    const right = 'net-atos-entng-timelinegenerator-controllers-TimelineController|updateTimeline';
    expect(canManage({ owner: { userId: 'u1' } }, { userId: 'u1' })).toBe(true);
    expect(canManage({ owner: { userId: 'u2' }, shared: [{ groupId: 'g1', [right]: true }] }, { userId: 'u1', groupsIds: ['g1'] })).toBe(true);
    expect(canManage({ owner: { userId: 'u2' }, shared: [{ userId: 'u1' }] }, { userId: 'u1' })).toBe(false);
  });
});
