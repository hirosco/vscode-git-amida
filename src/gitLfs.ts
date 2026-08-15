import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const MAX_GIT_LFS_POINTER_BYTES = 1024;
const POINTER_VERSION = "version https://git-lfs.github.com/spec/v1";

export interface GitLfsPointer {
  oid: string;
  size: number;
}

export class GitLfsError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GitLfsError";
  }
}

export function parseGitLfsPointer(
  content: Buffer,
): GitLfsPointer | undefined {
  if (content.byteLength > MAX_GIT_LFS_POINTER_BYTES) {
    return undefined;
  }
  const text = content.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(content)) {
    return undefined;
  }
  const normalized = text.replaceAll("\r\n", "\n");
  if (normalized.includes("\r")) {
    return undefined;
  }
  const lines = normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n")
    : normalized.split("\n");
  if (lines[0] !== POINTER_VERSION) {
    return undefined;
  }
  if (lines.some((line) => line.startsWith("ext-"))) {
    throw new GitLfsError(
      "Git LFS pointer extensions are not supported by GitAmida.",
    );
  }
  if (lines.length !== 3) {
    throw new GitLfsError("The historical Git LFS pointer is malformed.");
  }
  const oidMatch = /^oid sha256:([0-9a-f]{64})$/.exec(lines[1] ?? "");
  const sizeMatch = /^size (0|[1-9][0-9]*)$/.exec(lines[2] ?? "");
  if (oidMatch === null || sizeMatch === null) {
    throw new GitLfsError("The historical Git LFS pointer is malformed.");
  }
  const size = Number(sizeMatch[1]);
  if (!Number.isSafeInteger(size)) {
    throw new GitLfsError(
      "The historical Git LFS object size is not safely representable.",
    );
  }
  return { oid: oidMatch[1] ?? "", size };
}

export async function findLocalGitLfsObject(
  storageDirectory: string,
  pointer: GitLfsPointer,
): Promise<string | undefined> {
  const objectPath = gitLfsObjectPath(storageDirectory, pointer.oid);
  let stats;
  try {
    stats = await lstat(objectPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new GitLfsError(
      `The local Git LFS object ${pointer.oid} is not a regular file.`,
    );
  }
  if (stats.size !== pointer.size) {
    throw new GitLfsError(
      `The local Git LFS object ${pointer.oid} has an unexpected size.`,
    );
  }
  const [canonicalStorage, canonicalObject] = await Promise.all([
    realpath(storageDirectory),
    realpath(objectPath),
  ]);
  if (!isPathInside(canonicalStorage, canonicalObject)) {
    throw new GitLfsError(
      `The local Git LFS object ${pointer.oid} resolves outside its storage directory.`,
    );
  }
  return objectPath;
}

export async function readLocalGitLfsObject(
  storageDirectory: string,
  pointer: GitLfsPointer,
  signal?: AbortSignal,
): Promise<Buffer | undefined> {
  const objectPath = await findLocalGitLfsObject(storageDirectory, pointer);
  if (objectPath === undefined) {
    return undefined;
  }
  const content = signal === undefined
    ? await readFile(objectPath)
    : await readFile(objectPath, { signal });
  const oid = createHash("sha256").update(content).digest("hex");
  if (content.byteLength !== pointer.size || oid !== pointer.oid) {
    throw new GitLfsError(
      `The local Git LFS object ${pointer.oid} failed integrity verification.`,
    );
  }
  return content;
}

export function gitLfsFetchArgs(
  remote: string,
  ref: string,
  path: string,
): string[] {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(remote)) {
    throw new GitLfsError("The Git LFS remote name is not safe to use.");
  }
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(ref)) {
    throw new GitLfsError("The Git LFS revision is not a commit hash.");
  }
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path !== path.trim() ||
    path
      .split("/")
      .some(
        (component) =>
          component === "" || component === "." || component === "..",
      ) ||
    /[\0\r\n\t,#!*?[\]\\]/.test(path)
  ) {
    throw new GitLfsError(
      "This path uses characters that cannot be limited to one safe Git LFS fetch. Fetch the object with Git LFS outside GitAmida and try again.",
    );
  }
  return [
    "-c",
    "lfs.fetchrecentalways=false",
    "-c",
    "lfs.remote.autodetect=false",
    "-c",
    "lfs.remote.searchall=false",
    "lfs",
    "fetch",
    `--include=${path}`,
    "--exclude=",
    remote,
    ref,
  ];
}

function gitLfsObjectPath(storageDirectory: string, oid: string): string {
  return resolve(
    storageDirectory,
    "objects",
    oid.slice(0, 2),
    oid.slice(2, 4),
    oid,
  );
}

function isPathInside(parent: string, path: string): boolean {
  const relativePath = relative(parent, path);
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}
