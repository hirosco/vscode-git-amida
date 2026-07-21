import type {
  ChangedFile,
  Commit,
  FileTreeNode,
  FileViewMode,
  HistoryRow,
  RepositoryInfo,
  RepositoryViewState,
  RepositoryViewStatePatch,
} from "../src/model";
import type {
  HostToWebviewMessage,
  WebviewToHostMessage,
} from "../src/protocol";

interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const elements = {
  details: element<HTMLDivElement>("details"),
  collapseAll: element<HTMLButtonElement>("collapse-all"),
  detailsResizer: element<HTMLDivElement>("details-resizer"),
  detailsSection: element<HTMLElement>("details-section"),
  expandAll: element<HTMLButtonElement>("expand-all"),
  files: element<HTMLDivElement>("files"),
  flatMode: element<HTMLButtonElement>("flat-mode"),
  history: element<HTMLDivElement>("history"),
  historyCount: element<HTMLSpanElement>("history-count"),
  inspection: element<HTMLElement>("inspection"),
  repositoryMeta: element<HTMLSpanElement>("repository-meta"),
  repositoryName: element<HTMLElement>("repository-name"),
  selectedCommit: element<HTMLSpanElement>("selected-commit"),
  status: element<HTMLElement>("status"),
  toggleDetails: element<HTMLButtonElement>("toggle-details"),
  treeActions: element<HTMLDivElement>("tree-actions"),
  treeMode: element<HTMLButtonElement>("tree-mode"),
  workspace: element<HTMLElement>("workspace"),
  workspaceResizer: element<HTMLDivElement>("workspace-resizer"),
};

let selectedHash: string | undefined;
let currentHead: string | undefined;
let selectedFilePath: string | undefined;
let commits = new Map<string, Commit>();
let currentFiles: ChangedFile[] = [];
let currentTree: FileTreeNode[] = [];
let fileViewMode: FileViewMode = "flat";
let historyRatio = 55;
let filesRatio = 65;
let detailsCollapsed = false;
let expandedTreePaths = new Set<string>();

element<HTMLButtonElement>("refresh").addEventListener("click", () => {
  vscode.postMessage({ type: "refresh" });
});

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

configureResizer();
configureWorkspaceResizer();

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isHostMessage(event.data)) {
    return;
  }
  const message = event.data;

  switch (message.type) {
    case "historyLoading":
      setStatus("Loading history…");
      setEmpty(elements.history, "Loading commits…");
      break;
    case "history":
      applyViewState(message.viewState);
      selectedHash = message.selectedHash;
      currentHead = message.repository.head;
      renderRepository(message.repository);
      renderHistory(message.rows);
      renderSelectedCommit();
      break;
    case "filesLoading":
      selectedHash = message.hash;
      currentFiles = [];
      currentTree = [];
      updateCommitSelection();
      renderSelectedCommit();
      setEmpty(elements.files, "Loading changed files…");
      elements.selectedCommit.textContent =
        commits.get(message.hash)?.shortHash ?? shortHash(message.hash);
      setStatus("Loading changed files…");
      break;
    case "files":
      if (message.hash === selectedHash) {
        currentFiles = message.files;
        currentTree = message.tree;
        expandedTreePaths = collectDirectoryPaths(currentTree);
        renderFiles();
      }
      break;
    case "filesError":
      if (message.hash === selectedHash) {
        setEmpty(elements.files, message.message, true);
        setStatus(message.message, true);
      }
      break;
    case "error":
      commits.clear();
      setEmpty(elements.history, message.message, true);
      setEmpty(elements.files, "No changed files.");
      setEmpty(elements.details, "No commit selected.");
      setStatus(message.message, true);
      break;
  }
});

function renderRepository(repository: RepositoryInfo): void {
  elements.repositoryName.textContent = repository.name;
  elements.repositoryMeta.textContent = `${repository.branch} · ${shortHash(repository.head, 12)}`;
  elements.repositoryMeta.title = repository.root;
}

function renderHistory(rows: HistoryRow[]): void {
  elements.history.replaceChildren();
  commits = new Map();
  const commitRows = rows.filter(
    (row): row is Extract<HistoryRow, { kind: "commit" }> =>
      row.kind === "commit",
  );
  elements.historyCount.textContent = `${commitRows.length} commits`;

  for (const row of commitRows) {
    commits.set(row.commit.hash, row.commit);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-row history-columns";
    button.dataset.hash = row.commit.hash;
    button.setAttribute("role", "option");
    const isHead = row.commit.hash === currentHead;
    const refNames = row.commit.refs.map((ref) => ref.name).join(", ");
    button.setAttribute(
      "aria-label",
      `${isHead ? "HEAD, " : ""}${row.commit.subject}, ${formatFullDate(row.commit.authoredAt)}${refNames.length === 0 ? "" : `, ${refNames}`}`,
    );

    const graph = span("graph", row.graph);
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
    button.addEventListener("click", () => selectCommit(row.commit.hash));
    button.addEventListener("keydown", (event) => {
      navigateRows(event, ".history-row", () => {
        const hash = button.dataset.hash;
        if (hash !== undefined) {
          selectCommit(hash);
        }
      });
    });
    elements.history.append(button);
  }

  updateCommitSelection();
  setStatus("Select a commit, then double-click a file to open the editor diff.");
}

function createRefList(
  commit: Commit,
  isHead: boolean,
): HTMLSpanElement | undefined {
  const currentBranch = commit.refs.find((ref) => ref.current);
  const visibleRefs = commit.refs.filter((ref) => !ref.current);
  if (!isHead && visibleRefs.length === 0) {
    return undefined;
  }

  const list = document.createElement("span");
  list.className = "ref-list";
  if (isHead) {
    const head = document.createElement("span");
    const description =
      currentBranch === undefined
        ? `HEAD · Detached at ${commit.shortHash}`
        : `HEAD · ${refTooltip(currentBranch)}`;
    head.className = "ref-head";
    head.title = description;
    head.setAttribute("role", "img");
    head.setAttribute("aria-label", description);
    head.append(span("ref-symbol", ""), span("ref-head-label", "HEAD"));
    list.append(head);
  }

  for (const ref of visibleRefs) {
    const indicator = document.createElement("span");
    const description = refTooltip(ref);
    indicator.className = `ref-indicator ref-${ref.type}`;
    indicator.title = description;
    indicator.setAttribute("role", "img");
    indicator.setAttribute("aria-label", description);
    indicator.append(span("ref-symbol", ""));
    list.append(indicator);
  }
  return list;
}

function renderFiles(): void {
  elements.files.replaceChildren();
  if (currentFiles.length === 0) {
    setEmpty(elements.files, "This commit has no file changes.");
    setStatus("No file changes in the selected commit.");
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
  setStatus(
    `${currentFiles.length} changed file${currentFiles.length === 1 ? "" : "s"}. Double-click or press Enter to open a diff.`,
  );
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
    button.title = node.path;
    button.append(
      span("tree-chevron", expanded ? "⌄" : "›"),
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

function createFileRow(
  file: ChangedFile,
  label: string,
  tree = false,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = tree ? "file-row tree-file-row" : "file-row";
  button.dataset.filePath = file.path;
  button.setAttribute("role", tree ? "treeitem" : "option");
  button.title = fileDisplayPath(file);
  button.append(
    span("path", label),
    span(`status status-${file.status[0] ?? "X"}`, statusLabel(file.status)),
  );
  button.addEventListener("click", () => selectFile(file.path));
  button.addEventListener("dblclick", () => openDiff(file.path));
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      openDiff(file.path);
      return;
    }
    navigateRows(event, ".file-row", () => selectFile(file.path));
  });
  return button;
}

function renderSelectedCommit(): void {
  const commit = selectedHash === undefined ? undefined : commits.get(selectedHash);
  elements.details.replaceChildren();
  if (commit === undefined) {
    setEmpty(elements.details, "No commit selected.");
    return;
  }

  const subject = document.createElement("p");
  subject.className = "details-subject";
  subject.textContent = commit.subject || "(no subject)";
  subject.title = commit.subject;

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
  appendDetail(
    list,
    "Refs",
    commit.refs.map((ref) => ref.name).join(", ") || "—",
  );
  appendDetail(list, "Parents", commit.parents.join(", ") || "None (root commit)");
  appendDetail(
    list,
    "Compared with",
    commit.parents[0] ?? "Empty tree (root commit)",
  );
  elements.details.append(subject, list);
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

function selectCommit(hash: string): void {
  if (hash === selectedHash) {
    return;
  }
  selectedHash = hash;
  selectedFilePath = undefined;
  currentFiles = [];
  currentTree = [];
  updateCommitSelection();
  renderSelectedCommit();
  vscode.postMessage({ type: "selectCommit", hash });
}

function selectFile(path: string): void {
  selectedFilePath = path;
  updateFileSelection();
  if (selectedHash !== undefined) {
    vscode.postMessage({ type: "selectFile", hash: selectedHash, path });
  }
}

function updateCommitSelection(): void {
  for (const row of elements.history.querySelectorAll<HTMLElement>(
    ".history-row",
  )) {
    const selected = row.dataset.hash === selectedHash;
    row.classList.toggle("selected", selected);
    row.setAttribute("aria-selected", String(selected));
  }
}

function updateFileSelection(): void {
  for (const row of elements.files.querySelectorAll<HTMLElement>(".file-row")) {
    const selected = row.dataset.filePath === selectedFilePath;
    row.classList.toggle("selected", selected);
    row.setAttribute("aria-selected", String(selected));
  }
}

function openDiff(path: string): void {
  if (selectedHash !== undefined) {
    vscode.postMessage({ type: "openDiff", hash: selectedHash, path });
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
  elements.workspaceResizer.setAttribute("aria-valuenow", String(historyRatio));
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

function configureWorkspaceResizer(): void {
  let dragging = false;

  elements.workspaceResizer.addEventListener("pointerdown", (event) => {
    dragging = true;
    elements.workspaceResizer.setPointerCapture(event.pointerId);
    elements.workspaceResizer.classList.add("dragging");
    updateHistoryRatioFromPointer(event);
  });
  elements.workspaceResizer.addEventListener("pointermove", (event) => {
    if (dragging) {
      updateHistoryRatioFromPointer(event);
    }
  });
  const finish = (event: PointerEvent): void => {
    if (!dragging) {
      return;
    }
    dragging = false;
    if (elements.workspaceResizer.hasPointerCapture(event.pointerId)) {
      elements.workspaceResizer.releasePointerCapture(event.pointerId);
    }
    elements.workspaceResizer.classList.remove("dragging");
    updateViewState({ historyRatio });
  };
  elements.workspaceResizer.addEventListener("pointerup", finish);
  elements.workspaceResizer.addEventListener("pointercancel", finish);
  elements.workspaceResizer.addEventListener("keydown", (event) => {
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

function updateHistoryRatioFromPointer(event: PointerEvent): void {
  const bounds = elements.workspace.getBoundingClientRect();
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
  selectCurrent: () => void,
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
    target.click();
  } else if (event.key === " " || event.key === "Enter") {
    selectCurrent();
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

function setStatus(message: string, error = false): void {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", error);
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

function refTooltip(ref: Commit["refs"][number]): string {
  const type = {
    localBranch: "Local branch",
    remoteBranch: "Remote-tracking branch",
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
