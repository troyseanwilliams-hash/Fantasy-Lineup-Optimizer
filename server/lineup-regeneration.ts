/**
 * A regeneration against another DraftKings group must not rewrite the
 * source lineup's slate identity.  The source row is historical state; the
 * target roster belongs in a new row.
 */
export function shouldCloneRegeneratedLineup(
  sourceSlateId: number,
  targetSlateId: number,
  preserveSourceSlateId: boolean,
): boolean {
  return preserveSourceSlateId && sourceSlateId !== targetSlateId;
}

export interface ClassicMainIdentity {
  id: number;
  draftGroupId: number | null;
  isMain: boolean;
}

export function reconcileClassicMainIdentity(
  slates: ClassicMainIdentity[],
  targetDraftGroupId: number,
): {
  demoteSlateId: number | null;
  promoteSlateId: number | null;
  createTarget: boolean;
} {
  const currentMain = slates.find(slate => slate.isMain);
  const target = slates.find(slate => slate.draftGroupId === targetDraftGroupId);
  if (target && target.id !== currentMain?.id) {
    return {
      demoteSlateId: currentMain?.id ?? null,
      promoteSlateId: target.id,
      createTarget: false,
    };
  }
  if (!target && currentMain && currentMain.draftGroupId !== targetDraftGroupId) {
    return {
      demoteSlateId: currentMain.id,
      promoteSlateId: null,
      createTarget: true,
    };
  }
  return { demoteSlateId: null, promoteSlateId: null, createTarget: false };
}