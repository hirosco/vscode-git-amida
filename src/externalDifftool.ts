import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface ExternalDiffRequest {
  repository: string;
  beforePath: string;
  afterPath: string;
  beforeContent: Uint8Array;
  afterContent: Uint8Array;
}

interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type RunGit = (
  repository: string,
  args: readonly string[],
) => Promise<GitResult>;

export class ExternalDifftoolService {
  private readonly temporaryDirectories = new Set<string>();

  public constructor(private readonly runGit: RunGit = executeGit) {}

  public async open(request: ExternalDiffRequest): Promise<void> {
    const tool = await this.configuredTool(request.repository);
    if (tool === undefined) {
      throw new Error(
        "No Git diff tool is configured. Configure Git's diff.tool and try again.",
      );
    }

    const directory = await mkdtemp(join(tmpdir(), "git-amida-difftool-"));
    this.temporaryDirectories.add(directory);
    await chmod(directory, 0o700);
    const beforeDirectory = join(directory, "before");
    const afterDirectory = join(directory, "after");
    await Promise.all([
      mkdir(beforeDirectory, { mode: 0o700 }),
      mkdir(afterDirectory, { mode: 0o700 }),
    ]);
    const beforeFile = join(
      beforeDirectory,
      endpointName(request.beforePath, "before"),
    );
    const afterFile = join(
      afterDirectory,
      endpointName(request.afterPath, "after"),
    );
    await Promise.all([
      writeFile(beforeFile, request.beforeContent, { mode: 0o600 }),
      writeFile(afterFile, request.afterContent, { mode: 0o600 }),
    ]);

    const result = await this.runGit(request.repository, [
      "difftool",
      "--no-prompt",
      "--no-index",
      "--",
      beforeFile,
      afterFile,
    ]);
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(
        result.stderr.trim() ||
          `Git difftool ${tool} exited with code ${result.exitCode}.`,
      );
    }
  }

  public dispose(): void {
    for (const directory of this.temporaryDirectories) {
      void rm(directory, { recursive: true, force: true });
    }
    this.temporaryDirectories.clear();
  }

  private async configuredTool(repository: string): Promise<string | undefined> {
    for (const key of ["diff.tool", "merge.tool"]) {
      const result = await this.runGit(repository, ["config", "--get", key]);
      if (result.exitCode === 0) {
        const value = result.stdout.trim();
        if (value !== "") {
          return value;
        }
      } else if (result.exitCode !== 1) {
        throw new Error(
          result.stderr.trim() ||
            `Git config lookup exited with code ${result.exitCode}.`,
        );
      }
    }
    return undefined;
  }
}

function endpointName(path: string, fallback: string): string {
  const name = basename(path);
  return name === "" || name === "." || name === ".." ? fallback : name;
}

function executeGit(
  repository: string,
  args: readonly string[],
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", repository, ...args],
      {
        encoding: "utf8",
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error !== null && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve({
          exitCode:
            error !== null && typeof error.code === "number" ? error.code : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}
