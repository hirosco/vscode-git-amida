import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export class WorkingTreeFileError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WorkingTreeFileError";
  }
}

export async function resolveWorkingTreeFile(
  repository: string,
  path: string,
): Promise<string> {
  if (path.length === 0 || path.includes("\0") || isAbsolute(path)) {
    throw new WorkingTreeFileError("The file path is not repository-relative.");
  }

  const absolutePath = resolve(repository, path);
  if (!isPathInside(repository, absolutePath)) {
    throw new WorkingTreeFileError("The file path is outside the repository.");
  }

  try {
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new WorkingTreeFileError(
        "The working-tree path is not a regular file.",
      );
    }
    const [canonicalRepository, canonicalFile] = await Promise.all([
      realpath(repository),
      realpath(absolutePath),
    ]);
    if (!isPathInside(canonicalRepository, canonicalFile)) {
      throw new WorkingTreeFileError(
        "The working-tree file resolves outside the repository.",
      );
    }
    return absolutePath;
  } catch (error) {
    if (error instanceof WorkingTreeFileError) {
      throw error;
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new WorkingTreeFileError(
        "The working-tree file does not exist.",
      );
    }
    throw error;
  }
}

function isPathInside(repository: string, path: string): boolean {
  const relativePath = relative(repository, path);
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}
