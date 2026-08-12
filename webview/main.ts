import type {
  ChangedFile,
  Commit,
  CommitGraph,
  FileHistoryTab,
  FileTreeNode,
  FileViewMode,
  GraphLine,
  HistoryRow,
  RepositorySelection,
  RepositoryViewState,
  RepositoryViewStatePatch,
  WorkingTreeState,
} from "../src/model";
import type {
  HostToWebviewMessage,
  RepositoryStateKind,
  WebviewToHostMessage,
} from "../src/protocol";
import {
  compactBranchRefGroups,
  remoteDefaultBranches,
  remoteDefaultLabel,
  type CompactBranchRefGroup,
  type RemoteDefaultBranch,
} from "../src/refs.js";

interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
}

type FileIconKind =
  | "file"
  | NonNullable<ChangedFile["content"]>["kind"];

const FILE_ICON_PATHS: Record<FileIconKind, string> = {
  file: "M4 2.5h5l3 3v8H4zM9 2.5v3h3M6 8.5h4M6 11h3",
  image:
    "M2.5 3.5h11v9h-11zM4 11l3-3 2 2 1.5-1.5 2 2M10.5 6h.01",
  binary:
    "M4 2.5h5l3 3v8H4zM9 2.5v3h3M5.5 8h2v2h-2zM9 10.5h1.5V12H9z",
  oversized:
    "M4 2.5h5l3 3v8H4zM9 2.5v3h3M8 8v2.5M8 12h.01",
  submodule:
    "M3 3h4.5v4.5H3zM8.5 8.5H13V13H8.5zM7.5 5.25h2v5.5h-2",
};

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const elements = {
  details: element<HTMLDivElement>("details"),
  detailsHeading: element<HTMLElement>("details-heading"),
  collapseAll: element<HTMLButtonElement>("collapse-all"),
  detailsResizer: element<HTMLDivElement>("details-resizer"),
  detailsSection: element<HTMLElement>("details-section"),
  expandAll: element<HTMLButtonElement>("expand-all"),
  files: element<HTMLDivElement>("files"),
  fileHistoryCount: element<HTMLSpanElement>("file-history-count"),
  fileHistoryDetails: element<HTMLDivElement>("file-history-details"),
  fileHistoryPath: element<HTMLSpanElement>("file-history-path"),
  fileHistoryResizer: element<HTMLDivElement>("file-history-resizer"),
  fileHistoryWorkspace: element<HTMLElement>("file-history-workspace"),
  fileRevisions: element<HTMLDivElement>("file-revisions"),
  fileTabs: element<HTMLDivElement>("file-tabs"),
  flatMode: element<HTMLButtonElement>("flat-mode"),
  history: element<HTMLDivElement>("history"),
  historyCount: element<HTMLSpanElement>("history-count"),
  inspection: element<HTMLElement>("inspection"),
  repositoryTab: element<HTMLButtonElement>("repository-tab"),
  selectedCommit: element<HTMLSpanElement>("selected-commit"),
  status: element<HTMLElement>("status"),
  tabList: element<HTMLDivElement>("tab-list"),
  tabStrip: element<HTMLElement>("tab-strip"),
  toggleDetails: element<HTMLButtonElement>("toggle-details"),
  treeActions: element<HTMLDivElement>("tree-actions"),
  treeMode: element<HTMLButtonElement>("tree-mode"),
  workspace: element<HTMLElement>("workspace"),
  workspaceResizer: element<HTMLDivElement>("workspace-resizer"),
};

let selection: RepositorySelection | undefined;
let currentHead: string | undefined;
let workingTree: WorkingTreeState | undefined;
let selectedFilePath: string | undefined;
let commits = new Map<string, Commit>();
let currentFiles: ChangedFile[] = [];
let currentTree: FileTreeNode[] = [];
let fileViewMode: FileViewMode = "flat";
let historyRatio = 55;
let filesRatio = 65;
let detailsCollapsed = false;
let expandedTreePaths = new Set<string>();
let retainedFilesScrollTop: number | undefined;
let fileHistoryTabs: FileHistoryTab[] = [];
let activeFileHistoryTabId: string | undefined;
let changedFilePreviewTimer: number | undefined;
let fileRevisionPreviewTimer: number | undefined;
let fileHistoryScrollFrame: number | undefined;
let historyScrollFrame: number | undefined;
let historyHasMore = false;
let historyPageLoading = false;
let historyPageError: string | undefined;

elements.flatMode.addEventListener("click", () => setFileViewMode("flat"));
elements.treeMode.addEventListener("click", () => setFileViewMode("tree"));
elements.expandAll.addEventListener("click", () => {
  expandedTreePaths = collectDirectoryPaths(currentTree);
  renderFiles();
});
elements.collapseAll.addEventListener("click", () => {
  expandedTreePaths.clear();
  renderFiles();
});
elements.toggleDetails.addEventListener("click", () => {
  detailsCollapsed = !detailsCollapsed;
  applyDetailsState();
  updateViewState({ detailsCollapsed });
});
elements.repositoryTab.addEventListener("click", () => {
  saveActiveFileHistoryScroll();
  vscode.postMessage({ type: "activateRepositoryHistory" });
});
elements.repositoryTab.addEventListener("keydown", navigateHistoryTabs);
elements.fileRevisions.addEventListener("scroll", scheduleFileHistoryScroll);
elements.history.addEventListener("scroll", scheduleHistoryPrefetch);
elements.fileTabs.addEventListener(
  "wheel",
  (event) => {
    if (
      elements.fileTabs.scrollWidth <= elements.fileTabs.clientWidth + 1 ||
      Math.abs(event.deltaY) <= Math.abs(event.deltaX)
    ) {
      return;
    }
    event.preventDefault();
    elements.fileTabs.scrollLeft += event.deltaY;
  },
  { passive: false },
);

configureResizer();
configureWorkspaceResizer(elements.workspaceResizer, elements.workspace);
configureWorkspaceResizer(
  elements.fileHistoryResizer,
  elements.fileHistoryWorkspace,
);

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isHostMessage(event.data)) {
    return;
  }
  const message = event.data;

  switch (message.type) {
    case "historyLoading":
      historyHasMore = false;
      historyPageLoading = true;
      historyPageError = undefined;
      setStatus("Loading history…");
      setEmpty(elements.history, "Loading commits…");
      break;
    case "repositoryState":
      renderRepositoryState(message.state);
      break;
    case "history":
      historyHasMore = message.hasMore;
      historyPageLoading = false;
      historyPageError = undefined;
      applyViewState(message.viewState);
      selection = message.selection;
      currentHead = message.repository.head;
      workingTree = message.workingTree;
      renderHistory(message.rows, message.graphLaneCount);
      renderSelectionDetails();
      scheduleHistoryPrefetch();
      break;
    case "historyPageLoading":
      historyPageLoading = true;
      historyPageError = undefined;
      setStatus("Loading more commits…");
      break;
    case "historyPage":
      historyHasMore = message.hasMore;
      historyPageLoading = false;
      historyPageError = undefined;
      renderHistory(message.rows, message.graphLaneCount);
      renderSelectionDetails();
      scheduleHistoryPrefetch();
      break;
    case "historyPageError":
      historyPageLoading = false;
      historyPageError = message.message;
      setHistoryPageError(message.message);
      break;
    case "workingTree":
      workingTree = message.workingTree;
      selection = message.selection;
      const restoreHistoryFocus = renderWorkingTreeRow();
      updateCommitSelection();
      if (restoreHistoryFocus) {
        elements.history
          .querySelector<HTMLElement>(".history-row.selected")
          ?.focus({ preventScroll: true });
      }
      renderSelectionDetails();
      setStatus(
        "Click: commit · Shift+click: select visible interval · Cmd/Ctrl+click or Space: toggle commit.",
      );
      break;
    case "workingTreeError":
      setStatusWithRetry(message.message);
      break;
    case "refreshError":
      historyPageLoading = false;
      setStatusWithRetry(message.message);
      break;
    case "filesLoading":
      clearChangedFilePreview();
      if (sameSelection(message.selection, selection)) {
        retainedFilesScrollTop = elements.files.scrollTop;
      } else {
        retainedFilesScrollTop = undefined;
        selectedFilePath = undefined;
      }
      selection = message.selection;
      currentFiles = [];
      currentTree = [];
      updateCommitSelection();
      renderSelectionDetails();
      setEmpty(elements.files, "Loading changed files…");
      elements.selectedCommit.textContent = selectionLabel(
        message.selection,
      );
      setStatus("Loading changed files…");
      break;
    case "files":
      if (sameSelection(message.selection, selection)) {
        currentFiles = message.files;
        currentTree = message.tree;
        expandedTreePaths = collectDirectoryPaths(currentTree);
        renderFiles();
        restoreFilesScroll();
        renderSelectionDetails();
      }
      break;
    case "filesError":
      if (sameSelection(message.selection, selection)) {
        retainedFilesScrollTop = undefined;
        setEmptyWithRetry(elements.files, message.message);
        setStatus(message.message, true);
      }
      break;
    case "fileHistoryState":
      fileHistoryTabs = message.tabs;
      activeFileHistoryTabId = message.activeTabId;
      renderHistoryTabs();
      renderActiveWorkspace();
      break;
    case "revealRepositoryCommit":
      requestAnimationFrame(() => {
        const row = [...elements.history.querySelectorAll<HTMLElement>(
          ".history-row",
        )].find((candidate) => candidate.dataset.hash === message.hash);
        row?.scrollIntoView({ block: "center" });
      });
      break;
    case "error":
      historyHasMore = false;
      historyPageLoading = false;
      historyPageError = undefined;
      commits.clear();
      workingTree = undefined;
      selection = undefined;
      setEmptyWithRetry(elements.history, message.message);
      setEmpty(elements.files, "No changed files.");
      setEmpty(elements.details, "No commit selected.");
      setStatus(message.message, true);
      break;
  }
});

function renderHistoryTabs(): void {
  const restoreTabFocus = elements.tabList.contains(document.activeElement);
  elements.tabStrip.hidden = fileHistoryTabs.length === 0;
  elements.fileTabs.replaceChildren();
  elements.repositoryTab.setAttribute(
    "aria-selected",
    String(activeFileHistoryTabId === undefined),
  );
  elements.repositoryTab.classList.toggle(
    "active",
    activeFileHistoryTabId === undefined,
  );

  const labelCounts = new Map<string, number>();
  for (const tab of fileHistoryTabs) {
    labelCounts.set(tab.label, (labelCounts.get(tab.label) ?? 0) + 1);
  }

  for (const tab of fileHistoryTabs) {
    const item = document.createElement("div");
    item.className = "history-tab-item";
    item.classList.toggle("active", activeFileHistoryTabId === tab.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-tab file-history-tab";
    button.dataset.tabId = tab.id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", "file-history-workspace");
    button.setAttribute(
      "aria-selected",
      String(activeFileHistoryTabId === tab.id),
    );
    button.classList.toggle("active", activeFileHistoryTabId === tab.id);
    button.title = tab.path;
    button.textContent =
      (labelCounts.get(tab.label) ?? 0) > 1 ? tab.path : tab.label;
    button.addEventListener("click", () => {
      saveActiveFileHistoryScroll();
      vscode.postMessage({ type: "activateFileHistory", tabId: tab.id });
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "Delete") {
        event.preventDefault();
        saveActiveFileHistoryScroll();
        vscode.postMessage({ type: "closeFileHistory", tabId: tab.id });
        return;
      }
      navigateHistoryTabs(event);
    });

    const close = document.createElement("button");
    close.type = "button";
    close.className = "history-tab-close";
    close.title = `Close File History: ${tab.path}`;
    close.setAttribute("aria-label", `Close File History: ${tab.path}`);
    close.textContent = "×";
    close.addEventListener("click", () => {
      saveActiveFileHistoryScroll();
      vscode.postMessage({ type: "closeFileHistory", tabId: tab.id });
    });
    item.append(button, close);
    elements.fileTabs.append(item);
  }

  requestAnimationFrame(() => {
    const activeTab =
      activeFileHistoryTabId === undefined
        ? elements.repositoryTab
        : elements.fileTabs.querySelector<HTMLButtonElement>(
            `[role=tab][data-tab-id="${activeFileHistoryTabId}"]`,
          );
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (restoreTabFocus) {
      activeTab?.focus();
    }
  });
}

function renderActiveWorkspace(): void {
  const tab = activeFileHistoryTab();
  const repositoryActive = tab === undefined;
  elements.workspace.hidden = !repositoryActive;
  elements.fileHistoryWorkspace.hidden = repositoryActive;
  if (repositoryActive) {
    if (historyPageError !== undefined) {
      setHistoryPageError(historyPageError);
      return;
    }
    setStatus(
      "Click: commit · Shift+click: select visible interval · Cmd/Ctrl+click or Space: toggle commit.",
    );
    scheduleHistoryPrefetch();
    return;
  }
  renderFileRevisions(tab);
}

function renderFileRevisions(tab: FileHistoryTab): void {
  const focusedHash = elements.fileRevisions
    .querySelector<HTMLElement>(".file-revision-row:focus")
    ?.dataset.hash;
  elements.fileHistoryPath.textContent = tab.path;
  elements.fileHistoryPath.title = tab.path;
  elements.fileHistoryCount.textContent = tab.loading
    ? ""
    : `${tab.revisions.length} revision${tab.revisions.length === 1 ? "" : "s"}`;
  elements.fileRevisions.replaceChildren();
  renderFileHistoryDetails(tab);
  if (tab.loading) {
    setEmpty(elements.fileRevisions, "Loading file history…");
    setStatus(`Loading File History for ${tab.path}…`, false, "fileHistory");
    return;
  }
  if (tab.error !== undefined) {
    const wrapper = document.createElement("div");
    wrapper.className = "empty-state error retry-state";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "retry-button";
    retry.textContent = "Retry";
    retry.addEventListener("click", () =>
      vscode.postMessage({ type: "retryFileHistory", tabId: tab.id }),
    );
    wrapper.append(span("", tab.error), retry);
    elements.fileRevisions.append(wrapper);
    setStatus(tab.error, true, "fileHistory");
    return;
  }
  if (tab.revisions.length === 0) {
    setEmpty(elements.fileRevisions, "No committed revisions found.");
    setStatus(
      `No committed revisions found for ${tab.path}.`,
      false,
      "fileHistory",
    );
    return;
  }

  for (const revision of tab.revisions) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "file-revision-row file-history-columns";
    row.dataset.hash = revision.commit.hash;
    row.dataset.vscodeContext = JSON.stringify({
      webviewSection: "fileRevision",
      preventDefaultContextMenuItems: true,
      gitAmidaFileHistoryTabId: tab.id,
      gitAmidaCommitHash: revision.commit.hash,
    });
    row.setAttribute("role", "option");
    const selected = revision.commit.hash === tab.selectedHash;
    row.classList.toggle("selected", selected);
    row.setAttribute("aria-selected", String(selected));
    const path = fileDisplayPath(revision);
    const status = statusLabel(revision.status);
    const description =
      `${revision.commit.subject || "(no subject)"} · ${revision.commit.hash} · ` +
      `${path} · ${status} · Authored ${formatFullDate(revision.commit.authoredAt)}`;
    row.title = description;
    row.setAttribute("aria-label", description);
    const commitCell = span("file-revision-commit", "");
    commitCell.append(
      span("subject", revision.commit.subject || "(no subject)"),
      span("file-revision-hash", revision.commit.shortHash),
    );
    const statusClass = `status-${revision.status[0] ?? "X"}`;
    row.append(
      commitCell,
      span(`path ${statusClass}`, path),
      span("date", formatRowDate(revision.commit.authoredAt)),
      span(`status ${statusClass}`, status),
    );
    row.addEventListener("click", () => {
      if (fileRevisionPreviewTimer !== undefined) {
        window.clearTimeout(fileRevisionPreviewTimer);
      }
      fileRevisionPreviewTimer = window.setTimeout(() => {
        fileRevisionPreviewTimer = undefined;
        selectFileRevision(tab.id, revision.commit.hash, true);
      }, 180);
    });
    row.addEventListener("dblclick", () => {
      if (fileRevisionPreviewTimer !== undefined) {
        window.clearTimeout(fileRevisionPreviewTimer);
        fileRevisionPreviewTimer = undefined;
      }
      selectFileRevision(tab.id, revision.commit.hash, false);
    });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        selectFileRevision(tab.id, revision.commit.hash, false);
        return;
      }
      navigateRows(event, ".file-revision-row", (target) => {
        const hash = target.dataset.hash;
        if (hash !== undefined) {
          selectFileRevision(tab.id, hash, true);
        }
      });
    });
    elements.fileRevisions.append(row);
  }
  requestAnimationFrame(() => {
    elements.fileRevisions.scrollTop = tab.scrollTop;
    if (tab.revealSelected) {
      elements.fileRevisions
        .querySelector<HTMLElement>(".file-revision-row.selected")
        ?.scrollIntoView({ block: "center" });
      vscode.postMessage({
        type: "updateFileHistoryScroll",
        tabId: tab.id,
        scrollTop: elements.fileRevisions.scrollTop,
      });
    }
    if (focusedHash !== undefined) {
      elements.fileRevisions
        .querySelector<HTMLElement>(`.file-revision-row[data-hash="${focusedHash}"]`)
        ?.focus({ preventScroll: true });
    }
  });
  setStatus(
    `${tab.revisions.length} file revision${tab.revisions.length === 1 ? "" : "s"}. ` +
      "Click to preview; double-click or press Enter to keep a diff open.",
    false,
    "fileHistory",
  );
}

function renderFileHistoryDetails(tab: FileHistoryTab): void {
  elements.fileHistoryDetails.replaceChildren();
  if (tab.loading) {
    setEmpty(elements.fileHistoryDetails, "Loading file history…");
    return;
  }
  if (tab.error !== undefined) {
    setEmpty(elements.fileHistoryDetails, "Commit details are unavailable.");
    return;
  }
  const revision =
    tab.revisions.find((item) => item.commit.hash === tab.selectedHash) ??
    tab.revisions[0];
  if (revision === undefined) {
    setEmpty(elements.fileHistoryDetails, "No committed revision selected.");
    return;
  }
  renderCommitDetails(elements.fileHistoryDetails, revision.commit);
}

function activeFileHistoryTab(): FileHistoryTab | undefined {
  return activeFileHistoryTabId === undefined
    ? undefined
    : fileHistoryTabs.find((tab) => tab.id === activeFileHistoryTabId);
}

function selectFileRevision(
  tabId: string,
  hash: string,
  preview: boolean,
): void {
  saveActiveFileHistoryScroll();
  vscode.postMessage({
    type: "selectFileRevision",
    tabId,
    hash,
    preview,
  });
}

function saveActiveFileHistoryScroll(): void {
  if (fileRevisionPreviewTimer !== undefined) {
    window.clearTimeout(fileRevisionPreviewTimer);
    fileRevisionPreviewTimer = undefined;
  }
  const tab = activeFileHistoryTab();
  if (tab !== undefined && !elements.fileHistoryWorkspace.hidden) {
    vscode.postMessage({
      type: "updateFileHistoryScroll",
      tabId: tab.id,
      scrollTop: elements.fileRevisions.scrollTop,
    });
  }
}

function scheduleFileHistoryScroll(): void {
  if (fileHistoryScrollFrame !== undefined) {
    cancelAnimationFrame(fileHistoryScrollFrame);
  }
  fileHistoryScrollFrame = requestAnimationFrame(() => {
    fileHistoryScrollFrame = undefined;
    saveActiveFileHistoryScroll();
  });
}

function scheduleHistoryPrefetch(): void {
  if (historyScrollFrame !== undefined) {
    cancelAnimationFrame(historyScrollFrame);
  }
  historyScrollFrame = requestAnimationFrame(() => {
    historyScrollFrame = undefined;
    if (
      !historyHasMore ||
      historyPageLoading ||
      historyPageError !== undefined ||
      elements.workspace.hidden
    ) {
      return;
    }
    const remaining =
      elements.history.scrollHeight -
      elements.history.scrollTop -
      elements.history.clientHeight;
    const threshold = Math.max(250, elements.history.clientHeight);
    if (remaining <= threshold) {
      requestMoreHistory();
    }
  });
}

function requestMoreHistory(): void {
  if (!historyHasMore || historyPageLoading) {
    return;
  }
  historyPageError = undefined;
  historyPageLoading = true;
  vscode.postMessage({ type: "loadMoreHistory" });
}

function navigateHistoryTabs(event: KeyboardEvent): void {
  const current = event.currentTarget;
  if (!(current instanceof HTMLElement)) {
    return;
  }
  const tabs = [
    ...elements.tabList.querySelectorAll<HTMLButtonElement>("[role=tab]"),
  ];
  const index = tabs.indexOf(current as HTMLButtonElement);
  let target: HTMLButtonElement | undefined;
  if (event.key === "ArrowLeft") {
    target = tabs[Math.max(0, index - 1)];
  } else if (event.key === "ArrowRight") {
    target = tabs[Math.min(tabs.length - 1, index + 1)];
  } else if (event.key === "Home") {
    target = tabs[0];
  } else if (event.key === "End") {
    target = tabs.at(-1);
  }
  if (target !== undefined) {
    event.preventDefault();
    target.focus();
    target.click();
  }
}

function renderHistory(rows: HistoryRow[], graphLaneCount: number): void {
  const scrollTop = elements.history.scrollTop;
  const selectedRow = elements.history.querySelector<HTMLElement>(
    ".history-row.selected",
  );
  const selectedOffset =
    selectedRow === null ? undefined : selectedRow.offsetTop - scrollTop;
  const restoreFocus =
    selectedRow !== null && selectedRow.contains(document.activeElement);
  elements.history.replaceChildren();
  commits = new Map();
  const historyPane = elements.history.closest<HTMLElement>(".history-pane");
  const metrics = graphMetrics(graphLaneCount);
  if (historyPane !== null) {
    historyPane.dataset.graphSize = metrics.size;
  }
  elements.historyCount.textContent =
    `${rows.length}${historyHasMore ? "+" : ""} commits`;

  renderWorkingTreeRow();

  for (const row of rows) {
    commits.set(row.commit.hash, row.commit);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-row history-columns";
    button.dataset.hash = row.commit.hash;
    button.dataset.vscodeContext = JSON.stringify({
      webviewSection: "commit",
      preventDefaultContextMenuItems: true,
      gitAmidaCommitHash: row.commit.hash,
      gitAmidaHasSwitchableBranch: row.commit.refs.some(
        (ref) => ref.type === "localBranch" && !ref.current,
      ),
    });
    button.setAttribute("role", "option");
    const isHead = row.commit.hash === currentHead;
    const refNames = row.commit.refs.map((ref) => ref.name).join(", ");
    const worktreeDescription = describeWorktrees(row.commit.worktrees ?? []);
    button.setAttribute(
      "aria-label",
      `${isHead ? "HEAD, " : ""}${row.commit.subject}, ${formatFullDate(row.commit.authoredAt)}${refNames.length === 0 ? "" : `, ${refNames}`}${worktreeDescription.length === 0 ? "" : `, ${worktreeDescription}`}`,
    );

    const graph = createGraph(
      row.graph,
      graphLaneCount,
      metrics.width,
      isHead,
    );
    graph.setAttribute("aria-hidden", "true");
    const commitCell = document.createElement("span");
    commitCell.className = "commit-cell";
    const subject = span("subject", row.commit.subject || "(no subject)");
    subject.title = row.commit.subject;
    commitCell.append(subject);
    const refs = createRefList(row.commit, isHead);
    if (refs !== undefined) {
      commitCell.append(refs);
    }
    const date = span("date", formatRowDate(row.commit.authoredAt));
    date.title = `Authored ${formatFullDate(row.commit.authoredAt)}`;
    button.append(graph, commitCell, date);
    button.addEventListener("click", (event) => {
      selectCommit(
        row.commit.hash,
        event.shiftKey,
        event.metaKey || event.ctrlKey,
      );
    });
    button.addEventListener("keydown", (event) => {
      if (
        event.key === " " ||
        (event.key === "Enter" && (event.metaKey || event.ctrlKey))
      ) {
        event.preventDefault();
        selectCommit(row.commit.hash, false, true);
        return;
      }
      navigateRows(event, ".history-row", (target) => {
        selectHistoryTarget(target, event.shiftKey);
      });
    });
    elements.history.append(button);
  }

  updateCommitSelection();
  const nextSelectedRow = elements.history.querySelector<HTMLElement>(
    ".history-row.selected",
  );
  elements.history.scrollTop =
    selectedOffset === undefined || nextSelectedRow === null
      ? scrollTop
      : Math.max(0, nextSelectedRow.offsetTop - selectedOffset);
  if (restoreFocus) {
    nextSelectedRow?.focus({ preventScroll: true });
  }
  setStatus(
    "Click: commit · Shift+click: select visible interval · Cmd/Ctrl+click or Space: toggle commit.",
  );
}

function renderWorkingTreeRow(): boolean {
  const existing = elements.history.querySelector<HTMLElement>(
    ".working-tree-row",
  );
  const hadRow = existing !== null;
  const scrollTop = elements.history.scrollTop;
  const rowHeight = existing?.offsetHeight ?? 25;
  if (workingTree === undefined) {
    const restoreFocus =
      existing !== null && existing.contains(document.activeElement);
    existing?.remove();
    if (hadRow && scrollTop > 0) {
      elements.history.scrollTop = Math.max(0, scrollTop - rowHeight);
    }
    return restoreFocus;
  }

  const fileCount = workingTree.files.length;
  const label = `Uncommitted changes (${fileCount})`;
  if (existing !== null) {
    const subject = existing.querySelector<HTMLElement>(".subject");
    if (subject !== null) {
      subject.textContent = label;
    }
    existing.setAttribute(
      "aria-label",
      `${label}, saved working tree compared with HEAD`,
    );
    return false;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "history-row history-columns working-tree-row";
  button.dataset.workingTree = "true";
  button.dataset.vscodeContext = JSON.stringify({
    preventDefaultContextMenuItems: true,
  });
  button.setAttribute("role", "option");
  button.setAttribute(
    "aria-label",
    `${label}, saved working tree compared with HEAD`,
  );
  const commitCell = span("commit-cell working-tree-cell", "");
  commitCell.append(span("subject", label));
  button.append(createWorkingTreeMarker(), commitCell, span("date", ""));
  button.addEventListener("click", () => selectWorkingTree());
  button.addEventListener("keydown", (event) => {
    navigateRows(event, ".history-row", (target) => {
      selectHistoryTarget(target, event.shiftKey);
    });
  });
  elements.history.prepend(button);
  if (!hadRow && scrollTop > 0) {
    elements.history.scrollTop = scrollTop + rowHeight;
  }
  return false;
}

function createWorkingTreeMarker(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("graph", "working-tree-graph");
  svg.setAttribute("viewBox", "0 0 54 25");
  svg.setAttribute("preserveAspectRatio", "xMinYMid meet");
  svg.setAttribute("aria-hidden", "true");
  const marker = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  marker.classList.add("working-tree-marker");
  marker.setAttribute("d", "M 6 7 L 11 12.5 L 6 18 L 1 12.5 Z");
  svg.append(marker);
  return svg;
}

type GraphSize = "small" | "medium" | "large" | "xlarge" | "wide";
const HEAD_NODE_RADIUS = 5;

function graphMetrics(laneCount: number): { size: GraphSize; width: number } {
  if (laneCount <= 4) {
    return { size: "small", width: 54 };
  }
  if (laneCount <= 6) {
    return { size: "medium", width: 72 };
  }
  if (laneCount <= 8) {
    return { size: "large", width: 94 };
  }
  if (laneCount <= 10) {
    return { size: "xlarge", width: 116 };
  }
  return { size: "wide", width: 140 };
}

function createGraph(
  graph: CommitGraph,
  laneCount: number,
  width: number,
  isHead: boolean,
): SVGSVGElement {
  const height = 25;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("graph");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "xMinYMid meet");

  for (const line of graph.lines) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.classList.add("graph-line", graphColorClass(line.color));
    path.setAttribute(
      "d",
      graphPath(
        line,
        laneCount,
        width,
        height,
        isHead ? HEAD_NODE_RADIUS : 0,
      ),
    );
    svg.append(path);
  }

  const node = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  node.classList.add("graph-node");
  if (isHead) {
    node.classList.add("graph-head-node", graphColorClass(graph.nodeColor));
  } else {
    node.classList.add(graphColorClass(graph.nodeColor));
  }
  node.setAttribute(
    "cx",
    formatGraphNumber(laneX(graph.nodeLane, laneCount, width)),
  );
  node.setAttribute("cy", formatGraphNumber(height / 2));
  node.setAttribute("r", isHead ? String(HEAD_NODE_RADIUS) : "3.5");
  svg.append(node);
  if (isHead) {
    const center = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle",
    );
    center.classList.add(
      "graph-head-center",
      graphColorClass(graph.nodeColor),
    );
    center.setAttribute(
      "cx",
      formatGraphNumber(laneX(graph.nodeLane, laneCount, width)),
    );
    center.setAttribute("cy", formatGraphNumber(height / 2));
    center.setAttribute("r", "2");
    svg.append(center);
  }
  return svg;
}

function graphPath(
  line: GraphLine,
  laneCount: number,
  width: number,
  height: number,
  nodeInset: number,
): string {
  let from = {
    x: laneX(line.fromLane, laneCount, width),
    y: endpointY(line.from, height),
  };
  let to = {
    x: laneX(line.toLane, laneCount, width),
    y: endpointY(line.to, height),
  };
  if (nodeInset > 0 && line.from === "node") {
    from = movePointToward(from, to, nodeInset);
  }
  if (nodeInset > 0 && line.to === "node") {
    to = movePointToward(to, from, nodeInset);
  }
  const start = `${formatGraphNumber(from.x)} ${formatGraphNumber(from.y)}`;
  const end = `${formatGraphNumber(to.x)} ${formatGraphNumber(to.y)}`;
  return `M ${start} L ${end}`;
}

function movePointToward(
  point: { x: number; y: number },
  target: { x: number; y: number },
  distance: number,
): { x: number; y: number } {
  const deltaX = target.x - point.x;
  const deltaY = target.y - point.y;
  const length = Math.hypot(deltaX, deltaY);
  if (length === 0) {
    return point;
  }
  const ratio = Math.min(distance / length, 1);
  return {
    x: point.x + deltaX * ratio,
    y: point.y + deltaY * ratio,
  };
}

function laneX(lane: number, laneCount: number, width: number): number {
  if (laneCount <= 1) {
    return 6;
  }
  const spacing = Math.min(11, (width - 12) / (laneCount - 1));
  return 6 + lane * spacing;
}

function endpointY(
  endpoint: GraphLine["from"] | GraphLine["to"],
  height: number,
): number {
  if (endpoint === "top") {
    return -1;
  }
  if (endpoint === "bottom") {
    return height + 1;
  }
  return height / 2;
}

function graphColorClass(color: number): string {
  return `graph-color-${Math.abs(color) % 5}`;
}

function formatGraphNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function createRefList(
  commit: Commit,
  isHead: boolean,
): HTMLSpanElement | undefined {
  const worktrees = commit.worktrees ?? [];
  const remoteDefaults = remoteDefaultBranches(commit.refs);
  const remoteHeadRefs = new Set(
    remoteDefaults.map((candidate) => candidate.headFullName),
  );
  const groups = compactBranchRefGroups(commit.refs, remoteDefaults);
  const groupedRefs = new Set(
    groups.flatMap((group) =>
      [...group.localRefs, ...group.remoteRefs].map((ref) => ref.fullName),
    ),
  );
  const visibleRefs = commit.refs.filter(
    (ref) =>
      !groupedRefs.has(ref.fullName) && !remoteHeadRefs.has(ref.fullName),
  );
  if (
    !isHead &&
    worktrees.length === 0 &&
    groups.length === 0 &&
    visibleRefs.length === 0
  ) {
    return undefined;
  }

  const list = document.createElement("span");
  list.className = "ref-list";
  if (worktrees.length > 0) {
    list.append(createWorktreeIndicator(worktrees));
  }
  const currentGroup = groups.find((group) => group.current);
  if (isHead && currentGroup === undefined) {
    list.append(createDetachedHeadIndicator(commit));
  }
  for (const group of groups) {
    list.append(
      createGroupedRefIndicator(
        group,
        isHead && group.current,
        remoteDefaults,
      ),
    );
  }

  for (const ref of visibleRefs) {
    const isRemoteDefault =
      remoteDefaultLabel(ref, remoteDefaults) !== undefined;
    const description = refDescription(ref, isRemoteDefault);
    const indicator = document.createElement("span");
    indicator.className = `ref-indicator ref-${ref.type}`;
    indicator.setAttribute("role", "img");
    indicator.setAttribute("aria-label", description);
    indicator.append(span("ref-symbol", ""));
    list.append(indicator);
  }
  return list;
}

function createWorktreeIndicator(
  worktrees: NonNullable<Commit["worktrees"]>,
): HTMLSpanElement {
  const description = describeWorktrees(worktrees);
  const indicator = span("worktree-indicator", "");
  indicator.setAttribute("role", "img");
  indicator.setAttribute("aria-label", description);
  indicator.title = description;
  const symbol = span("worktree-symbol", "");
  symbol.setAttribute("aria-hidden", "true");
  indicator.append(symbol);
  return indicator;
}

function describeWorktrees(
  worktrees: NonNullable<Commit["worktrees"]>,
): string {
  const label = worktrees.length === 1 ? "Other worktree" : "Other worktrees";
  return `${label}: ${worktrees.map(worktreeDescription).join("; ")}`;
}

function worktreeDescription(
  worktree: NonNullable<Commit["worktrees"]>[number],
): string {
  const state =
    worktree.branch ?? (worktree.detached ? "Detached" : "No branch");
  return `${state} · ${worktree.path}`;
}

function createGroupedRefIndicator(
  group: CompactBranchRefGroup,
  isHead: boolean,
  remoteDefaults: readonly RemoteDefaultBranch[],
): HTMLSpanElement {
  const indicator = document.createElement("span");
  const type = group.localRefs.length > 0 ? "localBranch" : "remoteBranch";
  indicator.className = `ref-branch-group ref-${type}`;
  if (group.displayLabel !== undefined) {
    indicator.classList.add("ref-named");
  }
  if (group.current) {
    indicator.classList.add("ref-current-branch");
  }
  const descriptions = [
    ...(isHead ? [`Local HEAD · Checked out at ${group.label}`] : []),
    ...group.localRefs.map((ref) => refDescription(ref)),
    ...group.remoteRefs.map((ref) =>
      refDescription(
        ref,
        remoteDefaultLabel(ref, remoteDefaults) !== undefined,
      ),
    ),
  ];
  const description = descriptions.join("; ");
  indicator.setAttribute("role", "img");
  indicator.setAttribute("aria-label", description);
  indicator.title = description;

  const symbols = span("ref-symbol-group", "");
  symbols.setAttribute("aria-hidden", "true");
  if (isHead) {
    symbols.append(createGroupedRefSymbol("head"));
  }
  symbols.append(
    ...group.localRefs.map(() => createGroupedRefSymbol("localBranch")),
    ...group.remoteRefs.map(() => createGroupedRefSymbol("remoteBranch")),
  );
  indicator.append(symbols);
  if (group.displayLabel !== undefined) {
    indicator.append(span("ref-name", group.displayLabel));
  }
  return indicator;
}

function createGroupedRefSymbol(
  type: "remoteBranch" | "localBranch" | "head",
): HTMLSpanElement {
  const symbol = span("ref-symbol", "");
  symbol.classList.add(`ref-group-${type}`);
  return symbol;
}

function createDetachedHeadIndicator(commit: Commit): HTMLSpanElement {
  const indicator = document.createElement("span");
  indicator.className =
    "ref-named ref-branch-group ref-detached ref-current-branch";
  const description = `Local HEAD · Detached at ${commit.hash}`;
  indicator.setAttribute("role", "img");
  indicator.setAttribute("aria-label", description);
  indicator.title = description;
  const symbols = span("ref-symbol-group", "");
  symbols.setAttribute("aria-hidden", "true");
  symbols.append(createGroupedRefSymbol("head"));
  indicator.append(symbols, span("ref-name", commit.shortHash));
  return indicator;
}

function renderFiles(): void {
  elements.files.replaceChildren();
  if (currentFiles.length === 0) {
    const scope = selectionScope();
    setEmpty(elements.files, `No changed files in ${scope}.`);
    setStatus(`No changed files in ${scope}.`);
    return;
  }

  if (fileViewMode === "flat") {
    elements.files.setAttribute("role", "listbox");
    for (const file of currentFiles) {
      elements.files.append(createFileRow(file, fileDisplayPath(file)));
    }
  } else {
    elements.files.setAttribute("role", "tree");
    renderTreeNodes(currentTree, elements.files);
  }
  updateFileSelection();
  const scope =
    selection?.mode === "single"
      ? ""
      : ` across ${selectionScope()}`;
  setStatus(
    `${currentFiles.length} changed file${currentFiles.length === 1 ? "" : "s"}${scope}. ` +
      "Click to preview; double-click or press Enter to keep a diff open.",
  );
}

function restoreFilesScroll(): void {
  if (retainedFilesScrollTop !== undefined) {
    elements.files.scrollTop = retainedFilesScrollTop;
    retainedFilesScrollTop = undefined;
  }
}

function renderTreeNodes(nodes: FileTreeNode[], container: HTMLElement): void {
  for (const node of nodes) {
    if (node.kind === "file") {
      container.append(createFileRow(node.file, node.name, true));
      continue;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "tree-directory";
    wrapper.setAttribute("role", "treeitem");
    const expanded = expandedTreePaths.has(node.path);
    wrapper.setAttribute("aria-expanded", String(expanded));

    const button = document.createElement("button");
    button.type = "button";
    button.className = "tree-directory-row";
    button.dataset.vscodeContext = JSON.stringify({
      preventDefaultContextMenuItems: true,
    });
    button.title = node.path;
    button.append(
      createTreeChevron(expanded),
      createFolderIcon(expanded),
      span("tree-folder", node.name),
    );

    const children = document.createElement("div");
    children.className = "tree-children";
    children.setAttribute("role", "group");
    children.hidden = !expanded;
    renderTreeNodes(node.children, children);

    button.addEventListener("click", () => {
      if (expandedTreePaths.has(node.path)) {
        expandedTreePaths.delete(node.path);
      } else {
        expandedTreePaths.add(node.path);
      }
      renderFiles();
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight" && !expandedTreePaths.has(node.path)) {
        event.preventDefault();
        expandedTreePaths.add(node.path);
        renderFiles();
      } else if (
        event.key === "ArrowLeft" &&
        expandedTreePaths.has(node.path)
      ) {
        event.preventDefault();
        expandedTreePaths.delete(node.path);
        renderFiles();
      }
    });
    wrapper.append(button, children);
    container.append(wrapper);
  }
}

function createTreeChevron(expanded: boolean): SVGSVGElement {
  return createStrokeIcon(
    "tree-chevron",
    expanded ? "M3.5 6 8 10.5 12.5 6" : "M6 3.5 10.5 8 6 12.5",
  );
}

function createFolderIcon(expanded: boolean): SVGSVGElement {
  return createStrokeIcon(
    "content-kind-icon kind-folder",
    expanded
      ? "M2.5 5V4h4l1.5 1.5h5.5l-1.25 7h-9L2.5 6.5h11"
      : "M2.5 4h4L8 5.5h5.5v7h-11z",
  );
}

function createFileIcon(file: ChangedFile): SVGSVGElement {
  const kind: FileIconKind = file.content?.kind ?? "file";
  return createStrokeIcon(
    `content-kind-icon kind-${kind}`,
    FILE_ICON_PATHS[kind],
  );
}

function createStrokeIcon(
  className: string,
  pathData: string,
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add(...className.split(" "));
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData);
  svg.append(path);
  return svg;
}

function createFileRow(
  file: ChangedFile,
  label: string,
  tree = false,
): HTMLButtonElement {
  const canRestore =
    selection !== undefined &&
    selection.mode !== "workingTree" &&
    file.content?.kind !== "submodule";
  const canRestoreBefore =
    canRestore &&
    (selection?.mode === "selection"
      ? file.selection?.beforeRef !== undefined
      : !file.status.startsWith("A"));
  const canRestoreAfter =
    canRestore &&
    (selection?.mode === "selection"
      ? file.selection?.afterRef !== undefined
      : !file.status.startsWith("D"));
  const button = document.createElement("button");
  button.type = "button";
  button.className = tree ? "file-row tree-file-row" : "file-row";
  button.dataset.filePath = file.path;
  button.dataset.vscodeContext = JSON.stringify({
    webviewSection: "changedFile",
    preventDefaultContextMenuItems: true,
    gitAmidaFilePath: file.path,
    gitAmidaCanRestoreFile: canRestoreBefore || canRestoreAfter,
    gitAmidaCanRestoreBeforeFile: canRestoreBefore,
    gitAmidaCanRestoreAfterFile: canRestoreAfter,
  });
  button.setAttribute("role", tree ? "treeitem" : "option");
  const status = fileStatusLabel(file);
  const contributors = file.selection?.changes
    .map(
      (change) =>
        commits.get(change.commitHash)?.shortHash ??
        shortHash(change.commitHash),
    )
    .join(", ");
  const description =
    `${fileDisplayPath(file)} · ${status}` +
    (contributors === undefined ? "" : ` · commits ${contributors}`);
  const statusClass = `status-${file.status[0] ?? "X"}`;
  button.title = description;
  button.setAttribute("aria-label", description);
  const pathCell = span("file-path-cell", "");
  pathCell.append(
    createFileIcon(file),
    span(`path ${statusClass}`, label),
  );
  button.append(
    pathCell,
    span(`status ${statusClass}`, fileStatusShortLabel(file)),
  );
  button.addEventListener("click", () => selectFileAndPreview(file.path));
  button.addEventListener("dblclick", () => pinFileDiff(file.path));
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      pinFileDiff(file.path);
      return;
    }
    navigateRows(event, ".file-row", (target) => {
      const path = target.dataset.filePath;
      if (path !== undefined) {
        selectFile(path);
        openDiff(path, true);
      }
    });
  });
  return button;
}

function renderSelectionDetails(): void {
  elements.details.replaceChildren();
  if (selection === undefined) {
    elements.detailsHeading.textContent = "Commit details";
    setEmpty(elements.details, "No commit selected.");
    return;
  }

  if (selection.mode === "range") {
    renderRangeDetails(selection);
    return;
  }

  if (selection.mode === "selection") {
    renderExplicitSelectionDetails(selection);
    return;
  }

  if (selection.mode === "workingTree") {
    renderWorkingTreeDetails(selection);
    return;
  }

  const commit = commits.get(selection.activeHash);
  if (commit === undefined) {
    elements.detailsHeading.textContent = "Commit details";
    setEmpty(elements.details, "No commit selected.");
    return;
  }
  elements.detailsHeading.textContent = "Commit details";

  renderCommitDetails(elements.details, commit);
}

function renderCommitDetails(container: HTMLElement, commit: Commit): void {
  container.replaceChildren();

  const subject = document.createElement("p");
  subject.className = "details-subject";
  subject.textContent = commit.subject || "(no subject)";
  subject.title = commit.subject;

  const body = document.createElement("div");
  body.className = "details-message-body";
  body.textContent = commit.body ?? "";
  body.hidden = commit.body === undefined;

  const list = document.createElement("dl");
  list.className = "details-list";
  appendDetail(list, "Commit", commit.hash);
  appendDetail(
    list,
    "Author",
    `${commit.authorName} <${commit.authorEmail}>`,
  );
  appendDetail(list, "Authored", formatFullDate(commit.authoredAt));
  appendDetail(list, "Committed", formatFullDate(commit.committedAt));
  const remoteDefaults = remoteDefaultBranches(commit.refs);
  appendRefsDetail(list, commit.refs, remoteDefaults);
  appendRemoteDefaultsDetail(list, remoteDefaults);
  appendWorktreesDetail(list, commit.worktrees ?? []);
  appendDetail(list, "Parents", commit.parents.join(", ") || "None (root commit)");
  appendDetail(
    list,
    "Compared with",
    commit.parents[0] ?? "Empty tree (root commit)",
  );
  container.append(subject, body, list);
}

function renderWorkingTreeDetails(
  current: Extract<RepositorySelection, { mode: "workingTree" }>,
): void {
  elements.detailsHeading.textContent = "Commit details";
  const heading = document.createElement("h3");
  heading.className = "details-subheading";
  heading.textContent = "Working tree details";
  const subject = document.createElement("p");
  subject.className = "details-subject";
  subject.textContent = "Uncommitted changes";
  const list = document.createElement("dl");
  list.className = "details-list";
  appendDetail(list, "Base HEAD", current.headHash);
  appendDetail(list, "Files", String(workingTree?.files.length ?? 0));
  appendDetail(list, "Comparison", "HEAD → saved working tree");
  appendDetail(list, "Unsaved editors", "Excluded until saved");
  elements.details.append(heading, subject, list);
}

function renderExplicitSelectionDetails(
  explicit: Extract<RepositorySelection, { mode: "selection" }>,
): void {
  elements.detailsHeading.textContent = "Commit details";
  const heading = document.createElement("h3");
  heading.className = "details-subheading";
  heading.textContent = "Selected commits";

  const summary = document.createElement("p");
  summary.className = "details-subject";
  summary.textContent = "Selected changes; no virtual merged tree";

  const details = document.createElement("dl");
  details.className = "details-list";
  appendDetail(details, "Commits", String(explicit.commitHashes.length));
  appendDetail(
    details,
    "Comparison",
    "Per-file selected endpoints",
  );
  appendDetail(
    details,
    "Endpoints",
    "Oldest selected before-state → newest selected after-state per file",
  );

  const commitsHeading = document.createElement("h3");
  commitsHeading.className = "details-subheading";
  commitsHeading.textContent =
    `Included commits (${explicit.commitHashes.length})`;
  const commitList = createCommitList(explicit.commitHashes);
  elements.details.append(heading, summary, details, commitsHeading, commitList);

  const file = currentFiles.find(
    (candidate) => candidate.path === selectedFilePath,
  );
  if (file?.selection === undefined) {
    return;
  }
  const fileHeading = document.createElement("h3");
  fileHeading.className = "details-subheading";
  fileHeading.textContent =
    `Selected file changes (${file.selection.changes.length})`;
  const explanation = document.createElement("p");
  explanation.className = "selection-file-explanation";
  const beforeEndpoint =
    file.selection.beforeRef === undefined
      ? "Empty file"
      : shortHash(file.selection.beforeRef);
  const afterEndpoint =
    file.selection.afterRef === undefined
      ? "Empty file"
      : shortHash(file.selection.afterRef);
  const endpoint =
    `${beforeEndpoint} → ${afterEndpoint}`;
  explanation.textContent =
    file.selection.changes.length === 1
      ? `Endpoint ${endpoint}. Compares this selected change with its first parent.`
      : `Endpoint ${endpoint}. Compares this file's oldest selected before-state with its newest selected after-state. Intervening changes to this path are included; branches are not virtually merged.`;
  const fileCommits = createCommitList(
    file.selection.changes.map((change) => change.commitHash),
    new Map(
      file.selection.changes.map((change) => [
        change.commitHash,
        statusLabel(change.status),
      ]),
    ),
  );
  elements.details.append(fileHeading, explanation, fileCommits);
}

function renderRangeDetails(
  range: Extract<RepositorySelection, { mode: "range" }>,
): void {
  elements.detailsHeading.textContent = "Commit details";
  const oldest = commits.get(range.oldestHash);
  const newest = commits.get(range.newestHash);

  const rangeHeading = document.createElement("h3");
  rangeHeading.className = "details-subheading";
  rangeHeading.textContent = "Selected commits";

  const subject = document.createElement("p");
  subject.className = "details-subject";
  subject.textContent = `${newest?.subject || "(no subject)"} … ${oldest?.subject || "(no subject)"}`;

  const list = document.createElement("dl");
  list.className = "details-list";
  appendDetail(list, "Commits", String(range.commitHashes.length));
  appendDetail(list, "Comparison", "Continuous range");
  appendDetail(
    list,
    "Newest",
    commitDescription(range.newestHash),
  );
  appendDetail(
    list,
    "Oldest",
    commitDescription(range.oldestHash),
  );
  if (oldest !== undefined && oldest.parents.length > 1) {
    const comparisonParent = range.baseHash ?? "Empty tree";
    appendDetail(
      list,
      "Comparison parent",
      `1 of ${oldest.parents.length} (first parent) · ${comparisonParent}`,
    );
  }
  appendDetail(
    list,
    "Endpoints",
    `${range.baseHash ?? "Empty tree"} → ${range.newestHash}`,
  );

  const commitsHeading = document.createElement("h3");
  commitsHeading.className = "details-subheading";
  commitsHeading.textContent =
    `Included commits (${range.commitHashes.length})`;

  const commitList = document.createElement("ol");
  commitList.className = "range-commit-list";
  commitList.setAttribute("aria-label", "Selected commits, newest first");
  for (const hash of [...range.commitHashes].reverse()) {
    const commit = commits.get(hash);
    const item = document.createElement("li");
    item.className = "range-commit-item";
    item.title = `${hash} · ${commit?.subject || "(no subject)"}`;

    const hashValue = document.createElement("code");
    hashValue.className = "range-commit-hash";
    hashValue.textContent = commit?.shortHash ?? shortHash(hash);
    const commitSubject = span(
      "range-commit-subject",
      commit?.subject || "(no subject)",
    );
    commitSubject.title = commit?.subject ?? "";
    const commitDate = span(
      "range-commit-date",
      commit === undefined ? "—" : formatRowDate(commit.authoredAt),
    );
    commitDate.title =
      commit === undefined
        ? "Author date unavailable"
        : `Authored ${formatFullDate(commit.authoredAt)}`;
    item.append(hashValue, commitSubject, commitDate);
    commitList.append(item);
  }

  elements.details.append(
    rangeHeading,
    subject,
    list,
    commitsHeading,
    commitList,
  );
}

function createCommitList(
  hashes: string[],
  statuses: ReadonlyMap<string, string> = new Map(),
): HTMLOListElement {
  const list = document.createElement("ol");
  list.className = "range-commit-list";
  list.setAttribute("aria-label", "Selected commits, newest first");
  for (const hash of hashes) {
    const commit = commits.get(hash);
    const item = document.createElement("li");
    item.className = "range-commit-item";
    item.title = `${hash} · ${commit?.subject || "(no subject)"}`;
    const hashValue = document.createElement("code");
    hashValue.className = "range-commit-hash";
    hashValue.textContent = commit?.shortHash ?? shortHash(hash);
    const subjectValue = statuses.has(hash)
      ? `[${statuses.get(hash)}] ${commit?.subject || "(no subject)"}`
      : commit?.subject || "(no subject)";
    const commitSubject = span("range-commit-subject", subjectValue);
    commitSubject.title = commit?.subject ?? "";
    const commitDate = span(
      "range-commit-date",
      commit === undefined ? "—" : formatRowDate(commit.authoredAt),
    );
    commitDate.title =
      commit === undefined
        ? "Author date unavailable"
        : `Authored ${formatFullDate(commit.authoredAt)}`;
    item.append(hashValue, commitSubject, commitDate);
    list.append(item);
  }
  return list;
}

function appendDetail(
  list: HTMLDListElement,
  label: string,
  value: string,
): void {
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.title = value;
  if (label === "Commit") {
    description.className = "hash-value";
  }
  description.textContent = value;
  list.append(term, description);
}

function appendRefsDetail(
  list: HTMLDListElement,
  refs: readonly Commit["refs"][number][],
  remoteDefaults: readonly RemoteDefaultBranch[],
): void {
  const term = document.createElement("dt");
  term.textContent = "Refs";
  const description = document.createElement("dd");
  const remoteHeadRefs = new Set(
    remoteDefaults.map((candidate) => candidate.headFullName),
  );
  const visibleRefs = refs.filter((ref) => !remoteHeadRefs.has(ref.fullName));
  if (visibleRefs.length === 0) {
    description.textContent = "—";
    list.append(term, description);
    return;
  }

  description.className = "details-ref-list";
  for (const ref of visibleRefs) {
    const isRemoteDefault =
      remoteDefaultLabel(ref, remoteDefaults) !== undefined;
    const item = document.createElement("span");
    item.className = `details-ref-item ref-${ref.type}`;
    item.title = refDescription(ref, isRemoteDefault);
    item.setAttribute("aria-label", refDescription(ref, isRemoteDefault));
    const symbol = span("ref-symbol", "");
    symbol.setAttribute("aria-hidden", "true");
    item.append(symbol, span("details-ref-name", ref.name));
    description.append(item);
  }
  list.append(term, description);
}

function appendRemoteDefaultsDetail(
  list: HTMLDListElement,
  defaults: readonly RemoteDefaultBranch[],
): void {
  if (defaults.length === 0) {
    return;
  }
  appendDetail(
    list,
    defaults.length === 1 ? "Remote default" : "Remote defaults",
    defaults.map((candidate) => candidate.targetName).join(", "),
  );
}

function appendWorktreesDetail(
  list: HTMLDListElement,
  worktrees: NonNullable<Commit["worktrees"]>,
): void {
  if (worktrees.length === 0) {
    return;
  }
  const term = document.createElement("dt");
  term.textContent = worktrees.length === 1 ? "Other worktree" : "Other worktrees";
  const description = document.createElement("dd");
  description.className = "details-worktree-list";
  for (const worktree of worktrees) {
    const item = span("details-worktree-item", worktreeDescription(worktree));
    item.title = worktreeDescription(worktree);
    description.append(item);
  }
  list.append(term, description);
}

function selectCommit(hash: string, extend: boolean, toggle: boolean): void {
  if (
    !extend &&
    !toggle &&
    selection?.mode === "single" &&
    hash === selection.activeHash
  ) {
    return;
  }
  clearChangedFilePreview();
  vscode.postMessage({ type: "selectCommit", hash, extend, toggle });
}

function selectWorkingTree(): void {
  if (selection?.mode !== "workingTree") {
    clearChangedFilePreview();
    vscode.postMessage({ type: "selectWorkingTree" });
  }
}

function selectHistoryTarget(target: HTMLElement, extend: boolean): void {
  if (target.dataset.workingTree === "true") {
    selectWorkingTree();
    return;
  }
  const hash = target.dataset.hash;
  if (hash !== undefined) {
    selectCommit(hash, extend, false);
  }
}

function selectFile(path: string): void {
  selectedFilePath = path;
  updateFileSelection();
  renderSelectionDetails();
  if (selection !== undefined) {
    vscode.postMessage({ type: "selectFile", path });
  }
}

function updateCommitSelection(): void {
  const selectedHashes =
    selection?.mode === "range" || selection?.mode === "selection"
      ? new Set(selection.commitHashes)
      : new Set(
          selection === undefined || selection.mode === "workingTree"
            ? []
            : [selection.activeHash],
        );
  for (const row of elements.history.querySelectorAll<HTMLElement>(
    ".history-row",
  )) {
    const isWorkingTree = row.dataset.workingTree === "true";
    const hash = row.dataset.hash;
    const inSelection = hash !== undefined && selectedHashes.has(hash);
    const active = isWorkingTree
      ? selection?.mode === "workingTree"
      : hash !== undefined &&
        selection?.mode !== "workingTree" &&
        hash === selection?.activeHash;
    const endpoint =
      selection?.mode === "range" &&
      (hash === selection.oldestHash || hash === selection.newestHash);
    row.classList.toggle(
      "range-selected",
      selection?.mode === "range" && inSelection,
    );
    row.classList.toggle(
      "selection-selected",
      selection?.mode === "selection" && inSelection,
    );
    row.classList.toggle("range-endpoint", endpoint);
    row.classList.toggle("selected", active);
    row.setAttribute("aria-selected", String(isWorkingTree ? active : inSelection));
  }
}

function updateFileSelection(): void {
  for (const row of elements.files.querySelectorAll<HTMLElement>(".file-row")) {
    const selected = row.dataset.filePath === selectedFilePath;
    row.classList.toggle("selected", selected);
    row.setAttribute("aria-selected", String(selected));
  }
}

function selectFileAndPreview(path: string): void {
  selectFile(path);
  clearChangedFilePreview();
  changedFilePreviewTimer = window.setTimeout(() => {
    changedFilePreviewTimer = undefined;
    openDiff(path, true);
  }, 180);
}

function pinFileDiff(path: string): void {
  clearChangedFilePreview();
  selectFile(path);
  openDiff(path, false);
}

function clearChangedFilePreview(): void {
  if (changedFilePreviewTimer !== undefined) {
    window.clearTimeout(changedFilePreviewTimer);
    changedFilePreviewTimer = undefined;
  }
}

function openDiff(path: string, preview: boolean): void {
  if (selection !== undefined) {
    vscode.postMessage({ type: "openDiff", path, preview });
  }
}

function setFileViewMode(mode: FileViewMode): void {
  if (mode === fileViewMode) {
    return;
  }
  fileViewMode = mode;
  applyFileViewMode();
  renderFiles();
  updateViewState({ fileViewMode });
}

function applyViewState(state: RepositoryViewState): void {
  fileViewMode = state.fileViewMode;
  historyRatio = state.historyRatio;
  filesRatio = state.filesRatio;
  detailsCollapsed = state.detailsCollapsed;
  selectedFilePath = state.selectedFilePath;
  applyFileViewMode();
  applyHistoryRatio();
  applyRatio();
  applyDetailsState();
}

function applyFileViewMode(): void {
  elements.flatMode.setAttribute("aria-pressed", String(fileViewMode === "flat"));
  elements.treeMode.setAttribute("aria-pressed", String(fileViewMode === "tree"));
  elements.treeActions.hidden = fileViewMode !== "tree";
}

function applyHistoryRatio(): void {
  elements.workspace.dataset.historyRatio = String(historyRatio);
  elements.fileHistoryWorkspace.dataset.historyRatio = String(historyRatio);
  elements.workspaceResizer.setAttribute("aria-valuenow", String(historyRatio));
  elements.fileHistoryResizer.setAttribute(
    "aria-valuenow",
    String(historyRatio),
  );
}

function applyRatio(): void {
  elements.inspection.dataset.filesRatio = String(filesRatio);
  elements.detailsResizer.setAttribute("aria-valuenow", String(filesRatio));
}

function applyDetailsState(): void {
  elements.inspection.classList.toggle("details-collapsed", detailsCollapsed);
  elements.detailsSection.classList.toggle("collapsed", detailsCollapsed);
  elements.toggleDetails.textContent = detailsCollapsed ? "⌃" : "⌄";
  elements.toggleDetails.title = detailsCollapsed
    ? "Expand commit details"
    : "Collapse commit details";
  elements.toggleDetails.setAttribute(
    "aria-label",
    detailsCollapsed ? "Expand commit details" : "Collapse commit details",
  );
  elements.toggleDetails.setAttribute("aria-expanded", String(!detailsCollapsed));
}

function configureResizer(): void {
  let dragging = false;

  elements.detailsResizer.addEventListener("pointerdown", (event) => {
    dragging = true;
    elements.detailsResizer.setPointerCapture(event.pointerId);
    elements.detailsResizer.classList.add("dragging");
    updateRatioFromPointer(event);
  });
  elements.detailsResizer.addEventListener("pointermove", (event) => {
    if (dragging) {
      updateRatioFromPointer(event);
    }
  });
  const finish = (event: PointerEvent): void => {
    if (!dragging) {
      return;
    }
    dragging = false;
    if (elements.detailsResizer.hasPointerCapture(event.pointerId)) {
      elements.detailsResizer.releasePointerCapture(event.pointerId);
    }
    elements.detailsResizer.classList.remove("dragging");
    updateViewState({ filesRatio });
  };
  elements.detailsResizer.addEventListener("pointerup", finish);
  elements.detailsResizer.addEventListener("pointercancel", finish);
  elements.detailsResizer.addEventListener("keydown", (event) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setFilesRatio(filesRatio - 5, true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setFilesRatio(filesRatio + 5, true);
    } else if (event.key === "Home") {
      event.preventDefault();
      setFilesRatio(30, true);
    } else if (event.key === "End") {
      event.preventDefault();
      setFilesRatio(80, true);
    }
  });
}

function configureWorkspaceResizer(
  resizer: HTMLDivElement,
  workspace: HTMLElement,
): void {
  let dragging = false;

  resizer.addEventListener("pointerdown", (event) => {
    dragging = true;
    resizer.setPointerCapture(event.pointerId);
    resizer.classList.add("dragging");
    updateHistoryRatioFromPointer(event, workspace);
  });
  resizer.addEventListener("pointermove", (event) => {
    if (dragging) {
      updateHistoryRatioFromPointer(event, workspace);
    }
  });
  const finish = (event: PointerEvent): void => {
    if (!dragging) {
      return;
    }
    dragging = false;
    if (resizer.hasPointerCapture(event.pointerId)) {
      resizer.releasePointerCapture(event.pointerId);
    }
    resizer.classList.remove("dragging");
    updateViewState({ historyRatio });
  };
  resizer.addEventListener("pointerup", finish);
  resizer.addEventListener("pointercancel", finish);
  resizer.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setHistoryRatio(historyRatio - 5, true);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setHistoryRatio(historyRatio + 5, true);
    } else if (event.key === "Home") {
      event.preventDefault();
      setHistoryRatio(45, true);
    } else if (event.key === "End") {
      event.preventDefault();
      setHistoryRatio(70, true);
    }
  });
}

function updateHistoryRatioFromPointer(
  event: PointerEvent,
  workspace: HTMLElement,
): void {
  const bounds = workspace.getBoundingClientRect();
  if (bounds.width <= 0) {
    return;
  }
  setHistoryRatio(((event.clientX - bounds.left) / bounds.width) * 100, false);
}

function setHistoryRatio(value: number, persist: boolean): void {
  historyRatio = Math.min(70, Math.max(45, Math.round(value / 5) * 5));
  applyHistoryRatio();
  if (persist) {
    updateViewState({ historyRatio });
  }
}

function updateRatioFromPointer(event: PointerEvent): void {
  const bounds = elements.inspection.getBoundingClientRect();
  if (bounds.height <= 0) {
    return;
  }
  setFilesRatio(((event.clientY - bounds.top) / bounds.height) * 100, false);
}

function setFilesRatio(value: number, persist: boolean): void {
  filesRatio = Math.min(80, Math.max(30, Math.round(value / 5) * 5));
  applyRatio();
  if (persist) {
    updateViewState({ filesRatio });
  }
}

function updateViewState(patch: RepositoryViewStatePatch): void {
  vscode.postMessage({ type: "updateViewState", patch });
}

function navigateRows(
  event: KeyboardEvent,
  selector: string,
  selectTarget: (target: HTMLElement) => void,
): void {
  const current = event.currentTarget;
  if (!(current instanceof HTMLElement)) {
    return;
  }
  const rows = [...current.parentElement?.querySelectorAll<HTMLElement>(selector) ?? []];
  const index = rows.indexOf(current);
  let target: HTMLElement | undefined;
  if (event.key === "ArrowUp") {
    target = rows[Math.max(0, index - 1)];
  } else if (event.key === "ArrowDown") {
    target = rows[Math.min(rows.length - 1, index + 1)];
  } else if (event.key === "Home") {
    target = rows[0];
  } else if (event.key === "End") {
    target = rows.at(-1);
  }
  if (target !== undefined) {
    event.preventDefault();
    target.focus();
    selectTarget(target);
  } else if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    selectTarget(current);
  }
}

function setEmpty(
  container: HTMLElement,
  message: string,
  error = false,
): void {
  container.replaceChildren();
  const paragraph = document.createElement("p");
  paragraph.className = error ? "empty-state error" : "empty-state";
  paragraph.textContent = message;
  container.append(paragraph);
}

function renderRepositoryState(state: RepositoryStateKind): void {
  const message =
    state === "noWorkspace"
      ? "Open a folder to view its Git history."
      : state === "notRepository"
        ? "The selected folder is not inside a Git repository."
        : "This Git repository has no commits yet. Create its first commit, then refresh GitAmida.";
  historyHasMore = false;
  historyPageLoading = false;
  historyPageError = undefined;
  commits.clear();
  workingTree = undefined;
  selection = undefined;
  currentHead = undefined;
  currentFiles = [];
  currentTree = [];
  selectedFilePath = undefined;
  elements.selectedCommit.textContent = "No selection";
  setEmpty(elements.history, message);
  setEmpty(elements.files, "No changed files.");
  setEmpty(elements.details, "No commit selected.");
  setStatus(message);
}

function setEmptyWithRetry(container: HTMLElement, message: string): void {
  container.replaceChildren();
  const wrapper = document.createElement("div");
  wrapper.className = "empty-state error retry-state";
  wrapper.append(span("", message), createRetryButton());
  container.append(wrapper);
}

function setStatus(
  message: string,
  error = false,
  scope: "repository" | "fileHistory" = "repository",
): void {
  if (scope === "repository" && activeFileHistoryTabId !== undefined) {
    return;
  }
  elements.status.replaceChildren(span("status-message", message));
  elements.status.classList.toggle("error", error);
}

function setStatusWithRetry(message: string): void {
  if (activeFileHistoryTabId !== undefined) {
    return;
  }
  elements.status.replaceChildren(
    span("status-message", message),
    createRetryButton(),
  );
  elements.status.classList.add("error");
}

function setHistoryPageError(message: string): void {
  if (activeFileHistoryTabId !== undefined) {
    return;
  }
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "retry-button";
  retry.textContent = "Retry";
  retry.addEventListener("click", requestMoreHistory);
  elements.status.replaceChildren(span("status-message", message), retry);
  elements.status.classList.add("error");
}

function createRetryButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "retry-button";
  button.textContent = "Retry";
  button.addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
  return button;
}

function span(className: string, text: string): HTMLSpanElement {
  const value = document.createElement("span");
  value.className = className;
  value.textContent = text;
  return value;
}

function shortHash(hash: string, length = 8): string {
  return hash.slice(0, length);
}

function sameSelection(
  left: RepositorySelection,
  right: RepositorySelection | undefined,
): boolean {
  if (right === undefined || left.mode !== right.mode) {
    return false;
  }
  if (left.mode === "workingTree") {
    return (
      right.mode === "workingTree" &&
      left.headHash === right.headHash &&
      left.version === right.version
    );
  }
  if (left.mode === "single") {
    return right.mode === "single" && left.activeHash === right.activeHash;
  }
  if (left.mode === "range") {
    return (
      right.mode === "range" &&
      left.anchorHash === right.anchorHash &&
      left.activeHash === right.activeHash
    );
  }
  return (
    right.mode === "selection" &&
    left.commitHashes.join("\x00") === right.commitHashes.join("\x00")
  );
}

function selectionLabel(value: RepositorySelection): string {
  if (value.mode === "workingTree") {
    return "Working tree";
  }
  if (value.mode === "single") {
    return (
      commits.get(value.activeHash)?.shortHash ?? shortHash(value.activeHash)
    );
  }
  return `${value.commitHashes.length} commits selected`;
}

function selectionScope(): string {
  if (selection?.mode === "workingTree") {
    return "the working tree";
  }
  if (selection?.mode === "range" || selection?.mode === "selection") {
    return `${selection.commitHashes.length} selected commits`;
  }
  return "the selected commit";
}

function commitDescription(hash: string): string {
  const commit = commits.get(hash);
  return commit === undefined
    ? hash
    : `${commit.hash} · ${commit.subject || "(no subject)"}`;
}

function collectDirectoryPaths(nodes: FileTreeNode[]): Set<string> {
  const paths = new Set<string>();
  for (const node of nodes) {
    if (node.kind === "directory") {
      paths.add(node.path);
      for (const path of collectDirectoryPaths(node.children)) {
        paths.add(path);
      }
    }
  }
  return paths;
}

function refDescription(
  ref: Commit["refs"][number],
  remoteDefault = false,
): string {
  const type = {
    localBranch: "Local branch",
    remoteBranch: remoteDefault
      ? "Remote default branch"
      : "Remote-tracking branch",
    tag: "Tag",
  }[ref.type];
  const parts = [`${type}: ${ref.name}`, ref.fullName];
  if (ref.current) {
    parts.push("current branch");
  }
  if (ref.upstream !== undefined) {
    parts.push(`upstream: ${ref.upstream}${ref.tracking ?? ""}`);
  }
  return parts.join(" · ");
}

function formatRowDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatFullDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "long",
  }).format(date);
}

function fileDisplayPath(file: ChangedFile): string {
  return file.oldPath === undefined
    ? file.path
    : `${file.oldPath} → ${file.path}`;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    A: "Added",
    C: "Copied",
    D: "Deleted",
    M: "Modified",
    R: "Renamed",
    T: "Type changed",
    U: "Unmerged",
    X: "Unknown",
  };
  return labels[status[0] ?? "X"] ?? status;
}

function fileStatusLabel(file: ChangedFile): string {
  if (file.selection !== undefined) {
    const count = file.selection.changes.length;
    if (count === 1) {
      const changeStatus =
        file.selection.changes[0]?.status ?? file.status;
      const status = statusLabel(changeStatus);
      return file.content === undefined
        ? `${status} · 1 selected commit`
        : `${status} · ${contentLabel(file)} · 1 selected commit`;
    }
    return `${count} selected commits · endpoint diff`;
  }
  const status = statusLabel(file.status);
  if (file.content === undefined) {
    return status;
  }
  return `${status} · ${contentLabel(file)}`;
}

function fileStatusShortLabel(file: ChangedFile): string {
  if (file.selection !== undefined) {
    const count = file.selection.changes.length;
    if (count > 1) {
      return `${count} changes`;
    }
    const changeStatus = file.selection.changes[0]?.status ?? file.status;
    return file.content === undefined ||
      file.content.kind === "image" ||
      file.content.kind === "binary"
      ? statusLabel(changeStatus)
      : `${changeStatus[0] ?? "X"} · ${contentLabel(file, true)}`;
  }
  if (
    file.content === undefined ||
    file.content.kind === "image" ||
    file.content.kind === "binary"
  ) {
    return statusLabel(file.status);
  }
  return `${file.status[0] ?? "X"} · ${contentLabel(file, true)}`;
}

function contentLabel(file: ChangedFile, short = false): string {
  const content = file.content;
  if (content === undefined) {
    return "";
  }
  return {
    binary: "Binary",
    image: "Image",
    submodule: "Submodule",
    oversized:
      short || content.size === undefined
        ? "Large"
        : `Large · ${formatBytes(content.size)}`,
  }[content.kind];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.ceil(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (value === null) {
    throw new Error(`Missing required element: ${id}`);
  }
  return value as T;
}

function isHostMessage(value: unknown): value is HostToWebviewMessage {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

vscode.postMessage({ type: "ready" });
