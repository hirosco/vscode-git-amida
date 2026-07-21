import { randomBytes } from "node:crypto";
import { basename } from "node:path";

import * as vscode from "vscode";

import { GitContentProvider } from "./contentProvider";
import { buildFileTree } from "./fileTree";
import { GitClient, GitError } from "./git";
import type { ChangedFile, Commit } from "./model";
import type { HostToWebviewMessage } from "./protocol";
import {
  DEFAULT_VIEW_STATE,
  mergeViewState,
  sanitizeViewState,
} from "./viewState";

const VIEW_STATE_KEY = "gitAmida.repositoryViewState";

export class HistoryViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "gitAmida.history";

  private view?: vscode.WebviewView;
  private repository?: string;
  private readonly commits = new Map<string, Commit>();
  private readonly filesByCommit = new Map<string, ChangedFile[]>();
  private viewState = { ...DEFAULT_VIEW_STATE };
  private historyRequest = 0;
  private filesRequest = 0;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly git: GitClient,
    private readonly contentProvider: GitContentProvider,
    private readonly workspaceState: vscode.Memento,
  ) {
    this.viewState = sanitizeViewState(
      this.workspaceState.get<unknown>(VIEW_STATE_KEY),
    );
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "media"),
        vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
      ],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((message: unknown) => {
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

      this.repository = history.repository.root;
      this.commits.clear();
      this.filesByCommit.clear();
      for (const row of history.rows) {
        if (row.kind === "commit") {
          this.commits.set(row.commit.hash, row.commit);
        }
      }

      const firstCommit = history.rows.find(
        (row): row is Extract<(typeof history.rows)[number], { kind: "commit" }> =>
          row.kind === "commit",
      );
      const selectedHash =
        this.viewState.selectedHash !== undefined &&
        this.commits.has(this.viewState.selectedHash)
          ? this.viewState.selectedHash
          : firstCommit?.commit.hash;
      this.viewState = {
        ...this.viewState,
        selectedHash,
        selectedFilePath:
          selectedHash === this.viewState.selectedHash
            ? this.viewState.selectedFilePath
            : undefined,
      };
      await this.persistViewState();

      await this.post({
        type: "history",
        ...history,
        selectedHash,
        viewState: this.viewState,
      });
      if (selectedHash !== undefined) {
        await this.loadFiles(selectedHash);
      }
    } catch (error) {
      if (request !== this.historyRequest) {
        return;
      }
      await this.post({ type: "error", message: userMessage(error) });
    }
  }

  private async receiveMessage(message: unknown): Promise<void> {
    if (message === null || typeof message !== "object") {
      return;
    }
    const value = message as Record<string, unknown>;

    if (value.type === "ready" || value.type === "refresh") {
      await this.refresh();
      return;
    }

    if (value.type === "selectCommit" && typeof value.hash === "string") {
      if (!this.commits.has(value.hash)) {
        return;
      }
      this.viewState = {
        ...this.viewState,
        selectedHash: value.hash,
        selectedFilePath: undefined,
      };
      await this.persistViewState();
      await this.loadFiles(value.hash);
      return;
    }

    if (
      value.type === "selectFile" &&
      typeof value.hash === "string" &&
      typeof value.path === "string" &&
      this.findFile(value.hash, value.path) !== undefined
    ) {
      this.viewState = {
        ...this.viewState,
        selectedHash: value.hash,
        selectedFilePath: value.path,
      };
      await this.persistViewState();
      return;
    }

    if (
      value.type === "openDiff" &&
      typeof value.hash === "string" &&
      typeof value.path === "string"
    ) {
      await this.openDiff(value.hash, value.path);
      return;
    }

    if (value.type === "updateViewState") {
      this.viewState = mergeViewState(this.viewState, value.patch);
      await this.persistViewState();
    }
  }

  private async loadFiles(hash: string): Promise<void> {
    const commit = this.commits.get(hash);
    const repository = this.repository;
    if (commit === undefined || repository === undefined) {
      return;
    }

    const request = ++this.filesRequest;
    await this.post({ type: "filesLoading", hash });
    try {
      const files = await this.git.changedFiles(repository, commit);
      if (request !== this.filesRequest) {
        return;
      }
      this.filesByCommit.set(hash, files);
      if (
        this.viewState.selectedHash === hash &&
        this.viewState.selectedFilePath !== undefined &&
        !files.some((file) => file.path === this.viewState.selectedFilePath)
      ) {
        this.viewState = { ...this.viewState, selectedFilePath: undefined };
        await this.persistViewState();
      }
      await this.post({
        type: "files",
        hash,
        files,
        tree: buildFileTree(files),
      });
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
    const repository = this.repository;
    if (commit === undefined || file === undefined || repository === undefined) {
      return;
    }

    const parent = commit.parents[0];
    const beforeRef = file.status.startsWith("A") ? undefined : parent;
    const afterRef = file.status.startsWith("D") ? undefined : commit.hash;
    const beforePath = file.oldPath ?? file.path;

    try {
      const [before, after] = await Promise.all([
        this.git.readBlob(repository, beforeRef, beforePath),
        this.git.readBlob(repository, afterRef, file.path),
      ]);
      if (isBinary(before) || isBinary(after)) {
        await vscode.window.showInformationMessage(
          "GitAmida: Binary and image diffs are not available yet.",
        );
        return;
      }

      const shortHash = commit.shortHash;
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

  private async persistViewState(): Promise<void> {
    await this.workspaceState.update(VIEW_STATE_KEY, this.viewState);
  }

  private async post(message: HostToWebviewMessage): Promise<void> {
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
      vscode.Uri.joinPath(
        this.extensionUri,
        "dist",
        "webview",
        "webview",
        "main.js",
      ),
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
    <div class="repository-identity">
      <strong id="repository-name">GitAmida</strong>
      <span id="repository-meta">Open a Git repository to begin</span>
    </div>
    <button id="refresh" class="icon-button" type="button" title="Refresh history" aria-label="Refresh history">↻</button>
  </header>
  <main id="workspace" class="workspace" data-history-ratio="55">
    <section class="pane history-pane" aria-labelledby="history-heading">
      <div class="pane-heading">
        <h2 id="history-heading">Repository History</h2>
        <span id="history-count" class="secondary"></span>
      </div>
      <div class="column-head history-columns" aria-hidden="true">
        <span>Graph</span><span>Commit</span><span>Date</span>
      </div>
      <div id="history" class="list history-list" role="listbox" aria-label="Commit history"></div>
    </section>
    <div id="workspace-resizer" class="workspace-resizer" role="separator" aria-label="Resize Repository History and changed files" aria-orientation="vertical" aria-valuemin="45" aria-valuemax="70" aria-valuenow="55" tabindex="0"></div>
    <section id="inspection" class="inspection-pane" data-files-ratio="65">
      <section class="pane files-section" aria-labelledby="files-heading">
        <div class="pane-heading">
          <div class="heading-label">
            <h2 id="files-heading">Changed files</h2>
            <span id="selected-commit" class="secondary"></span>
          </div>
          <div class="file-toolbar">
            <div id="tree-actions" class="tree-actions" role="group" aria-label="Tree expansion" hidden>
              <button id="expand-all" class="icon-button" type="button" title="Expand all folders" aria-label="Expand all folders">＋</button>
              <button id="collapse-all" class="icon-button" type="button" title="Collapse all folders" aria-label="Collapse all folders">−</button>
            </div>
            <div class="mode-switch" role="group" aria-label="Changed file display">
              <button id="flat-mode" type="button" aria-pressed="true">Flat</button>
              <button id="tree-mode" type="button" aria-pressed="false">Tree</button>
            </div>
          </div>
        </div>
        <div class="column-head file-columns" aria-hidden="true">
          <span>Path</span><span>Status</span>
        </div>
        <div id="files" class="list file-list" role="listbox" aria-label="Changed files">
          <p class="empty-state">Select a commit.</p>
        </div>
      </section>
      <div id="details-resizer" class="details-resizer" role="separator" aria-label="Resize changed files and commit details" aria-orientation="horizontal" aria-valuemin="30" aria-valuemax="80" aria-valuenow="65" tabindex="0"></div>
      <section id="details-section" class="details-section" aria-labelledby="details-heading">
        <div class="pane-heading">
          <h2 id="details-heading">Commit details</h2>
          <button id="toggle-details" class="icon-button" type="button" title="Collapse commit details" aria-label="Collapse commit details" aria-expanded="true">⌄</button>
        </div>
        <div id="details" class="details-content">
          <p class="empty-state">Select a commit.</p>
        </div>
      </section>
    </section>
  </main>
  <footer id="status" role="status">Select a commit, then double-click a file to open the editor diff.</footer>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
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
