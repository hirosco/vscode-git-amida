import type {
  ChangedFile,
  ChangedFileContent,
  Commit,
  CommitFileChange,
  RepositorySelection,
} from "./model";

export interface FileComparison {
  beforeRef?: string;
  afterRef?: string;
  beforePath: string;
  afterPath: string;
  status: string;
  content?: ChangedFileContent;
}

export interface SelectionFileState {
  file: ChangedFile;
  changes: CommitFileChange[];
  comparison: FileComparison;
}

export function resolveFileComparison(
  selection: Exclude<RepositorySelection, { mode: "workingTree" }>,
  file: ChangedFile,
  activeCommit: Commit | undefined,
  selectionComparison?: FileComparison,
): FileComparison | undefined {
  if (selection.mode === "selection") {
    return selectionComparison;
  }
  if (activeCommit === undefined) {
    return undefined;
  }
  return {
    beforeRef: file.status.startsWith("A")
      ? undefined
      : selection.mode === "single"
        ? activeCommit.parents[0]
        : selection.baseHash,
    afterRef: file.status.startsWith("D")
      ? undefined
      : selection.mode === "single"
        ? activeCommit.hash
        : selection.newestHash,
    beforePath: file.oldPath ?? file.path,
    afterPath: file.path,
    status: file.status,
    ...(file.content === undefined ? {} : { content: file.content }),
  };
}

export function buildSelectionFiles(
  changes: CommitFileChange[],
  commitHashes: string[],
): SelectionFileState[] {
  const aliases = new PathAliases();
  for (const change of changes) {
    aliases.add(change.path);
    if (change.oldPath !== undefined) {
      aliases.add(change.oldPath);
      if (change.status.startsWith("R")) {
        aliases.union(change.oldPath, change.path);
      }
    }
  }

  const commitOrder = new Map(
    commitHashes.map((hash, index) => [hash, index]),
  );
  const groups = new Map<string, CommitFileChange[]>();
  for (const change of changes) {
    const identity = aliases.find(change.path);
    const group = groups.get(identity) ?? [];
    group.push(change);
    groups.set(identity, group);
  }

  const states = [...groups.values()].map((group) => {
    group.sort(
      (left, right) =>
        (commitOrder.get(left.commitHash) ?? Number.MAX_SAFE_INTEGER) -
          (commitOrder.get(right.commitHash) ?? Number.MAX_SAFE_INTEGER) ||
        left.path.localeCompare(right.path),
    );
    const newest = group[0];
    if (newest === undefined) {
      throw new Error("Selection file group cannot be empty.");
    }
    const comparison = compareSelectionEndpoints(group);
    const file: ChangedFile = {
      status: group.length === 1 ? newest.status : "S",
      path: newest.path,
      ...(group.length === 1 && newest.oldPath !== undefined
        ? { oldPath: newest.oldPath }
        : {}),
      ...(comparison.content === undefined
        ? {}
        : { content: comparison.content }),
      selection: {
        changes: group.map((change) => ({
          commitHash: change.commitHash,
          status: change.status,
        })),
        ...(comparison.beforeRef === undefined
          ? {}
          : { beforeRef: comparison.beforeRef }),
        ...(comparison.afterRef === undefined
          ? {}
          : { afterRef: comparison.afterRef }),
      },
    };
    return {
      file,
      changes: group,
      comparison,
    };
  });
  states.sort((left, right) => left.file.path.localeCompare(right.file.path));
  return states;
}

function compareSelectionEndpoints(
  changes: CommitFileChange[],
): FileComparison {
  const newest = changes[0];
  const oldest = changes.at(-1);
  if (newest === undefined || oldest === undefined) {
    throw new Error("Selection file group cannot be empty.");
  }
  return compareEndpoints(oldest, newest, changes);
}

function compareEndpoints(
  oldest: CommitFileChange,
  newest: CommitFileChange,
  changes: CommitFileChange[] = [oldest],
): FileComparison {
  const beforePath = oldest.oldPath ?? oldest.path;
  const afterPath = newest.path;
  const content = changes.find(
    (change) => change.content !== undefined,
  )?.content;
  return {
    beforeRef: isMissingObject(oldest.oldObject)
      ? undefined
      : oldest.parentHash,
    afterRef: isMissingObject(newest.newObject)
      ? undefined
      : newest.commitHash,
    beforePath,
    afterPath,
    status: comparisonStatus(
      oldest.oldObject,
      newest.newObject,
      beforePath,
      afterPath,
    ),
    ...(content === undefined ? {} : { content }),
  };
}

function comparisonStatus(
  oldObject: string,
  newObject: string,
  oldPath: string,
  newPath: string,
): string {
  if (isMissingObject(oldObject)) {
    return "A";
  }
  if (isMissingObject(newObject)) {
    return "D";
  }
  return oldPath === newPath ? "M" : "R";
}

function isMissingObject(hash: string): boolean {
  return /^0+$/.test(hash);
}

class PathAliases {
  private readonly parents = new Map<string, string>();

  public add(path: string): void {
    if (!this.parents.has(path)) {
      this.parents.set(path, path);
    }
  }

  public find(path: string): string {
    const parent = this.parents.get(path);
    if (parent === undefined || parent === path) {
      return path;
    }
    const root = this.find(parent);
    this.parents.set(path, root);
    return root;
  }

  public union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      this.parents.set(rightRoot, leftRoot);
    }
  }
}
