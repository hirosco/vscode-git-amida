import type {
  RepositoryNavigationState,
  RepositoryViewPreferences,
} from "./model";

export const DEFAULT_VIEW_PREFERENCES: RepositoryViewPreferences = {
  fileViewMode: "flat",
  historyRatio: 55,
  filesRatio: 65,
  detailsCollapsed: false,
};

export interface RestoredViewState {
  navigation: RepositoryNavigationState;
  preferences: RepositoryViewPreferences;
  migrateNavigation: boolean;
  migratePreferences: boolean;
  removeLegacy: boolean;
}

export function restoreViewState(
  preferencesValue: unknown,
  navigationValue: unknown,
  legacyValue: unknown,
): RestoredViewState {
  const hasPreferences = preferencesValue !== undefined;
  const hasNavigation = navigationValue !== undefined;
  const hasLegacy = legacyValue !== undefined;
  return {
    preferences: sanitizeViewPreferences(
      hasPreferences ? preferencesValue : legacyValue,
    ),
    navigation: sanitizeNavigationState(
      hasNavigation ? navigationValue : legacyValue,
    ),
    migratePreferences: hasLegacy && !hasPreferences,
    migrateNavigation: hasLegacy && !hasNavigation,
    removeLegacy: hasLegacy,
  };
}

export function sanitizeViewPreferences(
  value: unknown,
): RepositoryViewPreferences {
  if (value === null || typeof value !== "object") {
    return { ...DEFAULT_VIEW_PREFERENCES };
  }

  const candidate = value as Record<string, unknown>;
  return {
    fileViewMode: candidate.fileViewMode === "tree" ? "tree" : "flat",
    historyRatio: sanitizeRatio(candidate.historyRatio, 45, 70, 55),
    filesRatio: sanitizeRatio(candidate.filesRatio, 30, 80, 65),
    detailsCollapsed: candidate.detailsCollapsed === true,
  };
}

export function sanitizeNavigationState(
  value: unknown,
): RepositoryNavigationState {
  if (value === null || typeof value !== "object") {
    return {};
  }

  const candidate = value as Record<string, unknown>;
  const selectedHash = optionalString(candidate.selectedHash);
  const rangeAnchorHash = optionalString(candidate.rangeAnchorHash);
  const selectionHashes = optionalStringArray(candidate.selectionHashes);
  const selectedFilePath = optionalString(candidate.selectedFilePath);
  return {
    ...(selectedHash === undefined ? {} : { selectedHash }),
    ...(rangeAnchorHash === undefined ? {} : { rangeAnchorHash }),
    ...(selectionHashes === undefined ? {} : { selectionHashes }),
    ...(selectedFilePath === undefined ? {} : { selectedFilePath }),
  };
}

export function mergeViewPreferences(
  current: RepositoryViewPreferences,
  patch: unknown,
): RepositoryViewPreferences {
  if (patch === null || typeof patch !== "object") {
    return current;
  }
  const value = patch as Record<string, unknown>;
  return sanitizeViewPreferences({
    ...current,
    fileViewMode: value.fileViewMode ?? current.fileViewMode,
    historyRatio: value.historyRatio ?? current.historyRatio,
    filesRatio: value.filesRatio ?? current.filesRatio,
    detailsCollapsed: value.detailsCollapsed ?? current.detailsCollapsed,
  });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  const unique = [...new Set(strings)];
  return unique.length > 1 ? unique : undefined;
}

function sanitizeRatio(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(value / 5) * 5));
}
