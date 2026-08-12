import * as vscode from "vscode";

import { BranchMutationService } from "./branchSwitcher";
import {
  GitBlobFileSystemProvider,
  GitContentProvider,
} from "./contentProvider";
import {
  isNativeDiffSessionOpen,
  type NativeDiffSession,
  type NativeDiffTabIdentity,
  NativeDiffSessionRegistry,
} from "./diffSessions";
import { ExternalDifftoolService } from "./externalDifftool";
import { FileRestoreService } from "./fileRestorer";
import { GitClient } from "./git";
import { observeGitRepositories } from "./gitEvents";
import { HistoryViewProvider } from "./panel";

export function activate(context: vscode.ExtensionContext): void {
  const diagnosticOutput = vscode.window.createOutputChannel("GitAmida");
  const git = new GitClient((event) => {
    if (
      (event.status === "completed" && event.durationMs < 1_000) ||
      (event.status === "cancelled" && event.durationMs < 250)
    ) {
      return;
    }
    diagnosticOutput.appendLine(
      `${event.operation}: ${event.status} in ${event.durationMs} ms${event.message === undefined ? "" : ` — ${event.message}`}`,
    );
  });
  const branchMutations = new BranchMutationService();
  const contentProvider = new GitContentProvider();
  const blobProvider = new GitBlobFileSystemProvider();
  const diffSessions = new NativeDiffSessionRegistry();
  const externalDifftool = new ExternalDifftoolService();
  const fileRestorer = new FileRestoreService();
  const pendingDiffReleases = new Set<ReturnType<typeof setTimeout>>();
  const updateActiveDiffContext = (): void => {
    void vscode.commands.executeCommand(
      "setContext",
      "gitAmida.activeDiff",
      activeDiffSession(diffSessions) !== undefined,
    );
  };
  const unregisterDiffSessionListener =
    diffSessions.onDidChange(updateActiveDiffContext);
  const historyProvider = new HistoryViewProvider(
    context.extensionUri,
    git,
    branchMutations,
    contentProvider,
    blobProvider,
    diffSessions,
    externalDifftool,
    fileRestorer,
    context.workspaceState,
    context.globalState,
  );

  context.subscriptions.push(
    diagnosticOutput,
    vscode.workspace.registerTextDocumentContentProvider(
      "git-amida",
      contentProvider,
    ),
    vscode.workspace.registerFileSystemProvider(
      "git-amida-blob",
      blobProvider,
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
      "gitAmida.showInRepositoryHistory",
      async (contextValue?: unknown) => {
        await historyProvider.showFileRevisionInRepositoryHistory(
          contextFileHistoryTabId(contextValue),
          contextCommitHash(contextValue),
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
      "gitAmida.openInDifftoolFromChangedFile",
      async (contextValue?: unknown) => {
        await vscode.commands.executeCommand(
          "gitAmida.openInDifftool",
          contextValue,
        );
      },
    ),
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
    vscode.window.tabGroups.onDidChangeTabs((event) => {
      for (const tab of event.closed) {
        scheduleDiffTabRelease(
          tab,
          pendingDiffReleases,
          diffSessions,
          contentProvider,
          blobProvider,
          updateActiveDiffContext,
        );
      }
      updateActiveDiffContext();
    }),
    vscode.window.tabGroups.onDidChangeTabGroups(updateActiveDiffContext),
    new vscode.Disposable(unregisterDiffSessionListener),
    new vscode.Disposable(() => {
      for (const timer of pendingDiffReleases) {
        clearTimeout(timer);
      }
      pendingDiffReleases.clear();
    }),
    contentProvider,
    blobProvider,
    diffSessions,
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

function contextFileHistoryTabId(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const tabId = (value as Record<string, unknown>).gitAmidaFileHistoryTabId;
  return typeof tabId === "string" ? tabId : undefined;
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
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const identity = tab === undefined ? undefined : diffTabIdentity(tab);
  const session =
    identity === undefined ? undefined : diffSessions.getForTab(identity);
  return session === undefined
    ? undefined
    : {
        original: vscode.Uri.parse(session.originalUri),
        modified: vscode.Uri.parse(session.modifiedUri),
        session,
      };
}

function scheduleDiffTabRelease(
  tab: vscode.Tab,
  pending: Set<ReturnType<typeof setTimeout>>,
  diffSessions: NativeDiffSessionRegistry,
  contentProvider: GitContentProvider,
  blobProvider: GitBlobFileSystemProvider,
  updateActiveDiffContext: () => void,
): void {
  const identity = diffTabIdentity(tab);
  const session =
    identity === undefined ? undefined : diffSessions.getForTab(identity);
  if (session === undefined) {
    return;
  }
  const timer = setTimeout(() => {
    pending.delete(timer);
    const openTabs = vscode.window.tabGroups.all.flatMap((group) =>
      group.tabs.flatMap((candidate) => {
        const openIdentity = diffTabIdentity(candidate);
        return openIdentity === undefined ? [] : [openIdentity];
      }),
    );
    if (!isNativeDiffSessionOpen(session, openTabs)) {
      releaseDiffSession(
        session,
        diffSessions,
        contentProvider,
        blobProvider,
      );
    }
    updateActiveDiffContext();
  }, 0);
  pending.add(timer);
}

function diffTabIdentity(tab: vscode.Tab): NativeDiffTabIdentity | undefined {
  const input = tab.input;
  if (input instanceof vscode.TabInputTextDiff) {
    return {
      kind: "diff",
      originalUri: input.original.toString(),
      modifiedUri: input.modified.toString(),
    };
  }
  if (
    input instanceof vscode.TabInputCustom &&
    input.viewType === "imagePreview.previewEditor"
  ) {
    return { kind: "resource", uri: input.uri.toString() };
  }
  return undefined;
}

function releaseDiffSession(
  session: NativeDiffSession,
  diffSessions: NativeDiffSessionRegistry,
  contentProvider: GitContentProvider,
  blobProvider: GitBlobFileSystemProvider,
): void {
  if (
    diffSessions.get(session.originalUri, session.modifiedUri) !== session
  ) {
    return;
  }
  const released = diffSessions.remove(
    session.originalUri,
    session.modifiedUri,
  );
  if (released === undefined) {
    return;
  }
  for (const value of [released.originalUri, released.modifiedUri]) {
    const uri = vscode.Uri.parse(value);
    if (uri.scheme === "git-amida") {
      contentProvider.remove(uri);
    } else if (uri.scheme === "git-amida-blob") {
      blobProvider.remove(uri);
    }
  }
}

async function readDiffContent(uri: vscode.Uri): Promise<Uint8Array> {
  if (uri.scheme === "git-amida-blob") {
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
