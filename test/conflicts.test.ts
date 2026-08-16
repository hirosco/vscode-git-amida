import assert from "node:assert/strict";
import test from "node:test";

import {
  conflictStatusLabel,
  conflictSupportsMergetool,
  parseUnmergedIndex,
  workingTreeConflictSummary,
} from "../src/conflicts";

test("parseUnmergedIndex derives every unmerged status from index stages", () => {
  const records = [
    record("both-added.txt", 2),
    record("both-added.txt", 3),
    record("added-us.txt", 2),
    record("both-deleted.txt", 1),
    record("deleted-us.txt", 1),
    record("deleted-us.txt", 3),
    record("added-them.txt", 3),
    record("deleted-them.txt", 1),
    record("deleted-them.txt", 2),
    record("both-modified.txt", 1),
    record("both-modified.txt", 2),
    record("both-modified.txt", 3),
  ];

  const conflicts = new Map(
    parseUnmergedIndex(Buffer.from(`${records.join("\x00")}\x00`)).map(
      (entry) => [entry.path, entry.conflict],
    ),
  );

  assert.deepEqual(
    [...conflicts].map(([path, conflict]) => [path, conflict.status]),
    [
      ["both-added.txt", "AA"],
      ["added-us.txt", "AU"],
      ["both-deleted.txt", "DD"],
      ["deleted-us.txt", "DU"],
      ["added-them.txt", "UA"],
      ["deleted-them.txt", "UD"],
      ["both-modified.txt", "UU"],
    ],
  );
  assert.equal(conflictStatusLabel({ status: "UU" }), "Both modified");
  assert.equal(conflictStatusLabel({ status: "UD" }), "Deleted by them");
  assert.equal(conflictSupportsMergetool({ status: "UU" }), true);
  assert.equal(conflictSupportsMergetool({ status: "AA" }), true);
  assert.equal(conflictSupportsMergetool({ status: "UD" }), false);
});

test("parseUnmergedIndex preserves spaces, tabs, and non-ASCII paths", () => {
  const path = "日本語 space\tname.txt";
  const parsed = parseUnmergedIndex(
    Buffer.from(`${record(path, 1)}\x00${record(path, 2)}\x00`),
  );

  assert.equal(parsed[0]?.path, path);
  assert.equal(parsed[0]?.conflict.status, "UD");
});

test("workingTreeConflictSummary labels known and unclassified conflicts", () => {
  const conflictedFile = {
    status: "U",
    path: "content.txt",
    conflict: { status: "UU" as const },
  };

  assert.equal(
    workingTreeConflictSummary({
      headHash: "head",
      files: [conflictedFile],
      operation: "cherry-pick",
    }),
    "Cherry-pick in progress · 1 conflict",
  );
  assert.equal(
    workingTreeConflictSummary({
      headHash: "head",
      files: [conflictedFile],
    }),
    "1 conflict",
  );
  assert.equal(
    workingTreeConflictSummary({
      headHash: "head",
      files: [],
      operation: "revert",
    }),
    "Revert in progress · 0 conflicts",
  );
  assert.equal(
    workingTreeConflictSummary({ headHash: "head", files: [] }),
    undefined,
  );
});

function record(path: string, stage: 1 | 2 | 3): string {
  return `100644 ${String(stage).repeat(40)} ${stage}\t${path}`;
}
