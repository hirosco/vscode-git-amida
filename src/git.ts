import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";

import { buildHistoryGraph } from "./graph";
import type {
  ChangedFile,
  Commit,
  CommitRef,
  HistoryResult,
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
    const [headOutput, branchResult, logOutput, refsOutput] = await Promise.all([
      this.run(root, ["rev-parse", "HEAD"]),
      this.tryRun(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
      this.run(root, [
        "log",
        "--branches",
        "--remotes",
        "--tags",
        "--topo-order",
        "--color=never",
        "--no-decorate",
        `--format=${RECORD_MARKER}%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%s%x00`,
      ]),
      this.run(root, [
        "for-each-ref",
        `--format=${RECORD_MARKER}%(objectname)%00%(*objectname)%00%(refname)%00%(HEAD)%00%(upstream:short)%00%(upstream:trackshort)%00`,
        "refs/heads",
        "refs/remotes",
        "refs/tags",
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

    const graph = buildHistoryGraph(
      parseHistory(
        logOutput.toString("utf8"),
        parseRefs(refsOutput.toString("utf8")),
      ),
    );
    return { repository, rows: graph.rows, graphLaneCount: graph.laneCount };
  }

  public async changedFiles(
    repository: string,
    commit: Commit,
  ): Promise<ChangedFile[]> {
    const rootParent = commit.parents[0] ?? EMPTY_TREE;
    const output = await this.run(repository, [
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

  public async readBlob(
    repository: string,
    ref: string | undefined,
    path: string,
  ): Promise<Buffer> {
    if (ref === undefined) {
      return Buffer.alloc(0);
    }
    return this.run(repository, ["cat-file", "blob", `${ref}:${path}`]);
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

export function parseHistory(
  output: string,
  refsByCommit: ReadonlyMap<string, CommitRef[]> = new Map(),
): Commit[] {
  const commits: Commit[] = [];

  for (const rawLine of output.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) {
      continue;
    }

    const markerIndex = line.indexOf(RECORD_MARKER);
    if (markerIndex === -1) {
      continue;
    }

    const fields = line.slice(markerIndex + 1).split("\x00");
    const [
      hash,
      shortHash = "",
      parents = "",
      authorName = "",
      authorEmail = "",
      authoredAt = "",
      committedAt = "",
      subject = "",
    ] = fields;
    if (!hash) {
      continue;
    }

    commits.push({
      hash,
      shortHash,
      parents: parents.length > 0 ? parents.split(" ") : [],
      authorName,
      authorEmail,
      authoredAt,
      committedAt,
      subject,
      refs: refsByCommit.get(hash) ?? [],
    });
  }

  return commits;
}

export function parseRefs(output: string): Map<string, CommitRef[]> {
  const refsByCommit = new Map<string, CommitRef[]>();

  for (const rawRecord of output.split(RECORD_MARKER)) {
    const record = rawRecord.replace(/\r?\n$/, "");
    if (record.length === 0) {
      continue;
    }
    const [
      objectHash,
      peeledHash = "",
      fullName = "",
      head = "",
      upstream = "",
      tracking = "",
    ] = record.split("\x00");
    const targetHash = peeledHash || objectHash;
    const identity = parseRefIdentity(fullName);
    if (!targetHash || identity === undefined) {
      continue;
    }
    const ref: CommitRef = {
      ...identity,
      fullName,
      current: head.trim() === "*",
      ...(upstream.length === 0 ? {} : { upstream }),
      ...(tracking.length === 0 ? {} : { tracking }),
    };
    const refs = refsByCommit.get(targetHash) ?? [];
    refs.push(ref);
    refsByCommit.set(targetHash, refs);
  }

  for (const refs of refsByCommit.values()) {
    refs.sort(compareRefs);
  }
  return refsByCommit;
}

function parseRefIdentity(
  fullName: string,
): Pick<CommitRef, "name" | "type"> | undefined {
  if (fullName.startsWith("refs/heads/")) {
    return { name: fullName.slice("refs/heads/".length), type: "localBranch" };
  }
  if (fullName.startsWith("refs/remotes/")) {
    return {
      name: fullName.slice("refs/remotes/".length),
      type: "remoteBranch",
    };
  }
  if (fullName.startsWith("refs/tags/")) {
    return { name: fullName.slice("refs/tags/".length), type: "tag" };
  }
  return undefined;
}

function compareRefs(left: CommitRef, right: CommitRef): number {
  if (left.current !== right.current) {
    return left.current ? -1 : 1;
  }
  const order = { localBranch: 0, remoteBranch: 1, tag: 2 } as const;
  return order[left.type] - order[right.type] || left.name.localeCompare(right.name);
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
