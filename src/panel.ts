import { randomBytes } from "node:crypto";
import { basename, isAbsolute, relative, sep } from "node:path";

import * as vscode from "vscode";

import {
  BranchMutationService,
  BranchSwitchError,
} from "./branchSwitcher";
import {
  GitContentProvider,
  GitImageFileSystemProvider,
} from "./contentProvider";
import { NativeDiffSessionRegistry } from "./diffSessions";
import { ExternalDifftoolService } from "./externalDifftool";
import {
  FileRestoreError,
  FileRestoreService,
} from "./fileRestorer";
import { buildFileTree } from "./fileTree";
import { GitClient, GitError } from "./git";
import type {
  ChangedFile,
  Commit,
  CommitFileChange,
  RepositoryNavigationState,
  RepositorySelection,
  RepositoryViewPreferences,
  RepositoryViewState,
  WorkingTreeState,
} from "./model";
import type { HostToWebviewMessage } from "./protocol";
import {
  explicitCommitSelection,
  resolveVisibleSelection,
  selectionIdentity,
  singleCommitSelection,
  toggleExplicitCommit,
  workingTreeSelection,
} from "./selection";
import {
  buildSelectionFiles,
  resolveFileComparison,
  type FileComparison,
  type SelectionFileState,
} from "./selectionFiles";
import {
  mergeViewPreferences,
  restoreViewState,
} from "./viewState";

const LEGACY_VIEW_STATE_KEY = "gitAmida.repositoryViewState";
const NAVIGATION_STATE_KEY = "gitAmida.repositoryNavigationState";
const VIEW_PREFERENCES_KEY = "gitAmida.repositoryViewPreferences";
const DEFAULT_DIFF_MAX_FILE_SIZE_MB = 50;
type RefreshScope = "workingTree" | "history" | "detect";

export class HistoryViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  public static readonly viewType = "gitAmida.history";

  private view?: vscode.WebviewView;
  private repository?: string;
  private headHash?: string;
  private readonly commits = new Map<string, Commit>();
  private workingTree?: WorkingTreeState;
  private workingTreeVersion = 0;
  private selection?: RepositorySelection;
  private currentFiles: ChangedFile[] = [];
  private readonly selectionFiles = new Map<string, SelectionFileState>();
  private readonly commitChanges = new Map<
    string,
    Promise<CommitFileChange[]>
  >();
  private navigationState: RepositoryNavigationState;
  private viewPreferences: RepositoryViewPreferences;
  private readonly stateReady: Promise<void>;
  private historyRequest = 0;
  private repositoryStateRequest = 0;
  private workingTreeRequest = 0;
  private filesRequest = 0;
  private selectionRequest = 0;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private pendingRefresh?: RefreshScope;
  private historyFingerprint?: string;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly git: GitClient,
    private readonly branchMutations: BranchMutationService,
    private readonly contentProvider: GitContentProvider,
    private readonly imageProvider: GitImageFileSystemProvider,
    private readonly diffSessions: NativeDiffSessionRegistry,
    private readonly externalDifftool: ExternalDifftoolService,
    private readonly fileRestorer: FileRestoreService,
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
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.scheduleRefresh(this.pendingRefresh ?? "detect");
      }
    });
  }

  public dispose(): void {
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  public scheduleRefresh(
    scope: RefreshScope,
    repository?: string,
  ): void {
    if (
      repository !== undefined &&
      this.repository !== undefined &&
      vscode.Uri.file(repository).toString() !==
        vscode.Uri.file(this.repository).toString()
    ) {
      return;
    }
    this.pendingRefresh = mergeRefreshScope(this.pendingRefresh, scope);
    if (this.view === undefined) {
      return;
    }
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      const pending = this.pendingRefresh;
      this.pendingRefresh = undefined;
      if (pending === "history") {
        void this.refresh(false);
      } else if (pending === "detect") {
        void this.detectRepositoryChanges();
      } else if (pending === "workingTree") {
        void this.refreshWorkingTree();
      }
    }, 300);
  }

  public async openFileInDifftool(path: string): Promise<void> {
    await this.stateReady;
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
    if (file.content?.kind === "submodule") {
      await vscode.window.showInformationMessage(
        "GitAmida: Submodule comparisons cannot be opened in an external diff tool.",
      );
      return;
    }

    try {
      const beforePath = file.oldPath ?? file.path;
      if (selection.mode === "workingTree") {
        const [beforeContent, afterContent] = await Promise.all([
          this.git.readBlob(
            repository,
            file.status.startsWith("A") ? undefined : selection.headHash,
            beforePath,
          ),
          file.status.startsWith("D")
            ? Promise.resolve(Buffer.alloc(0))
            : this.git.readWorkingFile(repository, file.path),
        ]);
        await this.externalDifftool.open({
          repository,
          beforePath,
          afterPath: file.path,
          beforeContent,
          afterContent,
        });
        return;
      }

      const comparison = this.fileComparison(selection, file);
      if (comparison === undefined) {
        return;
      }
      const [beforeContent, afterContent] = await Promise.all([
        this.git.readBlob(
          repository,
          comparison.beforeRef,
          comparison.beforePath,
        ),
        this.git.readBlob(
          repository,
          comparison.afterRef,
          comparison.afterPath,
        ),
      ]);
      await this.externalDifftool.open({
        repository,
        beforePath: comparison.beforePath,
        afterPath: comparison.afterPath,
        beforeContent,
        afterContent,
      });
    } catch (error) {
      await vscode.window.showErrorMessage(`GitAmida: ${userMessage(error)}`);
    }
  }

  public async restoreFile(
    path: string | undefined,
    side: "before" | "after",
  ): Promise<void> {
    await this.stateReady;
    const selection = this.selection;
    const file = this.findFile(
      path ?? this.navigationState.selectedFilePath ?? "",
    );
    const repository = this.repository;
    if (
      selection === undefined ||
      selection.mode === "workingTree" ||
      file === undefined ||
      repository === undefined
    ) {
      await vscode.window.showInformationMessage(
        "GitAmida: Select a file from a historical comparison first.",
      );
      return;
    }
    if (file.content?.kind === "submodule") {
      await vscode.window.showInformationMessage(
        "GitAmida: Submodule revisions cannot be restored as files.",
      );
      return;
    }

    const comparison = this.fileComparison(selection, file);
    if (comparison === undefined) {
      return;
    }
    const sourceRef =
      side === "before" ? comparison.beforeRef : comparison.afterRef;
    const sourcePath =
      side === "before" ? comparison.beforePath : comparison.afterPath;
    if (sourceRef === undefined) {
      await vscode.window.showInformationMessage(
        `GitAmida: This comparison has no ${side} file version to restore.`,
      );
      return;
    }

    const request = {
      repository,
      sourceRef,
      sourcePath,
      destinationPath: file.path,
    };
    try {
      const plan = await this.fileRestorer.preflight(request);
      this.rejectUnsavedDestination(repository, plan.destination, file.path);
      const verb = plan.destinationExists ? "Replace" : "Create";
      const confirmation = await vscode.window.showWarningMessage(
        `${verb} "${file.path}" from the ${side} version?`,
        {
          modal: true,
          detail:
            `Source: ${sourceRef.slice(0, 8)}:${sourcePath}\n` +
            `Destination: ${file.path}\n` +
            "The Git index will remain unchanged.",
        },
        "Restore",
      );
      if (confirmation !== "Restore") {
        return;
      }

      this.rejectUnsavedDestination(repository, plan.destination, file.path);
      await this.fileRestorer.restore(request);
      await this.refreshWorkingTree();
      await vscode.window.showInformationMessage(
        `GitAmida: Restored "${file.path}" from the ${side} version.`,
      );
    } catch (error) {
      const message = userMessage(error);
      if (error instanceof FileRestoreError) {
        await vscode.window.showWarningMessage(`GitAmida: ${message}`);
      } else {
        await vscode.window.showErrorMessage(`GitAmida: ${message}`);
      }
    }
  }

  public async refresh(showLoading = true): Promise<void> {
    this.pendingRefresh = undefined;
    const request = ++this.historyRequest;
    ++this.repositoryStateRequest;
    ++this.workingTreeRequest;
    ++this.filesRequest;
    ++this.selectionRequest;
    if (showLoading) {
      await this.post({ type: "historyLoading" });
    }

    try {
      await this.stateReady;
      const folder = this.workspaceFolder();
      if (folder === undefined) {
        throw new GitError("Open a folder containing a Git repository first.");
      }

      const loadedHistory = await this.git.loadHistory(folder.uri.fsPath);
      const { historyFingerprint, ...history } = loadedHistory;
      const workingTree = await this.git.workingTreeChanges(
        history.repository.root,
        history.repository.head,
        this.textDiffMaxBytes(),
      );
      if (request !== this.historyRequest) {
        return;
      }

      this.repository = history.repository.root;
      this.historyFingerprint = historyFingerprint;
      this.headHash = history.repository.head;
      this.workingTree =
        workingTree.files.length === 0 ? undefined : workingTree;
      this.workingTreeVersion += 1;
      this.commits.clear();
      this.currentFiles = [];
      this.selectionFiles.clear();
      this.commitChanges.clear();
      for (const row of history.rows) {
        this.commits.set(row.commit.hash, row.commit);
      }

      const firstCommit = history.rows[0];
      const restoreWorkingTree =
        this.navigationState.selectedWorkingTree === true &&
        this.workingTree !== undefined;
      const selectedHash = restoreWorkingTree
        ? undefined
        : this.navigationState.selectedHash !== undefined &&
            this.commits.has(this.navigationState.selectedHash)
          ? this.navigationState.selectedHash
          : firstCommit?.commit.hash;
      this.selection = restoreWorkingTree
        ? workingTreeSelection(
            this.workingTree?.headHash ?? history.repository.head,
            this.workingTreeVersion,
          )
        : this.restoreSelection(selectedHash);
      const selectionAnchorHash = selectionAnchor(this.selection);
      const selectionHashes =
        this.selection?.mode === "range" ||
        this.selection?.mode === "selection"
          ? this.selection.commitHashes
          : undefined;
      this.navigationState = {
        selectedWorkingTree:
          this.selection?.mode === "workingTree" ? true : undefined,
        selectedHash:
          this.selection !== undefined &&
          this.selection.mode !== "workingTree"
            ? this.selection.activeHash
            : undefined,
        selectionAnchorHash,
        selectionHashes,
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
        ...(this.workingTree === undefined
          ? {}
          : { workingTree: this.workingTree }),
      });
      if (this.selection !== undefined) {
        await this.loadFiles(this.selection);
      }
    } catch (error) {
      if (request !== this.historyRequest) {
        return;
      }
      await this.post({
        type: showLoading ? "error" : "refreshError",
        message: userMessage(error),
      });
    }
  }

  private async detectRepositoryChanges(): Promise<void> {
    const repository = this.repository;
    const previousFingerprint = this.historyFingerprint;
    if (repository === undefined || previousFingerprint === undefined) {
      return;
    }
    const request = ++this.repositoryStateRequest;
    try {
      const nextFingerprint = await this.git.historyFingerprint(repository);
      if (request !== this.repositoryStateRequest) {
        return;
      }
      if (nextFingerprint !== previousFingerprint) {
        await this.refresh(false);
      } else {
        await this.refreshWorkingTree();
      }
    } catch (error) {
      if (request !== this.repositoryStateRequest) {
        return;
      }
      await this.post({
        type: "refreshError",
        message: userMessage(error),
      });
    }
  }

  public async switchBranchAtCommit(commitHash?: string): Promise<void> {
    const repository = this.repository;
    const selectedHash =
      commitHash ??
      (this.selection === undefined || this.selection.mode === "workingTree"
        ? undefined
        : this.selection.activeHash);
    if (
      repository === undefined ||
      selectedHash === undefined ||
      !this.commits.has(selectedHash)
    ) {
      await vscode.window.showInformationMessage(
        "GitAmida: Select a commit with a local branch first.",
      );
      return;
    }

    try {
      const branches = await this.branchMutations.localBranchesAtCommit(
        repository,
        selectedHash,
      );
      if (branches.length === 0) {
        await vscode.window.showInformationMessage(
          "GitAmida: No other local branch points at this commit.",
        );
        return;
      }
      const branch = await vscode.window.showQuickPick(branches, {
        title: "GitAmida: Switch Branch",
        placeHolder: "Select a local branch pointing at this commit",
      });
      if (branch === undefined) {
        return;
      }

      await this.branchMutations.switchBranch(
        repository,
        branch,
        selectedHash,
        this.unsavedEditorPaths(repository),
      );
      await this.refresh(false);
      await vscode.window.showInformationMessage(
        `GitAmida: Switched to branch "${branch}".`,
      );
    } catch (error) {
      const message = userMessage(error);
      if (error instanceof BranchSwitchError) {
        await vscode.window.showWarningMessage(`GitAmida: ${message}`);
      } else {
        await vscode.window.showErrorMessage(`GitAmida: ${message}`);
      }
    }
  }

  private async refreshWorkingTree(): Promise<void> {
    const repository = this.repository;
    const headHash = this.currentHead();
    if (repository === undefined || headHash === undefined) {
      return;
    }
    const request = ++this.workingTreeRequest;
    try {
      const state = await this.git.workingTreeChanges(
        repository,
        headHash,
        this.textDiffMaxBytes(),
      );
      if (request !== this.workingTreeRequest) {
        return;
      }
      this.workingTree = state.files.length === 0 ? undefined : state;
      this.workingTreeVersion += 1;

      if (this.selection?.mode === "workingTree") {
        if (this.workingTree === undefined) {
          const headSelection = singleCommitSelection(headHash);
          await this.post({
            type: "workingTree",
            workingTree: undefined,
            selection: headSelection,
          });
          await this.selectAndLoad(headSelection);
          return;
        }
        const nextSelection = workingTreeSelection(
          headHash,
          this.workingTreeVersion,
        );
        this.selection = nextSelection;
        this.navigationState = {
          selectedWorkingTree: true,
          selectedFilePath: this.navigationState.selectedFilePath,
        };
        await this.persistNavigationState();
        await this.post({
          type: "workingTree",
          workingTree: this.workingTree,
          selection: nextSelection,
        });
        await this.loadFiles(nextSelection);
        return;
      }

      await this.post({
        type: "workingTree",
        workingTree: this.workingTree,
        selection: this.selection,
      });
    } catch (error) {
      if (request !== this.workingTreeRequest) {
        return;
      }
      await this.post({
        type: "workingTreeError",
        message: userMessage(error),
      });
    }
  }

  private async receiveMessage(message: unknown): Promise<void> {
    await this.stateReady;
    if (message === null || typeof message !== "object") {
      return;
    }
    const value = message as Record<string, unknown>;

    if (value.type === "ready") {
      await this.refresh();
      return;
    }
    if (value.type === "refresh") {
      await this.refresh(false);
      return;
    }

    if (value.type === "selectWorkingTree") {
      const workingTree = this.workingTree;
      if (workingTree !== undefined) {
        await this.selectAndLoad(
          workingTreeSelection(
            workingTree.headHash,
            this.workingTreeVersion,
          ),
        );
      }
      return;
    }

    if (
      value.type === "selectCommit" &&
      typeof value.hash === "string" &&
      typeof value.extend === "boolean" &&
      typeof value.toggle === "boolean"
    ) {
      if (!this.commits.has(value.hash)) {
        return;
      }
      if (value.toggle) {
        await this.selectAndLoad(
          toggleExplicitCommit(this.commits, this.selection, value.hash),
        );
        return;
      }
      if (value.extend) {
        const anchorHash =
          this.navigationState.selectionAnchorHash ??
          this.navigationState.selectedHash;
        if (anchorHash !== undefined && anchorHash !== value.hash) {
          await this.selectAndLoad(
            resolveVisibleSelection(
              this.commits,
              anchorHash,
              value.hash,
            ),
          );
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
    this.selectionFiles.clear();
    this.navigationState = {
      selectedWorkingTree:
        selection.mode === "workingTree" ? true : undefined,
      selectedHash:
        selection.mode === "workingTree" ? undefined : selection.activeHash,
      selectionAnchorHash: selectionAnchor(selection),
      selectionHashes:
        selection.mode === "range" || selection.mode === "selection"
          ? selection.commitHashes
          : undefined,
      selectedFilePath: undefined,
    };
    await this.persistNavigationState();
    if (request !== this.selectionRequest) {
      return;
    }
    await this.loadFiles(selection);
  }

  private async loadFiles(selection: RepositorySelection): Promise<void> {
    const repository = this.repository;
    if (repository === undefined) {
      return;
    }

    const request = ++this.filesRequest;
    const textDiffMaxBytes = this.textDiffMaxBytes();
    await this.post({ type: "filesLoading", selection });
    try {
      let states: SelectionFileState[] | undefined;
      let files: ChangedFile[];
      if (selection.mode === "workingTree") {
        files =
          this.workingTree?.headHash === selection.headHash
            ? this.workingTree.files
            : [];
      } else if (selection.mode === "selection") {
        states = await this.loadSelectionFiles(
          repository,
          selection.commitHashes,
          textDiffMaxBytes,
        );
        files = states.map((state) => state.file);
      } else if (selection.mode === "single") {
        const commit = this.commits.get(selection.activeHash);
        if (commit === undefined) {
          return;
        }
        files = await this.git.changedFiles(
          repository,
          commit,
          textDiffMaxBytes,
        );
      } else {
        files = await this.git.changedFilesBetween(
          repository,
          selection.baseHash,
          selection.newestHash,
          textDiffMaxBytes,
        );
      }
      if (request !== this.filesRequest) {
        return;
      }
      this.currentFiles = files;
      this.selectionFiles.clear();
      for (const state of states ?? []) {
        this.selectionFiles.set(state.file.path, state);
      }
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

    if (selection.mode === "workingTree") {
      await this.openWorkingTreeDiff(selection, file, repository);
      return;
    }

    const comparison = this.fileComparison(selection, file);
    if (comparison === undefined) {
      return;
    }
    const diffIdentity = selectionIdentity(selection);
    const request = this.selectionRequest;

    await this.openComparison(
      repository,
      comparison,
      this.selectionLabel(selection),
      diffIdentity,
      request,
    );
  }

  private async openWorkingTreeDiff(
    selection: Extract<RepositorySelection, { mode: "workingTree" }>,
    file: ChangedFile,
    repository: string,
  ): Promise<void> {
    if (file.content?.kind === "image") {
      await this.openWorkingTreeImageDiff(selection, file, repository);
      return;
    }
    const textDiffMaxBytes = this.textDiffMaxBytes();
    const unsupportedMessage = fileContentMessage(
      file.content,
      textDiffMaxBytes,
    );
    if (unsupportedMessage !== undefined) {
      await vscode.window.showInformationMessage(unsupportedMessage);
      return;
    }
    const identity = selectionIdentity(selection);
    const request = this.selectionRequest;
    const beforePath = file.oldPath ?? file.path;
    try {
      const [beforeSize, after] = await Promise.all([
        this.git.blobSize(
          repository,
          file.status.startsWith("A") ? undefined : selection.headHash,
          beforePath,
        ),
        file.status.startsWith("D")
          ? Promise.resolve(Buffer.alloc(0))
          : this.git.readWorkingFile(
              repository,
              file.path,
              textDiffMaxBytes,
            ),
      ]);
      if (
        request !== this.selectionRequest ||
        this.selection === undefined ||
        selectionIdentity(this.selection) !== identity
      ) {
        return;
      }
      if (beforeSize > textDiffMaxBytes) {
        await vscode.window.showInformationMessage(
          textDiffLimitMessage(beforeSize, textDiffMaxBytes),
        );
        return;
      }
      const before = await this.git.readBlob(
        repository,
        file.status.startsWith("A") ? undefined : selection.headHash,
        beforePath,
        beforeSize,
      );
      if (
        request !== this.selectionRequest ||
        this.selection === undefined ||
        selectionIdentity(this.selection) !== identity
      ) {
        return;
      }
      if (isBinary(before) || isBinary(after)) {
        await vscode.window.showInformationMessage(
          "GitAmida: This file contains binary data, so a text diff was not opened.",
        );
        return;
      }
      const left = this.contentProvider.add(
        beforePath,
        "Working-Tree-base",
        before.toString("utf8"),
      );
      const right = this.contentProvider.add(
        file.path,
        "Working-Tree",
        after.toString("utf8"),
      );
      await vscode.commands.executeCommand(
        "vscode.diff",
        left,
        right,
        `${basename(file.path)} (Working Tree)`,
        { preview: true },
      );
      this.registerDiffSession(repository, beforePath, file.path, left, right);
    } catch (error) {
      await vscode.window.showErrorMessage(`GitAmida: ${userMessage(error)}`);
    }
  }

  private async openWorkingTreeImageDiff(
    selection: Extract<RepositorySelection, { mode: "workingTree" }>,
    file: ChangedFile,
    repository: string,
  ): Promise<void> {
    const identity = selectionIdentity(selection);
    const request = this.selectionRequest;
    const beforePath = file.oldPath ?? file.path;
    try {
      const [beforeSize, after] = await Promise.all([
        this.git.blobSize(
          repository,
          file.status.startsWith("A") ? undefined : selection.headHash,
          beforePath,
        ),
        file.status.startsWith("D")
          ? Promise.resolve(Buffer.alloc(0))
          : this.git.readWorkingImage(repository, file.path),
      ]);
      if (
        request !== this.selectionRequest ||
        this.selection === undefined ||
        selectionIdentity(this.selection) !== identity
      ) {
        return;
      }
      const left = this.imageProvider.add(
        beforePath,
        "Working-Tree-base",
        beforeSize,
        () =>
          this.git.readBlob(
            repository,
            file.status.startsWith("A") ? undefined : selection.headHash,
            beforePath,
            beforeSize,
          ),
      );
      const right = this.imageProvider.add(
        file.path,
        "Working-Tree",
        after.byteLength,
        () => Promise.resolve(after),
      );
      await vscode.commands.executeCommand(
        "vscode.diff",
        left,
        right,
        `${basename(file.path)} (Working Tree)`,
        { preview: true },
      );
      this.registerDiffSession(repository, beforePath, file.path, left, right);
    } catch (error) {
      await vscode.window.showErrorMessage(`GitAmida: ${userMessage(error)}`);
    }
  }

  private async openComparison(
    repository: string,
    comparison: FileComparison,
    label: string,
    selectionId: string,
    request: number,
  ): Promise<void> {
    if (comparison.content?.kind === "image") {
      await this.openImageComparison(
        repository,
        comparison,
        label,
        selectionId,
        request,
      );
      return;
    }
    const textDiffMaxBytes = this.textDiffMaxBytes();
    const unsupportedMessage = fileContentMessage(
      comparison.content,
      textDiffMaxBytes,
    );
    if (unsupportedMessage !== undefined) {
      await vscode.window.showInformationMessage(unsupportedMessage);
      return;
    }

    try {
      const [beforeSize, afterSize] = await Promise.all([
        this.git.blobSize(
          repository,
          comparison.beforeRef,
          comparison.beforePath,
        ),
        this.git.blobSize(
          repository,
          comparison.afterRef,
          comparison.afterPath,
        ),
      ]);
      if (
        request !== this.selectionRequest ||
        this.selection === undefined ||
        selectionIdentity(this.selection) !== selectionId
      ) {
        return;
      }
      const largestSize = Math.max(beforeSize, afterSize);
      if (largestSize > textDiffMaxBytes) {
        await vscode.window.showInformationMessage(
          textDiffLimitMessage(largestSize, textDiffMaxBytes),
        );
        return;
      }
      const [before, after] = await Promise.all([
        this.git.readBlob(
          repository,
          comparison.beforeRef,
          comparison.beforePath,
          beforeSize,
        ),
        this.git.readBlob(
          repository,
          comparison.afterRef,
          comparison.afterPath,
          afterSize,
        ),
      ]);
      if (
        request !== this.selectionRequest ||
        this.selection === undefined ||
        selectionIdentity(this.selection) !== selectionId
      ) {
        return;
      }
      if (isBinary(before) || isBinary(after)) {
        await vscode.window.showInformationMessage(
          "GitAmida: This file contains binary data, so a text diff was not opened.",
        );
        return;
      }

      const left = this.contentProvider.add(
        comparison.beforePath,
        `${label}-base`,
        before.toString("utf8"),
      );
      const right = this.contentProvider.add(
        comparison.afterPath,
        label,
        after.toString("utf8"),
      );
      await vscode.commands.executeCommand(
        "vscode.diff",
        left,
        right,
        `${basename(comparison.afterPath)} (${label})`,
        { preview: true },
      );
      this.registerDiffSession(
        repository,
        comparison.beforePath,
        comparison.afterPath,
        left,
        right,
      );
    } catch (error) {
      await vscode.window.showErrorMessage(`GitAmida: ${userMessage(error)}`);
    }
  }

  private async openImageComparison(
    repository: string,
    comparison: FileComparison,
    label: string,
    selectionId: string,
    request: number,
  ): Promise<void> {
    try {
      const [beforeSize, afterSize] = await Promise.all([
        this.git.blobSize(
          repository,
          comparison.beforeRef,
          comparison.beforePath,
        ),
        this.git.blobSize(
          repository,
          comparison.afterRef,
          comparison.afterPath,
        ),
      ]);
      if (
        request !== this.selectionRequest ||
        this.selection === undefined ||
        selectionIdentity(this.selection) !== selectionId
      ) {
        return;
      }
      const left = this.imageProvider.add(
        comparison.beforePath,
        `${label}-base`,
        beforeSize,
        () =>
          this.git.readBlob(
            repository,
            comparison.beforeRef,
            comparison.beforePath,
            beforeSize,
          ),
      );
      const right = this.imageProvider.add(
        comparison.afterPath,
        label,
        afterSize,
        () =>
          this.git.readBlob(
            repository,
            comparison.afterRef,
            comparison.afterPath,
            afterSize,
          ),
      );
      await vscode.commands.executeCommand(
        "vscode.diff",
        left,
        right,
        `${basename(comparison.afterPath)} (${label})`,
        { preview: true },
      );
      this.registerDiffSession(
        repository,
        comparison.beforePath,
        comparison.afterPath,
        left,
        right,
      );
    } catch (error) {
      await vscode.window.showErrorMessage(`GitAmida: ${userMessage(error)}`);
    }
  }

  private findFile(path: string): ChangedFile | undefined {
    return this.currentFiles.find((file) => file.path === path);
  }

  private fileComparison(
    selection: Exclude<RepositorySelection, { mode: "workingTree" }>,
    file: ChangedFile,
  ): FileComparison | undefined {
    return resolveFileComparison(
      selection,
      file,
      this.commits.get(selection.activeHash),
      this.selectionFiles.get(file.path)?.comparison,
    );
  }

  private registerDiffSession(
    repository: string,
    beforePath: string,
    afterPath: string,
    original: vscode.Uri,
    modified: vscode.Uri,
  ): void {
    this.diffSessions.register({
      repository,
      beforePath,
      afterPath,
      originalUri: original.toString(),
      modifiedUri: modified.toString(),
    });
  }

  private unsavedEditorPaths(repository: string): string[] {
    return vscode.workspace.textDocuments
      .filter(
        (document) =>
          document.isDirty &&
          document.uri.scheme === "file" &&
          isPathInside(repository, document.uri.fsPath),
      )
      .map((document) => document.uri.fsPath);
  }

  private rejectUnsavedDestination(
    repository: string,
    destination: string,
    displayPath: string,
  ): void {
    if (
      this.unsavedEditorPaths(repository).some(
        (path) => relative(destination, path) === "",
      )
    ) {
      throw new FileRestoreError(
        `"${displayPath}" has unsaved editor changes. Save or close it before restoring.`,
      );
    }
  }

  private restoreSelection(
    selectedHash: string | undefined,
  ): RepositorySelection | undefined {
    if (selectedHash === undefined) {
      return undefined;
    }
    const selectedHashes = this.navigationState.selectionHashes;
    const anchorHash = this.navigationState.selectionAnchorHash;
    if (selectedHashes !== undefined && selectedHashes.length > 1) {
      if (
        anchorHash !== undefined &&
        anchorHash !== selectedHash &&
        this.commits.has(anchorHash)
      ) {
        const resolved = resolveVisibleSelection(
          this.commits,
          anchorHash,
          selectedHash,
        );
        if (selectionHasHashes(resolved, selectedHashes)) {
          return resolved;
        }
      }
      return explicitCommitSelection(
        this.commits,
        selectedHashes,
        selectedHash,
        anchorHash,
      );
    }
    if (
      anchorHash !== undefined &&
      anchorHash !== selectedHash &&
      this.commits.has(anchorHash)
    ) {
      return resolveVisibleSelection(
        this.commits,
        anchorHash,
        selectedHash,
      );
    }
    return singleCommitSelection(selectedHash);
  }

  private selectionLabel(selection: RepositorySelection): string {
    if (selection.mode === "workingTree") {
      return "Working-Tree";
    }
    if (selection.mode === "single") {
      return (
        this.commits.get(selection.activeHash)?.shortHash ??
        selection.activeHash.slice(0, 8)
      );
    }
    if (selection.mode === "selection") {
      return `Selection-${selection.commitHashes.length}`;
    }
    const oldest =
      this.commits.get(selection.oldestHash)?.shortHash ??
      selection.oldestHash.slice(0, 8);
    const newest =
      this.commits.get(selection.newestHash)?.shortHash ??
      selection.newestHash.slice(0, 8);
    return `${oldest}…${newest}`;
  }

  private currentHead(): string | undefined {
    return this.headHash;
  }

  private textDiffMaxBytes(): number {
    const configured = vscode.workspace
      .getConfiguration("diffEditor")
      .get<number>("maxFileSize", DEFAULT_DIFF_MAX_FILE_SIZE_MB);
    const maxFileSizeMb =
      Number.isFinite(configured) && configured >= 0
        ? configured
        : DEFAULT_DIFF_MAX_FILE_SIZE_MB;
    return Math.min(
      Number.MAX_SAFE_INTEGER,
      Math.floor(maxFileSizeMb * 1024 * 1024),
    );
  }

  private async loadSelectionFiles(
    repository: string,
    commitHashes: string[],
    maxTextBlobBytes: number,
  ): Promise<SelectionFileState[]> {
    const allChanges: CommitFileChange[] = [];
    for (let index = 0; index < commitHashes.length; index += 4) {
      const batch = commitHashes.slice(index, index + 4);
      const changes = await Promise.all(
        batch.map(async (hash) => {
          const commit = this.commits.get(hash);
          return commit === undefined
            ? []
            : await this.changesForCommit(
                repository,
                commit,
                maxTextBlobBytes,
              );
        }),
      );
      allChanges.push(...changes.flat());
    }
    return buildSelectionFiles(allChanges, commitHashes);
  }

  private changesForCommit(
    repository: string,
    commit: Commit,
    maxTextBlobBytes: number,
  ): Promise<CommitFileChange[]> {
    const cacheKey = `${commit.hash}:${maxTextBlobBytes}`;
    const cached = this.commitChanges.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const request = this.git.commitFileChanges(
      repository,
      commit,
      maxTextBlobBytes,
    );
    this.commitChanges.set(cacheKey, request);
    void request.catch(() => {
      if (this.commitChanges.get(cacheKey) === request) {
        this.commitChanges.delete(cacheKey);
      }
    });
    return request;
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
            <div class="mode-switch" role="group" aria-label="Changed file display">
              <button id="flat-mode" type="button" aria-pressed="true">Flat</button>
              <button id="tree-mode" type="button" aria-pressed="false">Tree</button>
            </div>
          </div>
        </div>
        <div class="column-head file-columns">
          <span class="path-column-heading">
            <span>Path</span>
            <span id="tree-actions" class="tree-actions" role="group" aria-label="Tree expansion" hidden>
              <button id="expand-all" class="icon-button" type="button" title="Expand all folders" aria-label="Expand all folders">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5.5 5 2.5-2.5L10.5 5m-5 6L8 13.5l2.5-2.5"/></svg>
              </button>
              <button id="collapse-all" class="icon-button" type="button" title="Collapse all folders" aria-label="Collapse all folders">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 2.5 8 5.5l2.5-3m-5 11L8 10.5l2.5 3"/></svg>
              </button>
            </span>
          </span>
          <span aria-hidden="true">Status</span>
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
  <footer id="status" role="status">Click: commit · Shift+click: select visible interval · Cmd/Ctrl+click or Space: toggle commit.</footer>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function selectionAnchor(
  selection: RepositorySelection | undefined,
): string | undefined {
  if (selection?.mode === "range" || selection?.mode === "selection") {
    return selection.anchorHash;
  }
  return undefined;
}

function mergeRefreshScope(
  pending: RefreshScope | undefined,
  next: RefreshScope,
): RefreshScope {
  const priority: Record<RefreshScope, number> = {
    workingTree: 0,
    detect: 1,
    history: 2,
  };
  return pending === undefined || priority[next] > priority[pending]
    ? next
    : pending;
}

function selectionHasHashes(
  selection: RepositorySelection,
  hashes: readonly string[],
): boolean {
  if (selection.mode !== "range" && selection.mode !== "selection") {
    return false;
  }
  if (selection.commitHashes.length !== hashes.length) {
    return false;
  }
  const expected = new Set(hashes);
  return selection.commitHashes.every((hash) => expected.has(hash));
}

function isBinary(content: Buffer): boolean {
  const sampleLength = Math.min(content.length, 8 * 1024);
  return content.subarray(0, sampleLength).includes(0);
}

function fileContentMessage(
  content: ChangedFile["content"],
  textDiffMaxBytes: number,
): string | undefined {
  if (content === undefined) {
    return undefined;
  }
  switch (content.kind) {
    case "image":
      return undefined;
    case "binary":
      return "GitAmida: This is a binary file, so a text diff cannot be opened.";
    case "submodule":
      return "GitAmida: This path is a Git submodule. Its commit change is listed, but submodule comparison is not available yet.";
    case "oversized": {
      if (content.size !== undefined && content.size <= textDiffMaxBytes) {
        return undefined;
      }
      const actual =
        content.size === undefined ? "This file" : formatBytes(content.size);
      return `GitAmida: ${actual} exceeds the current ${formatBytes(textDiffMaxBytes)} VS Code/Cursor text-diff limit.`;
    }
  }
}

function textDiffLimitMessage(size: number, limit: number): string {
  return `GitAmida: ${formatBytes(size)} exceeds the current ${formatBytes(limit)} VS Code/Cursor text-diff limit.`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.ceil(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function userMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isPathInside(repository: string, path: string): boolean {
  const relativePath = relative(repository, path);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
}
