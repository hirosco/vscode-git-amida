import type { FileHistoryTab, FileRevision } from "./model";

export function fileHistoryMatchesPath(
  tab: FileHistoryTab,
  path: string,
): boolean {
  return (
    tab.path === path ||
    tab.revisions.some(
      (revision) =>
        revision.path === path || revision.oldPath === path,
    )
  );
}

export function fileHistoriesOverlap(
  left: readonly FileRevision[],
  right: readonly FileRevision[],
): boolean {
  const leftKeys = new Set(
    left.flatMap((revision) =>
      revisionPaths(revision).map(
        (path) => `${revision.commit.hash}\x00${path}`,
      ),
    ),
  );
  return right.some((revision) =>
    revisionPaths(revision).some((path) =>
      leftKeys.has(`${revision.commit.hash}\x00${path}`),
    ),
  );
}

export function selectedFileRevisionHash(
  revisions: readonly FileRevision[],
  requestedHash: string | undefined,
): string | undefined {
  return requestedHash !== undefined &&
    revisions.some((revision) => revision.commit.hash === requestedHash)
    ? requestedHash
    : revisions[0]?.commit.hash;
}

function revisionPaths(revision: FileRevision): string[] {
  return [revision.path, revision.oldPath].filter(
    (path): path is string => path !== undefined,
  );
}
