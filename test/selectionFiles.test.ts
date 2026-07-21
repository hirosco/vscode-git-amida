import assert from "node:assert/strict";
import test from "node:test";

import type { CommitFileChange } from "../src/model";
import { buildSelectionFiles } from "../src/selectionFiles";

test("buildSelectionFiles compares unrelated same-path changes by selection endpoints", () => {
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
  assert.deepEqual(shared.comparison, {
    beforeRef: "root",
    afterRef: "main",
    beforePath: "shared.txt",
    afterPath: "shared.txt",
    status: "M",
  });
  assert.deepEqual(shared.file.selection, {
    changes: [
      { commitHash: "main", status: "M" },
      { commitHash: "side", status: "M" },
    ],
    beforeRef: "root",
    afterRef: "main",
  });
  assert.deepEqual(
    states.map((state) => state.file.path),
    ["shared.txt", "side-only.txt"],
  );
});

test("buildSelectionFiles compares the oldest before-state with the newest after-state", () => {
  const states = buildSelectionFiles(
    [
      change("newest", "middle-parent", "M", "file.txt", "middle", "new"),
      change("oldest", "base", "M", "file.txt", "old", "middle"),
    ],
    ["newest", "oldest"],
  );

  assert.deepEqual(states[0]?.comparison, {
    beforeRef: "base",
    afterRef: "newest",
    beforePath: "file.txt",
    afterPath: "file.txt",
    status: "M",
  });
});

test("buildSelectionFiles spans a hidden same-file gap", () => {
  const states = buildSelectionFiles(
    [
      change("newest", "omitted", "M", "file.txt", "hidden", "new"),
      change("oldest", "base", "M", "file.txt", "old", "middle"),
    ],
    ["newest", "oldest"],
  );
  assert.deepEqual(states[0]?.comparison, {
    beforeRef: "base",
    afterRef: "newest",
    beforePath: "file.txt",
    afterPath: "file.txt",
    status: "M",
  });
});

test("buildSelectionFiles follows endpoint paths through selected renames", () => {
  const rename = change("rename", "base", "R100", "new.txt", "old", "same");
  rename.oldPath = "old.txt";
  const revert = change("revert", "rename", "R100", "old.txt", "same", "old");
  revert.oldPath = "new.txt";
  const states = buildSelectionFiles([revert, rename], ["revert", "rename"]);

  assert.equal(states.length, 1);
  assert.deepEqual(states[0]?.comparison, {
    beforeRef: "base",
    afterRef: "revert",
    beforePath: "old.txt",
    afterPath: "old.txt",
    status: "M",
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
