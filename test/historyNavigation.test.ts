import assert from "node:assert/strict";
import test from "node:test";

import { ensureHistoryCommitLoaded } from "../src/historyNavigation";

test("ensureHistoryCommitLoaded stops after the target page", async () => {
  const commits = new Set(["newest"]);
  const pages = [["middle"], ["target"], ["oldest"]];
  let loads = 0;

  const found = await ensureHistoryCommitLoaded("target", {
    hasCommit: (hash) => commits.has(hash),
    hasMore: () => pages.length > 0,
    loadNextPage: async () => {
      loads += 1;
      for (const hash of pages.shift() ?? []) {
        commits.add(hash);
      }
      return true;
    },
  });

  assert.equal(found, true);
  assert.equal(loads, 2);
  assert.deepEqual([...pages], [["oldest"]]);
});

test("ensureHistoryCommitLoaded does not page for a loaded commit", async () => {
  let loads = 0;

  const found = await ensureHistoryCommitLoaded("target", {
    hasCommit: (hash) => hash === "target",
    hasMore: () => true,
    loadNextPage: async () => {
      loads += 1;
      return true;
    },
  });

  assert.equal(found, true);
  assert.equal(loads, 0);
});

test("ensureHistoryCommitLoaded stops when a page cannot advance", async () => {
  let loads = 0;

  const found = await ensureHistoryCommitLoaded("missing", {
    hasCommit: () => false,
    hasMore: () => true,
    loadNextPage: async () => {
      loads += 1;
      return false;
    },
  });

  assert.equal(found, false);
  assert.equal(loads, 1);
});
