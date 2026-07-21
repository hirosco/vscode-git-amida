import type { RepositoryViewState } from "./model";

export const DEFAULT_VIEW_STATE: RepositoryViewState = {
  fileViewMode: "flat",
  filesRatio: 65,
  detailsCollapsed: false,
  expandedTreePaths: [],
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
    filesRatio: sanitizeRatio(candidate.filesRatio),
    detailsCollapsed: candidate.detailsCollapsed === true,
    expandedTreePaths: Array.isArray(candidate.expandedTreePaths)
      ? candidate.expandedTreePaths
          .filter(
            (path): path is string =>
              typeof path === "string" && path.length > 0 && path.length <= 1_024,
          )
          .filter((path, index, paths) => paths.indexOf(path) === index)
          .slice(0, 500)
      : [],
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
    filesRatio: value.filesRatio ?? current.filesRatio,
    detailsCollapsed: value.detailsCollapsed ?? current.detailsCollapsed,
    expandedTreePaths: value.expandedTreePaths ?? current.expandedTreePaths,
  });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sanitizeRatio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_VIEW_STATE.filesRatio;
  }
  return Math.min(80, Math.max(30, Math.round(value / 5) * 5));
}
