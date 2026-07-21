import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_VIEW_STATE,
  mergeViewState,
  sanitizeViewState,
} from "../src/viewState";

test("sanitizeViewState supplies safe defaults for untrusted state", () => {
  assert.deepEqual(sanitizeViewState(null), DEFAULT_VIEW_STATE);
  assert.deepEqual(
    sanitizeViewState({
      selectedHash: 12,
      fileViewMode: "unknown",
      historyRatio: 38,
      filesRatio: 94,
      detailsCollapsed: "yes",
      expandedTreePaths: ["src", 42],
    }),
    {
      fileViewMode: "flat",
      historyRatio: 45,
      filesRatio: 80,
      detailsCollapsed: false,
    },
  );
});

test("mergeViewState retains existing values and snaps the divider", () => {
  assert.deepEqual(
    mergeViewState(
      {
        ...DEFAULT_VIEW_STATE,
        selectedHash: "abc",
      },
      { fileViewMode: "tree", historyRatio: 63, filesRatio: 57 },
    ),
    {
      selectedHash: "abc",
      fileViewMode: "tree",
      historyRatio: 65,
      filesRatio: 55,
      detailsCollapsed: false,
    },
  );
});

test("mergeViewState ignores selection fields from a presentation patch", () => {
  assert.deepEqual(
    mergeViewState(
      { ...DEFAULT_VIEW_STATE, selectedHash: "trusted" },
      { selectedHash: "untrusted", selectedFilePath: "outside.txt" },
    ),
    { ...DEFAULT_VIEW_STATE, selectedHash: "trusted" },
  );
});

test("mergeViewState can expand details after they were collapsed", () => {
  const collapsed = mergeViewState(DEFAULT_VIEW_STATE, {
    detailsCollapsed: true,
  });
  assert.equal(collapsed.detailsCollapsed, true);

  const expanded = mergeViewState(collapsed, { detailsCollapsed: false });
  assert.equal(expanded.detailsCollapsed, false);
});
