import type { Commit, GraphLine, HistoryRow } from "./model";

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

  for (const commit of commits) {
    let nodeLane = lanes.findIndex((lane) => lane.hash === commit.hash);
    const hasIncomingLine = nodeLane !== -1;
    if (!hasIncomingLine) {
      const color = nextColor(lanes);
      lanes = [...lanes, { hash: commit.hash, color }];
      nodeLane = lanes.length - 1;
    }

    const before = lanes;
    const node = before[nodeLane];
    if (node === undefined) {
      continue;
    }

    const after = before.filter((_, index) => index !== nodeLane);
    let insertionIndex = Math.min(nodeLane, after.length);

    for (const [parentIndex, parent] of commit.parents.entries()) {
      const existingIndex = after.findIndex((lane) => lane.hash === parent);
      if (existingIndex !== -1) {
        insertionIndex = Math.max(insertionIndex, existingIndex + 1);
        continue;
      }

      const color = parentIndex === 0 ? node.color : nextColor(after);
      after.splice(insertionIndex, 0, { hash: parent, color });
      insertionIndex += 1;
    }

    const lines: GraphLine[] = [];
    for (const [index, lane] of before.entries()) {
      if (index === nodeLane) {
        if (hasIncomingLine) {
          lines.push(line(index, "top", nodeLane, "node", lane.color));
        }
        continue;
      }

      const targetLane = after.findIndex(
        (candidate) => candidate.hash === lane.hash,
      );
      if (targetLane !== -1) {
        lines.push(line(index, "top", targetLane, "bottom", lane.color));
      }
    }

    for (const parent of commit.parents) {
      const targetLane = after.findIndex((lane) => lane.hash === parent);
      const target = after[targetLane];
      if (targetLane !== -1 && target !== undefined) {
        lines.push(line(nodeLane, "node", targetLane, "bottom", target.color));
      }
    }

    const rowLaneCount = Math.max(before.length, after.length, 1);
    laneCount = Math.max(laneCount, rowLaneCount);
    rows.push({
      commit,
      graph: {
        nodeLane,
        nodeColor: node.color,
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

function nextColor(lanes: readonly Lane[]): number {
  const used = new Set(lanes.map((lane) => lane.color));
  for (let color = 0; color < COLOR_COUNT; color += 1) {
    if (!used.has(color)) {
      return color;
    }
  }
  return lanes.length % COLOR_COUNT;
}
