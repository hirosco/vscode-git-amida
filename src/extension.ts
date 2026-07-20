import * as vscode from "vscode";

import { GitContentProvider } from "./contentProvider";
import { GitClient } from "./git";
import { HistoryViewProvider } from "./panel";

export function activate(context: vscode.ExtensionContext): void {
  const git = new GitClient();
  const contentProvider = new GitContentProvider();
  const historyProvider = new HistoryViewProvider(
    context.extensionUri,
    git,
    contentProvider,
  );

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      "git-amida",
      contentProvider,
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
  );
}

export function deactivate(): void {}
