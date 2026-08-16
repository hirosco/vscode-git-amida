import { dirname, isAbsolute, relative, sep } from "node:path";

import * as vscode from "vscode";

import { conflictSupportsMergetool } from "./conflicts";
import { GitClient } from "./git";
import type { FileConflict } from "./model";

const ACTIVE_CONFLICT_CONTEXT =
  "gitAmida.activeConflictSupportsMergetool";

type HasConfiguredMergetool = (repository: string) => Promise<boolean>;

export interface ActiveConflict {
  resource: vscode.Uri;
  repository: string;
  path: string;
  conflict: FileConflict;
}

export class ActiveConflictTracker implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[];
  private request = 0;
  private value?: ActiveConflict;

  public constructor(
    private readonly git: GitClient,
    private readonly hasConfiguredMergetool: HasConfiguredMergetool,
  ) {
    this.disposables = [
      vscode.window.onDidChangeActiveTextEditor(() => {
        void this.refresh();
      }),
      vscode.window.tabGroups.onDidChangeTabs(() => {
        void this.refresh();
      }),
      vscode.window.tabGroups.onDidChangeTabGroups(() => {
        void this.refresh();
      }),
    ];
    void this.refresh();
  }

  public get current(): ActiveConflict | undefined {
    return this.value;
  }

  public async refresh(): Promise<void> {
    const request = ++this.request;
    this.value = undefined;
    await vscode.commands.executeCommand(
      "setContext",
      ACTIVE_CONFLICT_CONTEXT,
      false,
    );
    const resource = activeConflictEditorResource();
    if (resource === undefined) {
      return;
    }
    try {
      const repository = await this.git.resolveRepository(
        dirname(resource.fsPath),
      );
      const path = relative(repository, resource.fsPath);
      if (
        path === "" ||
        path === ".." ||
        path.startsWith(`..${sep}`) ||
        isAbsolute(path)
      ) {
        return;
      }
      const gitPath = path.split(sep).join("/");
      const conflict = await this.git.conflictAtPath(repository, gitPath);
      if (
        request !== this.request ||
        conflict === undefined ||
        !conflictSupportsMergetool(conflict)
      ) {
        return;
      }
      const hasConfiguredMergetool =
        await this.hasConfiguredMergetool(repository);
      if (request !== this.request) {
        return;
      }
      this.value = { resource, repository, path: gitPath, conflict };
      if (!hasConfiguredMergetool) {
        return;
      }
      await vscode.commands.executeCommand(
        "setContext",
        ACTIVE_CONFLICT_CONTEXT,
        true,
      );
    } catch {
      // Editor context is optional and must not surface repository discovery errors.
    }
  }

  public dispose(): void {
    this.request += 1;
    this.value = undefined;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    void vscode.commands.executeCommand(
      "setContext",
      ACTIVE_CONFLICT_CONTEXT,
      false,
    );
  }
}

function activeConflictEditorResource(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (mergeEditorResult(input) !== undefined) {
    return undefined;
  }
  const editorResource = vscode.window.activeTextEditor?.document.uri;
  if (editorResource?.scheme === "file") {
    return editorResource;
  }
  if (input instanceof vscode.TabInputText) {
    return input.uri.scheme === "file" ? input.uri : undefined;
  }
  if (input instanceof vscode.TabInputTextDiff) {
    return input.modified.scheme === "file" ? input.modified : undefined;
  }
  if (input instanceof vscode.TabInputCustom) {
    return input.uri.scheme === "file" ? input.uri : undefined;
  }
  return undefined;
}

function mergeEditorResult(input: unknown): vscode.Uri | undefined {
  if (input === null || typeof input !== "object") {
    return undefined;
  }
  const result = (input as Record<string, unknown>).result;
  return result instanceof vscode.Uri && result.scheme === "file"
    ? result
    : undefined;
}
