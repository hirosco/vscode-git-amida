import * as vscode from "vscode";

import { BranchMutationService } from "./branchSwitcher";
import {
  GitContentProvider,
  GitImageFileSystemProvider,
} from "./contentProvider";
import { NativeDiffSessionRegistry } from "./diffSessions";
import { ExternalDifftoolService } from "./externalDifftool";
import { FileRestoreService } from "./fileRestorer";
import { GitClient } from "./git";
import { observeGitRepositories } from "./gitEvents";
import { HistoryViewProvider } from "./panel";

export function activate(context: vscode.ExtensionContext): void {
  const git = new GitClient();
  const branchMutations = new BranchMutationService();
  const contentProvider = new GitContentProvider();
  const imageProvider = new GitImageFileSystemProvider();
  const diffSessions = new NativeDiffSessionRegistry();
  const externalDifftool = new ExternalDifftoolService();
  const fileRestorer = new FileRestoreService();
  const updateActiveDiffContext = (): void => {
    void vscode.commands.executeCommand(
      "setContext",
      "gitAmida.activeDiff",
      activeDiffSession(diffSessions) !== undefined,
    );
  };
  const unregisterDiffSessionListener =
    diffSessions.onDidRegister(updateActiveDiffContext);
  const historyProvider = new HistoryViewProvider(
    context.extensionUri,
    git,
    branchMutations,
    contentProvider,
    imageProvider,
    diffSessions,
    externalDifftool,
    fileRestorer,
    context.workspaceState,
    context.globalState,
  );

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      "git-amida",
      contentProvider,
    ),
    vscode.workspace.registerFileSystemProvider(
      "git-amida-image",
      imageProvider,
      { isReadonly: true, isCaseSensitive: true },
    ),
    vscode.window.registerWebviewViewProvider(
      HistoryViewProvider.viewType,
      historyProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand("gitAmida.open", async () => {
      await vscode.commands.executeCommand("gitAmida.history.focus");
    }),
    vscode.commands.registerCommand("gitAmida.refresh", async () => {
      await historyProvider.refresh();
    }),
    vscode.commands.registerCommand(
      "gitAmida.openFileHistory",
      async (contextValue?: unknown) => {
        const filePath = contextFilePath(contextValue);
        if (filePath !== undefined) {
          await historyProvider.openFileHistory(filePath);
          return;
        }

        const resource =
          contextResourceUri(contextValue) ??
          vscode.window.activeTextEditor?.document.uri;
        if (resource?.scheme === "file") {
          await vscode.commands.executeCommand("gitAmida.history.focus");
          await historyProvider.openFileHistoryForResource(resource);
          return;
        }

        await historyProvider.openFileHistory();
      },
    ),
    vscode.commands.registerCommand(
      "gitAmida.openFileHistoryFromChangedFile",
      async (contextValue?: unknown) => {
        await vscode.commands.executeCommand(
          "gitAmida.openFileHistory",
          contextValue,
        );
      },
    ),
    vscode.commands.registerCommand(
      "gitAmida.openChanges",
      async (contextValue?: unknown) => {
        await historyProvider.openChangedFileDiff(
          contextFilePath(contextValue),
        );
      },
    ),
    vscode.commands.registerCommand("gitAmida.openInDifftool", async (
      contextValue?: unknown,
    ) => {
      const filePath = contextFilePath(contextValue);
      if (filePath !== undefined) {
        await historyProvider.openFileInDifftool(filePath);
        return;
      }
      const activeDiff = activeDiffSession(diffSessions);
      if (activeDiff === undefined) {
        await vscode.window.showInformationMessage(
          "GitAmida: Open a GitAmida diff before using an external diff tool.",
        );
        return;
      }
      try {
        const [beforeContent, afterContent] = await Promise.all([
          readDiffContent(activeDiff.original),
          readDiffContent(activeDiff.modified),
        ]);
        await externalDifftool.open({
          repository: activeDiff.session.repository,
          beforePath: activeDiff.session.beforePath,
          afterPath: activeDiff.session.afterPath,
          beforeContent,
          afterContent,
        });
      } catch (error) {
        await vscode.window.showErrorMessage(
          `GitAmida: ${userMessage(error)}`,
        );
      }
    }),
    vscode.commands.registerCommand(
      "gitAmida.switchBranch",
      async (contextValue?: unknown) => {
        await historyProvider.switchBranchAtCommit(
          contextCommitHash(contextValue),
        );
      },
    ),
    vscode.commands.registerCommand(
      "gitAmida.restoreAfterFile",
      async (contextValue?: unknown) => {
        await historyProvider.restoreFile(
          contextFilePath(contextValue),
          "after",
        );
      },
    ),
    vscode.commands.registerCommand(
      "gitAmida.restoreBeforeFile",
      async (contextValue?: unknown) => {
        await historyProvider.restoreFile(
          contextFilePath(contextValue),
          "before",
        );
      },
    ),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.uri.scheme === "file") {
        historyProvider.scheduleRefresh("workingTree");
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("diffEditor.maxFileSize")) {
        historyProvider.scheduleRefresh("history");
      }
    }),
    vscode.window.tabGroups.onDidChangeTabs(updateActiveDiffContext),
    vscode.window.tabGroups.onDidChangeTabGroups(updateActiveDiffContext),
    new vscode.Disposable(unregisterDiffSessionListener),
    imageProvider,
    externalDifftool,
    historyProvider,
  );
  updateActiveDiffContext();
  void observeGitRepositories(
    context.subscriptions,
    (repository, scope) => {
      historyProvider.scheduleRefresh(scope, repository);
    },
  ).catch((error: unknown) => {
    console.warn("GitAmida: automatic Git refresh is unavailable.", error);
  });
}

export function deactivate(): void {}

function contextCommitHash(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const hash = (value as Record<string, unknown>).gitAmidaCommitHash;
  return typeof hash === "string" ? hash : undefined;
}

function contextFilePath(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const path = (value as Record<string, unknown>).gitAmidaFilePath;
  return typeof path === "string" ? path : undefined;
}

function contextResourceUri(value: unknown): vscode.Uri | undefined {
  return value instanceof vscode.Uri ? value : undefined;
}

function activeDiffSession(
  diffSessions: NativeDiffSessionRegistry,
):
  | {
      original: vscode.Uri;
      modified: vscode.Uri;
      session: NonNullable<
        ReturnType<NativeDiffSessionRegistry["get"]>
      >;
    }
  | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (!(input instanceof vscode.TabInputTextDiff)) {
    if (
      input instanceof vscode.TabInputCustom &&
      input.viewType === "imagePreview.previewEditor"
    ) {
      const session = diffSessions.getByUri(input.uri.toString());
      if (session !== undefined) {
        return {
          original: vscode.Uri.parse(session.originalUri),
          modified: vscode.Uri.parse(session.modifiedUri),
          session,
        };
      }
    }
    return undefined;
  }
  const session = diffSessions.get(
    input.original.toString(),
    input.modified.toString(),
  );
  return session === undefined
    ? undefined
    : { original: input.original, modified: input.modified, session };
}

async function readDiffContent(uri: vscode.Uri): Promise<Uint8Array> {
  if (uri.scheme === "git-amida-image") {
    return vscode.workspace.fs.readFile(uri);
  }
  if (uri.scheme === "git-amida") {
    const document = await vscode.workspace.openTextDocument(uri);
    return Buffer.from(document.getText(), "utf8");
  }
  throw new Error("The active diff does not use GitAmida content.");
}

function userMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
