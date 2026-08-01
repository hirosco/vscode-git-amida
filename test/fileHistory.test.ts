import assert from "node:assert/strict";
import test from "node:test";

import {
  fileHistoriesOverlap,
  fileHistoryMatchesPath,
  selectedFileRevisionHash,
} from "../src/fileHistory";
import type { Commit, FileHistoryTab, FileRevision } from "../src/model";

test("file history matches every path in a rename lineage", () => {
  const revisions = [
    revision("rename", "new/file.png", "old/file.png", "R100"),
    revision("add", "old/file.png", undefined, "A"),
  ];
  const tab: FileHistoryTab = {
    id: "file-1",
    label: "file.png",
    path: "new/file.png",
    revisions,
    selectedHash: "rename",
    scrollTop: 25,
    revealSelected: false,
    loading: false,
  };

  assert.equal(fileHistoryMatchesPath(tab, "new/file.png"), true);
  assert.equal(fileHistoryMatchesPath(tab, "old/file.png"), true);
  assert.equal(fileHistoryMatchesPath(tab, "other/file.png"), false);
});

test("overlap requires the same revision and path identity", () => {
  const current = [
    revision("rename", "new/file.png", "old/file.png", "R100"),
    revision("add", "old/file.png", undefined, "A"),
  ];
  const historicalEntry = [
    revision("add", "old/file.png", undefined, "A"),
  ];
  const unrelatedSameCommit = [
    revision("add", "other/file.png", undefined, "A"),
  ];

  assert.equal(fileHistoriesOverlap(current, historicalEntry), true);
  assert.equal(fileHistoriesOverlap(current, unrelatedSameCommit), false);
});

test("requested file revision wins, otherwise selection starts newest", () => {
  const revisions = [
    revision("newest", "file.txt", undefined, "M"),
    revision("older", "file.txt", undefined, "A"),
  ];
  assert.equal(selectedFileRevisionHash(revisions, "older"), "older");
  assert.equal(selectedFileRevisionHash(revisions, "missing"), "newest");
  assert.equal(selectedFileRevisionHash([], "missing"), undefined);
});

function revision(
  hash: string,
  path: string,
  oldPath: string | undefined,
  status: string,
): FileRevision {
  return {
    commit: commit(hash),
    status,
    path,
    ...(oldPath === undefined ? {} : { oldPath }),
  };
}

function commit(hash: string): Commit {
  return {
    hash,
    shortHash: hash.slice(0, 8),
    parents: [],
    authorName: "File History Test",
    authorEmail: "test@example.invalid",
    authoredAt: "2026-08-02T00:00:00Z",
    committedAt: "2026-08-02T00:00:00Z",
    subject: hash,
    refs: [],
  };
}
