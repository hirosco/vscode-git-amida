export interface RepositoryInfo {
  root: string;
  name: string;
  branch: string;
  head: string;
  detached: boolean;
}

export interface Commit {
  hash: string;
  parents: string[];
  date: string;
  subject: string;
  refs: string;
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
