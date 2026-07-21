import assert from "node:assert/strict";
import test from "node:test";

import type { Commit } from "../src/model";
import {
  resolveRange,
  selectionIdentity,
  singleCommitSelection,
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
