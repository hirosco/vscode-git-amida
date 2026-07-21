import type {
  Commit,
  CommitRangeSelection,
  RepositorySelection,
} from "./model";

export type LinearRangeResolution =
  | { ok: true; selection: CommitRangeSelection }
  | { ok: false; message: string };

type LinearPathResult =
  | { kind: "path"; hashes: string[] }
  | { kind: "merge" }
  | { kind: "missing" }
  | { kind: "unrelated" };

export function singleCommitSelection(hash: string): RepositorySelection {
  return { mode: "single", activeHash: hash };
}

export function resolveLinearRange(
  commits: ReadonlyMap<string, Commit>,
  anchorHash: string,
  activeHash: string,
): LinearRangeResolution {
  if (!commits.has(anchorHash) || !commits.has(activeHash)) {
    return {
      ok: false,
      message: "One of the selected commits is no longer in this history.",
    };
  }
  if (anchorHash === activeHash) {
    return {
      ok: false,
      message: "Select two different commits to create a Range.",
    };
  }

  const anchorToActive = traceLinearPath(commits, anchorHash, activeHash);
  if (anchorToActive.kind === "path") {
    return rangeResult(
      commits,
      anchorHash,
      activeHash,
      anchorHash,
      activeHash,
      anchorToActive.hashes,
    );
  }

  const activeToAnchor = traceLinearPath(commits, activeHash, anchorHash);
  if (activeToAnchor.kind === "path") {
    return rangeResult(
      commits,
      anchorHash,
      activeHash,
      activeHash,
      anchorHash,
      activeToAnchor.hashes,
    );
  }

  if (anchorToActive.kind === "merge" || activeToAnchor.kind === "merge") {
    return {
      ok: false,
      message:
        "Ranges containing merge commits are not available in this first Range checkpoint.",
    };
  }
  if (anchorToActive.kind === "missing" || activeToAnchor.kind === "missing") {
    return {
      ok: false,
      message: "The complete path between these commits is not loaded.",
    };
  }
  return {
    ok: false,
    message: "Range endpoints must have a direct linear ancestor relationship.",
  };
}

export function selectionIdentity(selection: RepositorySelection): string {
  return selection.mode === "single"
    ? `single:${selection.activeHash}`
    : `range:${selection.anchorHash}:${selection.activeHash}`;
}

function rangeResult(
  commits: ReadonlyMap<string, Commit>,
  anchorHash: string,
  activeHash: string,
  oldestHash: string,
  newestHash: string,
  commitHashes: string[],
): LinearRangeResolution {
  return {
    ok: true,
    selection: {
      mode: "range",
      anchorHash,
      activeHash,
      oldestHash,
      newestHash,
      baseHash: commits.get(oldestHash)?.parents[0],
      commitHashes,
    },
  };
}

function traceLinearPath(
  commits: ReadonlyMap<string, Commit>,
  oldestHash: string,
  newestHash: string,
): LinearPathResult {
  const hashes: string[] = [];
  const visited = new Set<string>();
  let currentHash = newestHash;

  while (!visited.has(currentHash)) {
    visited.add(currentHash);
    const commit = commits.get(currentHash);
    if (commit === undefined) {
      return { kind: "missing" };
    }
    hashes.unshift(currentHash);
    if (currentHash === oldestHash) {
      return commit.parents.length > 1
        ? { kind: "merge" }
        : { kind: "path", hashes };
    }
    if (commit.parents.length > 1) {
      return { kind: "merge" };
    }
    const parent = commit.parents[0];
    if (parent === undefined) {
      return { kind: "unrelated" };
    }
    currentHash = parent;
  }

  return { kind: "unrelated" };
}
