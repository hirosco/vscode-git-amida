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

import {
  parseUnmergedIndex,
  type UnmergedIndexEntry,
} from "./conflicts";
import { buildHistoryGraph, type HistoryGraphState } from "./graph";
import type {
  ChangedFile,
  Commit,
  CommitFileChange,
  CommitRef,
  CommitWorktree,
  FileConflict,
  FileRevision,
  HistoryResult,
  RepositoryInfo,
  WorkingTreeState,
} from "./model";
import { parseGitWorktrees, type GitWorktree } from "./worktrees";
import {
  findLocalGitLfsObject,
  GitLfsError,
  gitLfsFetchArgs,
  type GitLfsPointer,
  MAX_GIT_LFS_POINTER_BYTES,
  parseGitLfsPointer,
  readLocalGitLfsObject,
} from "./gitLfs";

const execFileAsync = promisify(execFile);
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const RECORD_MARKER = "\x1e";
const MAX_BUFFER = 16 * 1024 * 1024;
const METADATA_BUFFER = 4 * 1024 * 1024;
const CHANGED_FILES_BUFFER = 32 * 1024 * 1024;
const FILE_HISTORY_BUFFER = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const FILE_HISTORY_TIMEOUT_MS = 30_000;
const GIT_LFS_FETCH_TIMEOUT_MS = 2 * 60_000;
const HISTORY_REFS_FORMAT =
  `${RECORD_MARKER}%(objectname)%00%(*objectname)%00%(refname)%00` +
  "%(HEAD)%00%(upstream:short)%00%(upstream:trackshort)%00%(symref)%00";
const COMMIT_LOG_FORMAT =
  `${RECORD_MARKER}%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00` +
  "%s%x00%b%x00";
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
  oldLfs?: boolean;
  newLfs?: boolean;
}

interface ObjectInfo {
  type: string;
  size: number;
}

interface WorkingFileInfo {
  size: number;
  binary: boolean;
}

interface FileRevisionEntry extends FileRevision {
  oldMode: string;
  newMode: string;
  oldObject: string;
  newObject: string;
}

interface GitRunOptions {
  operation: string;
  maxBuffer?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface GitDiagnosticEvent {
  operation: string;
  status: "completed" | "cancelled" | "failed";
  durationMs: number;
  message?: string;
}

export interface HistoricalBlobInfo {
  rawSize: number;
  size: number;
  lfs?: GitLfsPointer & { available: boolean };
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

export class GitCancellationError extends GitError {
  public constructor(operation: string) {
    super(`${operation} was cancelled.`);
    this.name = "GitCancellationError";
  }
}

export class GitLfsObjectMissingError extends GitError {
  public constructor(
    path: string,
    public readonly pointer: GitLfsPointer,
  ) {
    super(
      `Git LFS content for "${path}" is not available locally. Download it and try again.`,
    );
    this.name = "GitLfsObjectMissingError";
  }
}

export class EmptyRepositoryError extends GitError {
  public constructor() {
    super("This Git repository has no commits yet.");
    this.name = "EmptyRepositoryError";
  }
}

export class NotGitRepositoryError extends GitError {
  public constructor() {
    super("The selected folder is not inside a Git repository.");
    this.name = "NotGitRepositoryError";
  }
}

export class GitClient {
  public constructor(
    private readonly reportDiagnostic?: (event: GitDiagnosticEvent) => void,
  ) {}

  public async resolveRepository(
    candidate: string,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      const output = await this.run(
        candidate,
        ["rev-parse", "--show-toplevel"],
        {
          operation: "Repository discovery",
          maxBuffer: METADATA_BUFFER,
          signal,
        },
      );
      return output.toString("utf8").trim();
    } catch (error) {
      if (
        error instanceof GitError &&
        !(error instanceof GitCancellationError) &&
        /not a git repository/i.test(error.stderr)
      ) {
        throw new NotGitRepositoryError();
      }
      throw error;
    }
  }

  public async loadHistory(
    candidate: string,
    pageSize = HISTORY_PAGE_SIZE,
    signal?: AbortSignal,
  ): Promise<
    HistoryResult & {
      historyFingerprint: string;
      cursor: HistoryCursor;
      graphState: HistoryGraphState;
    }
  > {
    validatePageSize(pageSize);
    const root = await this.resolveRepository(candidate, signal);
    const headResult = await this.tryRun(
      root,
      ["rev-parse", "--verify", "--quiet", "HEAD"],
      {
        operation: "HEAD resolution",
        maxBuffer: METADATA_BUFFER,
        signal,
      },
    );
    if (!headResult.ok) {
      throw new EmptyRepositoryError();
    }
    const worktreesOutput = await this.run(
      root,
      ["worktree", "list", "--porcelain", "-z"],
      {
        operation: "Worktree discovery",
        maxBuffer: METADATA_BUFFER,
        signal,
      },
    );
    const worktrees = activeWorktrees(worktreesOutput);
    const worktreeHeads = uniqueWorktreeHeads(worktrees);
    const worktreesByCommit = linkedWorktreesByCommit(worktrees, root);
    const [branchResult, logOutput, refsOutput] = await Promise.all([
      this.tryRun(
        root,
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        {
          operation: "Branch resolution",
          maxBuffer: METADATA_BUFFER,
          signal,
        },
      ),
      this.run(root, historyLogArgs(0, pageSize, worktreeHeads), {
        operation: "Repository history",
        maxBuffer: MAX_BUFFER,
        signal,
      }),
      this.run(
        root,
        [
          "for-each-ref",
          `--format=${HISTORY_REFS_FORMAT}`,
          "refs/heads",
          "refs/remotes",
          "refs/tags",
        ],
        {
          operation: "Repository refs",
          maxBuffer: METADATA_BUFFER,
          signal,
        },
      ),
    ]);

    const head = headResult.output.toString("utf8").trim();
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
    signal?: AbortSignal,
  ): Promise<HistoryPage> {
    validatePageSize(cursor.pageSize);
    const fingerprintBefore = await this.historyFingerprint(
      cursor.repository,
      signal,
    );
    if (fingerprintBefore !== cursor.historyFingerprint) {
      throw new HistoryChangedError();
    }
    const output = await this.run(
      cursor.repository,
      historyLogArgs(cursor.offset, cursor.pageSize, cursor.worktreeHeads),
      {
        operation: "Repository history page",
        maxBuffer: MAX_BUFFER,
        signal,
      },
    );
    const fingerprintAfter = await this.historyFingerprint(
      cursor.repository,
      signal,
    );
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

  public async historyFingerprint(
    repository: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const [headOutput, branchResult, refsOutput, worktreesOutput] =
      await Promise.all([
      this.run(repository, ["rev-parse", "HEAD"], {
        operation: "HEAD fingerprint",
        maxBuffer: METADATA_BUFFER,
        signal,
      }),
      this.tryRun(
        repository,
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        {
          operation: "Branch fingerprint",
          maxBuffer: METADATA_BUFFER,
          signal,
        },
      ),
      this.run(
        repository,
        [
          "for-each-ref",
          `--format=${HISTORY_REFS_FORMAT}`,
          "refs/heads",
          "refs/remotes",
          "refs/tags",
        ],
        {
          operation: "Refs fingerprint",
          maxBuffer: METADATA_BUFFER,
          signal,
        },
      ),
      this.run(repository, ["worktree", "list", "--porcelain", "-z"], {
        operation: "Worktree fingerprint",
        maxBuffer: METADATA_BUFFER,
        signal,
      }),
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
    signal?: AbortSignal,
  ): Promise<ChangedFile[]> {
    return this.changedFilesBetween(
      repository,
      commit.parents[0],
      commit.hash,
      maxTextBlobBytes,
      signal,
    );
  }

  public async workingTreeChanges(
    repository: string,
    headHash: string,
    maxTextBlobBytes = Number.POSITIVE_INFINITY,
    signal?: AbortSignal,
  ): Promise<WorkingTreeState> {
    const [
      rawOutput,
      numStatOutput,
      untrackedOutput,
      unmergedOutput,
      operation,
    ] = await Promise.all([
      this.run(
        repository,
        [
          "diff",
          "--raw",
          "--no-abbrev",
          "--no-ext-diff",
          "--no-textconv",
          "-z",
          "-M",
          headHash,
          "--",
        ],
        {
          operation: "Working-tree paths",
          maxBuffer: CHANGED_FILES_BUFFER,
          signal,
        },
      ),
      this.run(
        repository,
        [
          "diff",
          "--numstat",
          "--no-ext-diff",
          "--no-textconv",
          "-z",
          "-M",
          headHash,
          "--",
        ],
        {
          operation: "Working-tree statistics",
          maxBuffer: CHANGED_FILES_BUFFER,
          signal,
        },
      ),
      this.run(
        repository,
        [
          "ls-files",
          "--others",
          "--exclude-standard",
          "-z",
          "--",
        ],
        {
          operation: "Untracked-file discovery",
          maxBuffer: CHANGED_FILES_BUFFER,
          signal,
        },
      ),
      this.run(
        repository,
        ["ls-files", "--unmerged", "-z", "--"],
        {
          operation: "Unmerged-index discovery",
          maxBuffer: CHANGED_FILES_BUFFER,
          signal,
        },
      ),
      this.inProgressWorkingTreeOperation(repository, signal),
    ]);
    const trackedEntries = parseRawDiff(rawOutput);
    const untrackedPaths = parseNulPaths(untrackedOutput);
    const unmergedEntries = parseUnmergedIndex(unmergedOutput);
    const unmergedPaths = new Set(unmergedEntries.map((entry) => entry.path));
    const entries: RawDiffEntry[] = [
      ...trackedEntries.filter((entry) => !unmergedPaths.has(entry.path)),
      ...unmergedEntries.map(rawDiffEntryFromConflict),
      ...untrackedPaths
        .filter((path) => !unmergedPaths.has(path))
        .map((path) => ({
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
        signal,
      ),
      loadWorkingFileInfo(repository, entries, new Set(untrackedPaths)),
    ]);
    const lfsObjects = await this.loadGitLfsObjectHashes(
      repository,
      entries.flatMap((entry) => [entry.oldObject, entry.newObject]),
      objectInfo,
      signal,
    );
    const binaryPaths = parseBinaryPaths(numStatOutput);
    const files = entries.map((entry) => {
      const classifiedEntry = withGitLfsEndpoints(entry, lfsObjects);
      const content = classifyWorkingTreeFile(
        classifiedEntry,
        binaryPaths,
        objectInfo,
        workingFileInfo,
        maxTextBlobBytes,
      );
      return {
        ...changedFileFromEntry(classifiedEntry),
        ...(content === undefined ? {} : { content }),
      };
    });
    files.sort((left, right) => left.path.localeCompare(right.path));
    return {
      headHash,
      files,
      ...(operation === undefined ? {} : { operation }),
    };
  }

  public async conflictAtPath(
    repository: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<FileConflict | undefined> {
    resolveWorkingPath(repository, path);
    const output = await this.run(
      repository,
      ["ls-files", "--unmerged", "-z", "--", path],
      {
        operation: "Unmerged-file inspection",
        maxBuffer: METADATA_BUFFER,
        signal,
      },
    );
    return parseUnmergedIndex(output).find((entry) => entry.path === path)
      ?.conflict;
  }

  public async changedFilesBetween(
    repository: string,
    base: string | undefined,
    tip: string,
    maxTextBlobBytes = Number.POSITIVE_INFINITY,
    signal?: AbortSignal,
  ): Promise<ChangedFile[]> {
    const entries = await this.changedEntriesBetween(
      repository,
      base,
      tip,
      maxTextBlobBytes,
      signal,
    );
    return entries.map(changedFileFromEntry);
  }

  public async commitFileChanges(
    repository: string,
    commit: Commit,
    maxTextBlobBytes = Number.POSITIVE_INFINITY,
    signal?: AbortSignal,
  ): Promise<CommitFileChange[]> {
    const parentHash = commit.parents[0];
    const entries = await this.changedEntriesBetween(
      repository,
      parentHash,
      commit.hash,
      maxTextBlobBytes,
      signal,
    );
    return entries.map((entry) => ({
      ...changedFileFromEntry(entry),
      commitHash: commit.hash,
      ...(parentHash === undefined ? {} : { parentHash }),
      oldObject: entry.oldObject,
      newObject: entry.newObject,
      ...(entry.oldLfs === true ? { oldLfs: true } : {}),
      ...(entry.newLfs === true ? { newLfs: true } : {}),
    }));
  }

  public async fileHistory(
    repository: string,
    path: string,
    maxTextBlobBytes = Number.POSITIVE_INFINITY,
    signal?: AbortSignal,
  ): Promise<FileRevision[]> {
    const output = await this.run(
      repository,
      [
        "log",
        "--all",
        "--follow",
        "--find-renames",
        "--date-order",
        "--color=never",
        "--no-decorate",
        "--diff-merges=first-parent",
        `--format=${COMMIT_LOG_FORMAT}`,
        "--raw",
        "--no-abbrev",
        "-z",
        "--",
        path,
      ],
      {
        operation: "File history",
        maxBuffer: FILE_HISTORY_BUFFER,
        timeoutMs: FILE_HISTORY_TIMEOUT_MS,
        signal,
      },
    );
    const entries = parseFileHistoryEntries(output);
    const objectInfo = await this.loadObjectInfo(
      repository,
      entries.flatMap((entry) => [entry.oldObject, entry.newObject]),
      signal,
    );
    const lfsObjects = await this.loadGitLfsObjectHashes(
      repository,
      entries.flatMap((entry) => [entry.oldObject, entry.newObject]),
      objectInfo,
      signal,
    );
    return entries.map((entry) => {
      const { commit, ...rawEntry } = entry;
      const classifiedEntry = withGitLfsEndpoints(rawEntry, lfsObjects);
      const content = classifyChangedFile(
        classifiedEntry,
        new Set(),
        objectInfo,
        maxTextBlobBytes,
      );
      return {
        commit,
        ...changedFileFromEntry({
          ...classifiedEntry,
          ...(content === undefined ? {} : { content }),
        }),
      };
    });
  }

  private async changedEntriesBetween(
    repository: string,
    base: string | undefined,
    tip: string,
    maxTextBlobBytes: number,
    signal?: AbortSignal,
  ): Promise<RawDiffEntry[]> {
    const baseRef = base ?? EMPTY_TREE;
    const [rawOutput, numStatOutput] = await Promise.all([
      this.run(
        repository,
        [
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
        ],
        {
          operation: "Changed-file paths",
          maxBuffer: CHANGED_FILES_BUFFER,
          signal,
        },
      ),
      this.run(
        repository,
        [
          "diff",
          "--numstat",
          "--no-ext-diff",
          "--no-textconv",
          "-z",
          "-M",
          baseRef,
          tip,
          "--",
        ],
        {
          operation: "Changed-file statistics",
          maxBuffer: CHANGED_FILES_BUFFER,
          signal,
        },
      ),
    ]);
    const entries = parseRawDiff(rawOutput);
    const binaryPaths = parseBinaryPaths(numStatOutput);
    const objectInfo = await this.loadObjectInfo(
      repository,
      entries.flatMap((entry) => [entry.oldObject, entry.newObject]),
      signal,
    );
    const lfsObjects = await this.loadGitLfsObjectHashes(
      repository,
      entries.flatMap((entry) => [entry.oldObject, entry.newObject]),
      objectInfo,
      signal,
    );

    return entries.map((entry) => ({
      ...withGitLfsEndpoints(entry, lfsObjects),
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
    signal?: AbortSignal,
  ): Promise<Buffer> {
    if (ref === undefined) {
      return Buffer.alloc(0);
    }
    const size =
      knownSize ?? (await this.blobSize(repository, ref, path, signal));
    return this.run(
      repository,
      ["cat-file", "blob", `${ref}:${path}`],
      {
        operation: "Blob read",
        maxBuffer: Math.max(MAX_BUFFER, size + 1),
        timeoutMs: FILE_HISTORY_TIMEOUT_MS,
        signal,
      },
    );
  }

  public async blobSize(
    repository: string,
    ref: string | undefined,
    path: string,
    signal?: AbortSignal,
  ): Promise<number> {
    if (ref === undefined) {
      return 0;
    }
    const output = await this.run(
      repository,
      ["cat-file", "-s", `${ref}:${path}`],
      {
        operation: "Blob size",
        maxBuffer: METADATA_BUFFER,
        signal,
      },
    );
    const size = Number(output.toString("utf8").trim());
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new GitError(`Git returned an invalid blob size for ${path}.`);
    }
    return size;
  }

  public async inspectHistoricalBlob(
    repository: string,
    ref: string | undefined,
    path: string,
    signal?: AbortSignal,
  ): Promise<HistoricalBlobInfo> {
    if (ref === undefined) {
      return { rawSize: 0, size: 0 };
    }
    const rawSize = await this.blobSize(repository, ref, path, signal);
    if (rawSize > MAX_GIT_LFS_POINTER_BYTES) {
      return { rawSize, size: rawSize };
    }
    const pointer = parseGitLfsPointer(
      await this.readBlob(repository, ref, path, rawSize, signal),
    );
    if (pointer === undefined) {
      return { rawSize, size: rawSize };
    }
    const storage = await this.gitLfsStorageDirectory(repository, signal);
    const objectPath = await findLocalGitLfsObject(storage, pointer);
    return {
      rawSize,
      size: pointer.size,
      lfs: { ...pointer, available: objectPath !== undefined },
    };
  }

  public async readHistoricalBlob(
    repository: string,
    ref: string | undefined,
    path: string,
    knownInfo?: HistoricalBlobInfo,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const info = knownInfo ??
      (await this.inspectHistoricalBlob(repository, ref, path, signal));
    if (info.lfs === undefined) {
      return this.readBlob(repository, ref, path, info.rawSize, signal);
    }
    const storage = await this.gitLfsStorageDirectory(repository, signal);
    const content = await readLocalGitLfsObject(storage, info.lfs, signal);
    if (content === undefined) {
      throw new GitLfsObjectMissingError(path, info.lfs);
    }
    return content;
  }

  public async fetchHistoricalGitLfsBlob(
    repository: string,
    ref: string,
    path: string,
    pointer: GitLfsPointer,
    signal?: AbortSignal,
  ): Promise<void> {
    const storage = await this.gitLfsStorageDirectory(repository, signal);
    if ((await findLocalGitLfsObject(storage, pointer)) !== undefined) {
      return;
    }
    await this.assertSafeGitLfsTransferConfiguration(repository, signal);
    const remote = await this.defaultGitLfsRemote(repository, signal);
    try {
      await this.run(
        repository,
        gitLfsFetchArgs(remote, ref, path),
        {
          operation: "Git LFS object download",
          maxBuffer: METADATA_BUFFER,
          timeoutMs: GIT_LFS_FETCH_TIMEOUT_MS,
          signal,
        },
      );
    } catch (error) {
      if (
        error instanceof GitError &&
        /(?:git: 'lfs' is not a git command|git-lfs[^\n]*(?:not found|not recognized))/i.test(
          `${error.message}\n${error.stderr}`,
        )
      ) {
        throw new GitError(
          "Git LFS is required to download this historical file. Install Git LFS and try again.",
          error.stderr,
          error.exitCode,
        );
      }
      throw error;
    }
    if ((await findLocalGitLfsObject(storage, pointer)) === undefined) {
      throw new GitLfsObjectMissingError(path, pointer);
    }
  }

  public async readWorkingFile(
    repository: string,
    path: string,
    maxBytes = Number.POSITIVE_INFINITY,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    throwIfAborted(signal, "Working-tree file read");
    const absolutePath = resolveWorkingPath(repository, path);
    const stats = await lstat(absolutePath);
    throwIfAborted(signal, "Working-tree file read");
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
    return signal === undefined
      ? readFile(absolutePath)
      : readFile(absolutePath, { signal });
  }

  public async readWorkingBlob(
    repository: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    throwIfAborted(signal, "Working-tree blob read");
    const absolutePath = resolveWorkingPath(repository, path);
    const stats = await lstat(absolutePath);
    throwIfAborted(signal, "Working-tree blob read");
    if (!stats.isFile()) {
      throw new GitError(`Working tree path is not a regular file: ${path}`);
    }
    return signal === undefined
      ? readFile(absolutePath)
      : readFile(absolutePath, { signal });
  }

  private async loadObjectInfo(
    repository: string,
    objectHashes: string[],
    signal?: AbortSignal,
  ): Promise<Map<string, ObjectInfo>> {
    const hashes = [...new Set(objectHashes.filter(isObjectHash))];
    if (hashes.length === 0) {
      return new Map();
    }
    const output = await this.runWithInput(
      repository,
      ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
      `${hashes.join("\n")}\n`,
      {
        operation: "Object metadata",
        maxBuffer: CHANGED_FILES_BUFFER,
        signal,
      },
    );
    return parseObjectInfo(output);
  }

  private async inProgressWorkingTreeOperation(
    repository: string,
    signal?: AbortSignal,
  ): Promise<WorkingTreeState["operation"]> {
    const output = await this.run(
      repository,
      [
        "rev-parse",
        "--git-path",
        "MERGE_HEAD",
        "--git-path",
        "rebase-merge",
        "--git-path",
        "rebase-apply",
        "--git-path",
        "CHERRY_PICK_HEAD",
        "--git-path",
        "REVERT_HEAD",
      ],
      {
        operation: "Git operation discovery",
        maxBuffer: METADATA_BUFFER,
        signal,
      },
    );
    const paths = output
      .toString("utf8")
      .trim()
      .split(/\r?\n/)
      .map((path) => (isAbsolute(path) ? path : resolve(repository, path)));
    const [merge, rebaseMerge, rebaseApply, cherryPick, revert] =
      await Promise.all(paths.map(pathExists));
    if (merge === true) {
      return "merge";
    }
    if (rebaseMerge === true || rebaseApply === true) {
      return "rebase";
    }
    if (cherryPick === true) {
      return "cherry-pick";
    }
    return revert === true ? "revert" : undefined;
  }

  private async loadGitLfsObjectHashes(
    repository: string,
    objectHashes: string[],
    objectInfo: ReadonlyMap<string, ObjectInfo>,
    signal?: AbortSignal,
  ): Promise<Set<string>> {
    const hashes = [...new Set(objectHashes)].filter((hash) => {
      const info = objectInfo.get(hash);
      return (
        isObjectHash(hash) &&
        info?.type === "blob" &&
        info.size <= MAX_GIT_LFS_POINTER_BYTES
      );
    });
    if (hashes.length === 0) {
      return new Set();
    }
    const output = await this.runWithInput(
      repository,
      ["cat-file", "--batch"],
      `${hashes.join("\n")}\n`,
      {
        operation: "Git LFS pointer inspection",
        maxBuffer: CHANGED_FILES_BUFFER,
        signal,
      },
    );
    return parseGitLfsObjectHashes(output, hashes, objectInfo);
  }

  private async gitLfsStorageDirectory(
    repository: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const commonDirectory = (
      await this.run(repository, ["rev-parse", "--git-common-dir"], {
        operation: "Git storage discovery",
        maxBuffer: METADATA_BUFFER,
        signal,
      })
    ).toString("utf8").trim();
    const absoluteCommonDirectory = isAbsolute(commonDirectory)
      ? resolve(commonDirectory)
      : resolve(repository, commonDirectory);
    const configured = await this.optionalRun(
      repository,
      ["config", "--path", "--get", "lfs.storage"],
      {
        operation: "Git LFS storage lookup",
        maxBuffer: METADATA_BUFFER,
        signal,
      },
    );
    if (configured !== undefined) {
      const value = configured.toString("utf8").trim();
      if (value !== "") {
        return isAbsolute(value)
          ? resolve(value)
          : resolve(absoluteCommonDirectory, value);
      }
    }
    return resolve(absoluteCommonDirectory, "lfs");
  }

  private async defaultGitLfsRemote(
    repository: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const remotes = new Set(
      (
        await this.run(repository, ["remote"], {
          operation: "Git remote lookup",
          maxBuffer: METADATA_BUFFER,
          signal,
        })
      )
        .toString("utf8")
        .split("\n")
        .map((remote) => remote.trim())
        .filter((remote) => remote !== ""),
    );
    const headRef = await this.tryRun(
      repository,
      ["symbolic-ref", "--quiet", "HEAD"],
      {
        operation: "Git branch lookup",
        maxBuffer: METADATA_BUFFER,
        signal,
      },
    );
    if (headRef.ok) {
      const upstream = await this.tryRun(
        repository,
        [
          "for-each-ref",
          "--format=%(upstream:remotename)",
          headRef.output.toString("utf8").trim(),
        ],
        {
          operation: "Git tracking remote lookup",
          maxBuffer: METADATA_BUFFER,
          signal,
        },
      );
      if (upstream.ok) {
        const remote = upstream.output.toString("utf8").trim();
        if (remote !== "." && remotes.has(remote)) {
          return remote;
        }
      }
    }
    const configured = await this.optionalRun(
      repository,
      ["config", "--get", "remote.lfsdefault"],
      {
        operation: "Git LFS remote lookup",
        maxBuffer: METADATA_BUFFER,
        signal,
      },
    );
    if (configured !== undefined) {
      const remote = configured.toString("utf8").trim();
      if (remote !== "") {
        if (!remotes.has(remote)) {
          throw new GitError(
            `The configured Git LFS remote "${remote}" does not exist.`,
          );
        }
        return remote;
      }
    }
    if (remotes.has("origin")) {
      return "origin";
    }
    if (remotes.size === 1) {
      return [...remotes][0] ?? "";
    }
    if (remotes.size === 0) {
      throw new GitError(
        "A Git remote is required to download historical Git LFS content.",
      );
    }
    throw new GitError(
      "Git LFS has multiple possible remotes. Configure remote.lfsdefault and try again.",
    );
  }

  private async assertSafeGitLfsTransferConfiguration(
    repository: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const [customTransfers, standaloneTransfer] = await Promise.all([
      this.optionalRun(
        repository,
        [
          "config",
          "--get-regexp",
          "^lfs\\.customtransfer\\..*\\.(path|args)$",
        ],
        {
          operation: "Git LFS transfer configuration lookup",
          maxBuffer: METADATA_BUFFER,
          signal,
        },
      ),
      this.optionalRun(
        repository,
        ["config", "--get", "lfs.standalonetransferagent"],
        {
          operation: "Git LFS transfer configuration lookup",
          maxBuffer: METADATA_BUFFER,
          signal,
        },
      ),
    ]);
    if (
      (customTransfers !== undefined && customTransfers.toString("utf8").trim() !== "") ||
      (standaloneTransfer !== undefined && standaloneTransfer.toString("utf8").trim() !== "")
    ) {
      throw new GitError(
        "GitAmida does not execute custom Git LFS transfer commands. Fetch this object with Git LFS outside GitAmida and try again.",
      );
    }
  }

  private async tryRun(
    directory: string,
    args: string[],
    options: GitRunOptions = { operation: "Git query" },
  ): Promise<{ ok: true; output: Buffer } | { ok: false }> {
    try {
      return { ok: true, output: await this.run(directory, args, options) };
    } catch (error) {
      if (
        error instanceof GitError &&
        !(error instanceof GitCancellationError)
      ) {
        return { ok: false };
      }
      throw error;
    }
  }

  private async optionalRun(
    directory: string,
    args: string[],
    options: GitRunOptions = { operation: "Git query" },
  ): Promise<Buffer | undefined> {
    try {
      return await this.run(directory, args, options);
    } catch (error) {
      if (
        error instanceof GitError &&
        !(error instanceof GitCancellationError) &&
        error.exitCode === 1
      ) {
        return undefined;
      }
      throw error;
    }
  }

  private async run(
    directory: string,
    args: string[],
    options: GitRunOptions = { operation: "Git query" },
  ): Promise<Buffer> {
    const gitArgs = commandArgs(directory, args);
    const maxBuffer = options.maxBuffer ?? MAX_BUFFER;
    const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const startedAt = Date.now();

    try {
      throwIfAborted(options.signal, options.operation);
      const { stdout } = await execFileAsync("git", gitArgs, {
        encoding: "buffer",
        maxBuffer,
        timeout,
        signal: options.signal,
        env: commandEnvironment(),
      });
      this.diagnostic({
        operation: options.operation,
        status: "completed",
        durationMs: Date.now() - startedAt,
      });
      return stdout;
    } catch (error) {
      const failure = gitRunError(error, undefined, options);
      this.diagnostic({
        operation: options.operation,
        status:
          failure instanceof GitCancellationError ? "cancelled" : "failed",
        durationMs: Date.now() - startedAt,
        message: failure.message,
      });
      throw failure;
    }
  }

  private runWithInput(
    directory: string,
    args: string[],
    input: string,
    options: GitRunOptions = { operation: "Git query" },
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      let settled = false;
      const finish = (error: unknown, stdout?: Buffer, stderr?: Buffer): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (error === undefined && stdout !== undefined) {
          this.diagnostic({
            operation: options.operation,
            status: "completed",
            durationMs: Date.now() - startedAt,
          });
          resolve(stdout);
          return;
        }
        const failure = gitRunError(error, stderr, options);
        this.diagnostic({
          operation: options.operation,
          status:
            failure instanceof GitCancellationError ? "cancelled" : "failed",
          durationMs: Date.now() - startedAt,
          message: failure.message,
        });
        reject(failure);
      };

      try {
        throwIfAborted(options.signal, options.operation);
        const child = execFile(
          "git",
          commandArgs(directory, args),
          {
            encoding: "buffer",
            maxBuffer: options.maxBuffer ?? MAX_BUFFER,
            timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            signal: options.signal,
            env: commandEnvironment(),
          },
          (error, stdout, stderr) => {
            finish(error ?? undefined, stdout, stderr);
          },
        );
        child.stdin?.once("error", (error) => {
          finish(error);
        });
        child.stdin?.end(input);
      } catch (error) {
        finish(error);
      }
    });
  }

  private diagnostic(event: GitDiagnosticEvent): void {
    try {
      this.reportDiagnostic?.(event);
    } catch {
      // Diagnostics must never change Git operation behavior.
    }
  }
}

function gitRunError(
  error: unknown,
  callbackStderr: Buffer | string | undefined,
  options: GitRunOptions,
): GitError {
  const details = error as NodeJS.ErrnoException & {
    code?: string | number;
    killed?: boolean;
    signal?: string;
    stderr?: Buffer | string;
  };
  if (
    options.signal?.aborted === true ||
    details.name === "AbortError" ||
    details.code === "ABORT_ERR"
  ) {
    return new GitCancellationError(options.operation);
  }

  const stderrValue = callbackStderr ?? details.stderr;
  const stderr = Buffer.isBuffer(stderrValue)
    ? stderrValue.toString("utf8").trim()
    : String(stderrValue ?? "").trim();
  const exitCode = typeof details.code === "number" ? details.code : undefined;
  if (details.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return new GitError(
      `${options.operation} exceeded its ${formatMiB(options.maxBuffer ?? MAX_BUFFER)} output limit.`,
      stderr,
      exitCode,
    );
  }
  if (details.killed === true && details.signal !== undefined) {
    const seconds = Math.round(
      (options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000,
    );
    return new GitError(
      `${options.operation} exceeded its ${seconds}-second time limit.`,
      stderr,
      exitCode,
    );
  }

  const reason = stderr || details.message || "Git command failed.";
  return new GitError(
    `${options.operation} failed: ${reason}`,
    stderr,
    exitCode,
  );
}

function throwIfAborted(
  signal: AbortSignal | undefined,
  operation: string,
): void {
  if (signal?.aborted === true) {
    throw new GitCancellationError(operation);
  }
}

function formatMiB(bytes: number): string {
  return `${Math.ceil(bytes / (1024 * 1024))} MiB`;
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
    LANG: "C",
    LC_ALL: "C",
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
    `--format=${COMMIT_LOG_FORMAT}`,
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

  for (const rawRecord of output.split(RECORD_MARKER).slice(1)) {
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
      body = "",
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
      ...commitBody(body),
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
  return parseFileHistoryEntries(output).map((revision) => ({
    commit: revision.commit,
    status: revision.status,
    path: revision.path,
    ...(revision.oldPath === undefined ? {} : { oldPath: revision.oldPath }),
  }));
}

function parseFileHistoryEntries(output: Buffer): FileRevisionEntry[] {
  const revisions: FileRevisionEntry[] = [];
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
      body = "",
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
      ...commitBody(body),
      refs: [],
    };
    const entry = parseRawDiffFields(fields, 9)[0];
    if (entry !== undefined) {
      revisions.push({ commit, ...entry });
    }
  }
  return revisions;
}

function commitBody(body: string): { body?: string } {
  const normalized = body.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  return normalized.trim().length === 0 ? {} : { body: normalized };
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
  return parseRawDiffFields(output.toString("utf8").split("\x00"));
}

function parseRawDiffFields(
  fields: readonly string[],
  startIndex = 0,
): RawDiffEntry[] {
  const entries: RawDiffEntry[] = [];

  for (let index = startIndex; index < fields.length; ) {
    const header = (fields[index++] ?? "").replace(/^\r?\n+/, "");
    if (!header) {
      continue;
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
    ...(entry.oldLfs === true || entry.newLfs === true ? { lfs: true } : {}),
    ...(entry.conflict === undefined ? {} : { conflict: entry.conflict }),
  };
}

function rawDiffEntryFromConflict(entry: UnmergedIndexEntry): RawDiffEntry {
  const base = entry.stages.get(1);
  const ours = entry.stages.get(2);
  const theirs = entry.stages.get(3);
  const before = ours ?? base ?? theirs;
  const after = theirs ?? ours ?? base;
  return {
    status: "U",
    path: entry.path,
    oldMode: before?.mode ?? "000000",
    newMode: after?.mode ?? "000000",
    oldObject:
      before?.object ?? "0000000000000000000000000000000000000000",
    newObject:
      after?.object ?? "0000000000000000000000000000000000000000",
    conflict: entry.conflict,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function withGitLfsEndpoints(
  entry: RawDiffEntry,
  lfsObjects: ReadonlySet<string>,
): RawDiffEntry {
  return {
    ...entry,
    ...(lfsObjects.has(entry.oldObject) ? { oldLfs: true } : {}),
    ...(lfsObjects.has(entry.newObject) ? { newLfs: true } : {}),
  };
}

function parseGitLfsObjectHashes(
  output: Buffer,
  hashes: readonly string[],
  objectInfo: ReadonlyMap<string, ObjectInfo>,
): Set<string> {
  const lfsObjects = new Set<string>();
  let offset = 0;
  for (const expectedHash of hashes) {
    const lineEnd = output.indexOf(0x0a, offset);
    if (lineEnd < 0) {
      throw new GitError("Git returned incomplete object content metadata.");
    }
    const header = output.subarray(offset, lineEnd).toString("utf8");
    const match = /^([0-9a-f]+) ([a-z]+) ([0-9]+)$/.exec(header);
    const expected = objectInfo.get(expectedHash);
    const size = Number(match?.[3]);
    if (
      match?.[1] !== expectedHash ||
      match[2] !== "blob" ||
      expected?.type !== "blob" ||
      !Number.isSafeInteger(size) ||
      size !== expected.size
    ) {
      throw new GitError("Git returned unexpected object content metadata.");
    }
    const contentStart = lineEnd + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= output.length || output[contentEnd] !== 0x0a) {
      throw new GitError("Git returned incomplete object content.");
    }
    try {
      if (parseGitLfsPointer(output.subarray(contentStart, contentEnd)) !== undefined) {
        lfsObjects.add(expectedHash);
      }
    } catch (error) {
      if (!(error instanceof GitLfsError)) {
        throw error;
      }
      // Unsupported or malformed pointers remain inspectable as ordinary files.
      // Opening that exact endpoint still reports the specific Git LFS error.
    }
    offset = contentEnd + 1;
  }
  if (offset !== output.length) {
    throw new GitError("Git returned trailing object content.");
  }
  return lfsObjects;
}

function isObjectHash(value: string): boolean {
  return /^[0-9a-f]+$/.test(value) && !/^0+$/.test(value);
}

function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}
