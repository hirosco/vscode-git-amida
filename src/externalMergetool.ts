import { execFile } from "node:child_process";

import { conflictSupportsMergetool } from "./conflicts";
import type { FileConflict } from "./model";

const MAX_OUTPUT_BYTES = 1024 * 1024;

interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type RunGit = (
  repository: string,
  args: readonly string[],
) => Promise<GitResult>;

export interface ConfiguredMergetool {
  name: string;
  gui: boolean;
}

export interface ExternalMergeRequest {
  repository: string;
  path: string;
  conflict: FileConflict;
}

export class ExternalMergetoolService {
  public constructor(private readonly runGit: RunGit = executeGit) {}

  public async configuredTool(
    repository: string,
  ): Promise<ConfiguredMergetool | undefined> {
    for (const [key, gui] of [
      ["merge.tool", false],
      ["merge.guitool", true],
    ] as const) {
      const result = await this.runGit(repository, ["config", "--get", key]);
      if (result.exitCode === 0) {
        const name = result.stdout.trim();
        if (name !== "") {
          return { name, gui };
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

  public async open(request: ExternalMergeRequest): Promise<void> {
    if (!conflictSupportsMergetool(request.conflict)) {
      throw new Error(
        "This conflict does not have both index sides and cannot be opened in an external merge tool.",
      );
    }
    const tool = await this.configuredTool(request.repository);
    if (tool === undefined) {
      throw new Error(
        "No Git merge tool is configured. Configure Git's merge.tool or merge.guitool and try again.",
      );
    }
    const result = await this.runGit(request.repository, [
      "mergetool",
      ...(tool.gui ? ["--gui"] : []),
      "--no-prompt",
      "--",
      request.path,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr.trim() ||
          `Git mergetool ${tool.name} exited with code ${result.exitCode}.`,
      );
    }
  }
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
