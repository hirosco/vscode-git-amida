import assert from "node:assert/strict";
import test from "node:test";

import type { Commit, CommitFileChange } from "../src/model";
import {
  buildSelectionFiles,
  resolveFileComparison,
} from "../src/selectionFiles";

test("resolveFileComparison keeps single and Range endpoints explicit", () => {
  const active = commit("tip", ["parent"]);

  assert.deepEqual(
    resolveFileComparison(
      { mode: "single", activeHash: "tip" },
      { status: "R100", path: "new.png", oldPath: "old.png" },
      active,
    ),
    {
      beforeRef: "parent",
      afterRef: "tip",
      beforePath: "old.png",
      afterPath: "new.png",
      status: "R100",
    },
  );
  assert.deepEqual(
    resolveFileComparison(
      {
        mode: "range",
        anchorHash: "old",
        activeHash: "tip",
        oldestHash: "old",
        newestHash: "tip",
        baseHash: "base",
        commitHashes: ["tip", "old"],
      },
      { status: "M", path: "image.png", content: { kind: "image" } },
      active,
    ),
    {
      beforeRef: "base",
      afterRef: "tip",
      beforePath: "image.png",
      afterPath: "image.png",
      status: "M",
      content: { kind: "image" },
    },
  );
});

test("resolveFileComparison uses the precomputed Selection endpoints", () => {
  const comparison = {
    beforeRef: "side-base",
    afterRef: "main-tip",
    beforePath: "shared.png",
    afterPath: "shared.png",
    status: "M",
  };
  assert.equal(
    resolveFileComparison(
      {
        mode: "selection",
        activeHash: "main-tip",
        commitHashes: ["main-tip", "side-tip"],
      },
      { status: "S", path: "shared.png" },
      commit("main-tip", ["main-base"]),
      comparison,
    ),
    comparison,
  );
});

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

test("buildSelectionFiles preserves image content for multiple selected changes", () => {
  const files = buildSelectionFiles(
    [
      {
        commitHash: "new",
        parentHash: "middle",
        status: "M",
        path: "image.svg",
        oldObject: "old-image",
        newObject: "new-image",
        content: { kind: "image", size: 200 },
      },
      {
        commitHash: "old",
        parentHash: "root",
        status: "M",
        path: "image.svg",
        oldObject: "root-image",
        newObject: "old-image",
        content: { kind: "image", size: 100 },
      },
    ],
    ["new", "old"],
  );

  assert.deepEqual(files[0]?.file.content, { kind: "image", size: 200 });
  assert.deepEqual(files[0]?.comparison.content, {
    kind: "image",
    size: 200,
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

function commit(hash: string, parents: string[]): Commit {
  return {
    hash,
    shortHash: hash,
    parents,
    authorName: "Test",
    authorEmail: "test@example.com",
    authoredAt: "2026-01-01T00:00:00Z",
    committedAt: "2026-01-01T00:00:00Z",
    subject: hash,
    refs: [],
  };
}
