import type { Commit, CommitRef, GraphLine, HistoryRow } from "./model";

const COLOR_COUNT = 5;

interface Lane {
  hash: string;
  color: number;
}

export interface HistoryGraph {
  rows: HistoryRow[];
  laneCount: number;
}

export function buildHistoryGraph(commits: readonly Commit[]): HistoryGraph {
  let lanes: Lane[] = [];
  let laneCount = 1;
  const rows: HistoryRow[] = [];
  const primaryBackbone = findPrimaryBackbone(commits);
  const reservedColors =
    primaryBackbone.size === 0 ? new Set<number>() : new Set([0]);

  for (const commit of commits) {
    let incomingLanes = laneIndexesForHash(lanes, commit.hash);
    const hasIncomingLines = incomingLanes.length > 0;
    if (!hasIncomingLines) {
      const color = primaryBackbone.has(commit.hash)
        ? 0
        : nextColor(lanes, reservedColors);
      lanes = [...lanes, { hash: commit.hash, color }];
      incomingLanes = [lanes.length - 1];
    }

    const before = lanes;
    const nodeLane = incomingLanes[0];
    if (nodeLane === undefined) {
      continue;
    }
    const node = before[nodeLane];
    if (node === undefined) {
      continue;
    }
    const nodeColor = primaryBackbone.has(commit.hash) ? 0 : node.color;
    const incomingSet = new Set(incomingLanes);

    const after = before.filter((_, index) => !incomingSet.has(index));
    let insertionIndex = Math.min(nodeLane, after.length);
    const parentLanes: Lane[] = [];

    for (const [parentIndex, parent] of commit.parents.entries()) {
      const color =
        parentIndex === 0
          ? nodeColor
          : primaryBackbone.has(parent)
            ? 0
            : nextColor(after, reservedColors);
      const parentLane = { hash: parent, color };
      after.splice(insertionIndex, 0, parentLane);
      parentLanes.push(parentLane);
      insertionIndex += 1;
    }

    const lines: GraphLine[] = [];
    for (const [index, lane] of before.entries()) {
      if (incomingSet.has(index)) {
        if (hasIncomingLines) {
          lines.push(line(index, "top", nodeLane, "node", lane.color));
        }
        continue;
      }

      const targetLane = after.indexOf(lane);
      if (targetLane !== -1) {
        lines.push(line(index, "top", targetLane, "bottom", lane.color));
      }
    }

    for (const parentLane of parentLanes) {
      const targetLane = after.indexOf(parentLane);
      if (targetLane !== -1) {
        lines.push(
          line(nodeLane, "node", targetLane, "bottom", parentLane.color),
        );
      }
    }

    const rowLaneCount = Math.max(before.length, after.length, 1);
    laneCount = Math.max(laneCount, rowLaneCount);
    rows.push({
      commit,
      graph: {
        nodeLane,
        nodeColor,
        lines,
      },
    });
    lanes = after;
  }

  return { rows, laneCount };
}

function line(
  fromLane: number,
  from: GraphLine["from"],
  toLane: number,
  to: GraphLine["to"],
  color: number,
): GraphLine {
  return { fromLane, from, toLane, to, color };
}

function laneIndexesForHash(lanes: readonly Lane[], hash: string): number[] {
  const indexes: number[] = [];
  for (const [index, lane] of lanes.entries()) {
    if (lane.hash === hash) {
      indexes.push(index);
    }
  }
  return indexes;
}

function findPrimaryBackbone(commits: readonly Commit[]): Set<string> {
  const commitsByHash = new Map(commits.map((commit) => [commit.hash, commit]));
  const candidates: { hash: string; ref: CommitRef }[] = [];

  for (const commit of commits) {
    for (const ref of commit.refs) {
      if (primaryRefName(ref) !== undefined) {
        candidates.push({ hash: commit.hash, ref });
      }
    }
  }

  const primaryName = candidates.some(
    ({ ref }) => primaryRefName(ref) === "main",
  )
    ? "main"
    : "master";
  const matching = candidates
    .filter(({ ref }) => primaryRefName(ref) === primaryName)
    .map((candidate) => ({
      ...candidate,
      backbone: firstParentBackbone(commitsByHash, candidate.hash),
    }));
  const ranked = matching.map((candidate) => ({
    ...candidate,
    coverage: matching.filter(({ hash }) => candidate.backbone.has(hash))
      .length,
  }));
  ranked.sort((left, right) => {
    return (
      right.coverage - left.coverage ||
      Number(right.ref.type === "localBranch") -
        Number(left.ref.type === "localBranch") ||
      left.ref.name.localeCompare(right.ref.name)
    );
  });
  return ranked[0]?.backbone ?? new Set();
}

function firstParentBackbone(
  commitsByHash: ReadonlyMap<string, Commit>,
  start: string,
): Set<string> {
  const backbone = new Set<string>();
  let hash: string | undefined = start;
  while (hash !== undefined && !backbone.has(hash)) {
    const commit = commitsByHash.get(hash);
    if (commit === undefined) {
      break;
    }
    backbone.add(hash);
    hash = commit.parents[0];
  }
  return backbone;
}

function primaryRefName(ref: CommitRef): "main" | "master" | undefined {
  if (ref.type === "localBranch") {
    return ref.name === "main" || ref.name === "master"
      ? ref.name
      : undefined;
  }
  if (ref.type !== "remoteBranch") {
    return undefined;
  }
  const name = /\/(main|master)$/.exec(ref.name)?.[1];
  return name === "main" || name === "master" ? name : undefined;
}

function nextColor(
  lanes: readonly Lane[],
  reserved: ReadonlySet<number> = new Set(),
): number {
  const used = new Set(lanes.map((lane) => lane.color));
  for (let color = 0; color < COLOR_COUNT; color += 1) {
    if (!used.has(color) && !reserved.has(color)) {
      return color;
    }
  }
  for (let color = 0; color < COLOR_COUNT; color += 1) {
    if (!used.has(color)) {
      return color;
    }
  }
  return lanes.length % COLOR_COUNT;
}
