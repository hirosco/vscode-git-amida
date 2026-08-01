import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_VIEW_PREFERENCES,
  mergeViewPreferences,
  restoreViewState,
  sanitizeViewPreferences,
} from "../src/viewState";

test("view preferences ignore navigation fields", () => {
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

test("restoreViewState migrates only legacy preferences", () => {
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
      preferences: {
        fileViewMode: "tree",
        historyRatio: 65,
        filesRatio: 60,
        detailsCollapsed: true,
      },
      migratePreferences: true,
      removeNavigation: false,
      removeLegacy: true,
    },
  );
});

test("restoreViewState prefers global preferences and removes saved navigation", () => {
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
      preferences: { ...DEFAULT_VIEW_PREFERENCES, historyRatio: 70 },
      migratePreferences: false,
      removeNavigation: true,
      removeLegacy: true,
    },
  );
});

test("restoreViewState starts transient navigation clean", () => {
  assert.deepEqual(
    restoreViewState(DEFAULT_VIEW_PREFERENCES, undefined, undefined),
    {
      preferences: DEFAULT_VIEW_PREFERENCES,
      migratePreferences: false,
      removeNavigation: false,
      removeLegacy: false,
    },
  );
});
