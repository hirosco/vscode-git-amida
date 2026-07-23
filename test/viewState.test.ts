import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_VIEW_PREFERENCES,
  mergeViewPreferences,
  restoreViewState,
  sanitizeNavigationState,
  sanitizeViewPreferences,
} from "../src/viewState";

test("view preferences and navigation state sanitize independently", () => {
  assert.deepEqual(sanitizeViewPreferences(null), DEFAULT_VIEW_PREFERENCES);
  assert.deepEqual(
    sanitizeViewPreferences({
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
  assert.deepEqual(
    sanitizeNavigationState({
      selectedWorkingTree: true,
      selectedHash: "abc",
      rangeAnchorHash: "def",
      selectionHashes: ["abc", "ghi", "abc", 42],
      selectedFilePath: "src/file.ts",
      fileViewMode: "tree",
    }),
    {
      selectedWorkingTree: true,
      selectedHash: "abc",
      selectionAnchorHash: "def",
      selectionHashes: ["abc", "ghi"],
      selectedFilePath: "src/file.ts",
    },
  );
  assert.deepEqual(
    sanitizeNavigationState({
      selectedWorkingTree: false,
      selectedHash: 12,
      selectedFilePath: "",
    }),
    {},
  );
});

test("navigation state migrates the legacy Range anchor field", () => {
  assert.deepEqual(
    sanitizeNavigationState({
      selectedHash: "active",
      rangeAnchorHash: "legacy-anchor",
      selectionHashes: ["active", "legacy-anchor"],
    }),
    {
      selectedHash: "active",
      selectionAnchorHash: "legacy-anchor",
      selectionHashes: ["active", "legacy-anchor"],
    },
  );
});

test("mergeViewPreferences retains existing values and snaps the divider", () => {
  assert.deepEqual(
    mergeViewPreferences(
      DEFAULT_VIEW_PREFERENCES,
      { fileViewMode: "tree", historyRatio: 63, filesRatio: 57 },
    ),
    {
      fileViewMode: "tree",
      historyRatio: 65,
      filesRatio: 55,
      detailsCollapsed: false,
    },
  );
});

test("mergeViewPreferences ignores navigation fields", () => {
  assert.deepEqual(
    mergeViewPreferences(
      DEFAULT_VIEW_PREFERENCES,
      { selectedHash: "untrusted", selectedFilePath: "outside.txt" },
    ),
    DEFAULT_VIEW_PREFERENCES,
  );
});

test("mergeViewPreferences can expand details after they were collapsed", () => {
  const collapsed = mergeViewPreferences(DEFAULT_VIEW_PREFERENCES, {
    detailsCollapsed: true,
  });
  assert.equal(collapsed.detailsCollapsed, true);

  const expanded = mergeViewPreferences(collapsed, {
    detailsCollapsed: false,
  });
  assert.equal(expanded.detailsCollapsed, false);
});

test("restoreViewState migrates the legacy workspace value into split state", () => {
  assert.deepEqual(
    restoreViewState(undefined, undefined, {
      selectedHash: "legacy",
      selectedFilePath: "legacy.txt",
      fileViewMode: "tree",
      historyRatio: 64,
      filesRatio: 58,
      detailsCollapsed: true,
    }),
    {
      navigation: {
        selectedHash: "legacy",
        selectedFilePath: "legacy.txt",
      },
      preferences: {
        fileViewMode: "tree",
        historyRatio: 65,
        filesRatio: 60,
        detailsCollapsed: true,
      },
      migrateNavigation: true,
      migratePreferences: true,
      removeLegacy: true,
    },
  );
});

test("restoreViewState prefers established global and workspace values", () => {
  assert.deepEqual(
    restoreViewState(
      { ...DEFAULT_VIEW_PREFERENCES, historyRatio: 70 },
      { selectedHash: "current" },
      {
        selectedHash: "legacy",
        fileViewMode: "tree",
        historyRatio: 45,
      },
    ),
    {
      navigation: { selectedHash: "current" },
      preferences: { ...DEFAULT_VIEW_PREFERENCES, historyRatio: 70 },
      migrateNavigation: false,
      migratePreferences: false,
      removeLegacy: true,
    },
  );
});
