import type {
  ChangedFile,
  FileHistoryTab,
  FileTreeNode,
  HistoryResult,
  RepositorySelection,
  RepositoryViewState,
  RepositoryViewStatePatch,
  WorkingTreeState,
} from "./model";

export type RepositoryStateKind =
  | "noWorkspace"
  | "notRepository"
  | "emptyRepository";

export type HostToWebviewMessage =
  | { type: "historyLoading" }
  | { type: "repositoryState"; state: RepositoryStateKind }
  | (HistoryResult & {
      type: "history";
      selection?: RepositorySelection;
      viewState: RepositoryViewState;
      workingTree?: WorkingTreeState;
    })
  | { type: "historyPageLoading" }
  | {
      type: "historyPage";
      rows: HistoryResult["rows"];
      graphLaneCount: number;
      hasMore: boolean;
    }
  | { type: "historyPageError"; message: string }
  | {
      type: "workingTree";
      workingTree: WorkingTreeState | undefined;
      selection?: RepositorySelection;
    }
  | { type: "workingTreeError"; message: string }
  | { type: "refreshError"; message: string }
  | { type: "filesLoading"; selection: RepositorySelection }
  | {
      type: "files";
      selection: RepositorySelection;
      files: ChangedFile[];
      tree: FileTreeNode[];
    }
  | {
      type: "filesError";
      selection: RepositorySelection;
      message: string;
    }
  | {
      type: "fileHistoryState";
      tabs: FileHistoryTab[];
      activeTabId?: string;
    }
  | { type: "revealRepositoryCommit"; hash: string }
  | { type: "error"; message: string };

export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "loadMoreHistory" }
  | { type: "selectWorkingTree" }
  | {
      type: "selectCommit";
      hash: string;
      extend: boolean;
      toggle: boolean;
    }
  | { type: "selectFile"; path: string }
  | { type: "openDiff"; path: string; preview: boolean }
  | { type: "activateRepositoryHistory" }
  | { type: "activateFileHistory"; tabId: string }
  | { type: "closeFileHistory"; tabId: string }
  | { type: "retryFileHistory"; tabId: string }
  | {
      type: "selectFileRevision";
      tabId: string;
      hash: string;
      preview: boolean;
    }
  | { type: "updateFileHistoryScroll"; tabId: string; scrollTop: number }
  | { type: "updateViewState"; patch: RepositoryViewStatePatch };
