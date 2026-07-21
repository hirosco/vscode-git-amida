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

export interface GraphLine {
  fromLane: number;
  from: "top" | "node";
  toLane: number;
  to: "node" | "bottom";
  color: number;
}

export interface CommitGraph {
  nodeLane: number;
  nodeColor: number;
  lines: GraphLine[];
}

export interface HistoryRow {
  graph: CommitGraph;
  commit: Commit;
}

export interface ChangedFile {
  status: string;
  path: string;
  oldPath?: string;
}

export interface HistoryResult {
  repository: RepositoryInfo;
  rows: HistoryRow[];
  graphLaneCount: number;
}

export type FileViewMode = "flat" | "tree";

export interface RepositoryNavigationState {
  selectedHash?: string;
  selectedFilePath?: string;
}

export interface RepositoryViewPreferences {
  fileViewMode: FileViewMode;
  historyRatio: number;
  filesRatio: number;
  detailsCollapsed: boolean;
}

export interface RepositoryViewState
  extends RepositoryNavigationState,
    RepositoryViewPreferences {}

export type RepositoryViewStatePatch = Partial<
  RepositoryViewPreferences
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
