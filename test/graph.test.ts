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
      line(1, "node", 1, "bottom", 1),
    ],
  });
  assert.deepEqual(graph.rows[3]?.graph, {
    nodeLane: 0,
    nodeColor: 0,
    lines: [
      line(0, "top", 0, "node", 0),
      line(1, "top", 0, "node", 1),
    ],
  });
});

test("buildHistoryGraph joins diverged lines at their parent node", () => {
  const graph = buildHistoryGraph([
    commit("main-tip", ["root"]),
    commit("side-tip", ["root"]),
    commit("root", []),
  ]);

  assert.deepEqual(graph.rows[1]?.graph.lines, [
    line(0, "top", 0, "bottom", 0),
    line(1, "node", 1, "bottom", 1),
  ]);
  assert.deepEqual(graph.rows[2]?.graph.lines, [
    line(0, "top", 0, "node", 0),
    line(1, "top", 0, "node", 1),
  ]);
});

test("buildHistoryGraph keeps duplicate parent lanes separate across intervening rows", () => {
  const graph = buildHistoryGraph([
    commit("main-tip", ["root"]),
    commit("side-tip", ["root"]),
    commit("other-tip", ["other-root"]),
    commit("root", []),
    commit("other-root", []),
  ]);

  assert.deepEqual(graph.rows[2]?.graph.lines, [
    line(0, "top", 0, "bottom", 0),
    line(1, "top", 1, "bottom", 1),
    line(2, "node", 2, "bottom", 2),
  ]);
});

test("buildHistoryGraph changes color where a branch leaves the main backbone", () => {
  const graph = buildHistoryGraph([
    commit("feature-tip", ["feature-work"]),
    commit("feature-work", ["main-tip"]),
    commit("main-tip", ["root"], [localBranch("main")]),
    commit("root", []),
  ]);

  assert.deepEqual(
    graph.rows.map((row) => row.graph.nodeColor),
    [1, 1, 0, 0],
  );
  assert.deepEqual(graph.rows[2]?.graph.lines, [
    line(0, "top", 0, "node", 1),
    line(0, "node", 0, "bottom", 0),
  ]);
});

test("buildHistoryGraph uses a remote main ref when no local main exists", () => {
  const graph = buildHistoryGraph([
    commit("feature-tip", ["main-tip"]),
    commit("main-tip", ["root"], [remoteBranch("origin/main")]),
    commit("root", []),
  ]);

  assert.deepEqual(
    graph.rows.map((row) => row.graph.nodeColor),
    [1, 0, 0],
  );
});

test("buildHistoryGraph follows the most advanced main ref", () => {
  const graph = buildHistoryGraph([
    commit("remote-main", ["local-main"], [remoteBranch("origin/main")]),
    commit("feature-tip", ["local-main"]),
    commit("local-main", ["root"], [localBranch("main")]),
    commit("root", []),
  ]);

  assert.deepEqual(
    graph.rows.map((row) => row.graph.nodeColor),
    [0, 1, 0, 0],
  );
});

function commit(
  hash: string,
  parents: string[],
  refs: Commit["refs"] = [],
): Commit {
  return {
    hash,
    shortHash: hash,
    parents,
    authorName: "Graph Test",
    authorEmail: "graph@example.invalid",
    authoredAt: "2026-07-21T00:00:00Z",
    committedAt: "2026-07-21T00:00:00Z",
    subject: hash,
    refs,
  };
}

function localBranch(name: string): Commit["refs"][number] {
  return {
    name,
    fullName: `refs/heads/${name}`,
    type: "localBranch",
    current: false,
  };
}

function remoteBranch(name: string): Commit["refs"][number] {
  return {
    name,
    fullName: `refs/remotes/${name}`,
    type: "remoteBranch",
    current: false,
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
