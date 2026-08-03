import { execFile } from "node:child_process";
import { lstat, open, readFile, readlink } from "node:fs/promises";
import {
  basename,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";

import { buildHistoryGraph, type HistoryGraphState } from "./graph";
import type {
  ChangedFile,
  Commit,
  CommitFileChange,
  CommitRef,
  CommitWorktree,
  FileRevision,
  HistoryResult,
  RepositoryInfo,
  WorkingTreeState,
} from "./model";
import { parseGitWorktrees, type GitWorktree } from "./worktrees";

const execFileAsync = promisify(execFile);
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const RECORD_MARKER = "\x1e";
const MAX_BUFFER = 16 * 1024 * 1024;
const HISTORY_REFS_FORMAT =
  `${RECORD_MARKER}%(objectname)%00%(*objectname)%00%(refname)%00` +
  "%(HEAD)%00%(upstream:short)%00%(upstream:trackshort)%00%(symref)%00";
const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".ico",
  ".jpe",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);
export const HISTORY_PAGE_SIZE = 100;

export interface HistoryCursor {
  readonly repository: string;
  readonly historyFingerprint: string;
  readonly refsByCommit: ReadonlyMap<string, CommitRef[]>;
  readonly worktreesByCommit: ReadonlyMap<string, CommitWorktree[]>;
  readonly worktreeHeads: readonly string[];
  readonly offset: number;
  readonly pageSize: number;
}

export interface HistoryPage {
  commits: Commit[];
  cursor: HistoryCursor;
  hasMore: boolean;
}

export interface RawDiffEntry extends ChangedFile {
  oldMode: string;
  newMode: string;
  oldObject: string;
  newObject: string;
}

interface ObjectInfo {
  type: string;
  size: number;
}

interface WorkingFileInfo {
  size: number;
  binary: boolean;
}

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

export class HistoryChangedError extends GitError {
  public constructor() {
    super("Repository history changed while more commits were loading.");
    this.name = "HistoryChangedError";
  }
}

export class GitClient {
  public async resolveRepository(candidate: string): Promise<string> {
    const output = await this.run(candidate, ["rev-parse", "--show-toplevel"]);
    return output.toString("utf8").trim();
  }

  public async loadHistory(
    candidate: string,
    pageSize = HISTORY_PAGE_SIZE,
  ): Promise<
    HistoryResult & {
      historyFingerprint: string;
      cursor: HistoryCursor;
      graphState: HistoryGraphState;
    }
  > {
    validatePageSize(pageSize);
    const root = await this.resolveRepository(candidate);
    const worktreesOutput = await this.run(root, [
      "worktree",
      "list",
      "--porcelain",
      "-z",
    ]);
    const worktrees = activeWorktrees(worktreesOutput);
    const worktreeHeads = uniqueWorktreeHeads(worktrees);
    const worktreesByCommit = linkedWorktreesByCommit(worktrees, root);
    const [headOutput, branchResult, logOutput, refsOutput] = await Promise.all([
      this.run(root, ["rev-parse", "HEAD"]),
      this.tryRun(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
      this.run(root, historyLogArgs(0, pageSize, worktreeHeads)),
      this.run(root, [
        "for-each-ref",
        `--format=${HISTORY_REFS_FORMAT}`,
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
    const refsByCommit = parseRefs(refsOutput.toString("utf8"));
    const parsedCommits = parseHistory(
      logOutput.toString("utf8"),
      refsByCommit,
      worktreesByCommit,
    );
    const commits = parsedCommits.slice(0, pageSize);
    const hasMore = parsedCommits.length > pageSize;
    const historyFingerprint = createHistoryFingerprint(
      head,
      branchResult.ok ? branch : undefined,
      refsOutput,
      worktreesOutput,
    );

    const graph = buildHistoryGraph(
      commits,
      undefined,
      hasPrimaryBranchRef(refsByCommit),
    );
    return {
      repository,
      rows: graph.rows,
      graphLaneCount: graph.laneCount,
      hasMore,
      historyFingerprint,
      graphState: graph.state,
      cursor: {
        repository: root,
        historyFingerprint,
        refsByCommit,
        worktreesByCommit,
        worktreeHeads,
        offset: commits.length,
        pageSize,
      },
    };
  }

  public async loadNextHistoryPage(
    cursor: HistoryCursor,
  ): Promise<HistoryPage> {
    validatePageSize(cursor.pageSize);
    const fingerprintBefore = await this.historyFingerprint(cursor.repository);
    if (fingerprintBefore !== cursor.historyFingerprint) {
      throw new HistoryChangedError();
    }
    const output = await this.run(
      cursor.repository,
      historyLogArgs(
        cursor.offset,
        cursor.pageSize,
        cursor.worktreeHeads,
      ),
    );
    const fingerprintAfter = await this.historyFingerprint(cursor.repository);
    if (fingerprintAfter !== cursor.historyFingerprint) {
      throw new HistoryChangedError();
    }
    const parsedCommits = parseHistory(
      output.toString("utf8"),
      cursor.refsByCommit,
      cursor.worktreesByCommit,
    );
    const commits = parsedCommits.slice(0, cursor.pageSize);
    const hasMore = parsedCommits.length > cursor.pageSize;
    return {
      commits,
      hasMore,
      cursor: {
        ...cursor,
        offset: cursor.offset + commits.length,
      },
    };
  }

  public async historyFingerprint(repository: string): Promise<string> {
    const [headOutput, branchResult, refsOutput, worktreesOutput] =
      await Promise.all([
      this.run(repository, ["rev-parse", "HEAD"]),
      this.tryRun(repository, [
        "symbolic-ref",
        "--quiet",
        "--short",
        "HEAD",
      ]),
      this.run(repository, [
        "for-each-ref",
        `--format=${HISTORY_REFS_FORMAT}`,
        "refs/heads",
        "refs/remotes",
        "refs/tags",
      ]),
      this.run(repository, ["worktree", "list", "--porcelain", "-z"]),
    ]);
    return createHistoryFingerprint(
      headOutput.toString("utf8").trim(),
      branchResult.ok
        ? branchResult.output.toString("utf8").trim()
        : undefined,
      refsOutput,
      worktreesOutput,
    );
  }

  public async changedFiles(
    repository: string,
    commit: Commit,
    maxTextBlobBytes = Number.POSITIVE_INFINITY,
  ): Promise<ChangedFile[]> {
    return this.changedFilesBetween(
      repository,
      commit.parents[0],
      commit.hash,
      maxTextBlobBytes,
    );
  }

  public async workingTreeChanges(
    repository: string,
    headHash: string,
    maxTextBlobBytes = Number.POSITIVE_INFINITY,
  ): Promise<WorkingTreeState> {
    const [rawOutput, numStatOutput, untrackedOutput] = await Promise.all([
      this.run(repository, [
        "diff",
        "--raw",
        "--no-abbrev",
        "--no-ext-diff",
        "--no-textconv",
        "-z",
        "-M",
        headHash,
        "--",
      ]),
      this.run(repository, [
        "diff",
        "--numstat",
        "--no-ext-diff",
        "--no-textconv",
        "-z",
        "-M",
        headHash,
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
    const trackedEntries = parseRawDiff(rawOutput);
    const untrackedPaths = parseNulPaths(untrackedOutput);
    const entries: RawDiffEntry[] = [
      ...trackedEntries,
      ...untrackedPaths.map((path) => ({
        status: "A",
        path,
        oldMode: "000000",
        newMode: "100644",
        oldObject: "0000000000000000000000000000000000000000",
        newObject: "0000000000000000000000000000000000000000",
      })),
    ];
    const [objectInfo, workingFileInfo] = await Promise.all([
      this.loadObjectInfo(
        repository,
        entries.flatMap((entry) => [entry.oldObject, entry.newObject]),
      ),
      loadWorkingFileInfo(repository, entries, new Set(untrackedPaths)),
    ]);
    const binaryPaths = parseBinaryPaths(numStatOutput);
    const files = entries.map((entry) => {
      const content = classifyWorkingTreeFile(
        entry,
        binaryPaths,
        objectInfo,
        workingFileInfo,
        maxTextBlobBytes,
      );
      return {
        ...changedFileFromEntry(entry),
        ...(content === undefined ? {} : { content }),
      };
    });
    files.sort((left, right) => left.path.localeCompare(right.path));
    return {
      headHash,
      files,
    };
  }

  public async changedFilesBetween(
    repository: string,
    base: string | undefined,
    tip: string,
    maxTextBlobBytes = Number.POSITIVE_INFINITY,
  ): Promise<ChangedFile[]> {
    const entries = await this.changedEntriesBetween(
      repository,
      base,
      tip,
      maxTextBlobBytes,
    );
    return entries.map(changedFileFromEntry);
  }

  public async commitFileChanges(
    repository: string,
    commit: Commit,
    maxTextBlobBytes = Number.POSITIVE_INFINITY,
  ): Promise<CommitFileChange[]> {
    const parentHash = commit.parents[0];
    const entries = await this.changedEntriesBetween(
      repository,
      parentHash,
      commit.hash,
      maxTextBlobBytes,
    );
    return entries.map((entry) => ({
      ...changedFileFromEntry(entry),
      commitHash: commit.hash,
      ...(parentHash === undefined ? {} : { parentHash }),
      oldObject: entry.oldObject,
      newObject: entry.newObject,
    }));
  }

  public async fileHistory(
    repository: string,
    path: string,
  ): Promise<FileRevision[]> {
    const output = await this.run(repository, [
      "log",
      "--all",
      "--follow",
      "--find-renames",
      "--date-order",
      "--color=never",
      "--no-decorate",
      "--diff-merges=first-parent",
      `--format=${RECORD_MARKER}%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%s%x00`,
      "--name-status",
      "-z",
      "--",
      path,
    ]);
    return parseFileHistory(output);
  }

  private async changedEntriesBetween(
    repository: string,
    base: string | undefined,
    tip: string,
    maxTextBlobBytes: number,
  ): Promise<RawDiffEntry[]> {
    const baseRef = base ?? EMPTY_TREE;
    const [rawOutput, numStatOutput] = await Promise.all([
      this.run(repository, [
        "diff",
        "--raw",
        "--no-abbrev",
        "--no-ext-diff",
        "--no-textconv",
        "-z",
        "-M",
        baseRef,
        tip,
        "--",
      ]),
      this.run(repository, [
        "diff",
        "--numstat",
        "--no-ext-diff",
        "--no-textconv",
        "-z",
        "-M",
        baseRef,
        tip,
        "--",
      ]),
    ]);
    const entries = parseRawDiff(rawOutput);
    const binaryPaths = parseBinaryPaths(numStatOutput);
    const objectInfo = await this.loadObjectInfo(
      repository,
      entries.flatMap((entry) => [entry.oldObject, entry.newObject]),
    );

    return entries.map((entry) => ({
      ...entry,
      content: classifyChangedFile(
        entry,
        binaryPaths,
        objectInfo,
        maxTextBlobBytes,
      ),
    }));
  }

  public async readBlob(
    repository: string,
    ref: string | undefined,
    path: string,
    knownSize?: number,
  ): Promise<Buffer> {
    if (ref === undefined) {
      return Buffer.alloc(0);
    }
    const size = knownSize ?? (await this.blobSize(repository, ref, path));
    return this.run(
      repository,
      ["cat-file", "blob", `${ref}:${path}`],
      Math.max(MAX_BUFFER, size),
    );
  }

  public async blobSize(
    repository: string,
    ref: string | undefined,
    path: string,
  ): Promise<number> {
    if (ref === undefined) {
      return 0;
    }
    const output = await this.run(repository, [
      "cat-file",
      "-s",
      `${ref}:${path}`,
    ]);
    const size = Number(output.toString("utf8").trim());
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new GitError(`Git returned an invalid blob size for ${path}.`);
    }
    return size;
  }

  public async readWorkingFile(
    repository: string,
    path: string,
    maxBytes = Number.POSITIVE_INFINITY,
  ): Promise<Buffer> {
    const absolutePath = resolveWorkingPath(repository, path);
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      return Buffer.from(await readlink(absolutePath));
    }
    if (!stats.isFile()) {
      throw new GitError(`Working tree path is not a regular file: ${path}`);
    }
    if (stats.size > maxBytes) {
      throw new GitError(
        `Working tree file exceeds the current text-diff limit: ${path}`,
      );
    }
    return readFile(absolutePath);
  }

  public async readWorkingImage(
    repository: string,
    path: string,
  ): Promise<Buffer> {
    const absolutePath = resolveWorkingPath(repository, path);
    const stats = await lstat(absolutePath);
    if (!stats.isFile()) {
      throw new GitError(`Working tree path is not a regular file: ${path}`);
    }
    return readFile(absolutePath);
  }

  private async loadObjectInfo(
    repository: string,
    objectHashes: string[],
  ): Promise<Map<string, ObjectInfo>> {
    const hashes = [...new Set(objectHashes.filter(isObjectHash))];
    if (hashes.length === 0) {
      return new Map();
    }
    const output = await this.runWithInput(
      repository,
      ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
      `${hashes.join("\n")}\n`,
    );
    return parseObjectInfo(output);
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

  private async run(
    directory: string,
    args: string[],
    maxBuffer = MAX_BUFFER,
  ): Promise<Buffer> {
    const gitArgs = commandArgs(directory, args);

    try {
      const { stdout } = await execFileAsync("git", gitArgs, {
        encoding: "buffer",
        maxBuffer,
        timeout: 15_000,
        env: commandEnvironment(),
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

  private runWithInput(
    directory: string,
    args: string[],
    input: string,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        "git",
        commandArgs(directory, args),
        {
          encoding: "buffer",
          maxBuffer: MAX_BUFFER,
          timeout: 15_000,
          env: commandEnvironment(),
        },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve(stdout);
            return;
          }
          const details = error as NodeJS.ErrnoException & {
            code?: string | number;
          };
          const stderrText = Buffer.isBuffer(stderr)
            ? stderr.toString("utf8").trim()
            : String(stderr ?? "").trim();
          const exitCode =
            typeof details.code === "number" ? details.code : undefined;
          const reason = stderrText || details.message || "Git command failed.";
          reject(new GitError(reason, stderrText, exitCode));
        },
      );
      child.stdin?.once("error", (error) => {
        reject(new GitError(error.message));
      });
      child.stdin?.end(input);
    });
  }
}

function commandArgs(directory: string, args: string[]): string[] {
  return [
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
}

function commandEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_PAGER: "cat",
    GIT_EXTERNAL_DIFF: "",
  };
}

function validatePageSize(pageSize: number): void {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new GitError("History page size must be a positive integer.");
  }
}

function historyLogArgs(
  offset: number,
  pageSize: number,
  worktreeHeads: readonly string[] = [],
): string[] {
  return [
    "log",
    "--branches",
    "--remotes",
    "--tags",
    "--date-order",
    "--color=never",
    "--no-decorate",
    ...(offset === 0 ? [] : [`--skip=${offset}`]),
    `--max-count=${pageSize + 1}`,
    `--format=${RECORD_MARKER}%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%s%x00`,
    ...worktreeHeads,
  ];
}

function hasPrimaryBranchRef(
  refsByCommit: ReadonlyMap<string, CommitRef[]>,
): boolean {
  return [...refsByCommit.values()].some((refs) =>
    refs.some(
      (ref) =>
        (ref.type === "localBranch" &&
          (ref.name === "main" || ref.name === "master")) ||
        (ref.type === "remoteBranch" && /\/(main|master)$/.test(ref.name)),
    ),
  );
}

function createHistoryFingerprint(
  headHash: string,
  branch: string | undefined,
  refsOutput: Buffer,
  worktreesOutput: Buffer,
): string {
  return [
    headHash,
    branch ?? "",
    refsOutput.toString("utf8"),
    worktreesOutput.toString("utf8"),
  ].join("\x00");
}

export function parseHistory(
  output: string,
  refsByCommit: ReadonlyMap<string, CommitRef[]> = new Map(),
  worktreesByCommit: ReadonlyMap<string, CommitWorktree[]> = new Map(),
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

    const worktrees = worktreesByCommit.get(hash) ?? [];
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
      ...(worktrees.length === 0 ? {} : { worktrees }),
    });
  }

  return commits;
}

function activeWorktrees(output: Buffer): GitWorktree[] {
  return parseGitWorktrees(output).filter(
    (worktree) =>
      worktree.head !== undefined && !worktree.bare && !worktree.prunable,
  );
}

function uniqueWorktreeHeads(worktrees: readonly GitWorktree[]): string[] {
  return [
    ...new Set(
      worktrees.flatMap((worktree) =>
        worktree.head === undefined ? [] : [worktree.head],
      ),
    ),
  ];
}

function linkedWorktreesByCommit(
  worktrees: readonly GitWorktree[],
  repository: string,
): Map<string, CommitWorktree[]> {
  const currentPath = resolve(repository);
  const byCommit = new Map<string, CommitWorktree[]>();
  for (const worktree of worktrees) {
    if (
      worktree.head === undefined ||
      resolve(worktree.path) === currentPath
    ) {
      continue;
    }
    const locations = byCommit.get(worktree.head) ?? [];
    locations.push({
      path: worktree.path,
      ...(worktree.branch === undefined ? {} : { branch: worktree.branch }),
      detached: worktree.detached,
    });
    byCommit.set(worktree.head, locations);
  }
  for (const locations of byCommit.values()) {
    locations.sort((left, right) => left.path.localeCompare(right.path));
  }
  return byCommit;
}

export function parseFileHistory(output: Buffer): FileRevision[] {
  const revisions: FileRevision[] = [];
  for (const rawRecord of output.toString("utf8").split(RECORD_MARKER)) {
    if (rawRecord.length === 0) {
      continue;
    }
    const fields = rawRecord.split("\x00");
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
    const commit: Commit = {
      hash,
      shortHash,
      parents: parents.length > 0 ? parents.split(" ") : [],
      authorName,
      authorEmail,
      authoredAt,
      committedAt,
      subject,
      refs: [],
    };
    for (let index = 8; index < fields.length; ) {
      const status = (fields[index++] ?? "").replace(/^\r?\n+/, "");
      if (!/^[A-Z][0-9]*$/.test(status)) {
        continue;
      }
      const firstPath = fields[index++];
      if (firstPath === undefined || firstPath.length === 0) {
        break;
      }
      const renamed = status.startsWith("R") || status.startsWith("C");
      const path = renamed ? fields[index++] : firstPath;
      if (path === undefined || path.length === 0) {
        break;
      }
      revisions.push({
        commit,
        status,
        path,
        ...(renamed ? { oldPath: firstPath } : {}),
      });
      break;
    }
  }
  return revisions;
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
      symbolicTarget = "",
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
      ...(symbolicTarget.length === 0 ? {} : { symbolicTarget }),
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

export function parseRawDiff(output: Buffer): RawDiffEntry[] {
  const fields = output.toString("utf8").split("\x00");
  const entries: RawDiffEntry[] = [];

  for (let index = 0; index < fields.length; ) {
    const header = fields[index++];
    if (!header) {
      break;
    }
    const match =
      /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z][0-9]*)$/.exec(
        header,
      );
    if (match === null) {
      continue;
    }
    const [
      ,
      oldMode = "",
      newMode = "",
      oldObject = "",
      newObject = "",
      status = "",
    ] = match;
    const firstPath = fields[index++];
    if (firstPath === undefined) {
      break;
    }
    const renamed = status.startsWith("R") || status.startsWith("C");
    const path = renamed ? fields[index++] : firstPath;
    if (path === undefined) {
      break;
    }
    entries.push({
      status,
      path,
      ...(renamed ? { oldPath: firstPath } : {}),
      oldMode,
      newMode,
      oldObject,
      newObject,
    });
  }

  return entries;
}

export function parseBinaryPaths(output: Buffer): Set<string> {
  const fields = output.toString("utf8").split("\x00");
  const paths = new Set<string>();

  for (let index = 0; index < fields.length; ) {
    const record = fields[index++];
    if (!record) {
      break;
    }
    const firstSeparator = record.indexOf("\t");
    const secondSeparator = record.indexOf("\t", firstSeparator + 1);
    if (firstSeparator === -1 || secondSeparator === -1) {
      continue;
    }
    const added = record.slice(0, firstSeparator);
    const deleted = record.slice(firstSeparator + 1, secondSeparator);
    const path = record.slice(secondSeparator + 1);
    const renamed = path.length === 0;
    if (renamed) {
      index += 1;
    }
    const targetPath = renamed ? fields[index++] : path;
    if (
      targetPath !== undefined &&
      (added === "-" || deleted === "-")
    ) {
      paths.add(targetPath);
    }
  }

  return paths;
}

export function parseNulPaths(output: Buffer): string[] {
  return output
    .toString("utf8")
    .split("\x00")
    .filter((path) => path.length > 0);
}

async function loadWorkingFileInfo(
  repository: string,
  entries: RawDiffEntry[],
  binaryDetectionPaths: ReadonlySet<string>,
): Promise<Map<string, WorkingFileInfo>> {
  const info = new Map<string, WorkingFileInfo>();
  const paths = [
    ...new Set(
      entries
        .filter(
          (entry) =>
            entry.newMode !== "000000" && entry.newMode !== "160000",
        )
        .map((entry) => entry.path),
    ),
  ];
  for (const path of paths) {
    const absolutePath = resolveWorkingPath(repository, path);
    try {
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        const target = await readlink(absolutePath);
        info.set(path, { size: Buffer.byteLength(target), binary: false });
        continue;
      }
      if (!stats.isFile()) {
        continue;
      }
      const binary = binaryDetectionPaths.has(path)
        ? await workingFileContainsNul(absolutePath, stats.size)
        : false;
      info.set(path, { size: stats.size, binary });
    } catch {
      // The path may change again while Git status is being refreshed.
      continue;
    }
  }
  return info;
}

async function workingFileContainsNul(
  absolutePath: string,
  size: number,
): Promise<boolean> {
  if (size === 0) {
    return false;
  }
  const handle = await open(absolutePath, "r");
  try {
    const sample = Buffer.alloc(Math.min(8 * 1024, size));
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
    return sample.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

function resolveWorkingPath(repository: string, path: string): string {
  const root = resolve(repository);
  const absolutePath = resolve(root, path);
  const relativePath = relative(root, absolutePath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new GitError(`Working tree path is outside the repository: ${path}`);
  }
  return absolutePath;
}

function parseObjectInfo(output: Buffer): Map<string, ObjectInfo> {
  const info = new Map<string, ObjectInfo>();
  for (const line of output.toString("utf8").trim().split("\n")) {
    const match = /^([0-9a-f]+) ([a-z]+) ([0-9]+)$/.exec(line);
    if (match === null) {
      continue;
    }
    const [, hash = "", type = "", rawSize = ""] = match;
    const size = Number(rawSize);
    if (Number.isSafeInteger(size)) {
      info.set(hash, { type, size });
    }
  }
  return info;
}

function classifyChangedFile(
  entry: RawDiffEntry,
  binaryPaths: ReadonlySet<string>,
  objectInfo: ReadonlyMap<string, ObjectInfo>,
  maxTextBlobBytes: number,
): ChangedFile["content"] {
  if (entry.oldMode === "160000" || entry.newMode === "160000") {
    return { kind: "submodule" };
  }
  const sizes = [entry.oldObject, entry.newObject]
    .map((hash) => objectInfo.get(hash))
    .filter((info): info is ObjectInfo => info?.type === "blob")
    .map((info) => info.size);
  const size = sizes.length === 0 ? undefined : Math.max(...sizes);
  if (isImagePath(entry.path) || isImagePath(entry.oldPath ?? "")) {
    return { kind: "image", ...(size === undefined ? {} : { size }) };
  }
  if (size !== undefined && size > maxTextBlobBytes) {
    return { kind: "oversized", size };
  }
  if (binaryPaths.has(entry.path)) {
    return { kind: "binary", ...(size === undefined ? {} : { size }) };
  }
  return undefined;
}

function classifyWorkingTreeFile(
  entry: RawDiffEntry,
  binaryPaths: ReadonlySet<string>,
  objectInfo: ReadonlyMap<string, ObjectInfo>,
  workingFileInfo: ReadonlyMap<string, WorkingFileInfo>,
  maxTextBlobBytes: number,
): ChangedFile["content"] {
  if (entry.oldMode === "160000" || entry.newMode === "160000") {
    return { kind: "submodule" };
  }
  const objectSizes = [entry.oldObject, entry.newObject]
    .map((hash) => objectInfo.get(hash))
    .filter((info): info is ObjectInfo => info?.type === "blob")
    .map((info) => info.size);
  const workingInfo = workingFileInfo.get(entry.path);
  const sizes = [
    ...objectSizes,
    ...(workingInfo === undefined ? [] : [workingInfo.size]),
  ];
  const size = sizes.length === 0 ? undefined : Math.max(...sizes);
  if (isImagePath(entry.path) || isImagePath(entry.oldPath ?? "")) {
    return { kind: "image", ...(size === undefined ? {} : { size }) };
  }
  if (size !== undefined && size > maxTextBlobBytes) {
    return { kind: "oversized", size };
  }
  if (binaryPaths.has(entry.path) || workingInfo?.binary === true) {
    return { kind: "binary", ...(size === undefined ? {} : { size }) };
  }
  return undefined;
}

function changedFileFromEntry(entry: RawDiffEntry): ChangedFile {
  return {
    status: entry.status,
    path: entry.path,
    ...(entry.oldPath === undefined ? {} : { oldPath: entry.oldPath }),
    ...(entry.content === undefined ? {} : { content: entry.content }),
  };
}

function isObjectHash(value: string): boolean {
  return /^[0-9a-f]+$/.test(value) && !/^0+$/.test(value);
}

function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}
