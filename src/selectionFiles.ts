import type {
  ChangedFile,
  ChangedFileContent,
  CommitFileChange,
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
  combined?: FileComparison;
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
    const combined = combineChanges(group);
    const file: ChangedFile = {
      status: group.length === 1 ? newest.status : "S",
      path: newest.path,
      ...(group.length === 1 && newest.oldPath !== undefined
        ? { oldPath: newest.oldPath }
        : {}),
      ...(group.length === 1 && newest.content !== undefined
        ? { content: newest.content }
        : {}),
      selection: {
        changes: group.map((change) => ({
          commitHash: change.commitHash,
          status: change.status,
        })),
        combined: combined !== undefined,
      },
    };
    return {
      file,
      changes: group,
      ...(combined === undefined ? {} : { combined }),
    };
  });
  states.sort((left, right) => left.file.path.localeCompare(right.file.path));
  return states;
}

export function comparisonForChange(
  change: CommitFileChange,
): FileComparison {
  return {
    beforeRef: isMissingObject(change.oldObject)
      ? undefined
      : change.parentHash,
    afterRef: isMissingObject(change.newObject)
      ? undefined
      : change.commitHash,
    beforePath: change.oldPath ?? change.path,
    afterPath: change.path,
    status: change.status,
    ...(change.content === undefined ? {} : { content: change.content }),
  };
}

function combineChanges(
  changes: CommitFileChange[],
): FileComparison | undefined {
  if (changes.length < 2) {
    return undefined;
  }
  const remaining = new Set(changes);
  const starts = changes.filter(
    (candidate) =>
      !changes.some(
        (other) => other !== candidate && connects(other, candidate),
      ),
  );
  if (starts.length !== 1) {
    return undefined;
  }

  const start = starts[0];
  if (start === undefined) {
    return undefined;
  }
  const chain: CommitFileChange[] = [];
  let current: CommitFileChange = start;
  while (true) {
    chain.push(current);
    remaining.delete(current);
    if (remaining.size === 0) {
      break;
    }
    const next = [...remaining].filter((candidate) =>
      connects(current, candidate),
    );
    if (next.length !== 1) {
      return undefined;
    }
    const nextChange = next[0];
    if (nextChange === undefined) {
      return undefined;
    }
    current = nextChange;
  }

  const first = chain[0];
  const last = chain.at(-1);
  if (first === undefined || last === undefined) {
    return undefined;
  }
  const beforePath = first.oldPath ?? first.path;
  const afterPath = last.path;
  if (first.oldObject === last.newObject && beforePath === afterPath) {
    return undefined;
  }
  const content = changes.find(
    (change) => change.content !== undefined,
  )?.content;
  return {
    beforeRef: isMissingObject(first.oldObject)
      ? undefined
      : first.parentHash,
    afterRef: isMissingObject(last.newObject)
      ? undefined
      : last.commitHash,
    beforePath,
    afterPath,
    status: combinedStatus(first.oldObject, last.newObject, beforePath, afterPath),
    ...(content === undefined ? {} : { content }),
  };
}

function connects(
  older: CommitFileChange,
  newer: CommitFileChange,
): boolean {
  return (
    older.newObject === newer.oldObject &&
    older.path === (newer.oldPath ?? newer.path)
  );
}

function combinedStatus(
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
