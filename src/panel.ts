import { randomBytes } from "node:crypto";
import { basename } from "node:path";

import * as vscode from "vscode";

import { GitContentProvider } from "./contentProvider";
import { buildFileTree } from "./fileTree";
import { GitClient, GitError } from "./git";
import type {
  ChangedFile,
  Commit,
  RepositoryNavigationState,
  RepositorySelection,
  RepositoryViewPreferences,
  RepositoryViewState,
} from "./model";
import type { HostToWebviewMessage } from "./protocol";
import {
  resolveRange,
  selectionIdentity,
  singleCommitSelection,
} from "./selection";
import {
  mergeViewPreferences,
  restoreViewState,
} from "./viewState";

const LEGACY_VIEW_STATE_KEY = "gitAmida.repositoryViewState";
const NAVIGATION_STATE_KEY = "gitAmida.repositoryNavigationState";
const VIEW_PREFERENCES_KEY = "gitAmida.repositoryViewPreferences";

export class HistoryViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "gitAmida.history";

  private view?: vscode.WebviewView;
  private repository?: string;
  private readonly commits = new Map<string, Commit>();
  private selection?: RepositorySelection;
  private currentFiles: ChangedFile[] = [];
  private navigationState: RepositoryNavigationState;
  private viewPreferences: RepositoryViewPreferences;
  private readonly stateReady: Promise<void>;
  private historyRequest = 0;
  private filesRequest = 0;
  private selectionRequest = 0;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly git: GitClient,
    private readonly contentProvider: GitContentProvider,
    private readonly workspaceState: vscode.Memento,
    private readonly globalState: vscode.Memento,
  ) {
    const restored = restoreViewState(
      this.globalState.get<unknown>(VIEW_PREFERENCES_KEY),
      this.workspaceState.get<unknown>(NAVIGATION_STATE_KEY),
      this.workspaceState.get<unknown>(LEGACY_VIEW_STATE_KEY),
    );
    this.navigationState = restored.navigation;
    this.viewPreferences = restored.preferences;
    this.stateReady = this.migrateLegacyState(restored);
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
    ++this.selectionRequest;
    await this.post({ type: "historyLoading" });

    try {
      await this.stateReady;
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
      this.currentFiles = [];
      for (const row of history.rows) {
        this.commits.set(row.commit.hash, row.commit);
      }

      const firstCommit = history.rows[0];
      const selectedHash =
        this.navigationState.selectedHash !== undefined &&
        this.commits.has(this.navigationState.selectedHash)
          ? this.navigationState.selectedHash
          : firstCommit?.commit.hash;
      this.selection = this.restoreSelection(selectedHash);
      const rangeAnchorHash =
        this.selection?.mode === "range"
          ? this.selection.anchorHash
          : undefined;
      this.navigationState = {
        selectedHash: this.selection?.activeHash,
        rangeAnchorHash,
        selectedFilePath:
          selectedHash === this.navigationState.selectedHash
            ? this.navigationState.selectedFilePath
            : undefined,
      };
      await this.persistNavigationState();

      await this.post({
        type: "history",
        ...history,
        selection: this.selection,
        viewState: this.viewState(),
      });
      if (this.selection !== undefined) {
        await this.loadFiles(this.selection);
      }
    } catch (error) {
      if (request !== this.historyRequest) {
        return;
      }
      await this.post({ type: "error", message: userMessage(error) });
    }
  }

  private async receiveMessage(message: unknown): Promise<void> {
    await this.stateReady;
    if (message === null || typeof message !== "object") {
      return;
    }
    const value = message as Record<string, unknown>;

    if (value.type === "ready" || value.type === "refresh") {
      await this.refresh();
      return;
    }

    if (
      value.type === "selectCommit" &&
      typeof value.hash === "string" &&
      typeof value.extend === "boolean"
    ) {
      if (!this.commits.has(value.hash)) {
        return;
      }
      if (value.extend) {
        const anchorHash =
          this.navigationState.rangeAnchorHash ??
          this.navigationState.selectedHash;
        if (anchorHash !== undefined && anchorHash !== value.hash) {
          const result = resolveRange(
            this.commits,
            anchorHash,
            value.hash,
          );
          if (!result.ok) {
            await this.post({
              type: "selectionError",
              selection: this.selection,
              message: result.message,
            });
            return;
          }
          await this.selectAndLoad(result.selection);
          return;
        }
      }
      await this.selectAndLoad(singleCommitSelection(value.hash));
      return;
    }

    if (
      value.type === "selectFile" &&
      typeof value.path === "string" &&
      this.findFile(value.path) !== undefined
    ) {
      this.navigationState = {
        ...this.navigationState,
        selectedFilePath: value.path,
      };
      await this.persistNavigationState();
      return;
    }

    if (
      value.type === "openDiff" &&
      typeof value.path === "string"
    ) {
      await this.openDiff(value.path);
      return;
    }

    if (value.type === "updateViewState") {
      this.viewPreferences = mergeViewPreferences(
        this.viewPreferences,
        value.patch,
      );
      await this.persistViewPreferences();
    }
  }

  private async selectAndLoad(selection: RepositorySelection): Promise<void> {
    const request = ++this.selectionRequest;
    this.selection = selection;
    this.currentFiles = [];
    this.navigationState = {
      selectedHash: selection.activeHash,
      rangeAnchorHash:
        selection.mode === "range" ? selection.anchorHash : undefined,
      selectedFilePath: undefined,
    };
    await this.persistNavigationState();
    if (request !== this.selectionRequest) {
      return;
    }
    await this.loadFiles(selection);
  }

  private async loadFiles(selection: RepositorySelection): Promise<void> {
    const commit = this.commits.get(selection.activeHash);
    const repository = this.repository;
    if (commit === undefined || repository === undefined) {
      return;
    }

    const request = ++this.filesRequest;
    await this.post({ type: "filesLoading", selection });
    try {
      const files =
        selection.mode === "single"
          ? await this.git.changedFiles(repository, commit)
          : await this.git.changedFilesBetween(
              repository,
              selection.baseHash,
              selection.newestHash,
            );
      if (request !== this.filesRequest) {
        return;
      }
      this.currentFiles = files;
      if (
        selectionIdentity(this.selection ?? selection) ===
          selectionIdentity(selection) &&
        this.navigationState.selectedFilePath !== undefined &&
        !files.some(
          (file) => file.path === this.navigationState.selectedFilePath,
        )
      ) {
        this.navigationState = {
          ...this.navigationState,
          selectedFilePath: undefined,
        };
        await this.persistNavigationState();
      }
      await this.post({
        type: "files",
        selection,
        files,
        tree: buildFileTree(files),
      });
    } catch (error) {
      if (request !== this.filesRequest) {
        return;
      }
      await this.post({
        type: "filesError",
        selection,
        message: userMessage(error),
      });
    }
  }

  private async openDiff(path: string): Promise<void> {
    const selection = this.selection;
    const file = this.findFile(path);
    const repository = this.repository;
    if (
      selection === undefined ||
      file === undefined ||
      repository === undefined
    ) {
      return;
    }

    const activeCommit = this.commits.get(selection.activeHash);
    if (activeCommit === undefined) {
      return;
    }
    const beforeRef = file.status.startsWith("A")
      ? undefined
      : selection.mode === "single"
        ? activeCommit.parents[0]
        : selection.baseHash;
    const afterRef = file.status.startsWith("D")
      ? undefined
      : selection.mode === "single"
        ? activeCommit.hash
        : selection.newestHash;
    const beforePath = file.oldPath ?? file.path;
    const diffIdentity = selectionIdentity(selection);

    try {
      const [before, after] = await Promise.all([
        this.git.readBlob(repository, beforeRef, beforePath),
        this.git.readBlob(repository, afterRef, file.path),
      ]);
      if (
        this.selection === undefined ||
        selectionIdentity(this.selection) !== diffIdentity
      ) {
        return;
      }
      if (isBinary(before) || isBinary(after)) {
        await vscode.window.showInformationMessage(
          "GitAmida: Binary and image diffs are not available yet.",
        );
        return;
      }

      const label = this.selectionLabel(selection);
      const left = this.contentProvider.add(
        beforePath,
        `${label}-base`,
        before.toString("utf8"),
      );
      const right = this.contentProvider.add(
        file.path,
        label,
        after.toString("utf8"),
      );
      await vscode.commands.executeCommand(
        "vscode.diff",
        left,
        right,
        `${basename(file.path)} (${label})`,
        { preview: false },
      );
    } catch (error) {
      await vscode.window.showErrorMessage(`GitAmida: ${userMessage(error)}`);
    }
  }

  private findFile(path: string): ChangedFile | undefined {
    return this.currentFiles.find((file) => file.path === path);
  }

  private restoreSelection(
    selectedHash: string | undefined,
  ): RepositorySelection | undefined {
    if (selectedHash === undefined) {
      return undefined;
    }
    const anchorHash = this.navigationState.rangeAnchorHash;
    if (
      anchorHash !== undefined &&
      anchorHash !== selectedHash &&
      this.commits.has(anchorHash)
    ) {
      const result = resolveRange(
        this.commits,
        anchorHash,
        selectedHash,
      );
      if (result.ok) {
        return result.selection;
      }
    }
    return singleCommitSelection(selectedHash);
  }

  private selectionLabel(selection: RepositorySelection): string {
    if (selection.mode === "single") {
      return (
        this.commits.get(selection.activeHash)?.shortHash ??
        selection.activeHash.slice(0, 8)
      );
    }
    const oldest =
      this.commits.get(selection.oldestHash)?.shortHash ??
      selection.oldestHash.slice(0, 8);
    const newest =
      this.commits.get(selection.newestHash)?.shortHash ??
      selection.newestHash.slice(0, 8);
    return `${oldest}…${newest}`;
  }

  private viewState(): RepositoryViewState {
    return { ...this.viewPreferences, ...this.navigationState };
  }

  private async persistNavigationState(): Promise<void> {
    await this.workspaceState.update(
      NAVIGATION_STATE_KEY,
      this.navigationState,
    );
  }

  private async persistViewPreferences(): Promise<void> {
    await this.globalState.update(VIEW_PREFERENCES_KEY, this.viewPreferences);
  }

  private async migrateLegacyState(
    restored: ReturnType<typeof restoreViewState>,
  ): Promise<void> {
    if (restored.migratePreferences) {
      await this.persistViewPreferences();
    }
    if (restored.migrateNavigation) {
      await this.persistNavigationState();
    }
    if (restored.removeLegacy) {
      await this.workspaceState.update(LEGACY_VIEW_STATE_KEY, undefined);
    }
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
              <button id="expand-all" class="icon-button" type="button" title="Expand all folders" aria-label="Expand all folders">+</button>
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
  <footer id="status" role="status">Select a commit, or Shift+click another commit to review a linear Range.</footer>
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
