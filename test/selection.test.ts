import assert from "node:assert/strict";
import test from "node:test";

import type { Commit } from "../src/model";
import {
  explicitCommitSelection,
  resolveRange,
  selectionIdentity,
  singleCommitSelection,
  toggleExplicitCommit,
  workingTreeSelection,
} from "../src/selection";

test("resolveRange derives the same base and tip in either selection direction", () => {
  const commits = commitMap([
    commit("third", ["second"]),
    commit("second", ["root"]),
    commit("side", ["root"]),
    commit("root", []),
  ]);

  const forward = resolveRange(commits, "second", "third");
  assert.equal(forward.ok, true);
  if (forward.ok) {
    assert.deepEqual(forward.selection, {
      mode: "range",
      anchorHash: "second",
      activeHash: "third",
      oldestHash: "second",
      newestHash: "third",
      baseHash: "root",
      commitHashes: ["second", "third"],
    });
  }

  const reverse = resolveRange(commits, "third", "second");
  assert.equal(reverse.ok, true);
  if (reverse.ok) {
    assert.deepEqual(reverse.selection, {
      mode: "range",
      anchorHash: "third",
      activeHash: "second",
      oldestHash: "second",
      newestHash: "third",
      baseHash: "root",
      commitHashes: ["second", "third"],
    });
  }
});

test("resolveRange uses the empty tree before a root endpoint", () => {
  const result = resolveRange(
    commitMap([
      commit("second", ["root"]),
      commit("root", []),
    ]),
    "root",
    "second",
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.selection.baseHash, undefined);
    assert.deepEqual(result.selection.commitHashes, ["root", "second"]);
  }
});

test("resolveRange includes every merge contributor between base and tip", () => {
  const commits = commitMap([
    commit("merge", ["main", "side"]),
    commit("main", ["root"]),
    commit("side", ["root"]),
    commit("root", []),
    commit("unrelated", []),
  ]);

  const result = resolveRange(commits, "main", "merge");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.selection, {
      mode: "range",
      anchorHash: "main",
      activeHash: "merge",
      oldestHash: "main",
      newestHash: "merge",
      baseHash: "root",
      commitHashes: ["side", "main", "merge"],
    });
  }
});

test("resolveRange uses the first parent when the oldest endpoint is a merge", () => {
  const result = resolveRange(
    commitMap([
      commit("after", ["merge"]),
      commit("merge", ["main", "side"]),
      commit("main", ["root"]),
      commit("side", ["root"]),
      commit("root", []),
    ]),
    "merge",
    "after",
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.selection.baseHash, "main");
    assert.deepEqual(
      result.selection.commitHashes,
      ["side", "merge", "after"],
    );
  }
});

test("resolveRange keeps the same comparison when history presentation order changes", () => {
  const dateOrder = commitMap([
    commit("merge", ["main", "side"]),
    commit("side", ["root"]),
    commit("main", ["root"]),
    commit("root", []),
  ]);
  const topologyOrder = commitMap([
    commit("merge", ["main", "side"]),
    commit("main", ["root"]),
    commit("side", ["root"]),
    commit("root", []),
  ]);

  const dateResult = resolveRange(dateOrder, "main", "merge");
  const topologyResult = resolveRange(topologyOrder, "main", "merge");
  assert.equal(dateResult.ok, true);
  assert.equal(topologyResult.ok, true);
  if (!dateResult.ok || !topologyResult.ok) {
    return;
  }
  assert.deepEqual(
    {
      base: dateResult.selection.baseHash,
      oldest: dateResult.selection.oldestHash,
      newest: dateResult.selection.newestHash,
      commits: new Set(dateResult.selection.commitHashes),
    },
    {
      base: topologyResult.selection.baseHash,
      oldest: topologyResult.selection.oldestHash,
      newest: topologyResult.selection.newestHash,
      commits: new Set(topologyResult.selection.commitHashes),
    },
  );
});

test("resolveRange rejects unrelated endpoints explicitly", () => {
  const commits = commitMap([
    commit("main", ["root"]),
    commit("root", []),
    commit("unrelated", []),
  ]);

  assert.deepEqual(resolveRange(commits, "main", "unrelated"), {
    ok: false,
    message: "Range endpoints must have an ancestor relationship.",
  });
});

test("selectionIdentity distinguishes single selections and Range anchors", () => {
  assert.equal(selectionIdentity(singleCommitSelection("commit")), "single:commit");
  const result = resolveRange(
    commitMap([
      commit("second", ["root"]),
      commit("root", []),
    ]),
    "root",
    "second",
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(selectionIdentity(result.selection), "range:root:second");
  }
});

test("toggleExplicitCommit converts a Range and can omit an interior commit", () => {
  const commits = commitMap([
    commit("third", ["second"]),
    commit("second", ["root"]),
    commit("root", []),
  ]);
  const range = resolveRange(commits, "root", "third");
  assert.equal(range.ok, true);
  if (!range.ok) {
    return;
  }

  assert.deepEqual(toggleExplicitCommit(commits, range.selection, "second"), {
    mode: "selection",
    activeHash: "third",
    commitHashes: ["third", "root"],
  });
});

test("explicitCommitSelection supports unrelated commits and collapses to single", () => {
  const commits = commitMap([
    commit("main", ["root"]),
    commit("side", ["root"]),
    commit("root", []),
  ]);
  const selection = explicitCommitSelection(
    commits,
    ["side", "missing", "main"],
    "side",
  );
  assert.deepEqual(selection, {
    mode: "selection",
    activeHash: "side",
    commitHashes: ["main", "side"],
  });
  assert.equal(
    selectionIdentity(selection),
    "selection:main,side",
  );
  assert.deepEqual(toggleExplicitCommit(commits, selection, "main"), {
    mode: "single",
    activeHash: "side",
  });
});

test("working tree selection stays outside commit Selection", () => {
  const commits = commitMap([commit("head", ["root"]), commit("root", [])]);
  const workingTree = workingTreeSelection("head", 3);
  assert.equal(selectionIdentity(workingTree), "workingTree:head:3");
  assert.deepEqual(toggleExplicitCommit(commits, workingTree, "head"), {
    mode: "single",
    activeHash: "head",
  });
});

function commitMap(commits: Commit[]): Map<string, Commit> {
  return new Map(commits.map((value) => [value.hash, value]));
}

function commit(hash: string, parents: string[]): Commit {
  return {
    hash,
    shortHash: hash,
    parents,
    authorName: "Selection Test",
    authorEmail: "selection@example.invalid",
    authoredAt: "2026-07-21T00:00:00Z",
    committedAt: "2026-07-21T00:00:00Z",
    subject: hash,
    refs: [],
  };
}
