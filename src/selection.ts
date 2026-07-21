import type {
  Commit,
  CommitRangeSelection,
  RepositorySelection,
} from "./model";

export type RangeResolution =
  | { ok: true; selection: CommitRangeSelection }
  | { ok: false; message: string };

interface Reachability {
  hashes: Set<string>;
  missing: boolean;
}

export function singleCommitSelection(hash: string): RepositorySelection {
  return { mode: "single", activeHash: hash };
}

export function explicitCommitSelection(
  commits: ReadonlyMap<string, Commit>,
  hashes: Iterable<string>,
  activeHash: string,
): RepositorySelection {
  const selected = new Set(
    [...hashes].filter((hash) => commits.has(hash)),
  );
  if (selected.size === 0) {
    return singleCommitSelection(activeHash);
  }
  if (selected.size === 1) {
    return singleCommitSelection([...selected][0] ?? activeHash);
  }
  const commitHashes = [...commits.keys()].filter((hash) => selected.has(hash));
  return {
    mode: "selection",
    activeHash:
      selected.has(activeHash) ? activeHash : commitHashes[0] ?? activeHash,
    commitHashes,
  };
}

export function toggleExplicitCommit(
  commits: ReadonlyMap<string, Commit>,
  current: RepositorySelection | undefined,
  hash: string,
): RepositorySelection {
  if (current === undefined || !commits.has(hash)) {
    return singleCommitSelection(hash);
  }
  const selected = new Set(
    current.mode === "single" ? [current.activeHash] : current.commitHashes,
  );
  if (selected.has(hash)) {
    if (selected.size === 1) {
      return current;
    }
    selected.delete(hash);
  } else {
    selected.add(hash);
  }
  return explicitCommitSelection(commits, selected, hash);
}

export function resolveRange(
  commits: ReadonlyMap<string, Commit>,
  anchorHash: string,
  activeHash: string,
): RangeResolution {
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

  const anchorReachability = collectReachable(commits, anchorHash);
  const activeReachability = collectReachable(commits, activeHash);
  let oldestHash: string;
  let newestHash: string;
  let newestReachability: Reachability;

  if (activeReachability.hashes.has(anchorHash)) {
    oldestHash = anchorHash;
    newestHash = activeHash;
    newestReachability = activeReachability;
  } else if (anchorReachability.hashes.has(activeHash)) {
    oldestHash = activeHash;
    newestHash = anchorHash;
    newestReachability = anchorReachability;
  } else if (anchorReachability.missing || activeReachability.missing) {
    return {
      ok: false,
      message: "The complete ancestry between these commits is not loaded.",
    };
  } else {
    return {
      ok: false,
      message: "Range endpoints must have an ancestor relationship.",
    };
  }

  const oldestCommit = commits.get(oldestHash);
  if (oldestCommit === undefined) {
    return {
      ok: false,
      message: "One of the selected commits is no longer in this history.",
    };
  }
  const baseHash = oldestCommit.parents[0];
  const baseReachability =
    baseHash === undefined
      ? { hashes: new Set<string>(), missing: false }
      : collectReachable(commits, baseHash);
  if (newestReachability.missing || baseReachability.missing) {
    return {
      ok: false,
      message: "The complete ancestry between these commits is not loaded.",
    };
  }

  const selectedHashes = new Set(
    [...newestReachability.hashes].filter(
      (hash) => !baseReachability.hashes.has(hash),
    ),
  );
  const commitHashes = [...commits.keys()]
    .filter((hash) => selectedHashes.has(hash))
    .reverse();

  return {
    ok: true,
    selection: {
      mode: "range",
      anchorHash,
      activeHash,
      oldestHash,
      newestHash,
      baseHash,
      commitHashes,
    },
  };
}

export function selectionIdentity(selection: RepositorySelection): string {
  if (selection.mode === "single") {
    return `single:${selection.activeHash}`;
  }
  if (selection.mode === "range") {
    return `range:${selection.anchorHash}:${selection.activeHash}`;
  }
  return `selection:${[...selection.commitHashes].sort().join(",")}`;
}

function collectReachable(
  commits: ReadonlyMap<string, Commit>,
  startHash: string,
): Reachability {
  const hashes = new Set<string>();
  const pending = [startHash];
  let missing = false;

  while (pending.length > 0) {
    const hash = pending.pop();
    if (hash === undefined || hashes.has(hash)) {
      continue;
    }
    const commit = commits.get(hash);
    if (commit === undefined) {
      missing = true;
      continue;
    }
    hashes.add(hash);
    pending.push(...commit.parents);
  }

  return { hashes, missing };
}
