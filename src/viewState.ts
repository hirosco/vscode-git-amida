import type { RepositoryViewState } from "./model";

export const DEFAULT_VIEW_STATE: RepositoryViewState = {
  fileViewMode: "flat",
  historyRatio: 55,
  filesRatio: 65,
  detailsCollapsed: false,
};

export function sanitizeViewState(value: unknown): RepositoryViewState {
  if (value === null || typeof value !== "object") {
    return { ...DEFAULT_VIEW_STATE };
  }

  const candidate = value as Record<string, unknown>;
  const selectedHash = optionalString(candidate.selectedHash);
  const selectedFilePath = optionalString(candidate.selectedFilePath);
  return {
    ...(selectedHash === undefined ? {} : { selectedHash }),
    ...(selectedFilePath === undefined ? {} : { selectedFilePath }),
    fileViewMode: candidate.fileViewMode === "tree" ? "tree" : "flat",
    historyRatio: sanitizeRatio(candidate.historyRatio, 45, 70, 55),
    filesRatio: sanitizeRatio(candidate.filesRatio, 30, 80, 65),
    detailsCollapsed: candidate.detailsCollapsed === true,
  };
}

export function mergeViewState(
  current: RepositoryViewState,
  patch: unknown,
): RepositoryViewState {
  if (patch === null || typeof patch !== "object") {
    return current;
  }
  const value = patch as Record<string, unknown>;
  return sanitizeViewState({
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
