import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import type { Stats } from "node:fs";
import {
  lstat,
  mkdir,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_METADATA_BUFFER = 4 * 1024 * 1024;
const MIN_BLOB_BUFFER = 4 * 1024 * 1024;

interface GitCommandFailure extends Error {
  code?: string | number;
  stderr?: Buffer | string;
}

interface GitTreeEntry {
  mode: string;
  type: string;
  object: string;
  path: string;
}

interface GitIndexEntry {
  mode: string;
  stage: number;
  path: string;
}

interface DestinationSnapshot {
  exists: boolean;
  stats?: Stats;
}

interface RestoreInspection {
  repository: string;
  sourceObject: string;
  sourceMode: string;
  destination: string;
  destinationSnapshot: DestinationSnapshot;
}

export interface FileRestoreRequest {
  repository: string;
  sourceRef: string;
  sourcePath: string;
  destinationPath: string;
}

export interface FileRestorePlan {
  destination: string;
  destinationExists: boolean;
}

export class FileRestoreError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "FileRestoreError";
  }
}

export class FileRestoreService {
  public async preflight(
    request: FileRestoreRequest,
  ): Promise<FileRestorePlan> {
    return restorePlan(await this.inspect(request));
  }

  public async restore(
    request: FileRestoreRequest,
  ): Promise<FileRestorePlan> {
    const initial = await this.inspect(request);
    const content = await this.readBlob(
      initial.repository,
      initial.sourceObject,
    );
    await mkdir(dirname(initial.destination), { recursive: true });

    const prepared = await this.inspect(request);
    if (
      prepared.sourceObject !== initial.sourceObject ||
      prepared.destination !== initial.destination
    ) {
      throw new FileRestoreError(
        "The selected source or destination changed. Refresh history and try again.",
      );
    }

    const temporaryPath = resolve(
      dirname(prepared.destination),
      `.git-amida-${randomUUID()}.tmp`,
    );
    const mode = prepared.destinationSnapshot.stats?.mode ??
      (prepared.sourceMode === "100755" ? 0o755 : 0o644);
    await writeFile(temporaryPath, content, {
      flag: "wx",
      mode: mode & 0o777,
    });

    try {
      const finalInspection = await this.inspect(request);
      if (
        finalInspection.sourceObject !== prepared.sourceObject ||
        finalInspection.destination !== prepared.destination ||
        !sameDestination(
          prepared.destinationSnapshot,
          finalInspection.destinationSnapshot,
        )
      ) {
        throw new FileRestoreError(
          "The destination changed while restoring. No file was replaced.",
        );
      }
      await rename(temporaryPath, prepared.destination);
    } finally {
      await unlink(temporaryPath).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      });
    }

    return restorePlan(prepared);
  }

  private async inspect(
    request: FileRestoreRequest,
  ): Promise<RestoreInspection> {
    if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(request.sourceRef)) {
      throw new FileRestoreError(
        "The selected revision is no longer valid. Refresh history and try again.",
      );
    }

    let repository: string;
    try {
      repository = await realpath(request.repository);
    } catch (error) {
      throw new FileRestoreError(fileSystemMessage(error));
    }
    const sourcePath = toGitPath(
      repositoryPath(repository, request.sourcePath, "source"),
    );
    const destination = repositoryPath(
      repository,
      request.destinationPath,
      "destination",
    );
    const destinationPath = toGitPath(relative(repository, destination));

    const [sourceEntry, destinationSnapshot, indexEntries, staged, unstaged] =
      await Promise.all([
        this.sourceEntry(repository, request.sourceRef, sourcePath),
        inspectDestination(repository, destination),
        this.destinationIndexEntries(repository, destinationPath),
        this.run(repository, [
          "diff",
          "--cached",
          "--name-only",
          "-z",
          "--no-ext-diff",
          "--ignore-submodules=none",
          "--",
          destinationPath,
        ]),
        this.run(repository, [
          "diff",
          "--name-only",
          "-z",
          "--no-ext-diff",
          "--ignore-submodules=none",
          "--",
          destinationPath,
        ]),
      ]);

    if (sourceEntry.mode === "120000") {
      throw new FileRestoreError(
        "A symbolic-link revision cannot be restored as a working-tree file.",
      );
    }
    if (sourceEntry.mode === "160000" || sourceEntry.type === "commit") {
      throw new FileRestoreError(
        "A submodule revision cannot be restored as a working-tree file.",
      );
    }
    if (sourceEntry.type !== "blob") {
      throw new FileRestoreError(
        "The selected revision is not a regular Git file.",
      );
    }

    const prefixes = new Set(pathPrefixes(destinationPath));
    if (
      indexEntries.some(
        (entry) => entry.mode === "160000" && prefixes.has(entry.path),
      )
    ) {
      throw new FileRestoreError(
        "Files inside a submodule cannot be restored from GitAmida.",
      );
    }

    const exactEntries = indexEntries.filter(
      (entry) => entry.path === destinationPath,
    );
    if (
      exactEntries.some((entry) => entry.mode === "120000")
    ) {
      throw new FileRestoreError(
        "A tracked symbolic link cannot be replaced by file restoration.",
      );
    }
    if (
      exactEntries.length > 1 ||
      exactEntries.some((entry) => entry.stage !== 0)
    ) {
      throw new FileRestoreError(
        `"${request.destinationPath}" has unresolved index entries. Resolve them before restoring.`,
      );
    }
    if (staged.length > 0) {
      throw new FileRestoreError(
        `"${request.destinationPath}" has staged changes. Commit or restore them first.`,
      );
    }
    if (unstaged.length > 0) {
      throw new FileRestoreError(
        `"${request.destinationPath}" has unstaged changes. Commit or restore them first.`,
      );
    }
    if (destinationSnapshot.exists && exactEntries.length === 0) {
      throw new FileRestoreError(
        `"${request.destinationPath}" is untracked or ignored. Move or remove it before restoring.`,
      );
    }
    if (!destinationSnapshot.exists && exactEntries.length > 0) {
      throw new FileRestoreError(
        `"${request.destinationPath}" is missing from the working tree. Restore or commit that deletion first.`,
      );
    }
    if (destinationSnapshot.exists && exactEntries.length === 1) {
      const flags = await this.run(repository, [
        "ls-files",
        "-v",
        "-z",
        "--",
        destinationPath,
      ]);
      const tag = flags.toString("utf8", 0, 1);
      if (tag !== "H") {
        throw new FileRestoreError(
          `"${request.destinationPath}" uses special index flags. Clear them before restoring.`,
        );
      }
    }

    return {
      repository,
      sourceObject: sourceEntry.object,
      sourceMode: sourceEntry.mode,
      destination,
      destinationSnapshot,
    };
  }

  private async sourceEntry(
    repository: string,
    sourceRef: string,
    sourcePath: string,
  ): Promise<GitTreeEntry> {
    const output = await this.run(repository, [
      "ls-tree",
      "--full-tree",
      "-z",
      sourceRef,
      "--",
      sourcePath,
    ]);
    const entries = parseTreeEntries(output);
    const entry = entries.find((candidate) => candidate.path === sourcePath);
    if (entry === undefined) {
      throw new FileRestoreError(
        "The selected file revision no longer exists. Refresh history and try again.",
      );
    }
    return entry;
  }

  private async destinationIndexEntries(
    repository: string,
    destinationPath: string,
  ): Promise<GitIndexEntry[]> {
    return parseIndexEntries(
      await this.run(repository, [
        "ls-files",
        "--stage",
        "-z",
        "--",
        ...pathPrefixes(destinationPath),
      ]),
    );
  }

  private async readBlob(
    repository: string,
    object: string,
  ): Promise<Buffer> {
    const sizeOutput = await this.run(repository, ["cat-file", "-s", object]);
    const size = Number.parseInt(sizeOutput.toString("utf8").trim(), 10);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new FileRestoreError("Git returned an invalid blob size.");
    }
    return this.run(
      repository,
      ["cat-file", "blob", object],
      Math.max(MIN_BLOB_BUFFER, size + 1024),
      60_000,
    );
  }

  private async run(
    repository: string,
    args: string[],
    maxBuffer = MAX_METADATA_BUFFER,
    timeout = 15_000,
  ): Promise<Buffer> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        commandArgs(repository, args),
        {
          encoding: "buffer",
          maxBuffer,
          timeout,
          env: commandEnvironment(),
        },
      );
      return stdout;
    } catch (error) {
      throw new FileRestoreError(commandMessage(error));
    }
  }
}

function restorePlan(inspection: RestoreInspection): FileRestorePlan {
  return {
    destination: inspection.destination,
    destinationExists: inspection.destinationSnapshot.exists,
  };
}

function repositoryPath(
  repository: string,
  value: string,
  label: "source" | "destination",
): string {
  if (value.length === 0 || value.includes("\0") || isAbsolute(value)) {
    throw new FileRestoreError(`The ${label} path is not repository-relative.`);
  }
  const absolute = resolve(repository, value);
  const relativePath = relative(repository, absolute);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new FileRestoreError(`The ${label} path is outside the repository.`);
  }
  return label === "source" ? relativePath : absolute;
}

async function inspectDestination(
  repository: string,
  destination: string,
): Promise<DestinationSnapshot> {
  const components = relative(repository, destination).split(sep);
  let current = repository;
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (component === undefined) {
      continue;
    }
    current = resolve(current, component);
    let stats: Stats;
    try {
      stats = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { exists: false };
      }
      throw new FileRestoreError(fileSystemMessage(error));
    }
    if (stats.isSymbolicLink()) {
      throw new FileRestoreError(
        "The destination crosses or replaces a symbolic link.",
      );
    }
    const isDestination = index === components.length - 1;
    if (!isDestination && !stats.isDirectory()) {
      throw new FileRestoreError(
        "A destination path component is not a directory.",
      );
    }
    if (isDestination) {
      if (!stats.isFile()) {
        throw new FileRestoreError(
          "The destination exists but is not a regular file.",
        );
      }
      return { exists: true, stats };
    }
  }
  return { exists: false };
}

function pathPrefixes(path: string): string[] {
  const components = path.split("/");
  const prefixes: string[] = [];
  for (let index = 1; index <= components.length; index += 1) {
    prefixes.push(components.slice(0, index).join("/"));
  }
  return prefixes;
}

function toGitPath(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

function parseTreeEntries(output: Buffer): GitTreeEntry[] {
  const entries: GitTreeEntry[] = [];
  for (const record of output.toString("utf8").split("\0")) {
    if (record.length === 0) {
      continue;
    }
    const tab = record.indexOf("\t");
    const metadata = tab === -1 ? "" : record.slice(0, tab);
    const path = tab === -1 ? "" : record.slice(tab + 1);
    const [mode, type, object] = metadata.split(" ");
    if (
      mode === undefined ||
      type === undefined ||
      object === undefined ||
      path.length === 0
    ) {
      throw new FileRestoreError("Git returned an invalid tree entry.");
    }
    entries.push({ mode, type, object, path });
  }
  return entries;
}

function parseIndexEntries(output: Buffer): GitIndexEntry[] {
  const entries: GitIndexEntry[] = [];
  for (const record of output.toString("utf8").split("\0")) {
    if (record.length === 0) {
      continue;
    }
    const tab = record.indexOf("\t");
    const metadata = tab === -1 ? "" : record.slice(0, tab);
    const path = tab === -1 ? "" : record.slice(tab + 1);
    const [mode, _object, rawStage] = metadata.split(" ");
    const stage = Number.parseInt(rawStage ?? "", 10);
    if (mode === undefined || !Number.isInteger(stage) || path.length === 0) {
      throw new FileRestoreError("Git returned an invalid index entry.");
    }
    entries.push({ mode, stage, path });
  }
  return entries;
}

function sameDestination(
  before: DestinationSnapshot,
  after: DestinationSnapshot,
): boolean {
  if (before.exists !== after.exists) {
    return false;
  }
  if (!before.exists) {
    return true;
  }
  const left = before.stats;
  const right = after.stats;
  return (
    left !== undefined &&
    right !== undefined &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function commandArgs(repository: string, args: string[]): string[] {
  return [
    "-C",
    repository,
    "--no-pager",
    "--literal-pathspecs",
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

function commandMessage(error: unknown): string {
  const details = error as GitCommandFailure;
  const stderr = Buffer.isBuffer(details.stderr)
    ? details.stderr.toString("utf8").trim()
    : String(details.stderr ?? "").trim();
  return stderr || details.message || "Git command failed.";
}

function fileSystemMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
