import { randomBytes } from "node:crypto";
import { basename } from "node:path";

import * as vscode from "vscode";

import { GitContentProvider } from "./contentProvider";
import { GitClient, GitError } from "./git";
import type { ChangedFile, Commit, HistoryResult } from "./model";

interface WebviewMessage {
  type?: unknown;
  hash?: unknown;
  path?: unknown;
}

export class HistoryViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "gitAmida.history";

  private view?: vscode.WebviewView;
  private history?: HistoryResult;
  private readonly commits = new Map<string, Commit>();
  private historyRequest = 0;
  private filesRequest = 0;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly git: GitClient,
    private readonly contentProvider: GitContentProvider,
  ) {}

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((message: WebviewMessage) => {
      void this.receiveMessage(message);
    });
  }

  public async refresh(): Promise<void> {
    const request = ++this.historyRequest;
    ++this.filesRequest;
    await this.post({ type: "historyLoading" });

    try {
      const folder = this.workspaceFolder();
      if (folder === undefined) {
        throw new GitError("Open a folder containing a Git repository first.");
      }

      const history = await this.git.loadHistory(folder.uri.fsPath);
      if (request !== this.historyRequest) {
        return;
      }

      this.git.setRepository(history.repository.root);
      this.history = history;
      this.commits.clear();
      for (const row of history.rows) {
        if (row.kind === "commit") {
          this.commits.set(row.commit.hash, row.commit);
        }
      }

      await this.post({ type: "history", ...history });
      const firstCommit = history.rows.find(
        (row): row is Extract<(typeof history.rows)[number], { kind: "commit" }> =>
          row.kind === "commit",
      );
      if (firstCommit !== undefined) {
        await this.loadFiles(firstCommit.commit.hash);
      }
    } catch (error) {
      if (request !== this.historyRequest) {
        return;
      }
      await this.post({ type: "error", message: userMessage(error) });
    }
  }

  private async receiveMessage(message: WebviewMessage): Promise<void> {
    if (message === null || typeof message !== "object") {
      return;
    }

    if (message.type === "ready" || message.type === "refresh") {
      await this.refresh();
      return;
    }

    if (message.type === "selectCommit" && typeof message.hash === "string") {
      await this.loadFiles(message.hash);
      return;
    }

    if (
      message.type === "openDiff" &&
      typeof message.hash === "string" &&
      typeof message.path === "string"
    ) {
      await this.openDiff(message.hash, message.path);
    }
  }

  private async loadFiles(hash: string): Promise<void> {
    const commit = this.commits.get(hash);
    if (commit === undefined) {
      return;
    }

    const request = ++this.filesRequest;
    await this.post({ type: "filesLoading", hash });
    try {
      const files = await this.git.changedFiles(commit);
      if (request !== this.filesRequest) {
        return;
      }
      await this.post({ type: "files", hash, files });
    } catch (error) {
      if (request !== this.filesRequest) {
        return;
      }
      await this.post({
        type: "filesError",
        hash,
        message: userMessage(error),
      });
    }
  }

  private async openDiff(hash: string, path: string): Promise<void> {
    const commit = this.commits.get(hash);
    const file = this.findFile(hash, path);
    if (commit === undefined || file === undefined) {
      return;
    }

    const parent = commit.parents[0];
    const beforeRef = file.status.startsWith("A") ? undefined : parent;
    const afterRef = file.status.startsWith("D") ? undefined : commit.hash;
    const beforePath = file.oldPath ?? file.path;

    try {
      const [before, after] = await Promise.all([
        this.git.readBlob(beforeRef, beforePath),
        this.git.readBlob(afterRef, file.path),
      ]);
      if (isBinary(before) || isBinary(after)) {
        await vscode.window.showInformationMessage(
          "GitAmida: Binary and image diffs are not available in this comparison MVP.",
        );
        return;
      }

      const shortHash = commit.hash.slice(0, 8);
      const left = this.contentProvider.add(
        beforePath,
        `${shortHash}-parent`,
        before.toString("utf8"),
      );
      const right = this.contentProvider.add(
        file.path,
        shortHash,
        after.toString("utf8"),
      );
      await vscode.commands.executeCommand(
        "vscode.diff",
        left,
        right,
        `${basename(file.path)} (${shortHash})`,
        { preview: true },
      );
    } catch (error) {
      await vscode.window.showErrorMessage(`GitAmida: ${userMessage(error)}`);
    }
  }

  private findFile(hash: string, path: string): ChangedFile | undefined {
    return this.filesByCommit.get(hash)?.find((file) => file.path === path);
  }

  private selectedHash?: string;
  private readonly filesByCommit = new Map<string, ChangedFile[]>();

  private async post(message: Record<string, unknown>): Promise<void> {
    if (message.type === "files" && typeof message.hash === "string") {
      const files = message.files;
      if (Array.isArray(files)) {
        this.selectedHash = message.hash;
        this.filesByCommit.set(message.hash, files as ChangedFile[]);
      }
    }
    await this.view?.webview.postMessage(message);
  }

  private workspaceFolder(): vscode.WorkspaceFolder | undefined {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri !== undefined) {
      const activeFolder = vscode.workspace.getWorkspaceFolder(activeUri);
      if (activeFolder !== undefined) {
        return activeFolder;
      }
    }
    return vscode.workspace.workspaceFolders?.[0];
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString("base64");
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "main.css"),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "main.js"),
    );

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>GitAmida</title>
</head>
<body>
  <header class="repository-bar">
    <div>
      <strong id="repository-name">GitAmida</strong>
      <span id="repository-meta">Open a Git repository to begin</span>
    </div>
    <button id="refresh" class="icon-button" type="button" title="Refresh history" aria-label="Refresh history">↻</button>
  </header>
  <main class="workspace">
    <section class="pane history-pane" aria-labelledby="history-heading">
      <div class="pane-heading">
        <h2 id="history-heading">History</h2>
        <span id="history-count" class="secondary"></span>
      </div>
      <div class="column-head history-columns" aria-hidden="true">
        <span>Graph</span><span>Commit</span><span>Date</span>
      </div>
      <div id="history" class="list history-list" role="listbox" aria-label="Commit history"></div>
    </section>
    <section class="pane files-pane" aria-labelledby="files-heading">
      <div class="pane-heading">
        <h2 id="files-heading">Changed files</h2>
        <span id="selected-commit" class="secondary"></span>
      </div>
      <div class="column-head file-columns" aria-hidden="true">
        <span>Path</span><span>Status</span>
      </div>
      <div id="files" class="list file-list" role="listbox" aria-label="Changed files">
        <p class="empty-state">Select a commit.</p>
      </div>
    </section>
  </main>
  <footer id="status" role="status">Click a commit, then double-click a file to open the editor diff.</footer>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function isBinary(content: Buffer): boolean {
  const sampleLength = Math.min(content.length, 8 * 1024);
  return content.subarray(0, sampleLength).includes(0);
}

function userMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
