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

import { buildHistoryGraph } from "./graph";
import type {
  ChangedFile,
  Commit,
  CommitFileChange,
  CommitRef,
  HistoryResult,
  RepositoryInfo,
  WorkingTreeState,
} from "./model";

const execFileAsync = promisify(execFile);
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const RECORD_MARKER = "\x1e";
const MAX_BUFFER = 16 * 1024 * 1024;
export const MAX_TEXT_BLOB_BYTES = 5 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".heic",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
]);

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
        "--date-order",
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
    return this.changedFilesBetween(
      repository,
      commit.parents[0],
      commit.hash,
    );
  }

  public async workingTreeChanges(
    repository: string,
    headHash: string,
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
  ): Promise<ChangedFile[]> {
    const entries = await this.changedEntriesBetween(repository, base, tip);
    return entries.map(changedFileFromEntry);
  }

  public async commitFileChanges(
    repository: string,
    commit: Commit,
  ): Promise<CommitFileChange[]> {
    const parentHash = commit.parents[0];
    const entries = await this.changedEntriesBetween(
      repository,
      parentHash,
      commit.hash,
    );
    return entries.map((entry) => ({
      ...changedFileFromEntry(entry),
      commitHash: commit.hash,
      ...(parentHash === undefined ? {} : { parentHash }),
      oldObject: entry.oldObject,
      newObject: entry.newObject,
    }));
  }

  private async changedEntriesBetween(
    repository: string,
    base: string | undefined,
    tip: string,
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
      content: classifyChangedFile(entry, binaryPaths, objectInfo),
    }));
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

  public async readWorkingFile(
    repository: string,
    path: string,
  ): Promise<Buffer> {
    const absolutePath = resolveWorkingPath(repository, path);
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      return Buffer.from(await readlink(absolutePath));
    }
    if (!stats.isFile()) {
      throw new GitError(`Working tree path is not a regular file: ${path}`);
    }
    if (stats.size > MAX_TEXT_BLOB_BYTES) {
      throw new GitError(`Working tree file is larger than 5 MiB: ${path}`);
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

  private async run(directory: string, args: string[]): Promise<Buffer> {
    const gitArgs = commandArgs(directory, args);

    try {
      const { stdout } = await execFileAsync("git", gitArgs, {
        encoding: "buffer",
        maxBuffer: MAX_BUFFER,
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
  if (size !== undefined && size > MAX_TEXT_BLOB_BYTES) {
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
  if (size !== undefined && size > MAX_TEXT_BLOB_BYTES) {
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
