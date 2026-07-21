import assert from "node:assert/strict";
import test from "node:test";

import type { Commit } from "../src/model";
import {
  resolveLinearRange,
  selectionIdentity,
  singleCommitSelection,
} from "../src/selection";

test("resolveLinearRange derives the same base and tip in either selection direction", () => {
  const commits = commitMap([
    commit("third", ["second"]),
    commit("second", ["root"]),
    commit("side", ["root"]),
    commit("root", []),
  ]);

  const forward = resolveLinearRange(commits, "second", "third");
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

  const reverse = resolveLinearRange(commits, "third", "second");
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

test("resolveLinearRange uses the empty tree before a root endpoint", () => {
  const result = resolveLinearRange(
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

test("resolveLinearRange rejects merge and unrelated paths explicitly", () => {
  const commits = commitMap([
    commit("merge", ["main", "side"]),
    commit("main", ["root"]),
    commit("side", ["root"]),
    commit("root", []),
    commit("unrelated", []),
  ]);

  assert.deepEqual(resolveLinearRange(commits, "main", "merge"), {
    ok: false,
    message:
      "Ranges containing merge commits are not available in this first Range checkpoint.",
  });
  assert.deepEqual(resolveLinearRange(commits, "main", "unrelated"), {
    ok: false,
    message: "Range endpoints must have a direct linear ancestor relationship.",
  });
});

test("selectionIdentity distinguishes single selections and Range anchors", () => {
  assert.equal(selectionIdentity(singleCommitSelection("commit")), "single:commit");
  const result = resolveLinearRange(
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
