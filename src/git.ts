import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";

import type {
  ChangedFile,
  Commit,
  HistoryResult,
  HistoryRow,
  RepositoryInfo,
} from "./model";

const execFileAsync = promisify(execFile);
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const RECORD_MARKER = "\x1e";
const MAX_BUFFER = 16 * 1024 * 1024;

export class GitError extends Error {
  public constructor(
    message: string,
    public readonly stderr = "",
    public readonly exitCode?: number,
  ) {
    super(message);
    this.name = "GitError";
  }
}
export class GitClient {
  public async resolveRepository(candidate: string): Promise<string> {
    const output = await this.run(candidate, ["rev-parse", "--show-toplevel"]);
    return output.toString("utf8").trim();
  }

  public async loadHistory(candidate: string): Promise<HistoryResult> {
    const root = await this.resolveRepository(candidate);
    const [headOutput, branchResult, logOutput] = await Promise.all([
      this.run(root, ["rev-parse", "--short=12", "HEAD"]),
      this.tryRun(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
      this.run(root, [
        "log",
        "--graph",
        "--topo-order",
        "--decorate=short",
        "--date=short",
        "--max-count=100",
        `--format=${RECORD_MARKER}%H%x00%P%x00%ad%x00%s%x00%D%x00`,
      ]),
    ]);

    const head = headOutput.toString("utf8").trim();
    const branch = branchResult.ok
      ? branchResult.output.toString("utf8").trim()
      : `detached at ${head}`;
    const repository: RepositoryInfo = {
      root,
      name: basename(root),
      branch,
      head,
      detached: !branchResult.ok,
    };

    return {
      repository,
      rows: parseHistory(logOutput.toString("utf8")),
    };
  }

  public async changedFiles(commit: Commit): Promise<ChangedFile[]> {
    const rootParent = commit.parents[0] ?? EMPTY_TREE;
    const output = await this.runForRepository([
      "diff",
      "--name-status",
      "--no-ext-diff",
      "-z",
      "-M",
      rootParent,
      commit.hash,
      "--",
    ]);
    return parseNameStatus(output);
  }

  public async readBlob(ref: string | undefined, path: string): Promise<Buffer> {
    if (ref === undefined) {
      return Buffer.alloc(0);
    }
    return this.runForRepository(["cat-file", "blob", `${ref}:${path}`]);
  }

  public setRepository(root: string): void {
    this.repository = root;
  }

  private repository?: string;

  private async runForRepository(args: string[]): Promise<Buffer> {
    if (this.repository === undefined) {
      throw new GitError("No Git repository is active.");
    }
    return this.run(this.repository, args);
  }

  private async tryRun(
    directory: string,
    args: string[],
  ): Promise<{ ok: true; output: Buffer } | { ok: false }> {
    try {
      return { ok: true, output: await this.run(directory, args) };
    } catch (error) {
      if (error instanceof GitError) {
        return { ok: false };
      }
      throw error;
    }
  }

  private async run(directory: string, args: string[]): Promise<Buffer> {
    const gitArgs = [
      "-C",
      directory,
      "--no-pager",
      "-c",
      "color.ui=false",
      "-c",
      "core.quotepath=false",
      "-c",
      "diff.external=",
      ...args,
    ];

    try {
      const { stdout } = await execFileAsync("git", gitArgs, {
        encoding: "buffer",
        maxBuffer: MAX_BUFFER,
        timeout: 15_000,
        env: {
          ...process.env,
          GIT_PAGER: "cat",
          GIT_EXTERNAL_DIFF: "",
        },
      });
      return stdout;
    } catch (error) {
      const details = error as NodeJS.ErrnoException & {
        code?: string | number;
        stderr?: Buffer | string;
      };
      const stderr = Buffer.isBuffer(details.stderr)
        ? details.stderr.toString("utf8").trim()
        : String(details.stderr ?? "").trim();
      const exitCode =
        typeof details.code === "number" ? details.code : undefined;
      const reason = stderr || details.message || "Git command failed.";
      throw new GitError(reason, stderr, exitCode);
    }
  }
}

export function parseHistory(output: string): HistoryRow[] {
  const rows: HistoryRow[] = [];

  for (const rawLine of output.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) {
      continue;
    }

    const markerIndex = line.indexOf(RECORD_MARKER);
    if (markerIndex === -1) {
      rows.push({ kind: "graph", graph: line });
      continue;
    }

    const graph = line.slice(0, markerIndex);
    const fields = line.slice(markerIndex + 1).split("\x00");
    const [hash, parents = "", date = "", subject = "", refs = ""] = fields;
    if (!hash) {
      continue;
    }

    rows.push({
      kind: "commit",
      graph,
      commit: {
        hash,
        parents: parents.length > 0 ? parents.split(" ") : [],
        date,
        subject,
        refs,
      },
    });
  }

  return rows;
}

export function parseNameStatus(output: Buffer): ChangedFile[] {
  const fields = output.toString("utf8").split("\x00");
  const files: ChangedFile[] = [];

  for (let index = 0; index < fields.length; ) {
    const status = fields[index++];
    if (!status) {
      break;
    }

    if (status.startsWith("R") || status.startsWith("C")) {
      const oldPath = fields[index++];
      const path = fields[index++];
      if (oldPath !== undefined && path !== undefined) {
        files.push({ status, oldPath, path });
      }
      continue;
    }

    const path = fields[index++];
    if (path !== undefined) {
      files.push({ status, path });
    }
  }

  return files;
}
