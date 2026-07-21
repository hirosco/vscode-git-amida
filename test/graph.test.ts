import assert from "node:assert/strict";
import test from "node:test";

import { buildHistoryGraph } from "../src/graph";
import type { Commit } from "../src/model";

test("buildHistoryGraph keeps a linear history in one lane", () => {
  const graph = buildHistoryGraph([
    commit("third", ["second"]),
    commit("second", ["root"]),
    commit("root", []),
  ]);

  assert.equal(graph.laneCount, 1);
  assert.deepEqual(
    graph.rows.map((row) => row.graph),
    [
      {
        nodeLane: 0,
        nodeColor: 0,
        lines: [line(0, "node", 0, "bottom", 0)],
      },
      {
        nodeLane: 0,
        nodeColor: 0,
        lines: [
          line(0, "top", 0, "node", 0),
          line(0, "node", 0, "bottom", 0),
        ],
      },
      {
        nodeLane: 0,
        nodeColor: 0,
        lines: [line(0, "top", 0, "node", 0)],
      },
    ],
  );
});

test("buildHistoryGraph splits and rejoins merge parents", () => {
  const graph = buildHistoryGraph([
    commit("merge", ["main", "side"]),
    commit("main", ["root"]),
    commit("side", ["root"]),
    commit("root", []),
  ]);

  assert.equal(graph.laneCount, 2);
  assert.deepEqual(graph.rows[0]?.graph, {
    nodeLane: 0,
    nodeColor: 0,
    lines: [
      line(0, "node", 0, "bottom", 0),
      line(0, "node", 1, "bottom", 1),
    ],
  });
  assert.deepEqual(graph.rows[1]?.graph, {
    nodeLane: 0,
    nodeColor: 0,
    lines: [
      line(0, "top", 0, "node", 0),
      line(1, "top", 1, "bottom", 1),
      line(0, "node", 0, "bottom", 0),
    ],
  });
  assert.deepEqual(graph.rows[2]?.graph, {
    nodeLane: 1,
    nodeColor: 1,
    lines: [
      line(0, "top", 0, "bottom", 0),
      line(1, "top", 1, "node", 1),
      line(1, "node", 0, "bottom", 0),
    ],
  });
  assert.deepEqual(graph.rows[3]?.graph, {
    nodeLane: 0,
    nodeColor: 0,
    lines: [line(0, "top", 0, "node", 0)],
  });
});

function commit(hash: string, parents: string[]): Commit {
  return {
    hash,
    shortHash: hash,
    parents,
    authorName: "Graph Test",
    authorEmail: "graph@example.invalid",
    authoredAt: "2026-07-21T00:00:00Z",
    committedAt: "2026-07-21T00:00:00Z",
    subject: hash,
    refs: [],
  };
}

function line(
  fromLane: number,
  from: "top" | "node",
  toLane: number,
  to: "node" | "bottom",
  color: number,
) {
  return { fromLane, from, toLane, to, color };
}
