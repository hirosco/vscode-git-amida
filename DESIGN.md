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

- Render every commit as one logical row with a compact primary line
- Never wrap the subject; place compact ref indicators after it on the same physical line
- Show graph, subject, and date in the history list; keep author information in commit details
- Order commits by commit date while ensuring that no parent appears before its children, and show the committed timestamp in the date column
- Give the subject flexible width and truncate it with an accessible full-value label
- Mark local and remote HEAD positions with compact, unbordered icon-and-text `HEAD` indicators instead of competing with the graph gutter
- Use fill as well as color to distinguish refs: local branch indicators are filled, remote-tracking indicators are outlined, and tags use a distinct shape
- Prefer the subject when horizontal space is scarce, then truncate overflowing ref indicators with an ellipsis
- Keep complete ref names in commit details and accessible labels rather than hover-only UI
- Treat refs as branch or tag pointers whose current target is exactly that commit. Git does not record one owning branch for a commit; branches that contain it are a separate reachability query
- Keep graph alignment stable while refs appear or disappear
- Keep the selected row visually distinct without relying on color alone

The full commit hash and other secondary metadata do not need permanent space in every row.

### Changed files and commit details

The right side is split vertically:

- Changed files above
- Selected commit details below

The divider is resizable. Commit details can be collapsed, but changed files must retain a usable minimum height.

Changed files support a flat full-path list and a user-controlled Tree mode for large changes. Flat is the default for fast scanning. Tree mode starts fully expanded whenever files are loaded and provides expand-all and collapse-all actions. Expansion state is intentionally not persisted across commit changes, refreshes, or editor restarts.

The vertical split between Repository History and inspection is resizable and shared across workspaces in the same editor profile. Its default gives inspection enough width for full commit metadata without sacrificing a usable history list; narrow containers may still reflow vertically.

Persistent borders are reserved for the structural boundaries between Repository History and inspection, and between changed files and commit details. Repeated rows, headings, status labels, and view switches rely on spacing, backgrounds, and focus states instead because themes may render `panel.border` with deliberately high contrast. Resizers keep a forgiving hit area while drawing only a one-pixel resting divider.

The details pane shows:

- Full commit subject
- Full selectable commit hash without a persistent copy button; provide copying through contextual actions
- Author name and email
- Authored or committed time, with the chosen meaning labeled
- Branch and tag refs pointing directly at the selected commit
- Parent commits
- The active comparison parent for a merge commit

Selecting a commit updates both changed files and details. Loading either area must not block or clear the other area unnecessarily.

### Commit graph

The Extension Host derives a lane model from commit hashes and parents instead of accepting terminal graph text from Git. Each history row carries typed line segments and a commit node; the Webview renders them as a compact SVG aligned with the row. Lane transitions use unsmoothed straight segments so branches and merges remain visually discrete in the dense Panel layout. This prevents terminal ANSI sequences from leaking into the browser and keeps graph structure independent of user Git color configuration.

Lane colors use VS Code's `scmGraph.foreground1` through `scmGraph.foreground5` theme tokens with standard workbench fallbacks. The graph column grows in bounded steps as concurrent lanes increase, then compresses lane spacing rather than taking unbounded horizontal space from commit subjects. The current evaluation build lays out the complete loaded history in one pass; pagination must later preserve active lane and color state across loaded batches.

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

- Keep history ref indicators display-only; their small targets are not suitable branch-switch controls
- Open the editor-native Webview context menu from a Repository History commit row and expose **Switch Branch…** only when the commit has a switchable local branch
- Use Quick Pick to show every local branch pointing at that commit, excluding the already checked-out branch
- Provide the same Quick Pick from a keyboard-accessible command for the selected commit
- Resolve and validate branch candidates again in the Extension Host instead of trusting stale Webview state
- Use `git switch` with an argument array and no shell
- Check working-tree changes, untracked conflicts, in-progress Git operations, submodules, and worktree branch occupancy before switching
- Never stash, discard, force, or save editor contents automatically
- Explain why switching is blocked and leave the repository unchanged
- Refresh HEAD, branch, history, changed files, details, and relevant file histories after a successful switch
- Do not create a local tracking branch from a remote-tracking ref in the initial implementation

The commit hash remains copyable so an informed user can run `git switch --detach <hash>` manually. Do not label a detached-HEAD action as ordinary switching.

Branch switching changes the working tree but not Git history. Keep it behind a separate application boundary from all read-only history queries and test it independently.

## Native diff editor

Load before and after Git blobs into read-only virtual documents through `TextDocumentContentProvider`, then invoke the built-in `vscode.diff` command.

Double-click and Enter are explicit open actions. Open their native diffs as pinned, non-preview editor tabs so inspecting another file does not replace an existing comparison.

For a single commit:

- Compare an ordinary commit with its first parent
- Compare a root commit with Git's empty tree
- Show the active parent for merge commits and later allow explicit parent selection

The virtual-document path accepts text blobs up to 5 MiB. Classify raster images, binary blobs, submodules, and oversized text before opening a diff, keep them visible in Changed files, and explain why the text comparison is unavailable. Do not decode unsupported content as UTF-8. Image preview and external-tool routing remain separate later checkpoints.

## Multiple-commit semantics

IntelliJ IDEA is an interaction reference for familiar selection and aggregation, not the authority for GitAmida's result semantics. Every multi-commit result must remain explainable from actual Git revisions.

- Store selection by commit hash so Date/Topology ordering and unrelated rows between selected commits do not change the result
- Distinguish a **Range**, which compares two real repository states, from a **Selection**, which investigates an explicit set of commit changes
- Show the comparison basis or contributing commits instead of presenting an unexplained combined diff
- Never create a virtual tree by cherry-picking selected commits
- Never attribute an unselected commit's change to a Selection merely to produce a convenient two-pane diff
- Fall back to per-commit diffs when selected changes cannot be composed without a hidden gap
- Treat ambiguity as a presentation constraint, not an error: keep the selected commits and explain why their diffs remain separate

### Range

A Range has explicit oldest and newest endpoints and represents one real before/after comparison. Compare the state immediately before the oldest endpoint with the tree at the newest endpoint, using the empty tree before a root commit. Show deduplicated changed files and open the resulting file comparisons in the native diff editor.

The inspection pane keeps its stable **Commit details** heading. Range selection adds nested **Range details** and **Selected commits** sections: keep the comparison basis prominent, then show a compact newest-to-oldest list matching Repository History using short hashes, subjects, and committed timestamps. Do not repeat complete author metadata for every commit in the limited Panel height; users can still inspect an individual commit by returning to single selection.

Range meaning comes from its displayed base and tip, not from every row physically located between the endpoints. Date-ordered interleaving must not silently redefine it. A merge at a comparison boundary uses an explicit parent; first parent is the initial default and must be visible to the user.

The current multiple-commit implementation supports only single selection and Range. It completes the whole path from choosing endpoints, through aggregated changed files, to a native file diff before explicit non-contiguous Selection is added.

Range endpoints must have an ancestor relationship. Use the first parent of the older endpoint as the comparison base, or the empty tree when that endpoint is a root commit. The contributing commit set is every commit reachable from the tip but not from the base, equivalent to `git rev-list base..tip`. This includes side-branch commits merged between the declared base and tip while excluding unrelated date-interleaved rows. When the older endpoint is a merge, show that first-parent choice explicitly. A Shift selection between unrelated endpoints leaves the current selection unchanged because that investigation belongs to explicit Selection rather than one before/after Range.

### Selection

A Selection is an explicit set of commits, including a set formed by adding or removing individual commits from an initial visual range. It is a review focus, not a rewritten history.

A Selection may include commits from different branches even when neither is an ancestor of the other. Aggregate their changed files and keep each contributing commit visible, but do not imply that the selection is one real final repository state. If revisions of the same file do not form an exact chain, present their commit diffs separately. A hypothetical merged branch result would require separate merge-preview semantics and is not part of Selection.

Aggregate and deduplicate changed files, retain the selected commits relevant to each file, and present their diffs in chronological order. Changes may be combined only when their before and after revisions form an exact, explainable chain that does not absorb an unselected change. When an omitted commit creates a gap in the same file, keep that file's selected commit diffs separate.

The familiar interaction target is Shift selection for an initial range and Cmd/Ctrl toggling for individual inclusion. The interaction may follow IntelliJ conventions, but the displayed result remains governed by the rules above.

### Acceptance invariants

- Ancestor-related Range results match the diff between the declared base and tip
- An unrelated branch row appearing between endpoints does not change a hash-based selection
- A file changed only by an omitted commit is absent from Selection results
- An omitted same-file change is not silently folded into a selected commit's diff
- Merge comparisons identify the active parent
- The same selected hashes produce the same result under Date and Topology ordering
- Additions, deletions, renames, cancellations, and unsupported content remain explicit rather than being dropped during deduplication

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
- Compile browser-targeted TypeScript separately from the Extension Host without a framework, bundler, or runtime dependency
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

The evaluation build temporarily loads every commit reachable from local branches, remote-tracking branches, and tags in one request, while retaining the operation timeout and output limit. This exists to measure real repository behavior and is not the intended distribution strategy.

The production target uses 100 commits as a page size, not a product limit. Prefetch the next page automatically before the user reaches the end of the current rows, preserve graph, selection, and scroll state, and continue until all reachable history is available. Do not require a routine **Load more** action. Show an explicit retry only when automatic loading fails.

## Logical architecture

The Webview renders trusted view models and emits validated user intentions. Extension Host application services own repository state, Repository History, open File History sessions, Git queries, branch-switch preflight, and virtual diff documents. The Git adapter does not import VS Code or Webview types.

Presentation preferences such as Flat or Tree mode, divider ratios, and details visibility belong to extension-global state so one adjustment applies to every workspace in the current editor profile. Repository-specific navigation state, including the selected commit and file, belongs to workspace state. Transient interactions such as tree-folder expansion are not persisted. Future behavioral options such as commit ordering must also have one global value rather than accumulating workspace overrides.

Do not introduce a second frontend or shared cross-language core unless a current product requirement justifies it.

## Safety and independence

All history, file, and diff operations are read-only. Branch switching is the only planned working-tree mutation and follows the separate safety boundary above.

GitAmida may learn from general history-viewer workflows, but it must derive its hierarchy and interactions from its own requirements. Do not reproduce JetBrains wording, icons, colors, assets, screenshots, or source code, and do not imply affiliation.
