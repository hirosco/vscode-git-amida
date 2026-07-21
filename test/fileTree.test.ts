import assert from "node:assert/strict";
import test from "node:test";

import { buildFileTree } from "../src/fileTree";

test("buildFileTree groups directories before files and preserves file data", () => {
  const tree = buildFileTree([
    { status: "M", path: "README.md" },
    { status: "A", path: "src/zeta.ts" },
    { status: "R100", oldPath: "old.ts", path: "src/alpha.ts" },
    { status: "D", path: "docs/guide/start.md" },
  ]);

  assert.deepEqual(tree, [
    {
      kind: "directory",
      name: "docs",
      path: "docs",
      children: [
        {
          kind: "directory",
          name: "guide",
          path: "docs/guide",
          children: [
            {
              kind: "file",
              name: "start.md",
              path: "docs/guide/start.md",
              file: { status: "D", path: "docs/guide/start.md" },
            },
          ],
        },
      ],
    },
    {
      kind: "directory",
      name: "src",
      path: "src",
      children: [
        {
          kind: "file",
          name: "alpha.ts",
          path: "src/alpha.ts",
          file: { status: "R100", oldPath: "old.ts", path: "src/alpha.ts" },
        },
        {
          kind: "file",
          name: "zeta.ts",
          path: "src/zeta.ts",
          file: { status: "A", path: "src/zeta.ts" },
        },
      ],
    },
    {
      kind: "file",
      name: "README.md",
      path: "README.md",
      file: { status: "M", path: "README.md" },
    },
  ]);
});
