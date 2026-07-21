import assert from "node:assert/strict";
import test from "node:test";

import type { CommitFileChange } from "../src/model";
import {
  buildSelectionFiles,
  comparisonForChange,
} from "../src/selectionFiles";

test("buildSelectionFiles keeps unrelated same-path changes separate", () => {
  const states = buildSelectionFiles(
    [
      change("main", "root", "M", "shared.txt", "base", "main"),
      change("side", "root", "M", "shared.txt", "base", "side"),
      change("side", "root", "A", "side-only.txt", "0", "added"),
    ],
    ["main", "side"],
  );

  const shared = states.find((state) => state.file.path === "shared.txt");
  assert.ok(shared);
  assert.equal(shared.combined, undefined);
  assert.deepEqual(shared.file.selection, {
    changes: [
      { commitHash: "main", status: "M" },
      { commitHash: "side", status: "M" },
    ],
    combined: false,
  });
  assert.deepEqual(
    states.map((state) => state.file.path),
    ["shared.txt", "side-only.txt"],
  );
});

test("buildSelectionFiles combines an exact file revision chain", () => {
  const states = buildSelectionFiles(
    [
      change("newest", "middle-parent", "M", "file.txt", "middle", "new"),
      change("oldest", "base", "M", "file.txt", "old", "middle"),
    ],
    ["newest", "oldest"],
  );

  assert.deepEqual(states[0]?.combined, {
    beforeRef: "base",
    afterRef: "newest",
    beforePath: "file.txt",
    afterPath: "file.txt",
    status: "M",
  });
  assert.equal(states[0]?.file.selection?.combined, true);
});

test("buildSelectionFiles does not combine a hidden same-file gap", () => {
  const states = buildSelectionFiles(
    [
      change("newest", "omitted", "M", "file.txt", "hidden", "new"),
      change("oldest", "base", "M", "file.txt", "old", "middle"),
    ],
    ["newest", "oldest"],
  );
  assert.equal(states[0]?.combined, undefined);
  assert.equal(states[0]?.file.selection?.combined, false);
});

test("buildSelectionFiles follows renames and avoids an empty combined diff", () => {
  const rename = change("rename", "base", "R100", "new.txt", "old", "same");
  rename.oldPath = "old.txt";
  const revert = change("revert", "rename", "R100", "old.txt", "same", "old");
  revert.oldPath = "new.txt";
  const states = buildSelectionFiles([revert, rename], ["revert", "rename"]);

  assert.equal(states.length, 1);
  assert.equal(states[0]?.combined, undefined);
  assert.deepEqual(comparisonForChange(rename), {
    beforeRef: "base",
    afterRef: "rename",
    beforePath: "old.txt",
    afterPath: "new.txt",
    status: "R100",
  });
});

function change(
  commitHash: string,
  parentHash: string,
  status: string,
  path: string,
  oldObject: string,
  newObject: string,
): CommitFileChange {
  return {
    commitHash,
    parentHash,
    status,
    path,
    oldObject,
    newObject,
  };
}
