export interface RepositoryInfo {
  root: string;
  name: string;
  branch: string;
  head: string;
  detached: boolean;
}

export interface Commit {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  committedAt: string;
  subject: string;
  refs: CommitRef[];
}

export type RefType = "localBranch" | "remoteBranch" | "tag";

export interface CommitRef {
  name: string;
  fullName: string;
  type: RefType;
  current: boolean;
  upstream?: string;
  tracking?: string;
}

export type HistoryRow =
  | { kind: "commit"; graph: string; commit: Commit }
  | { kind: "graph"; graph: string };

export interface ChangedFile {
  status: string;
  path: string;
  oldPath?: string;
}

export interface HistoryResult {
  repository: RepositoryInfo;
  rows: HistoryRow[];
}

export type FileViewMode = "flat" | "tree";

export interface RepositoryViewState {
  selectedHash?: string;
  selectedFilePath?: string;
  fileViewMode: FileViewMode;
  historyRatio: number;
  filesRatio: number;
  detailsCollapsed: boolean;
}

export type RepositoryViewStatePatch = Partial<
  Pick<
    RepositoryViewState,
    "fileViewMode" | "historyRatio" | "filesRatio" | "detailsCollapsed"
  >
>;

export interface FileTreeDirectory {
  kind: "directory";
  name: string;
  path: string;
  children: FileTreeNode[];
}

export interface FileTreeEntry {
  kind: "file";
  name: string;
  path: string;
  file: ChangedFile;
}

export type FileTreeNode = FileTreeDirectory | FileTreeEntry;
