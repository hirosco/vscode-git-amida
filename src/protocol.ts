import type {
  ChangedFile,
  FileTreeNode,
  HistoryResult,
  RepositoryViewState,
  RepositoryViewStatePatch,
} from "./model";

export type HostToWebviewMessage =
  | { type: "historyLoading" }
  | (HistoryResult & {
      type: "history";
      selectedHash?: string;
      viewState: RepositoryViewState;
    })
  | { type: "filesLoading"; hash: string }
  | {
      type: "files";
      hash: string;
      files: ChangedFile[];
      tree: FileTreeNode[];
    }
  | { type: "filesError"; hash: string; message: string }
  | { type: "commitCopied"; hash: string }
  | { type: "error"; message: string };

export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "selectCommit"; hash: string }
  | { type: "selectFile"; hash: string; path: string }
  | { type: "openDiff"; hash: string; path: string }
  | { type: "copyCommitId"; hash: string }
  | { type: "updateViewState"; patch: RepositoryViewStatePatch };
