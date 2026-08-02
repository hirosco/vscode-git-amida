import assert from "node:assert/strict";
import test from "node:test";

import { buildHistoryGraph, type HistoryGraph } from "../src/graph";
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

test("buildHistoryGraph converges every parent of an octopus merge", () => {
  const commits = [
    commit("octopus", ["main", "side-a", "side-b"]),
    commit("main", ["root"]),
    commit("side-a", ["root"]),
    commit("side-b", ["root"]),
    commit("root", []),
  ];

  const graph = buildHistoryGraph(commits);

  assertGraphInvariants(commits, graph);
  assert.equal(graph.laneCount, 3);
  assert.equal(
    graph.rows[0]?.graph.lines.filter((candidate) => candidate.from === "node")
      .length,
    3,
  );
  assert.equal(linesEnteringNode(graph, "root"), 3);
});

test("buildHistoryGraph preserves both merge bases in a criss-cross history", () => {
  const commits = [
    commit("tip", ["left-tip", "right-tip"]),
    commit("left-tip", ["left-merge"]),
    commit("right-tip", ["right-merge"]),
    commit("left-merge", ["left-base", "right-base"]),
    commit("right-merge", ["right-base", "left-base"]),
    commit("left-base", ["root"]),
    commit("right-base", ["root"]),
    commit("root", []),
  ];

  const graph = buildHistoryGraph(commits);

  assertGraphInvariants(commits, graph);
  assert.equal(linesEnteringNode(graph, "left-base"), 2);
  assert.equal(linesEnteringNode(graph, "right-base"), 2);
  assert.equal(linesEnteringNode(graph, "root"), 2);
});

test("buildHistoryGraph leaves a safe continuation for a parent outside the loaded rows", () => {
  const commits = [
    commit("tip", ["visible"]),
    commit("visible", ["not-loaded"]),
  ];

  const graph = buildHistoryGraph(commits);

  assertGraphInvariants(commits, graph);
  assert.equal(graph.laneCount, 1);
  assert.deepEqual(graph.rows[1]?.graph.lines, [
    line(0, "top", 0, "node", 0),
    line(0, "node", 0, "bottom", 0),
  ]);
});

test("buildHistoryGraph bounds and converges many simultaneous lanes", () => {
  const laneTotal = 16;
  const commits = [
    ...Array.from({ length: laneTotal }, (_, index) =>
      commit(`tip-${index}`, ["root"]),
    ),
    commit("root", []),
  ];

  const graph = buildHistoryGraph(commits);

  assertGraphInvariants(commits, graph);
  assert.equal(graph.laneCount, laneTotal);
  assert.equal(linesEnteringNode(graph, "root"), laneTotal);
  assert.equal(
    new Set(graph.rows.map((row) => row.graph.nodeColor)).size,
    5,
  );
});

test("buildHistoryGraph remains deterministic across generated valid DAGs", () => {
  for (let seed = 1; seed <= 20; seed += 1) {
    const commits = generatedDag(seed, 120);
    const first = buildHistoryGraph(commits);
    const second = buildHistoryGraph(commits);

    assertGraphInvariants(commits, first);
    assert.deepEqual(first, second);
  }
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

function linesEnteringNode(graph: HistoryGraph, hash: string): number {
  const row = graph.rows.find((candidate) => candidate.commit.hash === hash);
  assert.ok(row);
  return row.graph.lines.filter((candidate) => candidate.to === "node").length;
}

function assertGraphInvariants(
  commits: readonly Commit[],
  graph: HistoryGraph,
): void {
  assert.equal(graph.rows.length, commits.length);
  assert.ok(graph.laneCount >= 1);
  assert.deepEqual(
    graph.rows.map((row) => row.commit.hash),
    commits.map((candidate) => candidate.hash),
  );

  const rowByHash = new Map(
    graph.rows.map((row, index) => [row.commit.hash, index]),
  );
  for (const [rowIndex, row] of graph.rows.entries()) {
    assert.ok(row.graph.nodeLane >= 0);
    assert.ok(row.graph.nodeLane < graph.laneCount);
    assert.ok(row.graph.nodeColor >= 0 && row.graph.nodeColor < 5);
    for (const candidate of row.graph.lines) {
      assert.ok(candidate.fromLane >= 0);
      assert.ok(candidate.fromLane < graph.laneCount);
      assert.ok(candidate.toLane >= 0);
      assert.ok(candidate.toLane < graph.laneCount);
      assert.ok(candidate.color >= 0 && candidate.color < 5);
    }
    assert.equal(
      row.graph.lines.filter(
        (candidate) => candidate.from === "node" && candidate.to === "bottom",
      ).length,
      row.commit.parents.length,
    );
    assert.equal(
      row.graph.lines.filter((candidate) => candidate.to === "node").length,
      commits.reduce(
        (total, child) =>
          total +
          child.parents.filter((parent) => parent === row.commit.hash).length,
        0,
      ),
    );
    for (const parent of row.commit.parents) {
      const parentIndex = rowByHash.get(parent);
      if (parentIndex !== undefined) {
        assert.ok(parentIndex > rowIndex, `${parent} must follow its child`);
      }
    }
  }
}

function generatedDag(seed: number, size: number): Commit[] {
  let state = seed >>> 0;
  const random = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const oldestFirst: Commit[] = [];

  for (let index = 0; index < size; index += 1) {
    const available = oldestFirst.length;
    const parentCount =
      available === 0
        ? 0
        : Math.min(available, random() < 0.12 ? 3 : random() < 0.35 ? 2 : 1);
    const parents = new Set<string>();
    while (parents.size < parentCount) {
      const parentIndex = Math.floor(random() * available);
      const parent = oldestFirst[parentIndex];
      assert.ok(parent);
      parents.add(parent.hash);
    }
    oldestFirst.push(
      commit(
        `seed-${seed}-commit-${index}`,
        [...parents],
        index === size - 1 ? [localBranch("main")] : [],
      ),
    );
  }

  return oldestFirst.reverse();
}
