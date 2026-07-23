import type {
  ChangedFile,
  FileTreeNode,
  HistoryResult,
  RepositorySelection,
  RepositoryViewState,
  RepositoryViewStatePatch,
  WorkingTreeState,
} from "./model";

export type HostToWebviewMessage =
  | { type: "historyLoading" }
  | (HistoryResult & {
      type: "history";
      selection?: RepositorySelection;
      viewState: RepositoryViewState;
      workingTree?: WorkingTreeState;
    })
  | {
      type: "workingTree";
      workingTree: WorkingTreeState | undefined;
      selection?: RepositorySelection;
    }
  | { type: "workingTreeError"; message: string }
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
  | { type: "error"; message: string };

export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "selectWorkingTree" }
  | {
      type: "selectCommit";
      hash: string;
      extend: boolean;
      toggle: boolean;
    }
  | { type: "selectFile"; path: string }
  | { type: "openDiff"; path: string }
  | { type: "updateViewState"; patch: RepositoryViewStatePatch };
