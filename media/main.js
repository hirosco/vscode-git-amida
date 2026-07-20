(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const elements = {
    files: document.getElementById("files"),
    history: document.getElementById("history"),
    historyCount: document.getElementById("history-count"),
    repositoryMeta: document.getElementById("repository-meta"),
    repositoryName: document.getElementById("repository-name"),
    selectedCommit: document.getElementById("selected-commit"),
    status: document.getElementById("status"),
  };
  let selectedHash;

  document.getElementById("refresh").addEventListener("click", () => {
    vscode.postMessage({ type: "refresh" });
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message.type !== "string") {
      return;
    }

    switch (message.type) {
      case "historyLoading":
        setStatus("Loading history…");
        setEmpty(elements.history, "Loading commits…");
        break;
      case "history":
        renderRepository(message.repository);
        renderHistory(message.rows);
        break;
      case "filesLoading":
        selectedHash = message.hash;
        updateCommitSelection();
        setEmpty(elements.files, "Loading changed files…");
        elements.selectedCommit.textContent = shortHash(message.hash);
        setStatus("Loading changed files…");
        break;
      case "files":
        if (message.hash === selectedHash) {
          renderFiles(message.files, message.hash);
        }
        break;
      case "filesError":
        if (message.hash === selectedHash) {
          setEmpty(elements.files, message.message, true);
          setStatus(message.message, true);
        }
        break;
      case "error":
        setEmpty(elements.history, message.message, true);
        setEmpty(elements.files, "No changed files.");
        setStatus(message.message, true);
        break;
      default:
        break;
    }
  });

  function renderRepository(repository) {
    elements.repositoryName.textContent = repository.name;
    elements.repositoryMeta.textContent = `${repository.branch} · ${repository.head}`;
    elements.repositoryMeta.title = repository.root;
  }

  function renderHistory(rows) {
    elements.history.replaceChildren();
    const commitCount = rows.filter((row) => row.kind === "commit").length;
    elements.historyCount.textContent = `${commitCount} commits`;

    for (const row of rows) {
      if (row.kind === "graph") {
        const graphRow = document.createElement("div");
        graphRow.className = "graph-only";
        graphRow.textContent = row.graph;
        graphRow.setAttribute("aria-hidden", "true");
        elements.history.append(graphRow);
        continue;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "history-row";
      button.dataset.hash = row.commit.hash;
      button.setAttribute("role", "option");
      button.setAttribute("aria-label", `${row.commit.subject}, ${shortHash(row.commit.hash)}, ${row.commit.date}`);

      const graph = span("graph", row.graph);
      const details = document.createElement("span");
      details.className = "commit-details";
      const subject = span("subject", row.commit.subject || "(no subject)");
      const metadata = document.createElement("span");
      metadata.className = "commit-metadata";
      metadata.append(span("hash", shortHash(row.commit.hash)));
      if (row.commit.refs) {
        metadata.append(span("refs", row.commit.refs));
      }
      details.append(subject, metadata);
      button.append(graph, details, span("date", row.commit.date));
      button.addEventListener("click", () => {
        selectCommit(row.commit.hash);
      });
      elements.history.append(button);
    }

    setStatus("Click a commit, then double-click a file to open the editor diff.");
  }

  function renderFiles(files, hash) {
    elements.files.replaceChildren();
    if (files.length === 0) {
      setEmpty(elements.files, "This commit has no file changes.");
      setStatus("No file changes in the selected commit.");
      return;
    }

    for (const file of files) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "file-row";
      button.setAttribute("role", "option");
      button.title = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
      button.append(
        span("path", file.oldPath ? `${file.oldPath} → ${file.path}` : file.path),
        span(`status status-${file.status[0]}`, statusLabel(file.status)),
      );
      button.addEventListener("click", () => {
        for (const row of elements.files.querySelectorAll(".selected")) {
          row.classList.remove("selected");
          row.setAttribute("aria-selected", "false");
        }
        button.classList.add("selected");
        button.setAttribute("aria-selected", "true");
      });
      button.addEventListener("dblclick", () => openDiff(hash, file.path));
      button.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          openDiff(hash, file.path);
        }
      });
      elements.files.append(button);
    }
    setStatus(`${files.length} changed file${files.length === 1 ? "" : "s"}. Double-click or press Enter to open a diff.`);
  }

  function selectCommit(hash) {
    if (hash === selectedHash) {
      return;
    }
    selectedHash = hash;
    updateCommitSelection();
    vscode.postMessage({ type: "selectCommit", hash });
  }

  function updateCommitSelection() {
    for (const row of elements.history.querySelectorAll(".history-row")) {
      const selected = row.dataset.hash === selectedHash;
      row.classList.toggle("selected", selected);
      row.setAttribute("aria-selected", String(selected));
    }
  }

  function openDiff(hash, path) {
    vscode.postMessage({ type: "openDiff", hash, path });
  }

  function setEmpty(container, message, error = false) {
    container.replaceChildren();
    const paragraph = document.createElement("p");
    paragraph.className = error ? "empty-state error" : "empty-state";
    paragraph.textContent = message;
    container.append(paragraph);
  }

  function setStatus(message, error = false) {
    elements.status.textContent = message;
    elements.status.classList.toggle("error", error);
  }

  function span(className, text) {
    const element = document.createElement("span");
    element.className = className;
    element.textContent = text;
    return element;
  }

  function shortHash(hash) {
    return typeof hash === "string" ? hash.slice(0, 8) : "";
  }

  function statusLabel(status) {
    const labels = {
      A: "Added",
      C: "Copied",
      D: "Deleted",
      M: "Modified",
      R: "Renamed",
      T: "Type changed",
      U: "Unmerged",
      X: "Unknown",
    };
    return labels[status[0]] || status;
  }

  vscode.postMessage({ type: "ready" });
})();
