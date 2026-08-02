export interface HistoryCommitLoader {
  hasCommit(hash: string): boolean;
  hasMore(): boolean;
  loadNextPage(): Promise<boolean>;
}

export async function ensureHistoryCommitLoaded(
  hash: string,
  loader: HistoryCommitLoader,
): Promise<boolean> {
  while (!loader.hasCommit(hash) && loader.hasMore()) {
    if (!(await loader.loadNextPage())) {
      break;
    }
  }
  return loader.hasCommit(hash);
}
