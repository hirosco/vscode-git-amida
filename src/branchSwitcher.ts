import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 4 * 1024 * 1024;

interface GitCommandFailure extends Error {
  code?: string | number;
  stderr?: Buffer | string;
}

export interface WorktreeBranch {
  path: string;
  branch?: string;
}

export class BranchSwitchError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "BranchSwitchError";
  }
}

export class BranchMutationService {
  public async localBranchesAtCommit(
    repository: string,
    commitHash: string,
  ): Promise<string[]> {
    const [refsOutput, currentBranch] = await Promise.all([
      this.run(repository, [
        "for-each-ref",
        "--format=%(refname)%00%(objectname)%00",
        "refs/heads",
      ]),
      this.currentBranch(repository),
    ]);
    const branches: string[] = [];
    for (const rawLine of refsOutput.toString("utf8").split("\n")) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line.length === 0) {
        continue;
      }
      const [fullName = "", hash = ""] = line.split("\x00");
      if (!fullName.startsWith("refs/heads/") || hash !== commitHash) {
        continue;
      }
      const branch = fullName.slice("refs/heads/".length);
      if (branch !== currentBranch) {
        branches.push(branch);
      }
    }
    branches.sort((left, right) => left.localeCompare(right));
    return branches;
  }

  public async switchBranch(
    repository: string,
    branch: string,
    expectedHash: string,
    unsavedEditorPaths: string[],
  ): Promise<void> {
    const actualHash = await this.resolveLocalBranch(repository, branch);
    if (actualHash !== expectedHash) {
      throw new BranchSwitchError(
        `Branch "${branch}" no longer points at the selected commit. Refresh history and try again.`,
      );
    }
    if (unsavedEditorPaths.length > 0) {
      const noun = unsavedEditorPaths.length === 1 ? "editor" : "editors";
      throw new BranchSwitchError(
        `Save or close ${unsavedEditorPaths.length} modified ${noun} before switching branches.`,
      );
    }

    const operation = await this.inProgressOperation(repository);
    if (operation !== undefined) {
      throw new BranchSwitchError(
        `Cannot switch branches while ${operation} is in progress.`,
      );
    }

    const dirtyStates = await this.dirtyStates(repository);
    if (dirtyStates.length > 0) {
      throw new BranchSwitchError(
        `Cannot switch branches while the current worktree has ${joinReasons(dirtyStates)}.`,
      );
    }

    const occupiedPath = await this.occupiedWorktree(
      repository,
      branch,
    );
    if (occupiedPath !== undefined) {
      throw new BranchSwitchError(
        `Branch "${branch}" is already checked out in another worktree: ${occupiedPath}`,
      );
    }

    try {
      await this.run(repository, ["switch", "--", branch], 30_000);
    } catch (error) {
      throw new BranchSwitchError(commandMessage(error));
    }
  }

  private async currentBranch(repository: string): Promise<string | undefined> {
    try {
      const output = await this.run(repository, [
        "symbolic-ref",
        "--quiet",
        "--short",
        "HEAD",
      ]);
      return output.toString("utf8").trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private async resolveLocalBranch(
    repository: string,
    branch: string,
  ): Promise<string> {
    try {
      const output = await this.run(repository, [
        "show-ref",
        "--verify",
        "--hash",
        `refs/heads/${branch}`,
      ]);
      return output.toString("utf8").trim();
    } catch {
      throw new BranchSwitchError(
        `Local branch "${branch}" no longer exists. Refresh history and try again.`,
      );
    }
  }

  private async dirtyStates(repository: string): Promise<string[]> {
    const [staged, unstaged, untracked] = await Promise.all([
      this.run(repository, [
        "diff",
        "--cached",
        "--name-only",
        "-z",
        "--no-ext-diff",
        "--ignore-submodules=none",
        "--",
      ]),
      this.run(repository, [
        "diff",
        "--name-only",
        "-z",
        "--no-ext-diff",
        "--ignore-submodules=none",
        "--",
      ]),
      this.run(repository, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
      ]),
    ]);
    return [
      ...(staged.length === 0 ? [] : ["staged changes"]),
      ...(unstaged.length === 0 ? [] : ["unstaged changes"]),
      ...(untracked.length === 0 ? [] : ["untracked files"]),
    ];
  }

  private async inProgressOperation(
    repository: string,
  ): Promise<string | undefined> {
    const operations = [
      { name: "a merge", paths: ["MERGE_HEAD"] },
      { name: "a rebase", paths: ["rebase-merge", "rebase-apply"] },
      { name: "a cherry-pick", paths: ["CHERRY_PICK_HEAD"] },
      { name: "a revert", paths: ["REVERT_HEAD"] },
      { name: "a bisect", paths: ["BISECT_LOG", "BISECT_START"] },
      {
        name: "a cherry-pick or revert sequence",
        paths: ["sequencer"],
      },
    ];
    for (const operation of operations) {
      for (const path of operation.paths) {
        const gitPath = await this.gitPath(repository, path);
        if (await pathExists(gitPath)) {
          return operation.name;
        }
      }
    }
    return undefined;
  }

  private async occupiedWorktree(
    repository: string,
    branch: string,
  ): Promise<string | undefined> {
    const output = await this.run(repository, [
      "worktree",
      "list",
      "--porcelain",
      "-z",
    ]);
    const currentPath = resolve(repository);
    return parseWorktreeBranches(output).find(
      (worktree) =>
        worktree.branch === branch && resolve(worktree.path) !== currentPath,
    )?.path;
  }

  private async gitPath(repository: string, path: string): Promise<string> {
    const output = await this.run(repository, ["rev-parse", "--git-path", path]);
    const value = output.toString("utf8").trim();
    return isAbsolute(value) ? value : resolve(repository, value);
  }

  private async run(
    repository: string,
    args: string[],
    timeout = 15_000,
  ): Promise<Buffer> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        commandArgs(repository, args),
        {
          encoding: "buffer",
          maxBuffer: MAX_BUFFER,
          timeout,
          env: commandEnvironment(),
        },
      );
      return stdout;
    } catch (error) {
      throw new BranchSwitchError(commandMessage(error));
    }
  }
}

export function parseWorktreeBranches(output: Buffer): WorktreeBranch[] {
  const worktrees: WorktreeBranch[] = [];
  for (const record of output.toString("utf8").split("\x00\x00")) {
    let path: string | undefined;
    let branch: string | undefined;
    for (const field of record.split("\x00")) {
      if (field.startsWith("worktree ")) {
        path = field.slice("worktree ".length);
      } else if (field.startsWith("branch refs/heads/")) {
        branch = field.slice("branch refs/heads/".length);
      }
    }
    if (path !== undefined) {
      worktrees.push({ path, ...(branch === undefined ? {} : { branch }) });
    }
  }
  return worktrees;
}

function commandArgs(repository: string, args: string[]): string[] {
  return [
    "-C",
    repository,
    "--no-pager",
    "-c",
    "color.ui=false",
    "-c",
    "core.quotepath=false",
    "-c",
    "diff.external=",
    ...args,
  ];
}

function commandEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_PAGER: "cat",
    GIT_EXTERNAL_DIFF: "",
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    const details = error as NodeJS.ErrnoException;
    if (details.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function commandMessage(error: unknown): string {
  const details = error as GitCommandFailure;
  const stderr = Buffer.isBuffer(details.stderr)
    ? details.stderr.toString("utf8").trim()
    : String(details.stderr ?? "").trim();
  return stderr || details.message || "Git command failed.";
}

function joinReasons(reasons: string[]): string {
  if (reasons.length < 2) {
    return reasons[0] ?? "uncommitted changes";
  }
  if (reasons.length === 2) {
    return `${reasons[0]} and ${reasons[1]}`;
  }
  return `${reasons.slice(0, -1).join(", ")}, and ${reasons.at(-1)}`;
}
