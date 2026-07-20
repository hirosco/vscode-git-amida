# GitAmida Design

## Purpose

GitAmida is a focused history navigator for understanding how a repository and its files changed over time.

The central experience is Repository History: scan a compact commit graph, inspect changed files and commit details, and open native diffs without hiding the log. File histories branch from that center as independent investigation tabs and can link back to the relevant repository commit.

Reviewing multiple commits as one coherent change remains a distinctive goal, but it belongs inside this broader history-navigation model rather than defining a separate tool.

## Product surface

Cursor and VS Code are the primary environments. GitAmida contributes one View Container to the bottom Panel, alongside Terminal, Problems, and Output.

The GitAmida view owns two kinds of internal tabs:

- **Repository History**: exactly one pinned, non-closable tab
- **File History**: zero or more closable tabs, one per repository path

Opening the same file history twice focuses its existing tab. File-history tabs preserve their selected revision and scroll position while another tab is active. Repository History preserves its selected commit and file state when a file-history tab is opened.

Detailed text comparisons open in the editor's native diff view instead of consuming the limited height of the bottom Panel.

## Repository History

### Commit list

The commit list is optimized for scanning a large history.

- Render every commit on exactly one row
- Never wrap subject or metadata inside a history row
- Show graph, subject, refs, author, and date as columns
- Give the subject flexible width and truncate it with an accessible full-value label
- Keep graph alignment stable while optional columns appear or disappear
- Hide lower-priority columns responsively before allowing horizontal overflow
- Keep the selected row visually distinct without relying on color alone

The full commit hash and other secondary metadata do not need permanent space in every row.

### Changed files and commit details

The right side is split vertically:

- Changed files above
- Selected commit details below

The divider is resizable. Commit details can be collapsed, but changed files must retain a usable minimum height.

Changed files initially support a flat full-path list. Add a user-controlled Tree mode for large changes, while retaining Flat mode for fast scanning and searching. Tree expansion state is presentation state and must not alter the selected files.

The details pane shows:

- Full commit subject
- Full commit hash with an explicit copy action
- Author name and email
- Authored or committed time, with the chosen meaning labeled
- Branch and tag refs
- Parent commits
- The active comparison parent for a merge commit

Selecting a commit updates both changed files and details. Loading either area must not block or clear the other area unnecessarily.

### Commit graph

The current MVP displays Git's plain graph output. The intended graph uses a theme-aware lane model with distinct colors, connected branch and merge lines, and commit markers aligned with history rows.

Derive the visual model from commit hashes and parents rather than depending on user-configured Git colors. Pagination must preserve active lane state across loaded batches.

## File History

A file history is an investigation opened from one of these entry points:

- A changed-file context menu in Repository History
- The Cursor or VS Code Explorer context menu
- The active editor's title or context menu

Several file histories may stay open simultaneously. Repository History remains a singleton because it is the stable navigation center; supporting several repository logs would add repository ownership, cache, and selection complexity without a demonstrated need.

Each File History tab shows revisions that changed the file, follows renames where Git can determine them, and retains the path identity needed to compare historical blobs.

- Single-clicking a revision updates a preview diff
- Enter or double-click opens or pins the native diff
- **Show in Repository History** activates the singleton Repository History tab, loads the commit if necessary, and selects it
- Returning to Repository History never closes the originating File History tab

Path history must handle additions, deletions, renames, merge simplification, and commits outside the initially loaded repository-history page explicitly.

## Branch switching

GitAmida plans to support switching to a named branch. It does not provide direct switching to an arbitrary commit.

- Use `git switch` with an argument array and no shell
- Check working-tree changes, untracked conflicts, in-progress Git operations, submodules, and worktree branch occupancy before switching
- Never stash, discard, force, or save editor contents automatically
- Explain why switching is blocked and leave the repository unchanged
- Refresh HEAD, branch, history, changed files, details, and relevant file histories after a successful switch

The commit hash remains copyable so an informed user can run `git switch --detach <hash>` manually. Do not label a detached-HEAD action as ordinary switching.

Branch switching changes the working tree but not Git history. Keep it behind a separate application boundary from all read-only history queries and test it independently.

## Native diff editor

Load before and after Git blobs into read-only virtual documents through `TextDocumentContentProvider`, then invoke the built-in `vscode.diff` command.

For a single commit:

- Compare an ordinary commit with its first parent
- Compare a root commit with Git's empty tree
- Show the active parent for merge commits and later allow explicit parent selection

The current virtual-document path assumes text content. Binary and image diffs must report or route unsupported content explicitly instead of coercing it into text.

## Multiple-commit semantics

### Contiguous range

Treat everything from immediately before the oldest selected commit through the newest selected commit as one change. Show deduplicated files and the final diff for the whole range.

### Non-contiguous selection

Do not create a virtual tree by cherry-picking selected commits. Aggregate changed files, show the relevant commits for each file, and present per-commit diffs in chronological order.

### Entire branch

Treat the range from the merge base with an explicit or inferred base branch through the target branch as one change. Always allow correction of an inferred base.

## Technology choices

### TypeScript extension

Implement GitAmida as one TypeScript extension.

- Cursor and VS Code provide the Extension Host runtime to installed extensions
- The View Container API makes GitAmida visible beside built-in Panel tools
- The native diff supplies selection, scrolling, syntax highlighting, accessibility, and familiar mouse behavior
- A single frontend avoids duplicating selection and navigation behavior

Node.js is a development and build tool only. Extension users do not need to install Node.js.

### Webview View

Use a Webview View because a topology graph, compact data grid, resizable details split, and multiple internal history tabs exceed what one native Tree View represents well.

- Use VS Code theme tokens instead of copying another product's presentation
- Keep all scripts and styles local
- Apply a restrictive Content Security Policy with a per-render nonce
- Render Git data through DOM text nodes, never HTML interpolation
- Validate every message at the Extension Host boundary
- Provide complete keyboard equivalents and visible focus
- Preserve responsive reflow and usable target sizes

### Git CLI

Invoke the locally installed Git CLI from the Extension Host instead of parsing `.git` directly.

- Run `execFile` with an argument array and never use a shell
- Disable color, pagers, and external diff behavior for parsed output
- Use NUL-delimited output for paths
- Apply operation-specific history, output, and time limits
- Treat Git output and Webview messages as untrusted input

The initial history loads 100 commits as an implementation limit, not a product limit. Additional history should load incrementally while preserving graph and selection state.

## Logical architecture

The Webview renders trusted view models and emits validated user intentions. Extension Host application services own repository state, Repository History, open File History sessions, Git queries, branch-switch preflight, and virtual diff documents. The Git adapter does not import VS Code or Webview types.

Do not introduce a second frontend or shared cross-language core unless a current product requirement justifies it.

## Safety and independence

All history, file, and diff operations are read-only. Branch switching is the only planned working-tree mutation and follows the separate safety boundary above.

GitAmida may learn from general history-viewer workflows, but it must derive its hierarchy and interactions from its own requirements. Do not reproduce JetBrains wording, icons, colors, assets, screenshots, or source code, and do not imply affiliation.
