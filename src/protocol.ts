import type {
  ChangedFile,
  FileTreeNode,
  HistoryResult,
  RepositorySelection,
  RepositoryViewState,
  RepositoryViewStatePatch,
} from "./model";

export type HostToWebviewMessage =
  | { type: "historyLoading" }
  | (HistoryResult & {
      type: "history";
      selection?: RepositorySelection;
      viewState: RepositoryViewState;
    })
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
      type: "selectionError";
      selection?: RepositorySelection;
      message: string;
    }
  | { type: "error"; message: string };

export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "selectCommit"; hash: string; extend: boolean }
  | { type: "selectFile"; path: string }
  | { type: "openDiff"; path: string }
  | { type: "updateViewState"; patch: RepositoryViewStatePatch };
