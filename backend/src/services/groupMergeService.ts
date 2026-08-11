/**
 * DocumentGroup Merge Service
 *
 * Reordering the grouping strategies stops NEW splits, but it does nothing for
 * the rows already sitting in the Bundle table as duplicates, and it can't help
 * a document that genuinely arrives with no reference number and a misread
 * plate. This module closes both gaps.
 *
 * The invariant we want: one LR ⇒ one DocumentGroup.
 *
 * Whenever a document gets linked to an Lr, we ask "does this LR now have
 * documents spread across more than one group?" If so, the groups are merged
 * into the oldest one. The oldest is chosen deliberately — it is the group the
 * first document of the trip created, so it carries the most trustworthy
 * vehicleNo and date, and any DocumentBundle rows already built against it stay
 * valid.
 */

import { db } from '../lib/db.js';

export interface MergeSummary {
  /** The group everything was merged into. Null when no merge was needed. */
  survivingGroupId: string | null;
  /** Groups that were absorbed and deleted. */
  mergedGroupIds: string[];
  /** How many Document rows were reassigned. */
  documentsMoved: number;
}

const NO_MERGE: MergeSummary = {
  survivingGroupId: null,
  mergedGroupIds: [],
  documentsMoved: 0,
};

/**
 * Collapse every DocumentGroup that holds a document linked to `lrId` into a
 * single group.
 *
 * Safe to call on every link — it short-circuits cheaply when the LR's
 * documents already share one group, which is the overwhelmingly common case.
 *
 * Deliberately does NOT merge on the basis of vehicle+date similarity alone. A
 * merge is destructive and only ever justified by a confirmed LR link, which is
 * evidence that the documents genuinely belong to the same trip.
 */
export async function mergeGroupsForLr(lrId: string): Promise<MergeSummary> {
  const links = await db.documentLinkRecord.findMany({
    where: { lrId },
    select: { document: { select: { id: true, groupId: true } } },
  });

  const groupIds = [
    ...new Set(
      links
        .map((l) => l.document?.groupId)
        .filter((g): g is string => typeof g === 'string' && g.length > 0),
    ),
  ];

  // Nothing to do: the LR's documents are already in one group (or none).
  if (groupIds.length < 2) return NO_MERGE;

  const groups = await db.documentGroup.findMany({
    where: { id: { in: groupIds } },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  if (groups.length < 2) return NO_MERGE;

  const survivor = groups[0]!;
  const doomed = groups.slice(1).map((g) => g.id);

  const documentsMoved = await db.$transaction(async (tx) => {
    // Move every document out of the doomed groups — not just the ones linked
    // to this LR. A group is a vehicle+date bucket; if it was created by a
    // misread plate then everything in it belongs with the survivor. Anything
    // that genuinely belongs elsewhere will be re-sorted by its own LR link on
    // the next relink pass.
    const moved = await tx.document.updateMany({
      where: { groupId: { in: doomed } },
      data: { groupId: survivor.id },
    });

    // Repoint driver-portal uploads the same way, or they orphan on delete.
    await tx.driverUploadDocument.updateMany({
      where: { linkedGroupId: { in: doomed } },
      data: { linkedGroupId: survivor.id },
    });

    // Any DocumentBundle already built against a doomed group must follow it,
    // otherwise a previously-sent bundle loses its group and its audit trail.
    await tx.documentBundle.updateMany({
      where: { groupId: { in: doomed } },
      data: { groupId: survivor.id },
    });

    await tx.documentGroup.deleteMany({ where: { id: { in: doomed } } });

    return moved.count;
  });

  console.info(
    `[groupMerge] lr=${lrId}: merged ${doomed.length} group(s) into ${survivor.id}, ` +
      `moved ${documentsMoved} document(s)`,
  );

  return {
    survivingGroupId: survivor.id,
    mergedGroupIds: doomed,
    documentsMoved,
  };
}

/**
 * Sweep every LR whose documents span more than one group and merge them.
 *
 * Intended as a one-off backfill after deploying the grouping fix, and as a
 * nightly safety net alongside `relinkPendingDocuments`. Processes LRs one at a
 * time so a single bad row can't abort the whole run.
 */
export async function mergeAllSplitGroups(companyId?: string): Promise<{
  lrsScanned: number;
  lrsMerged: number;
  groupsRemoved: number;
}> {
  const lrs = await db.lr.findMany({
    where: companyId ? { companyId } : {},
    select: { id: true },
  });

  let lrsMerged = 0;
  let groupsRemoved = 0;

  for (const lr of lrs) {
    try {
      const summary = await mergeGroupsForLr(lr.id);
      if (summary.mergedGroupIds.length > 0) {
        lrsMerged += 1;
        groupsRemoved += summary.mergedGroupIds.length;
      }
    } catch (err) {
      console.error(`[groupMerge] failed for lrId=${lr.id}:`, err);
    }
  }

  return { lrsScanned: lrs.length, lrsMerged, groupsRemoved };
}
