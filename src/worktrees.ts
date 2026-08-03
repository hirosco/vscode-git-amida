export interface GitWorktree {
  path: string;
  head?: string;
  branch?: string;
  detached: boolean;
  bare: boolean;
  prunable: boolean;
}

export function parseGitWorktrees(output: Buffer): GitWorktree[] {
  const worktrees: GitWorktree[] = [];
  for (const record of output.toString("utf8").split("\x00\x00")) {
    let path: string | undefined;
    let head: string | undefined;
    let branch: string | undefined;
    let detached = false;
    let bare = false;
    let prunable = false;
    for (const field of record.split("\x00")) {
      if (field.startsWith("worktree ")) {
        path = field.slice("worktree ".length);
      } else if (field.startsWith("HEAD ")) {
        head = field.slice("HEAD ".length);
      } else if (field.startsWith("branch refs/heads/")) {
        branch = field.slice("branch refs/heads/".length);
      } else if (field === "detached") {
        detached = true;
      } else if (field === "bare") {
        bare = true;
      } else if (field === "prunable" || field.startsWith("prunable ")) {
        prunable = true;
      }
    }
    if (path !== undefined) {
      worktrees.push({
        path,
        ...(head === undefined ? {} : { head }),
        ...(branch === undefined ? {} : { branch }),
        detached,
        bare,
        prunable,
      });
    }
  }
  return worktrees;
}
